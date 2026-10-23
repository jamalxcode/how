// How — type a thing, see how it works.
// Static page: the AI (Claude, via OpenRouter, paid by the visitor) returns a JSON "explainer"
// with an animated SVG; this file draws it, pulls it apart, and adds Wikipedia photos and Sketchfab 3D.
'use strict';

const OPENROUTER = 'https://openrouter.ai';
const APP_TITLE = 'How';
const SITE_URL = 'https://how.sala.company/';
const LINKS_API = 'https://how-links.jamal-akuna-matata.workers.dev';
const CACHE_KEY = 'tmw_cache_v1';
const CACHE_MAX = 24;
const RTL = /^(arabic|urdu|persian|hebrew)$/i;

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const state = { key: null, result: null, query: null, abort: null, cost: 0, prices: {}, model3d: null };

const store = {
  get(k, s = localStorage) { try { return s.getItem(k); } catch { return null; } },
  set(k, v, s = localStorage) { try { s.setItem(k, v); } catch {} },
  del(k, s = localStorage) { try { s.removeItem(k); } catch {} },
};

// ---------- OpenRouter sign-in (OAuth PKCE, no server needed) ----------
function b64url(bytes) {
  let s = '';
  new Uint8Array(bytes).forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function callbackUrl() { return location.origin + location.pathname; }

async function signIn(newAccount = false) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  store.set('pkce_verifier', verifier, sessionStorage);
  const auth = new URL(`${OPENROUTER}/auth`);
  auth.searchParams.set('callback_url', callbackUrl());
  auth.searchParams.set('code_challenge', challenge);
  auth.searchParams.set('code_challenge_method', 'S256');
  if (newAccount) { location.href = auth.toString(); return; }
  const signin = new URL(`${OPENROUTER}/sign-in`);
  signin.searchParams.set('redirect_url', auth.toString());
  location.href = signin.toString();
}

