// Tell Me Why — type a thing, see how it works.
// Static page: the AI (Claude, via OpenRouter, paid by the visitor) returns a JSON "explainer"
// with an animated SVG; this file draws it, pulls it apart, and adds Wikipedia photos and Sketchfab 3D.
'use strict';

const OPENROUTER = 'https://openrouter.ai';
const APP_TITLE = 'Tell Me Why';
const CACHE_KEY = 'tmw_cache_v1';
const CACHE_MAX = 24;
const RTL = /^(arabic|urdu|persian|hebrew)$/i;

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const state = { key: null, result: null, query: null, abort: null, cost: 0, prices: {} };

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
  return `You are the illustrator of a "Tell Me Why" picture encyclopedia: the reader learns by LOOKING, not reading. Answer as JSON only.

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
function show(result, q, { free = false } = {}) {
  state.result = result; state.query = q;
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
  $('#cost').textContent = free ? 'Free (already drawn)' : result.cost ? `This drawing cost $${result.cost.toFixed(3)}` : '';

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
  load3D(result.search_terms || q);
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
async function load3D(terms) {
  const box = $('#model3d'); box.innerHTML = '<p class="empty">Looking for a 3D model…</p>';
  $('#model3d-credit').textContent = '';
  const searchLink = `https://sketchfab.com/search?q=${encodeURIComponent(terms)}&type=models`;
  try {
    const res = await fetch(`https://api.sketchfab.com/v3/search?type=models&q=${encodeURIComponent(terms)}&count=8&sort_by=-likeCount&downloadable=false`);
    if (!res.ok) throw new Error();
    const { results } = await res.json();
    const models = (results || []).filter((m) => m.uid && m.isAgeRestricted !== true);
    if (!models.length) throw new Error();
    box.innerHTML = '<div class="viewer"><iframe title="3D model" allow="autoplay; fullscreen; xr-spatial-tracking" allowfullscreen></iframe></div><div class="thumbs"></div>';
    const iframe = $('iframe', box); const thumbs = $('.thumbs', box);
    const pick = (m, btn) => {
      iframe.src = `https://sketchfab.com/models/${m.uid}/embed?autostart=0&ui_infos=1&ui_watermark=0&dnt=1`;
      $$('button', thumbs).forEach((b) => b.classList.toggle('active', b === btn));
      $('#model3d-credit').innerHTML = `<a target="_blank" rel="noopener"></a> by ${escapeHTML(m.user?.displayName || 'a Sketchfab artist')} on Sketchfab, under its own licence. Drag to spin, pinch or scroll to zoom.`;
      const a = $('#model3d-credit a'); a.href = m.viewerUrl || `https://sketchfab.com/3d-models/${m.uid}`; a.textContent = m.name;
    };
    models.forEach((m, i) => {
      const b = document.createElement('button'); b.type = 'button';
      const t = (m.thumbnails?.images || []).sort((x, y) => x.width - y.width).find((x) => x.width >= 200) || m.thumbnails?.images?.[0];
      b.innerHTML = `<img alt="" loading="lazy"><span></span>`;
      if (t) $('img', b).src = t.url;
      $('span', b).textContent = m.name;
      b.addEventListener('click', () => pick(m, b));
      thumbs.appendChild(b);
      if (i === 0) pick(m, b);
    });
  } catch {
    box.innerHTML = `<p class="empty">Couldn't load a 3D model here. <a href="${searchLink}" target="_blank" rel="noopener">Browse models on Sketchfab</a></p>`;
  }
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
$('#share').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); $('#share').textContent = 'Link copied'; setTimeout(() => { $('#share').textContent = 'Copy link'; }, 1500); } catch {}
});
$('#download').addEventListener('click', () => {
  const svg = $('#stage svg'); if (!svg) return;
  const clone = svg.cloneNode(true);
  $$('[data-part]', clone).forEach((w) => { w.style.transform = ''; });
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${(state.result?.title || 'drawing').replace(/[^\w؀-ۿ-]+/g, '-')}.svg`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
  const h = new URLSearchParams(location.hash.slice(1));
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
