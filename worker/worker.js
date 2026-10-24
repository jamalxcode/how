// How — link service (Cloudflare Worker + KV).
//   POST /              body: an answer (max 64 KB)          → { id }
//   GET  /<id>          → the answer
//   GET  /gallery       → the curated list [{ id, title, hook, lang, svg }]
//   POST /gallery       header X-Admin: <ADMIN_SECRET>, body { id, title, hook, lang, svg } → adds it
//   DELETE /gallery/<id> header X-Admin                      → removes it
//   POST /flag           body { id, reason }                          → marks a stored answer as wrong
//   GET  /flags          header X-Admin                                → the flagged answers, newest first
//   GET  /wiki?t=<title> → { page, url, pics: [{ src, caption }] }   (Wikipedia, cached a day)
//   GET  /3d?q=<terms>   → { models: [{ uid, name, by, url, thumb }] } (Sketchfab, cached a day)
// Bindings: KV namespace as LINKS. Optional secret ADMIN_SECRET (for the gallery).

const ALLOWED = ['https://how.sala.company', 'https://jamalxcode.github.io', 'http://localhost:8765', 'http://127.0.0.1:8765'];
const MAX_BYTES = 64 * 1024;
const GALLERY_MAX = 60;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes
const UA = 'HowSalaCompany/1.0 (https://how.sala.company)';

function cors(origin) {
  const ok = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return { 'Access-Control-Allow-Origin': ok, 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Admin', 'Vary': 'Origin' };
}
function id(n = 7) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
}
const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const isAdmin = (req, env) => !!env.ADMIN_SECRET && req.headers.get('X-Admin') === env.ADMIN_SECRET;

// Wikipedia: pick the pictures that show the thing, not flags, maps and icons.
const BAD_IMAGE = /icon|logo|commons-|wiki|edit-|question_book|symbol|flag_of|ambox|disambig|padlock|speaker|sound-|nuvola|crystal_clear|\.ogv|\.webm|\.ogg|\.mid|locator|coat_of_arms|seal_of|emblem|_map|map_of|chart|graph_|plot/i;
// Wikipedia's media list points at thumb.wikimedia.org with tracking parameters meant for its own
// pages; that host refuses other sites. upload.wikimedia.org serves the same files to anyone.
function wikiImageUrl(src) {
  return ('https:' + String(src).replace(/^https?:/, '')).replace(/^https:\/\/thumb\.wikimedia\.org\//, 'https://upload.wikimedia.org/').split('?')[0];
}
async function wiki(title) {
  const h = { 'User-Agent': UA, Accept: 'application/json' };
  const s = await (await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title)}&srlimit=1&format=json`, { headers: h })).json();
  const page = s.query?.search?.[0]?.title || title;
  const enc = encodeURIComponent(page.replace(/ /g, '_'));
  const [lead, media] = await Promise.all([
    fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${enc}&prop=pageimages&piprop=original&format=json&redirects=1`, { headers: h }).then((r) => r.json()).catch(() => null),
    fetch(`https://en.wikipedia.org/api/rest_v1/page/media-list/${enc}`, { headers: h }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const pics = [];
  const leadSrc = Object.values(lead?.query?.pages || {})[0]?.original?.source;
  const items = (media?.items || []).filter((it) => it.type === 'image' && it.srcset?.length && !BAD_IMAGE.test(it.title));
  // photos first, drawings (svg) after, captioned ones before uncaptioned
  items.sort((a, b) => (/\.svg$/i.test(a.title) - /\.svg$/i.test(b.title)) || (!!b.caption - !!a.caption));
  for (const it of items) {
    const small = wikiImageUrl(it.srcset[0].src);
    const src = small.replace(/\/(\d+)px-/, '/720px-');
    pics.push({ src, small, caption: it.caption?.text || it.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '').replace(/_/g, ' ') });
  }
  if (leadSrc) {
    const i = pics.findIndex((p) => p.src.split('/').pop().replace(/^\d+px-/, '') === leadSrc.split('/').pop());
    if (i > 0) pics.unshift(...pics.splice(i, 1));
  }
  return { page, url: `https://en.wikipedia.org/wiki/${enc}`, pics: pics.slice(0, 9) };
}

async function sketchfab(q) {
  // relevance order (not "most liked": the most-liked "electric motor" is an electric car),
  // and models whose name mentions the thing come first
  const res = await fetch(`https://api.sketchfab.com/v3/search?type=models&q=${encodeURIComponent(q)}&count=24&downloadable=false`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`sketchfab ${res.status}`);
  const { results } = await res.json();
  const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const score = (m) => { const n = (m.name || '').toLowerCase(); const tags = (m.tags || []).map((t) => (t.name || t.slug || '').toLowerCase()).join(' '); return words.filter((w) => n.includes(w)).length * 2 + words.filter((w) => tags.includes(w)).length; };
  const models = (results || []).filter((m) => m.uid && m.isAgeRestricted !== true).map((m, i) => ({ m, i, s: score(m) }))
    .sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 8).map(({ m }) => m).map((m) => {
    const t = (m.thumbnails?.images || []).slice().sort((x, y) => x.width - y.width).find((x) => x.width >= 200) || m.thumbnails?.images?.[0];
    return { uid: m.uid, name: m.name, by: m.user?.displayName || '', url: m.viewerUrl || `https://sketchfab.com/3d-models/${m.uid}`, thumb: t?.url || '' };
  });
  return { models };
}