async function finishSignIn() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return;
  history.replaceState(null, '', callbackUrl() + location.hash);
  const verifier = store.get('pkce_verifier', sessionStorage);
  store.del('pkce_verifier', sessionStorage);
  try {
    const res = await fetch(`${OPENROUTER}/api/v1/auth/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    });
    if (!res.ok) throw new Error(`OpenRouter sign-in failed (${res.status})`);
    const { key } = await res.json();
    if (!key) throw new Error('OpenRouter did not return a key');
    setKey(key);
  } catch (e) { showError(e.message); }
}

function setKey(key) { state.key = key; store.set('or_key', key); renderAuth(); }
function signOut() { state.key = null; store.del('or_key'); renderAuth(); }
function renderAuth() {
  $('#signin').hidden = !!state.key;
  $('#signedin').hidden = !state.key;
}

// ---------- cache of answers (so a question is paid for once per browser) ----------
function cacheKey(q, lang, level) { return `${q.trim().toLowerCase()}|${lang}|${level}`; }
function loadCache() { try { return JSON.parse(store.get(CACHE_KEY) || '{}'); } catch { return {}; } }
function cacheGet(k) { return loadCache()[k] || null; }
function cachePut(k, result) {
  const c = loadCache();
  c[k] = { ...result, at: Date.now() };
  const keys = Object.keys(c).sort((a, b) => c[b].at - c[a].at);
  keys.slice(CACHE_MAX).forEach((old) => delete c[old]);
  store.set(CACHE_KEY, JSON.stringify(c));
  renderRecent();
}
function renderRecent() {
  const c = loadCache();
  const keys = Object.keys(c).sort((a, b) => c[b].at - c[a].at).slice(0, 8);
  const box = $('#recent'); const list = $('#recent-list');
  list.innerHTML = '';
  for (const k of keys) {
    const [q, lang, level] = k.split('|');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip';
    b.textContent = c[k].title || q;
    b.title = `${q} · ${lang}`;
    b.addEventListener('click', () => { $('#q').value = q; $('#lang').value = lang; $('#level').value = level; show(c[k], q); });
    list.appendChild(b);
  }
  box.hidden = keys.length === 0;
}

// ---------- the AI call ----------
const SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'explainer', strict: true,
    schema: {
      type: 'object', additionalProperties: false,
      required: ['title', 'hook', 'kind', 'wikipedia_title', 'search_terms', 'parts', 'steps', 'fun_fact', 'svg'],
      properties: {
        title: { type: 'string' },
        hook: { type: 'string' },
        kind: { type: 'string', enum: ['object', 'process', 'refused'] },
        wikipedia_title: { type: 'string' },
        search_terms: { type: 'string' },
        parts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'role', 'color'],
          properties: { id: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, color: { type: 'string' } } } },
        steps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'text', 'parts'],
          properties: { title: { type: 'string' }, text: { type: 'string' }, parts: { type: 'array', items: { type: 'string' } } } } },
        fun_fact: { type: 'string' },
        svg: { type: 'string' },
      },
    },
  },
};

function systemPrompt(lang, level) {
  return `You are the illustrator of a children's "how it works" picture encyclopedia: the reader learns by LOOKING, not reading. Answer as JSON only.

Write every text field in ${lang}, for ${level}. Keep text tiny: hook ≤ 20 words (one captivating line); part "role" ≤ 12 words; step "text" ≤ 22 words; 3–7 parts; 3–6 steps. "title" is the thing's name in ${lang}. For a process (e.g. how a house is built, how bread rises) the "parts" are its stages or components and the steps follow them in order; set kind to "process", otherwise "object".
"wikipedia_title": the English Wikipedia article title for the thing. "search_terms": 2–3 English words to find a 3D model of it. "fun_fact": one surprising sentence.

The "svg" is the heart of the answer: ONE bold, flat-colour cutaway or side-view illustration in the style of a vintage children's encyclopedia, showing the real mechanism clearly. Rules:
- Start with <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"> (no width/height). First element: <rect width="800" height="520" fill="#fbf4e4"/>.
- Draw with simple primitives (rect, circle, ellipse, path, polygon, polyline, line). Thick dark outlines: stroke="#1d2433" stroke-width="3" or "4", stroke-linejoin="round", stroke-linecap="round". Flat fills using the "color" you give each part (choose from a warm, readable palette: #e4572e, #1f8a8a, #e8b43a, #2b4c7e, #9bc4bc, #d98c5f, #8a6fbf, #a3b86c, #c0c7d0, #f2e3c6).
- EACH part is exactly one group: <g id="PARTID"> containing all its shapes. PARTID matches the parts list. Give each part data-explode="dx dy": the direction (dx, dy between -230 and 230, each part a different direction, outward from the picture's centre) it should move when the picture is pulled apart so parts stop overlapping. Keep the part <g> itself free of transform/opacity attributes; put any static transform on an inner <g>.
- Make the mechanism MOVE with SMIL animation (<animate>, <animateTransform additive="sum">, <animateMotion>), repeatCount="indefinite", dur 1–4 s, on elements INSIDE the part groups: pistons slide, blades close, gears turn (mesh correctly), valves open, air/water/electricity flows (animated stroke-dashoffset on dashed paths, in <g id="fx"> with your flow arrows). For a process, loop through the stages (~2 s each) by animating opacity so they appear in order and build up. The scene must look alive the moment it loads.
- Keep motion arrows, flow lines and ground/decoration in <g id="fx">; everything else that is drawn belongs to a part.
- No text inside the SVG (the page adds numbered labels), except tiny numbers if essential. No <script>, <foreignObject>, <image>, <use> of external resources, no external URLs, no CSS classes. Total svg under 9000 characters. Valid XML: close every tag, escape & as &amp;.
Draw accurately: real proportions, the real arrangement of parts, the real motion. Never refuse a safe everyday topic. If the request is unsafe (weapons, explosives, drugs, harming people) or meaningless, set kind to "refused", explain in "hook" in ${lang}, and return empty parts, steps and svg.`;
}

async function askAI(q, lang, level, model, signal) {
  const messages = [
    { role: 'system', content: systemPrompt(lang, level) },
    { role: 'user', content: `Show me how this works: ${q}` },
  ];
  let text;
  try {
    text = await callAI({ model, messages, maxTokens: 16000, responseFormat: SCHEMA, signal });
  } catch (e) {
    if (signal.aborted) throw e;
    // Some model/provider combinations reject strict schemas; ask again without one.
    if (!/schema|response_format|parameters/i.test(e.message)) throw e;
    text = await callAI({ model, messages: [...messages, { role: 'system', content: 'Reply with the JSON object only, no prose, no code fences.' }], maxTokens: 16000, signal });
  }
  return parseJSON(text);
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  throw new Error('The AI answered in a form the page could not read. Try again, or another model.');
}

class RetryableError extends Error {
  constructor(message, retryAfterMs) { super(message); this.retryAfterMs = retryAfterMs; }
}
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
  });
}

async function callAI({ model, messages, maxTokens, responseFormat, signal }) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await requestAI({ model, messages, maxTokens, responseFormat, signal });
    } catch (e) {
      const retryable = e instanceof RetryableError || (e instanceof TypeError && !signal?.aborted);
      if (!retryable || attempt >= 3) {
        throw e instanceof TypeError ? new Error('Could not reach OpenRouter. Check your connection and try again.') : e;
      }
      const wait = e.retryAfterMs ?? 2000 * 2 ** (attempt - 1);
      setLoading('Still drawing…', `The AI service is busy; trying again in ${Math.ceil(wait / 1000)} s`);
      await sleep(wait, signal);
    }
  }
}

async function requestAI({ model, messages, maxTokens, responseFormat, signal }) {
  const res = await fetch(`${OPENROUTER}/api/v1/chat/completions`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${state.key}`, 'Content-Type': 'application/json', 'HTTP-Referer': callbackUrl(), 'X-Title': APP_TITLE },
    body: JSON.stringify({
      model, messages, max_tokens: maxTokens, usage: { include: true },
      ...(responseFormat && { response_format: responseFormat, provider: { require_parameters: true } }),
    }),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch {}
    if (res.status === 401) { signOut(); throw new Error('Your OpenRouter session expired. Please sign in again.'); }
    if (res.status === 402) throw new Error('Your OpenRouter account is out of credit. Add credit at openrouter.ai/settings/credits.');
    if (RETRY_STATUS.has(res.status)) {
      const after = Number(res.headers.get('retry-after'));
      throw new RetryableError(`AI request failed: ${msg}`, after > 0 ? Math.min(after, 30) * 1000 : undefined);
    }
    throw new Error(`AI request failed: ${msg}`);
  }
  const j = await res.json();
  if (j.error) throw new RetryableError(j.error.message || 'The AI returned an error');
  if (j.usage?.cost != null) state.cost += Number(j.usage.cost);
  return j.choices?.[0]?.message?.content || '';
}

// ---------- the flow ----------
const LOADING_LINES = [
  'Taking it apart to see what\'s inside', 'Sharpening the pencils', 'Checking which part pushes which',
  'Colouring in the moving bits', 'Making sure the gears mesh', 'Adding the arrows',
  'Looking for a photo of the real thing', 'Finding a 3D model to spin around',
];
let loadingTimer = null;
function setLoading(title, msg) {
  if (title) $('#loading-title').textContent = title;
  if (msg) $('#loading-msg').textContent = msg;
}
function startLoading(q) {
  $('#loading').hidden = false; $('#result').hidden = true; $('#error').hidden = true;
  setLoading(`Drawing ${q}…`, LOADING_LINES[0]);
  let i = 1;
  clearInterval(loadingTimer);
  loadingTimer = setInterval(() => { setLoading(null, LOADING_LINES[i++ % LOADING_LINES.length]); }, 2600);
  $('#loading').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function stopLoading() { clearInterval(loadingTimer); $('#loading').hidden = true; }

function showError(msg) {
  stopLoading();
  $('#error-msg').textContent = msg;
  $('#error').hidden = false;
}

async function ask(q, { force = false } = {}) {
  q = q.trim();
  if (!q) return;
  const lang = $('#lang').value; const level = $('#level').value; const model = $('#model').value;
  $('#q').value = q;
  location.hash = `q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}`;

  if (!force) {
    if (typeof DEMO !== 'undefined' && DEMO[q.toLowerCase()] && lang === 'English') { show(DEMO[q.toLowerCase()], q, { free: true }); return; }
    const cached = cacheGet(cacheKey(q, lang, level));
    if (cached) { show(cached, q, { free: true }); return; }
  }
  if (!state.key) {
    store.set('pending_q', q, sessionStorage);
    showError('To draw a new answer, sign in to OpenRouter first (top right). The scissors demo and anything you have seen before are free.');
    $('#signin').focus();
    return;
  }

  state.abort?.abort();
  const ctrl = new AbortController(); state.abort = ctrl;
  state.cost = 0;
  startLoading(q);
  try {
    const result = await askAI(q, lang, level, model, ctrl.signal);
    if (ctrl.signal.aborted) return;
    result.lang = lang; result.cost = state.cost; result.model = model;
    if (result.kind !== 'refused' && result.svg) cachePut(cacheKey(q, lang, level), result);
    show(result, q);
  } catch (e) {
    if (e.name === 'AbortError') { stopLoading(); return; }
    showError(e.message);
  }
}

// ---------- rendering ----------
let partsById = {};
function show(result, q, { free = false, shared = false } = {}) {
  state.result = result; state.query = q; state.shortId = undefined;
  stopLoading();
  $('#error').hidden = true;
  const r = $('#result');
  r.hidden = false;
  document.body.classList.add('has-result');
  r.setAttribute('dir', RTL.test(result.lang || '') ? 'rtl' : 'ltr');
  r.setAttribute('lang', langCode(result.lang));
  if (r.getAttribute('dir') === 'rtl') loadArabicFont();

  $('#r-kind').textContent = result.kind === 'process' ? 'How it is done' : result.kind === 'refused' ? 'Sorry' : 'How it works';
  $('#r-title').textContent = result.title || q;
  $('#r-hook').textContent = result.hook || '';
  $('#fact').textContent = result.fun_fact || '';
  $('#shared-note').hidden = !shared;
  $('#cost').textContent = shared ? '' : free ? 'Free (already drawn)' : result.cost ? `This drawing cost $${result.cost.toFixed(3)}` : '';

  partsById = {};
  (result.parts || []).forEach((p, i) => { partsById[p.id] = { ...p, n: i + 1 }; });

  // steps and parts lists
  const steps = $('#steps'); steps.innerHTML = '';
  (result.steps || []).forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="num">${i + 1}</span><strong></strong><span></span>`;
    li.querySelector('strong').textContent = s.title;
    li.querySelector('span:not(.num)').textContent = s.text;
    li.addEventListener('click', () => { highlight(s.parts || [], li); });
    steps.appendChild(li);
  });
  const parts = $('#parts'); parts.innerHTML = '';
  (result.parts || []).forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="num"></span><strong></strong><span></span>`;
    const num = li.querySelector('.num'); num.textContent = i + 1; num.style.background = safeColor(p.color);
    li.querySelector('strong').textContent = p.name;
    li.querySelector('span:not(.num)').textContent = p.role;
    li.addEventListener('click', () => { highlight([p.id], li); openCallout(p.id); });
    parts.appendChild(li);
  });

  drawSVG(result.svg || '');
  setView('works');
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });

  // the other tabs load in the background, free of charge
  loadPhotos(result.wikipedia_title || q);
  load3D(result.search_terms || q, result.m3d);
}

