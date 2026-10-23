// How — short-link service (Cloudflare Worker + KV).
// POST /        body: the answer JSON (max 64 KB)  → { id }
// GET  /<id>    → the answer JSON
// Bind a KV namespace to the variable LINKS (Settings → Bindings).

const ALLOWED = ['https://how.sala.company', 'https://jamalxcode.github.io', 'http://localhost:8765', 'http://127.0.0.1:8765'];
const MAX_BYTES = 64 * 1024;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes

function cors(origin) {
  const ok = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return { 'Access-Control-Allow-Origin': ok, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
}
function id(n = 7) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
}
const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export default {
  async fetch(req, env) {
    const h = cors(req.headers.get('Origin') || '');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const key = new URL(req.url).pathname.slice(1);

    if (req.method === 'GET' && /^[a-z0-9]{5,12}$/.test(key)) {
      const body = await env.LINKS.get(key);
      if (!body) return json({ error: 'not found' }, 404, h);
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=31536000, immutable', ...h } });
    }

    if (req.method === 'POST' && key === '') {
      const len = Number(req.headers.get('Content-Length') || 0);
      if (len > MAX_BYTES) return json({ error: 'too large' }, 413, h);
      const text = await req.text();
      if (text.length > MAX_BYTES) return json({ error: 'too large' }, 413, h);
      let data;
      try { data = JSON.parse(text); } catch { return json({ error: 'not json' }, 400, h); }
      if (!data || typeof data.svg !== 'string' || typeof data.title !== 'string') return json({ error: 'not an answer' }, 400, h);
      // same answer → same id, so re-sharing never fills the store
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const k = [...new Uint8Array(digest).slice(0, 6)].map((x) => ALPHABET[x % ALPHABET.length]).join('') + id(1);
      await env.LINKS.put(k, text);
      return json({ id: k }, 200, h);
    }

    return json({ ok: true, service: 'how-links' }, 200, h);
  },
};
