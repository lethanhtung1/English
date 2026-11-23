export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || prompt.length > 4000) {
    return res.status(400).json({ error: 'bad request' });
  }

  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

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
        maxOutputTokens: 1024
      }
    })
  });

  if (r.status === 429) return res.status(429).json({ error: 'rate limited' });
  if (!r.ok) return res.status(502).json({ error: 'upstream' });

  const d = await r.json();
  const text = (d.candidates?.[0]?.content?.parts || [])
    .map(p => p.text || '').join('').replace(/```json|```/g, '').trim();
  try {
    res.status(200).json(JSON.parse(text));
  } catch {
    res.status(502).json({ error: 'parse' });
  }
}