function langCode(name) {
  const m = { English: 'en', Arabic: 'ar', French: 'fr', Spanish: 'es', German: 'de', Portuguese: 'pt', Italian: 'it', Turkish: 'tr', Russian: 'ru', Hindi: 'hi', Urdu: 'ur', Persian: 'fa', Chinese: 'zh', Japanese: 'ja', Korean: 'ko', Indonesian: 'id', Swahili: 'sw' };
  return m[name] || 'en';
}
let arabicFontLoaded = false;
function loadArabicFont() {
  if (arabicFontLoaded) return; arabicFontLoaded = true;
  const l = document.createElement('link'); l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;700&display=swap';
  document.head.appendChild(l);
}
function safeColor(c) { return /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#1d2433'; }

// Parse the AI's SVG safely, wrap every part in a group of our own (so pulling apart never fights
// the AI's own transforms/animations), and add numbered labels.
function drawSVG(svgText) {
  const stage = $('#stage'); stage.innerHTML = '';
  $('#callout').hidden = true;
  if (!svgText.trim()) { stage.innerHTML = '<p class="empty">No drawing for this one.</p>'; return; }
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  let svg = doc.documentElement;
  if (svg.nodeName !== 'svg' || doc.querySelector('parsererror')) {
    // try to repair the commonest slip: an unescaped ampersand
    const doc2 = new DOMParser().parseFromString(svgText.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, '&amp;'), 'image/svg+xml');
    svg = doc2.documentElement;
    if (svg.nodeName !== 'svg' || doc2.querySelector('parsererror')) { stage.innerHTML = '<p class="empty">The drawing came back broken. Try “Draw it again”.</p>'; return; }
  }
  // sanitize
  $$('script, foreignObject, image, iframe, object, embed, a', svg).forEach((n) => n.remove());
  $$('*', svg).forEach((el) => {
    for (const a of [...el.attributes]) {
      const name = a.name.toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'xlink:href') && !a.value.startsWith('#'))) el.removeAttribute(a.name);
    }
  });
  svg.removeAttribute('width'); svg.removeAttribute('height');
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', '0 0 800 520');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg = document.importNode(svg, true);

  // wrap parts
  for (const id of Object.keys(partsById)) {
    const g = svg.getElementById(id);
    if (!g) continue;
    const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    wrap.setAttribute('data-part', id);
    const [dx, dy] = (g.getAttribute('data-explode') || '0 0').split(/[\s,]+/).map(Number);
    wrap.dataset.dx = isFinite(dx) ? dx : 0; wrap.dataset.dy = isFinite(dy) ? dy : 0;
    g.parentNode.insertBefore(wrap, g);
    wrap.appendChild(g);
    wrap.addEventListener('click', (e) => { e.stopPropagation(); highlight([id]); openCallout(id); });
  }
  stage.appendChild(svg);
  svg.addEventListener('click', () => { clearHighlight(); $('#callout').hidden = true; });

  // labels: one numbered badge per part, placed on the part's biggest shape (or where the
  // AI said with data-label="x y"), nudged apart so badges never sit on top of each other.
  const placed = [];
  for (const [id, p] of Object.entries(partsById)) {
    const wrap = svg.querySelector(`[data-part="${CSS.escape(id)}"]`);
    if (!wrap) continue;
    let cx, cy;
    const hint = (wrap.firstElementChild?.getAttribute('data-label') || '').split(/[\s,]+/).map(Number);
    if (hint.length === 2 && hint.every(isFinite)) { [cx, cy] = hint; }
    else {
      // biggest shape, measured in the picture's own coordinates (shapes may sit inside transformed groups)
      let best = null, bestArea = -1;
      const rootM = svg.getScreenCTM();
      if (!rootM) continue;
      const inv = rootM.inverse();
      for (const el of $$('rect, circle, ellipse, path, polygon, polyline, line', wrap)) {
        let bb, m; try { bb = el.getBBox(); m = inv.multiply(el.getScreenCTM()); } catch { continue; }
        const pts = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]]
          .map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
        const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
        const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        const area = box.w * box.h;
        if (area > bestArea) { bestArea = area; best = box; }
      }
      if (!best) continue;
      cx = best.x + best.w / 2; cy = best.y + best.h / 2;
    }
    for (let tries = 0; tries < 12; tries++) {
      const hit = placed.find((q) => Math.hypot(q.x - cx, q.y - cy) < 44);
      if (!hit) break;
      const ang = Math.atan2(cy - hit.y, cx - hit.x) || (tries * 1.1);
      cx = hit.x + Math.cos(ang) * 46; cy = hit.y + Math.sin(ang) * 46;
    }
    placed.push({ x: cx, y: cy });
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    l.setAttribute('data-label', id);
    l.innerHTML = `<circle r="18" fill="${safeColor(p.color)}" stroke="#1d2433" stroke-width="3"/><text y="7" text-anchor="middle" font-family="Nunito,system-ui,sans-serif" font-weight="900" font-size="20" fill="#fff" stroke="#1d2433" stroke-width="3" paint-order="stroke">${p.n}</text>`;
    l.setAttribute('transform', `translate(${cx.toFixed(1)} ${cy.toFixed(1)})`);
    wrap.appendChild(l); // inside the wrapper so it moves with the part
  }
  explode(0);
}

