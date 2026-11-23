export const config = { maxDuration: 30 };

// Giảm "thời gian suy nghĩ" của mô hình để trả lời nhanh hơn
function thinkingFor(model) {
  if (/^gemini-2\.5/.test(model)) return { thinkingBudget: 0 };
  return { thinkingLevel: 'low' };
}

async function callGemini(model, prompt, withThinking = true) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const delays = [400, 900];

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 1024,
          ...(withThinking ? { thinkingConfig: thinkingFor(model) } : {})
        }
      })
    });

    if (r.ok) return { ok: true, data: await r.json() };

    // Mô hình không nhận cấu hình thinking: thử lại không có nó
    if (r.status === 400 && withThinking) return callGemini(model, prompt, false);

    // Chỉ retry khi quá tải tạm thời (503) hoặc rate limit nhẹ (429)
    if ((r.status === 503 || r.status === 429) && attempt < delays.length) {
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
      continue;
    }

    const detail = (await r.text()).slice(0, 300);
    return { ok: false, status: r.status, detail };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || prompt.length > 4000) {
    return res.status(400).json({ error: 'bad request' });
  }

  const primaryModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'gemini-flash-latest';

  let result = await callGemini(primaryModel, prompt);

  if (!result.ok && (result.status === 503 || result.status === 404) && fallbackModel !== primaryModel) {
    result = await callGemini(fallbackModel, prompt);
  }

  if (!result.ok) {
    if (result.status === 429) return res.status(429).json({ error: 'rate limited' });
    if (result.status === 503) {
      return res.status(503).json({ error: 'busy', message: 'Model đang quá tải, thử lại sau' });
    }
    return res.status(502).json({ error: 'upstream', status: result.status, detail: result.detail });
  }

  const text = (result.data.candidates?.[0]?.content?.parts || [])
    .map(p => p.text || '').join('').replace(/```json|```/g, '').trim();

  try {
    res.status(200).json(JSON.parse(text));
  } catch {
    res.status(502).json({ error: 'parse', raw: text.slice(0, 300) });
  }
}