// Cached JSON for the lookups (one day), keyed by the request URL.
async function cached(req, h, fn) {
  const cache = caches.default;
  const hit = await cache.match(req);
  if (hit) { const r = new Response(hit.body, hit); Object.entries(h).forEach(([k, v]) => r.headers.set(k, v)); return r; }
  let data;
  try { data = await fn(); } catch (e) { return json({ error: String(e.message || e) }, 502, h); }
  const res = json(data, 200, { 'Cache-Control': 'public, max-age=86400', ...h });
  await cache.put(req, res.clone());
  return res;
}

export default {
  async fetch(req, env) {
    const h = cors(req.headers.get('Origin') || '');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');

    if (req.method === 'GET' && path === '/wiki') {
      const t = (url.searchParams.get('t') || '').trim().slice(0, 120);
      if (!t) return json({ error: 'no title' }, 400, h);
      return cached(req, h, () => wiki(t));
    }
    if (req.method === 'GET' && path === '/3d') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
      if (!q) return json({ error: 'no query' }, 400, h);
      return cached(req, h, () => sketchfab(q));
    }

    if (path === '/gallery') {
      if (req.method === 'GET') {
        const list = await env.LINKS.get('gallery:list');
        return new Response(list || '[]', { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120', ...h } });
      }
      if (req.method === 'POST') {
        if (!isAdmin(req, env)) return json({ error: 'not allowed' }, 403, h);
        let item; try { item = await req.json(); } catch { return json({ error: 'not json' }, 400, h); }
        if (!/^[a-z0-9]{5,12}$/.test(item?.id || '') || typeof item.svg !== 'string' || typeof item.title !== 'string') return json({ error: 'bad item' }, 400, h);
        if (!(await env.LINKS.get(item.id))) return json({ error: 'unknown id' }, 404, h);
        const list = JSON.parse((await env.LINKS.get('gallery:list')) || '[]').filter((x) => x.id !== item.id);
        list.unshift({ id: item.id, title: item.title.slice(0, 80), hook: String(item.hook || '').slice(0, 200), lang: String(item.lang || 'English').slice(0, 20), q: String(item.q || '').slice(0, 120), svg: item.svg.slice(0, 20000) });
        await env.LINKS.put('gallery:list', JSON.stringify(list.slice(0, GALLERY_MAX)));
        return json({ ok: true, count: Math.min(list.length, GALLERY_MAX) }, 200, h);
      }
    }
    if (req.method === 'DELETE' && /^\/gallery\/[a-z0-9]{5,12}$/.test(path)) {
      if (!isAdmin(req, env)) return json({ error: 'not allowed' }, 403, h);
      const gid = path.split('/')[2];
      const list = JSON.parse((await env.LINKS.get('gallery:list')) || '[]').filter((x) => x.id !== gid);
      await env.LINKS.put('gallery:list', JSON.stringify(list));
      return json({ ok: true, count: list.length }, 200, h);
    }

    if (req.method === 'POST' && path === '/flag') {
      let b; try { b = await req.json(); } catch { return json({ error: 'not json' }, 400, h); }
      if (!/^[a-z0-9]{5,12}$/.test(b?.id || '')) return json({ error: 'bad id' }, 400, h);
      const stored = await env.LINKS.get(b.id);
      if (!stored) return json({ error: 'unknown id' }, 404, h);
      const list = JSON.parse((await env.LINKS.get('flags:list')) || '[]').filter((x) => x.id !== b.id);
      let title = ''; let q = ''; try { const a = JSON.parse(stored); title = a.title || ''; q = a.q || ''; } catch {}
      list.unshift({ id: b.id, title: title.slice(0, 80), q: q.slice(0, 120), reason: String(b.reason || '').slice(0, 300), at: new Date().toISOString() });
      await env.LINKS.put('flags:list', JSON.stringify(list.slice(0, 200)));
      return json({ ok: true }, 200, h);
    }
    if (req.method === 'GET' && path === '/flags') {
      if (!isAdmin(req, env)) return json({ error: 'not allowed' }, 403, h);
      return new Response((await env.LINKS.get('flags:list')) || '[]', { status: 200, headers: { 'Content-Type': 'application/json', ...h } });
    }

    const key = path.slice(1);
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
      const k = [...new Uint8Array(digest).slice(0, 7)].map((x) => ALPHABET[x % ALPHABET.length]).join('');
      await env.LINKS.put(k, text);
      return json({ id: k }, 200, h);
    }

    return json({ ok: true, service: 'how-links', admin: !!env.ADMIN_SECRET }, 200, h);
  },
};