function highlight(ids, li) {
  const svg = $('#stage svg'); if (!svg) return;
  $$('.hot', document).forEach((n) => n.classList.remove('hot'));
  const found = ids.map((id) => svg.querySelector(`[data-part="${CSS.escape(id)}"]`)).filter(Boolean);
  if (!found.length) { svg.classList.remove('dim'); return; }
  found.forEach((n) => n.classList.add('hot'));
  svg.classList.add('dim');
  li?.classList.add('hot');
  // also mark matching part cards
  ids.forEach((id) => { const n = partsById[id]?.n; if (n) $(`#parts li:nth-child(${n})`)?.classList.add('hot'); });
}
function clearHighlight() {
  $('#stage svg')?.classList.remove('dim');
  $$('.hot', document).forEach((n) => n.classList.remove('hot'));
}
function openCallout(id) {
  const p = partsById[id]; if (!p) return;
  $('#callout-num').textContent = p.n; $('#callout-num').style.background = safeColor(p.color);
  $('#callout-name').textContent = p.name; $('#callout-role').textContent = p.role;
  $('#callout').hidden = false;
}

function explode(k) {
  const svg = $('#stage svg'); if (!svg) return;
  let maxX = 0, maxY = 0;
  $$('[data-part]', svg).forEach((w) => {
    w.style.transform = k ? `translate(${w.dataset.dx * k}px, ${w.dataset.dy * k}px)` : '';
    maxX = Math.max(maxX, Math.abs(w.dataset.dx * k)); maxY = Math.max(maxY, Math.abs(w.dataset.dy * k));
  });
  // zoom out so pulled-apart pieces stay inside the picture
  if (!svg.dataset.vb) svg.dataset.vb = svg.getAttribute('viewBox');
  const [x, y, w, h] = svg.dataset.vb.split(/[\s,]+/).map(Number);
  const padX = Math.min(maxX * 0.75, w / 2), padY = Math.min(maxY * 0.75, h / 2);
  svg.setAttribute('viewBox', `${x - padX} ${y - padY} ${w + 2 * padX} ${h + 2 * padY}`);
}

