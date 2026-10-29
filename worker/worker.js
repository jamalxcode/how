// How — link service (Cloudflare Worker + KV).
//   POST /              body: an answer (max 64 KB)          → { id }
//   GET  /<id>          → the answer (without the picture bytes)
//   GET  /img/<id>      → the exploded-view picture (jpeg)
//   GET  /img/<id>/whole → the assembled picture, if any
//   GET  /img/<id>/factory → the painted factory floor, if any
//   GET  /img/<id>/s/<key> → a before/after picture of one factory zone (key z<zone>a or z<zone>b)
//   GET  /img/<id>/factory/<mode>, /img/<id>/s/<mode>/<key> → the same for another version of the factory
//        (mode manual, mixed or auto); the version shown when the page was stored uses the paths above
//   GET  /gallery       → the curated list [{ id, title, hook, lang, svg }]
//   POST /gallery       header X-Admin: <ADMIN_SECRET>, body { id, title, hook, lang, svg } → adds it
//   DELETE /gallery/<id> header X-Admin                      → removes it
//   POST /flag           body { id, reason }                          → marks a stored answer as wrong
//   GET  /flags          header X-Admin                                → the flagged answers, newest first
//   GET  /wiki?t=<title> → { page, url, pics: [{ src, caption }] }   (Wikipedia, cached a day)
//   GET  /3d?q=<terms>   → { models: [{ uid, name, by, url, thumb }] } (Sketchfab, cached a day)
// Bindings: KV namespace as LINKS. Optional secret ADMIN_SECRET (for the gallery).

