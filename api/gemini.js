// Vercel serverless function. The Gemini key stays on the server (GEMINI_API_KEY).
// Protection: Origin allow-list + per-IP limits (Upstash Redis if configured, in-memory fallback).
const mem = new Map();
const MAX_PROMPT = 60000;
const PER_MINUTE = 10;
const PER_DAY = 150;

function allowedHosts() {
  const hosts = new Set(['localhost:3000', 'localhost:4321', '127.0.0.1:3000']);
  const add = (v) => {
    if (!v) return;
    try { hosts.add(new URL(/^https?:/.test(v) ? v : 'https://' + v).host); } catch { }
  };
  [process.env.SITE_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]
    .forEach(add);
  (process.env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).forEach(add);
  return hosts;
}

async function upstashCount(key, ttl) {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify([['INCR', key], ['EXPIRE', key, ttl, 'NX']]),
    });
    const d = await r.json();
    return Number(d?.[0]?.result) || null;
  } catch { return null; }
}

function memCount(key, ttlMs) {
  const now = Date.now();
  const arr = (mem.get(key) || []).filter((t) => now - t < ttlMs);
  arr.push(now);
  mem.set(key, arr);
  if (mem.size > 5000) mem.clear();
  return arr.length;
}

async function overLimit(ip) {
  const minute = (await upstashCount(`ai:m:${ip}`, 60)) ?? memCount(`m:${ip}`, 60000);
  if (minute > PER_MINUTE) return true;
  const day = (await upstashCount(`ai:d:${ip}`, 86400)) ?? memCount(`d:${ip}`, 86400000);
  return day > PER_DAY;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Only our own site may call this endpoint (blocks curl/scripts and other websites)
  let originHost = '';
  try { originHost = new URL(req.headers.origin || '').host; } catch { }
  if (!originHost || !allowedHosts().has(originHost)) return res.status(403).json({ error: 'Forbidden' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'AI is not configured on the server.' });

  const ip = (req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (await overLimit(ip)) return res.status(429).json({ error: 'Too many AI requests. Please try again later.' });

  const { prompt } = req.body || {};
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT) {
    return res.status(400).json({ error: 'Invalid prompt.' });
  }

  // Try the main model first, then fall back to others if Google is overloaded or the model is gone
  const models = [...new Set([process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'].filter(Boolean))];
  let lastStatus = 502;
  for (const model of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 8192 } }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        const text = (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
        return res.status(200).json({ text });
      }
      console.error('Gemini error', model, r.status, d.error?.message);
      lastStatus = r.status;
      if (![404, 429, 500, 503].includes(r.status)) break;
    } catch (e) {
      console.error('Gemini fetch failed', model, e.message);
    }
  }
  const busy = lastStatus === 429 || lastStatus === 503;
  return res.status(busy ? 503 : 502).json({ error: busy ? 'AI is busy, please try again in a few seconds.' : 'AI request failed.' });
}