let playing = true;
function setPlaying(on) {
  playing = on;
  const svg = $('#stage svg'); if (!svg) return;
  try { on ? svg.unpauseAnimations() : svg.pauseAnimations(); } catch {}
  $('#play').textContent = on ? '⏸ Pause' : '▶ Play';
}

function setView(view) {
  $$('.tab').forEach((t) => { const on = t.dataset.view === view; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); });
  $('#view-drawing').hidden = !(view === 'works' || view === 'parts');
  $('#view-photos').hidden = view !== 'photos';
  $('#view-model3d').hidden = view !== 'model3d';
  $('#controls-works').hidden = view !== 'works';
  $('#controls-parts').hidden = view !== 'parts';
  $('#steps').hidden = view !== 'works';
  $('#parts').hidden = view !== 'parts';
  clearHighlight(); $('#callout').hidden = true;
  const svg = $('#stage svg');
  if (view === 'parts') {
    svg?.classList.add('exploded');
    try { svg?.pauseAnimations(); } catch {}
    explode($('#explode').value / 100);
  } else if (view === 'works') {
    svg?.classList.remove('exploded');
    explode(0);
    setPlaying(true);
  }
}

// ---------- photos of the real thing (Wikipedia) ----------
const BAD_IMAGE = /icon|logo|commons-|wiki|edit-|question_book|symbol|flag_of|ambox|disambig|padlock|speaker|sound-|nuvola|crystal_clear|\.ogv|\.webm|\.ogg/i;
async function loadPhotos(title) {
  const box = $('#gallery'); box.innerHTML = '<p class="empty">Looking for photos…</p>';
  $('#gallery-credit').textContent = '';
  try {
    let page = title;
    // resolve to the actual article (redirects, spelling), via the search API
    const s = await (await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title)}&srlimit=1&format=json&origin=*`)).json();
    if (s.query?.search?.[0]) page = s.query.search[0].title;
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(page.replace(/ /g, '_'))}`);
    if (!res.ok) throw new Error();
    const { items } = await res.json();
    const pics = (items || []).filter((it) => it.type === 'image' && it.srcset?.length && !BAD_IMAGE.test(it.title)).slice(0, 9);
    if (!pics.length) throw new Error();
    box.innerHTML = '';
    pics.forEach((it, i) => {
      const src = ('https:' + it.srcset[0].src.replace(/^https?:/, '')).replace(/\/(\d+)px-/, '/720px-');
      const fig = document.createElement('figure'); if (i === 0) fig.className = 'wide';
      const img = document.createElement('img'); img.loading = 'lazy'; img.src = src; img.alt = it.caption?.text || it.title;
      img.addEventListener('error', () => fig.remove());
      const cap = document.createElement('figcaption'); cap.textContent = it.caption?.text || it.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '').replace(/_/g, ' ');
      fig.append(img, cap);
      box.appendChild(fig);
    });
    const a = `https://en.wikipedia.org/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}`;
    $('#gallery-credit').innerHTML = `Photos from the Wikipedia article <a href="${a}" target="_blank" rel="noopener"></a>, each under its own licence.`;
    $('#gallery-credit a').textContent = page;
  } catch {
    box.innerHTML = `<p class="empty">No photos found. <a href="https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(title)}" target="_blank" rel="noopener">Search Wikipedia</a></p>`;
  }
}