const ALLOWED = ['https://how.sala.company', 'https://jamalxcode.github.io', 'http://localhost:8765', 'http://127.0.0.1:8765'];
const MAX_BYTES = 3 * 1024 * 1024; // answers carry a picture (~300–900 KB as base64)
// Only the site may store pages, and not too many: new pages per address per 10 minutes (per Cloudflare location).
const POST_LIMIT = 12;
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 600000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > POST_LIMIT;
}
// What a stored page may hold, and how long each text may be. Anything else is dropped.
const STR = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
const LIST = (v, n, f) => (Array.isArray(v) ? v.slice(0, n).map(f).filter(Boolean) : undefined);
function cleanAnswer(d) {
  const out = {
    title: STR(d.title, 120), hook: STR(d.hook, 400), kind: STR(d.kind, 40), lang: STR(d.lang, 40), q: STR(d.q, 120),
    wikipedia_title: STR(d.wikipedia_title, 120), search_terms: STR(d.search_terms, 120), fun_fact: STR(d.fun_fact, 600),
    image_prompt: STR(d.image_prompt, 2000), whole_prompt: STR(d.whole_prompt, 2000),
    parts: LIST(d.parts, 20, (p) => (p && typeof p === 'object' ? { name: STR(p.name, 80) || '', role: STR(p.role, 300) || '' } : null)),
    steps: LIST(d.steps, 20, (p) => (p && typeof p === 'object' ? { title: STR(p.title, 80) || '', text: STR(p.text, 600) || '' } : null)),
    badges: LIST(d.badges, 8, (b) => STR(b, 40)),
    image_id: /^[a-z0-9]{5,12}$/.test(d.image_id || '') ? d.image_id : undefined,
    factory: cleanFactory(d.factory, Array.isArray(d.parts) ? Math.min(d.parts.length, 20) : 0),
    // where the painted factory floor's zone numbers are, in % of the picture
    floor_badges: cleanBadges(d.floor_badges),
    financials: cleanFinancials(d.financials),
  };
  const m = d.m3d;
  if (m && typeof m === 'object' && /^[a-f0-9]{32}$/i.test(m.uid || '')) {
    out.m3d = { uid: m.uid, name: STR(m.name, 120), by: STR(m.by, 80), url: /^https:\/\/(www\.)?sketchfab\.com\//i.test(m.url || '') ? m.url.slice(0, 300) : undefined };
  }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}
// The Factory tab's plan (see factory.js, which trims it the same way before drawing).
const STAGE_KEYS = ['materials', 'components', 'fabrication', 'assembly', 'quality', 'packing', 'shipping'];
const WHO_KEYS = ['machine', 'both', 'human'];
function cleanFactory(f, nParts) {
  if (!f || typeof f !== 'object') return undefined;
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const n = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo; };
  const list = (v, max, fn) => (Array.isArray(v) ? v.slice(0, max).filter((x) => x && typeof x === 'object').map(fn) : []);
  const partNums = (v) => (Array.isArray(v) ? [...new Set(v.map((x) => Math.round(Number(x))))].filter((k) => k >= 1 && k <= nParts).slice(0, 12) : []);
  const stage = (k) => (STAGE_KEYS.includes(k) ? k : 'fabrication');
  const zones = list(f.zones, 12, (z) => ({
    name: s(z.name, 60), name_en: s(z.name_en, 60), stage: stage(z.stage), length_m: n(z.length_m, 2, 120), width_m: n(z.width_m, 2, 80), staff: Math.round(n(z.staff, 0, 500)),
    machines: list(z.machines, 6, (m) => ({ name: s(m.name, 60), count: Math.round(n(m.count, 1, 60)), length_m: n(m.length_m, 0.3, 60), width_m: n(m.width_m, 0.3, 30) })),
  }));
  return {
    applicable: f.applicable !== false, summary: s(f.summary, 300), output: s(f.output, 100), investment: s(f.investment, 60), unit_cost: s(f.unit_cost, 60),
    shifts: Math.round(n(f.shifts, 1, 3)), workers_per_shift: Math.round(n(f.workers_per_shift, 0, 9999)),
    building: { length_m: n(f.building?.length_m, 5, 600), width_m: n(f.building?.width_m, 5, 400), height_m: n(f.building?.height_m, 2, 40) },
    materials: list(f.materials, 10, (m) => ({ name: s(m.name, 80), form: s(m.form, 80), per_unit: s(m.per_unit, 40), parts: partNums(m.parts) })),
    components: list(f.components, 20, (c) => ({ part: Math.round(n(c.part, 0, nParts)), make: !!c.make, process: s(c.process, 160) })).filter((c) => c.part >= 1),
    steps: list(f.steps, 30, (st) => ({ stage: stage(st.stage), title: s(st.title, 60), text: s(st.text, 240), who: WHO_KEYS.includes(st.who) ? st.who : 'both', why: s(st.why, 140), parts: partNums(st.parts), zone: Math.round(n(st.zone, 0, zones.length)) })),
    zones, floor_prompt: s(f.floor_prompt, 2000),
    states: (Array.isArray(f.states) ? f.states.slice(0, zones.length) : []).map((st, i) => {
      st = st && typeof st === 'object' ? st : {};
      const k = Math.round(Number(st.before_from)); const look = (o) => ({ label: s(o?.label, 80), prompt: s(o?.prompt, 600), same_as: /^(manual|mixed|auto):z\d{1,2}[ab]$/.test(o?.same_as || '') ? o.same_as : '' });
      return { change: s(st.change, 160), before_from: k >= 1 && k <= i ? k : 0, before: look(st.before), after: look(st.after) };
    }),
  };
}
const STATE_KEY = /^z\d{1,2}[ab]$/;
const MODES = ['manual', 'mixed', 'auto'];
// The Money tab's inputs (see money.js, which trims them the same way and does all the sums).
function cleanFinancials(m) {
  if (!m || typeof m !== 'object') return undefined;
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const n = (v, hi = 1e10) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(0, x)) : 0; };
  const list = (v, max, fn) => (Array.isArray(v) ? v.slice(0, max).filter((x) => x && typeof x === 'object').map(fn) : []);
  return {
    region: s(m.region, 80), unit_label: s(m.unit_label, 30) || 'units', assumptions: (Array.isArray(m.assumptions) ? m.assumptions : []).slice(0, 6).map((a) => s(a, 160)).filter(Boolean),
    price_reference: { low: n(m.price_reference?.low, 1e7), high: n(m.price_reference?.high, 1e7), note: s(m.price_reference?.note, 160) },
    setups: list(m.setups, 3, (u) => ({
      mode: MODES.includes(u.mode) ? u.mode : 'mixed', output_per_month: n(u.output_per_month), land_m2: n(u.land_m2), building_m2: n(u.building_m2),
      staff: list(u.staff, 12, (x) => ({ role: s(x.role, 60), count: Math.round(n(x.count, 5000)), monthly_salary: n(x.monthly_salary, 1e6) })),
      capex: list(u.capex, 16, (x) => ({ item: s(x.item, 80), amount: n(x.amount) })),
      power: { installed_kw: n(u.power?.installed_kw, 1e6), kwh_per_month: n(u.power?.kwh_per_month), price_per_kwh: n(u.power?.price_per_kwh, 10) },
      opex: list(u.opex, 12, (x) => ({ item: s(x.item, 80), monthly: n(x.monthly) })),
      material_per_unit: n(u.material_per_unit, 1e7),
    })),
  };
}
const cleanBadges = (v) => LIST(v, 12, (b) => (b && Number.isInteger(b.n) && b.n >= 1 && b.n <= 12 && b.x >= 0 && b.x <= 100 && b.y >= 0 && b.y <= 100 ? { n: b.n, x: Number(b.x), y: Number(b.y) } : null));
// Decoded picture bytes must start like a JPEG, PNG or WebP file.
const looksLikeImage = (b) => b && b.length > 12 && (
  (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ||
  (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45));
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
const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', ...headers } });
const isAdmin = (req, env) => {
  const given = req.headers.get('X-Admin') || '', want = env.ADMIN_SECRET || '';
  if (!want || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
};

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
        if (!/^[a-z0-9]{5,12}$/.test(item?.id || '') || typeof item.title !== 'string') return json({ error: 'bad item' }, 400, h);
        if (!(await env.LINKS.get(item.id))) return json({ error: 'unknown id' }, 404, h);
        const list = JSON.parse((await env.LINKS.get('gallery:list')) || '[]').filter((x) => x.id !== item.id);
        list.unshift({ id: item.id, title: item.title.slice(0, 80), hook: String(item.hook || '').slice(0, 200), lang: String(item.lang || 'English').slice(0, 20), q: String(item.q || '').slice(0, 120) });
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

    if (req.method === 'GET' && /^\/img\/[a-z0-9]{5,12}\/s\/((manual|mixed|auto)\/)?z\d{1,2}[ab]$/.test(path)) {
      const bits = path.split('/'); const pid = bits[2]; const key = bits.pop(); const mode = bits.length === 5 ? bits[4] : '';
      const img = await env.LINKS.get(`imgs:${pid}:${mode ? `${mode}:` : ''}${key}`, { type: 'arrayBuffer' });
      if (!img) return json({ error: 'not found' }, 404, h);
      return new Response(img, { status: 200, headers: { 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable', ...h } });
    }
    if (req.method === 'GET' && /^\/img\/[a-z0-9]{5,12}(\/whole|\/factory(\/(manual|mixed|auto))?)?$/.test(path)) {
      const [, , pid, which, mode] = path.split('/');
      const img = await env.LINKS.get(`${which === 'whole' ? 'imgw' : which === 'factory' ? 'imgf' : 'img'}:${pid}${mode ? `:${mode}` : ''}`, { type: 'arrayBuffer' });
      if (!img) return json({ error: 'not found' }, 404, h);
      return new Response(img, { status: 200, headers: { 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable', ...h } });
    }

    const key = path.slice(1);
    if (req.method === 'GET' && /^[a-z0-9]{5,12}$/.test(key)) {
      const body = await env.LINKS.get(key);
      if (!body) return json({ error: 'not found' }, 404, h);
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=31536000, immutable', ...h } });
    }

    if (req.method === 'POST' && key === '') {
      if (!ALLOWED.includes(req.headers.get('Origin') || '')) return json({ error: 'not for this site' }, 403, h);
      const ip = req.headers.get('CF-Connecting-IP') || '';
      if (ip && tooMany(ip)) return json({ error: 'too many pages from your address, try again in a few minutes' }, 429, h);
      const len = Number(req.headers.get('Content-Length') || 0);
      if (len > MAX_BYTES) return json({ error: 'too large' }, 413, h);
      const text = await req.text();
      if (text.length > MAX_BYTES) return json({ error: 'too large' }, 413, h);
      let data;
      try { data = JSON.parse(text); } catch { return json({ error: 'not json' }, 400, h); }
      if (!data || typeof data.title !== 'string') return json({ error: 'not an answer' }, 400, h);
      // the picture: either new bytes (data URL) or a reference to one already stored (image_id)
      const decode = (v) => { const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(v || ''); return m ? Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)) : null; };
      let imgBytes = decode(data.image), wholeBytes = decode(data.image_whole), factBytes = decode(data.image_factory);
      if ([imgBytes, wholeBytes, factBytes].some((b) => b && !looksLikeImage(b))) return json({ error: 'not a picture' }, 400, h);
      if (!imgBytes && data.image_id && /^[a-z0-9]{5,12}$/.test(data.image_id)) {
        imgBytes = await env.LINKS.get(`img:${data.image_id}`, { type: 'arrayBuffer' });
        if (!wholeBytes) wholeBytes = await env.LINKS.get(`imgw:${data.image_id}`, { type: 'arrayBuffer' });
        if (!factBytes && data.has_factory_img) factBytes = await env.LINKS.get(`imgf:${data.image_id}${MODES.includes(data.factory_where) ? `:${data.factory_where}` : ''}`, { type: 'arrayBuffer' });
      }
      // before/after pictures of the factory zones: new ones as data URLs, stored ones by key
      const stateBytes = {};
      if (data.state_images && typeof data.state_images === 'object') {
        for (const [sk, v] of Object.entries(data.state_images).slice(0, 24)) {
          const b = STATE_KEY.test(sk) ? decode(v) : null;
          if (b && !looksLikeImage(b)) return json({ error: 'not a picture' }, 400, h);
          if (b) stateBytes[sk] = b;
        }
      }
      if (/^[a-z0-9]{5,12}$/.test(data.image_id || '') && Array.isArray(data.state_keys)) {
        for (const sk of data.state_keys.slice(0, 24)) {
          if (typeof sk !== 'string' || !STATE_KEY.test(sk) || stateBytes[sk]) continue;
          const b = await env.LINKS.get(`imgs:${data.image_id}:${MODES.includes(data.factory_where) ? `${data.factory_where}:` : ''}${sk}`, { type: 'arrayBuffer' });
          if (b) stateBytes[sk] = b;
        }
      }
      // the other versions of the factory (hand-made / mixed / automated), each with its own pictures
      const mode = MODES.includes(data.factory_mode) ? data.factory_mode : 'mixed';
      const variants = {}; const nParts = Array.isArray(data.parts) ? Math.min(data.parts.length, 20) : 0;
      const oldId = /^[a-z0-9]{5,12}$/.test(data.image_id || '') ? data.image_id : null;
      if (data.factories && typeof data.factories === 'object') {
        for (const m of MODES) {
          const v = data.factories[m]; if (m === mode || !v || typeof v !== 'object' || !v.factory) continue;
          const at = MODES.includes(v.where) ? `:${v.where}` : ''; // where this version's pictures are now
          let floor = decode(v.image_factory);
          if (floor && !looksLikeImage(floor)) return json({ error: 'not a picture' }, 400, h);
          if (!floor && v.has_factory_img && oldId) floor = await env.LINKS.get(`imgf:${oldId}${at}`, { type: 'arrayBuffer' });
          const pics = {};
          if (v.state_images && typeof v.state_images === 'object') {
            for (const [sk, val] of Object.entries(v.state_images).slice(0, 24)) {
              const b = STATE_KEY.test(sk) ? decode(val) : null;
              if (b && !looksLikeImage(b)) return json({ error: 'not a picture' }, 400, h);
              if (b) pics[sk] = b;
            }
          }
          if (oldId && Array.isArray(v.state_keys)) {
            for (const sk of v.state_keys.slice(0, 24)) {
              if (typeof sk !== 'string' || !STATE_KEY.test(sk) || pics[sk]) continue;
              const b = await env.LINKS.get(`imgs:${oldId}${at}:${sk}`, { type: 'arrayBuffer' });
              if (b) pics[sk] = b;
            }
          }
          const factory = cleanFactory(v.factory, nParts);
          if (factory) variants[m] = { factory, floor, pics, floor_badges: cleanBadges(v.floor_badges) };
        }
      }
      data = cleanAnswer(data);
      data.has_whole = !!wholeBytes;
      if (data.factory) data.factory_mode = mode;
      const vNames = Object.keys(variants);
      if (vNames.length) {
        data.factories = Object.fromEntries(vNames.map((m) => { const v = variants[m]; const keys = Object.keys(v.pics).sort();
          return [m, { factory: v.factory, has_factory_img: !!v.floor || undefined, state_keys: keys.length ? keys : undefined, floor_badges: v.floor_badges }]; }));
      }
      const stateKeys = data.factory ? Object.keys(stateBytes).sort() : [];
      if (stateKeys.length) data.state_keys = stateKeys;
      if (factBytes && data.factory) data.has_factory_img = true;
      // same answer (+ same picture) → same id, so re-sharing never fills the store
      const body = JSON.stringify(data);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body + (imgBytes ? imgBytes.byteLength : '') + (factBytes ? `f${factBytes.byteLength}` : '') + stateKeys.map((sk) => `${sk}${stateBytes[sk].byteLength}`).join('') + vNames.map((m) => `${m}${variants[m].floor?.byteLength || 0}${Object.values(variants[m].pics).map((b) => b.byteLength).join('.')}`).join('')));
      const k = [...new Uint8Array(digest).slice(0, 7)].map((x) => ALPHABET[x % ALPHABET.length]).join('');
      data.image_id = imgBytes ? k : (data.image_id || undefined);
      await env.LINKS.put(k, JSON.stringify(data));
      if (imgBytes) await env.LINKS.put(`img:${k}`, imgBytes);
      if (wholeBytes) await env.LINKS.put(`imgw:${k}`, wholeBytes);
      if (data.has_factory_img) await env.LINKS.put(`imgf:${k}`, factBytes);
      for (const sk of stateKeys) await env.LINKS.put(`imgs:${k}:${sk}`, stateBytes[sk]);
      for (const m of vNames) {
        if (variants[m].floor) await env.LINKS.put(`imgf:${k}:${m}`, variants[m].floor);
        for (const [sk, b] of Object.entries(variants[m].pics)) await env.LINKS.put(`imgs:${k}:${m}:${sk}`, b);
      }
      // "factory", "states" and "variants" tell the page what this service kept (an older one drops them silently)
      return json({ id: k, factory: !!data.factory, financials: !!data.financials, states: stateKeys.length,
        variants: Object.fromEntries(vNames.map((m) => [m, { floor: !!variants[m].floor, states: Object.keys(variants[m].pics).length }])) }, 200, h);
    }

    return json({ ok: true, service: 'how-links', admin: !!env.ADMIN_SECRET }, 200, h);
  },
};