// ---------- 3D models (Sketchfab) ----------
async function load3D(terms, known) {
  const box = $('#model3d'); box.innerHTML = '<p class="empty">Looking for a 3D model…</p>';
  state.model3d = known || null;
  $('#model3d-credit').textContent = '';
  const searchLink = `https://sketchfab.com/search?q=${encodeURIComponent(terms)}&type=models`;
  try {
    const res = await fetch(`https://api.sketchfab.com/v3/search?type=models&q=${encodeURIComponent(terms)}&count=8&sort_by=-likeCount&downloadable=false`);
    if (!res.ok) throw new Error();
    const { results } = await res.json();
    let models = (results || []).filter((m) => m.uid && m.isAgeRestricted !== true);
    if (known?.uid) models = [known, ...models.filter((m) => m.uid !== known.uid)];
    if (!models.length) throw new Error();
    box.innerHTML = '<div class="viewer"><iframe title="3D model" allow="autoplay; fullscreen; xr-spatial-tracking" allowfullscreen></iframe></div><div class="thumbs"></div>';
    const iframe = $('iframe', box); const thumbs = $('.thumbs', box);
    const pick = (m, btn) => {
      state.shortId = undefined;
      state.model3d = { uid: m.uid, name: m.name, by: m.user?.displayName ?? m.by ?? '', url: m.viewerUrl || m.url || '', thumb: thumbOf(m) };
      iframe.src = `https://sketchfab.com/models/${m.uid}/embed?autostart=0&ui_infos=1&ui_watermark=0&dnt=1`;
      $$('button', thumbs).forEach((b) => b.classList.toggle('active', b === btn));
      $('#model3d-credit').innerHTML = `<a target="_blank" rel="noopener"></a> by ${escapeHTML(state.model3d.by || 'a Sketchfab artist')} on Sketchfab, under its own licence. Drag to spin, pinch or scroll to zoom.`;
      const a = $('#model3d-credit a'); a.href = state.model3d.url || `https://sketchfab.com/3d-models/${m.uid}`; a.textContent = m.name;
    };
    models.forEach((m, i) => {
      const b = document.createElement('button'); b.type = 'button';
      const t = thumbOf(m);
      b.innerHTML = `<img alt="" loading="lazy"><span></span>`;
      if (t) $('img', b).src = t;
      $('span', b).textContent = m.name;
      b.addEventListener('click', () => pick(m, b));
      thumbs.appendChild(b);
      if (i === 0) pick(m, b);
    });
  } catch {
    if (known?.uid) {
      box.innerHTML = '<div class="viewer"><iframe title="3D model" allow="autoplay; fullscreen; xr-spatial-tracking" allowfullscreen></iframe></div>';
      $('iframe', box).src = `https://sketchfab.com/models/${known.uid}/embed?autostart=0&ui_infos=1&ui_watermark=0&dnt=1`;
      $('#model3d-credit').innerHTML = `<a target="_blank" rel="noopener"></a> by ${escapeHTML(known.by || 'a Sketchfab artist')} on Sketchfab, under its own licence.`;
      const a = $('#model3d-credit a'); a.href = known.url || `https://sketchfab.com/3d-models/${known.uid}`; a.textContent = known.name || '3D model';
      return;
    }
    box.innerHTML = `<p class="empty">Couldn't load a 3D model here. <a href="${searchLink}" target="_blank" rel="noopener">Browse models on Sketchfab</a></p>`;
  }
}
function thumbOf(m) {
  if (m.thumb) return m.thumb;
  const t = (m.thumbnails?.images || []).slice().sort((x, y) => x.width - y.width).find((x) => x.width >= 200) || m.thumbnails?.images?.[0];
  return t?.url || '';
}
function escapeHTML(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------- prices (estimate shown under "More options") ----------
const FALLBACK = { 'anthropic/claude-sonnet-5.5': [2e-6, 10e-6], 'anthropic/claude-opus-5.5': [4e-6, 20e-6], 'anthropic/claude-haiku-5.5': [0.1e-6, 0.5e-6] };
async function loadPrices() {
  try {
    const { data } = await (await fetch(`${OPENROUTER}/api/v1/models`)).json();
    for (const m of data) if (m.id.startsWith('anthropic/')) state.prices[m.id] = [Number(m.pricing.prompt), Number(m.pricing.completion)];
  } catch {}
  updateEstimate();
}
function updateEstimate() {
  const m = $('#model').value;
  const [i, o] = state.prices[m] || FALLBACK[m] || [0, 0];
  const cost = 1800 * i + 5000 * o; // prompt + a typical drawing
  $('#estimate').textContent = cost ? `About $${cost.toFixed(2)} per new drawing, charged to your OpenRouter account. Reopening an answer is free.` : '';
}

// ---------- sharing: the whole answer travels inside the link ----------
// The answer (JSON with the SVG) is deflated and base64url-encoded into #r=…, so a reader
// needs no sign-in and no AI: the page just unpacks and draws it. Typical link: 3–5 KB.
async function encodeResult(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let out = bytes, tag = 'u';
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    out = new Uint8Array(await new Response(stream).arrayBuffer()); tag = 'd';
  }
  return tag + b64url(out);
}
async function decodeResult(str) {
  const tag = str[0]; const b64 = str.slice(1).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64); const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  let json;
  if (tag === 'd') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    json = await new Response(stream).text();
  } else json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}
// Short link: the answer is stored by the links service and the link carries only its id.
// If the service can't be reached, the long link (answer inside the address) is used instead.
async function shareUrl() {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
  const base = local ? SITE_URL : location.origin + location.pathname;
  const slug = encodeURIComponent(fileSlug());
  const payload = sharePayload(state.result);
  if (state.shortId === undefined) {
    try {
      const res = await fetch(`${LINKS_API}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = res.ok ? await res.json() : null;
      state.shortId = j?.id || null;
    } catch { state.shortId = null; }
  }
  const url = state.shortId ? `${base}#${slug}/s=${state.shortId}` : `${base}#${slug}/r=${await encodeResult(payload)}`;
  $('#share-link-size').textContent = state.shortId ? 'Short link; the answer is kept by the link service' : `${(url.length / 1024).toFixed(1)} KB, everything inside the address`;
  return url;
}
function sharePayload(result) {
  const { title, hook, kind, wikipedia_title, search_terms, parts, steps, fun_fact, lang } = result;
  const svg = (result.svg || '').replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ');
  const m = state.model3d;
  const m3d = m?.uid ? { uid: m.uid, name: m.name, by: m.by, url: m.url } : undefined;
  return { title, hook, kind, wikipedia_title, search_terms, parts, steps, fun_fact, svg, lang, m3d, q: state.query };
}
function openShare() {
  if (!state.result) return;
  $('#share-status').textContent = '';
  $('#share-native').hidden = !navigator.share;
  shareUrl();
  $('#share-dialog').showModal();
}
function shareStatus(msg) { $('#share-status').textContent = msg; }
function fileSlug() { return (state.result?.title || 'how').replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'how'; }
function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// The drawing as shown (with numbered labels), un-exploded, as a standalone SVG string.
function currentSVG() {
  const svg = $('#stage svg'); if (!svg) return '';
  const clone = svg.cloneNode(true);
  $$('[data-part]', clone).forEach((w) => { w.removeAttribute('style'); w.classList.remove('hot'); });
  clone.classList.remove('dim', 'exploded');
  if (svg.dataset.vb) clone.setAttribute('viewBox', svg.dataset.vb);
  clone.removeAttribute('class');
  return new XMLSerializer().serializeToString(clone);
}
// One self-contained HTML file: the drawing (still animated), parts, steps, fact, links, and a
// link back to the interactive version. Opens anywhere, offline, no scripts.
async function buildReport() {
  const r = state.result; const esc = escapeHTML;
  const rtl = RTL.test(r.lang || '');
  const link = await shareUrl();
  const parts = (r.parts || []).map((p, i) => `<li><span class="n" style="background:${safeColor(p.color)}">${i + 1}</span><b>${esc(p.name)}</b><span>${esc(p.role)}</span></li>`).join('');
  const steps = (r.steps || []).map((st, i) => `<li><span class="n">${i + 1}</span><b>${esc(st.title)}</b><span>${esc(st.text)}</span></li>`).join('');
  const wiki = `https://en.wikipedia.org/wiki/${encodeURIComponent((r.wikipedia_title || state.query || '').replace(/ /g, '_'))}`;
  const sk = `https://sketchfab.com/search?q=${encodeURIComponent(r.search_terms || state.query || '')}&type=models`;
  const m = state.model3d;
  const model = m?.uid ? `<h2>In 3D</h2><div class="stage three"><iframe title="3D model" src="https://sketchfab.com/models/${esc(m.uid)}/embed?autostart=0&ui_infos=1&ui_watermark=0&dnt=1" allow="autoplay; fullscreen; xr-spatial-tracking" allowfullscreen></iframe></div><p class="credit"><a href="${esc(m.url || 'https://sketchfab.com/3d-models/' + m.uid)}">${esc(m.name || '3D model')}</a> by ${esc(m.by || 'a Sketchfab artist')} on Sketchfab (needs an internet connection; drag to spin).</p>` : '';
  return `<!doctype html><html lang="${langCode(r.lang)}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.title)} — How</title>
<style>
body{margin:0;background:#fbf4e4;color:#1d2433;font:17px/1.5 Nunito,system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(100% - 32px,900px);margin:0 auto;padding:24px 0 40px}
.eyebrow{margin:0;text-transform:uppercase;letter-spacing:.14em;font-size:12px;font-weight:800;color:#1f8a8a;text-align:center}
h1{font-family:Fraunces,Georgia,serif;font-size:clamp(32px,6vw,52px);margin:4px 0 6px;text-align:center;line-height:1.05}
.hook{text-align:center;font-style:italic;color:#4a5263;font-size:19px;max-width:640px;margin:0 auto 18px;font-family:Fraunces,Georgia,serif}
.stage{border:2px solid #1d2433;border-radius:18px;overflow:hidden;background:#fbf4e4;box-shadow:0 10px 30px -14px rgba(29,36,51,.35)}
.stage svg{display:block;width:100%;height:auto}
.stage.three{aspect-ratio:16/10;position:relative;background:#111}
.stage.three iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.credit{color:#7d8494;font-size:13px;margin:8px 2px 0}.credit a{color:inherit}
h2{font-family:Fraunces,Georgia,serif;font-size:22px;margin:26px 0 8px}
ol{list-style:none;margin:0;padding:0;display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
li{background:#f3e9d2;border:1.5px solid #d9cdb2;border-radius:14px;padding:12px 14px 12px 50px;position:relative}
[dir=rtl] li{padding:12px 50px 12px 14px}
.n{position:absolute;left:12px;top:12px;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:14px;background:#1d2433;color:#fff}
[dir=rtl] .n{left:auto;right:12px}
li b{display:block;font-family:Fraunces,Georgia,serif;font-size:17px}
li span:not(.n){color:#4a5263;font-size:15px}
.fact{margin:22px 0 0;padding:14px 18px;border-left:5px solid #e8b43a;background:#f3e9d2;border-radius:0 14px 14px 0;color:#4a5263}
[dir=rtl] .fact{border-left:0;border-right:5px solid #e8b43a;border-radius:14px 0 0 14px}
.fact b{color:#1d2433}
.links{margin-top:22px;display:flex;flex-wrap:wrap;gap:8px}
.links a{border:2px solid #1d2433;border-radius:999px;padding:8px 14px;text-decoration:none;color:#1d2433;font-weight:800;font-size:14px}
.links a.main{background:#e4572e;border-color:#e4572e;color:#fff}
footer{margin-top:30px;text-align:center;color:#7d8494;font-size:13px}
footer a{color:inherit}
</style></head><body><main>
<p class="eyebrow">${r.kind === 'process' ? 'How it is done' : 'How it works'}</p>
<h1>${esc(r.title)}</h1>
<p class="hook">${esc(r.hook || '')}</p>
<div class="stage">${currentSVG()}</div>
<h2>Parts</h2><ol>${parts}</ol>
<h2>Step by step</h2><ol>${steps}</ol>
${r.fun_fact ? `<p class="fact"><b>Did you know?</b> ${esc(r.fun_fact)}</p>` : ''}
${model}
<div class="links"><a class="main" href="${esc(link)}">Open the interactive version (pull it apart, 3D)</a><a href="${wiki}">Photos on Wikipedia</a><a href="${esc(sk)}">3D models on Sketchfab</a></div>
<footer>Made with <a href="${SITE_URL}">How</a> — type a thing, see how it works. Drawing by AI; check important details against a trusted source.</footer>
</main></body></html>`;
}

// ---------- wiring ----------
$('#ask').addEventListener('submit', (e) => { e.preventDefault(); ask($('#q').value); });
$$('.chip', $('#chips')).forEach((c) => c.addEventListener('click', () => { if (c.classList.contains('chip-demo')) $('#lang').value = 'English'; ask(c.dataset.q); }));
$('#signin').addEventListener('click', () => signIn(false));
$('#signout').addEventListener('click', signOut);
$('#cancel').addEventListener('click', () => state.abort?.abort());
$('#error-close').addEventListener('click', () => { $('#error').hidden = true; });
$('#model').addEventListener('change', updateEstimate);
$$('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
$('#play').addEventListener('click', () => setPlaying(!playing));
$('#explode').addEventListener('input', (e) => explode(e.target.value / 100));
$('#callout-close').addEventListener('click', () => { $('#callout').hidden = true; clearHighlight(); });
$('#redraw').addEventListener('click', () => ask(state.query, { force: true }));
$('#share').addEventListener('click', openShare);
$('#share-link').addEventListener('click', async () => {
  const url = await shareUrl();
  try { await navigator.clipboard.writeText(url); shareStatus('Link copied. Anyone who opens it sees this answer, no sign-in needed.'); }
  catch { prompt('Copy this link:', url); }
});
$('#share-native').addEventListener('click', async () => {
  const url = await shareUrl();
  try { await navigator.share({ title: `${state.result?.title} — How`, text: state.result?.hook || '', url }); } catch {}
});
$('#share-report').addEventListener('click', async () => {
  const html = await buildReport();
  downloadBlob(new Blob([html], { type: 'text/html' }), `${fileSlug()}-how.html`);
  shareStatus('Report saved. It opens in any browser, offline, with the drawing moving.');
});
$('#share-svg').addEventListener('click', () => {
  downloadBlob(new Blob([currentSVG()], { type: 'image/svg+xml' }), `${fileSlug()}.svg`);
  shareStatus('Drawing saved.');
});
$('#privacy').addEventListener('click', () => $('#privacy-dialog').showModal());
$('#paste-key').addEventListener('click', () => { $('#key-input').value = ''; $('#key-dialog').showModal(); });
$('#key-cancel').addEventListener('click', () => $('#key-dialog').close());
$('#key-form').addEventListener('submit', () => { const k = $('#key-input').value.trim(); if (k) setKey(k); });
window.addEventListener('hashchange', () => { /* links are handled on load only */ });

(async function init() {
  state.key = store.get('or_key');
  await finishSignIn();
  renderAuth();
  renderRecent();
  loadPrices();
  const h = new URLSearchParams(location.hash.slice(1).replace(/^[^=]*\//, ''));
  const shared = h.get('r'); const shortId = h.get('s');
  if (shortId && /^[a-z0-9]{5,12}$/.test(shortId)) {
    try {
      startLoading('the shared answer');
      const res = await fetch(`${LINKS_API}/${shortId}`);
      if (!res.ok) throw new Error();
      const r = await res.json();
      const q = r.q || r.title; delete r.q;
      $('#q').value = q; if (r.lang && $(`#lang option[value="${CSS.escape(r.lang)}"]`)) $('#lang').value = r.lang;
      show(r, q, { free: true, shared: true });
      state.shortId = shortId;
      if (r.svg) cachePut(cacheKey(q, r.lang || 'English', $('#level').value), r);
      return;
    } catch { showError('This shared link could not be opened. It may have been mistyped, or the link service is unreachable right now.'); }
  }
  if (shared) {
    try {
      const r = await decodeResult(shared);
      const q = r.q || r.title; delete r.q;
      $('#q').value = q; if (r.lang && $(`#lang option[value="${CSS.escape(r.lang)}"]`)) $('#lang').value = r.lang;
      show(r, q, { free: true, shared: true });
      if (r.svg) cachePut(cacheKey(q, r.lang || 'English', $('#level').value), r);
      return;
    } catch { showError('This shared link is damaged or incomplete. Ask the sender to share it again.'); }
  }
  const q = h.get('q'); const lang = h.get('lang');
  if (lang && $(`#lang option[value="${CSS.escape(lang)}"]`)) $('#lang').value = lang;
  const pending = store.get('pending_q', sessionStorage);
  if (pending && state.key) { store.del('pending_q', sessionStorage); ask(pending); return; }
  if (q) {
    $('#q').value = q;
    const demo = typeof DEMO !== 'undefined' && DEMO[q.toLowerCase()];
    const cached = cacheGet(cacheKey(q, $('#lang').value, $('#level').value));
    if ((demo && $('#lang').value === 'English') || cached) ask(q); else $('#q').focus();
  }
})();
