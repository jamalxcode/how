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

const state = { key: null, result: null, query: null, abort: null, cost: 0, prices: {}, model3d: null, shortId: undefined, admin: null, gallery: [], loop: 4 };

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
      required: ['title', 'hook', 'kind', 'wikipedia_title', 'search_terms', 'parts', 'steps', 'loop_seconds', 'fun_fact', 'svg'],
      properties: {
        title: { type: 'string' },
        hook: { type: 'string' },
        kind: { type: 'string', enum: ['object', 'diagram', 'process', 'refused'] },
        wikipedia_title: { type: 'string' },
        search_terms: { type: 'string' },
        parts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'role', 'color'],
          properties: { id: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, color: { type: 'string' } } } },
        steps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'text', 'parts', 'at'],
          properties: { title: { type: 'string' }, text: { type: 'string' }, parts: { type: 'array', items: { type: 'string' } }, at: { type: 'number' } } } },
        loop_seconds: { type: 'number' },
        fun_fact: { type: 'string' },
        svg: { type: 'string' },
      },
    },
  },
};

function systemPrompt(lang, level) {
  return `You are the illustrator of a children's "how it works" picture encyclopedia: the reader learns by LOOKING, not reading. Answer as JSON only.

Write every text field in ${lang}, for ${level}. Keep text tiny: hook ≤ 20 words (one captivating line); part "role" ≤ 12 words; step "text" ≤ 22 words; 3–7 parts; 3–6 steps. "title" is the thing's name in ${lang}. "kind": "object" for a thing made of parts that fit together (engine, scissors, can opener): the page lets the reader pull it apart. "diagram" when the explanation is a principle shown between things (reading glasses: page, lens, eye; why planes fly; how sound travels): parts are the things in the scene and nothing is pulled apart. "process" (how a house is built, how bread rises): the parts are its stages or components and the steps follow them in order.
Light, air, water, electricity, forces, heat and arrows are NEVER parts: they are drawn as flows in <g id="fx">. A part is a physical thing you could touch.
"wikipedia_title": the English Wikipedia article title for the thing. "search_terms": 2–3 English words to find a 3D model of it. "fun_fact": one surprising sentence.
Timing: the whole animation is ONE cycle of "loop_seconds" (2–8 s). Every animation you write uses dur equal to loop_seconds, or begin/dur values inside it, so the cycle repeats cleanly. Each step gets "at": the percentage (0–100) of the cycle at which that step is happening, increasing from step to step (first step at 0). The page lights up each step as the drawing reaches it.

The "svg" is the heart of the answer: ONE bold, flat-colour cutaway or side-view illustration in the style of a vintage children's encyclopedia, showing the real mechanism clearly. Rules:
- Start with <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"> (no width/height). First element: <rect width="800" height="520" fill="#fbf4e4"/>.
- Draw with simple primitives (rect, circle, ellipse, path, polygon, polyline, line). Thick dark outlines: stroke="#1d2433" stroke-width="3" or "4", stroke-linejoin="round", stroke-linecap="round". Flat fills using the "color" you give each part (choose from a warm, readable palette: #e4572e, #1f8a8a, #e8b43a, #2b4c7e, #9bc4bc, #d98c5f, #8a6fbf, #a3b86c, #c0c7d0, #f2e3c6).
- EACH part is exactly one group: <g id="PARTID"> containing all its shapes. PARTID matches the parts list. Give each part data-explode="dx dy": the direction (dx, dy between -230 and 230, each part a different direction, outward from the picture's centre) it should move when the picture is pulled apart so parts stop overlapping. Keep the part <g> itself free of transform/opacity attributes; put any static transform on an inner <g>.
- Make the mechanism MOVE with SMIL animation (<animate>, <animateTransform additive="sum">, <animateMotion>), repeatCount="indefinite", dur = loop_seconds, on elements INSIDE the part groups: pistons slide, blades close, gears turn (mesh correctly), valves open, air/water/electricity flows (animated stroke-dashoffset on dashed paths, in <g id="fx"> with your flow arrows). For a process, loop through the stages (~2 s each) by animating opacity so they appear in order and build up. The scene must look alive the moment it loads.
- Keep motion arrows, flow lines and ground/decoration in <g id="fx">; everything else that is drawn belongs to a part.
- No text inside the SVG (the page adds numbered labels), except tiny numbers if essential. No <script>, <foreignObject>, <image>, <use> of external resources, no external URLs, no CSS classes. Total svg under 9000 characters. Valid XML: close every tag, escape & as &amp;.
Draw accurately: real proportions, the real arrangement of parts, the real motion. Never refuse a safe everyday topic. If the request is unsafe (weapons, explosives, drugs, harming people) or meaningless, set kind to "refused", explain in "hook" in ${lang}, and return empty parts, steps and svg.`;
}

async function askAI(q, lang, level, model, signal, feedback) {
  const messages = [
    { role: 'system', content: systemPrompt(lang, level) },
    { role: 'user', content: `Show me how this works: ${q}` + (feedback ? `\n\nYour previous drawing had these problems, which the page checks mechanically:\n- ${feedback.join('\n- ')}\nDraw it again and fix every one of them.` : '') },
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

// Mechanical checks on an answer: the SVG parses, every listed part is drawn and visible,
// something moves, and the parts pull apart. Returns a list of problems (empty = fine).
function checkResult(r) {
  const problems = [];
  if (r.kind === 'refused') return problems;
  if (!Array.isArray(r.parts) || r.parts.length < 2) problems.push('fewer than 2 parts');
  if (!Array.isArray(r.steps) || r.steps.length < 2) problems.push('fewer than 2 steps');
  const svg = parseSVG(r.svg || '');
  if (!svg) { problems.push('the svg is not valid XML (check unclosed tags and unescaped & characters)'); return problems; }
  const ids = (r.parts || []).map((p) => p.id);
  const missing = ids.filter((id) => !svg.getElementById(id));
  if (missing.length) problems.push(`these parts have no <g id> in the svg: ${missing.join(', ')}`);
  if (!svg.querySelector('animate, animateTransform, animateMotion, set')) problems.push('nothing moves: no SMIL animation elements');
  const explodes = ids.map((id) => (svg.getElementById(id)?.getAttribute('data-explode') || '0 0').split(/[\s,]+/).map(Number));
  const still = explodes.filter(([x, y]) => !(Math.abs(x) + Math.abs(y) > 20)).length;
  if (still > 1) problems.push(`${still} parts have no data-explode direction (each part needs a different outward dx dy)`);
  // measure: every part must have real size on the page
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:800px;height:520px;visibility:hidden';
  const live = document.importNode(svg, true); probe.appendChild(live); document.body.appendChild(probe);
  try {
    const empty = ids.filter((id) => { const g = live.getElementById(id); if (!g) return false; try { const b = g.getBBox(); return b.width < 4 || b.height < 4; } catch { return true; } });
    if (empty.length) problems.push(`these parts draw nothing visible: ${empty.join(', ')}`);
    const tiny = ids.filter((id) => { const g = live.getElementById(id); if (!g) return false; try { const b = g.getBBox(); return b.width * b.height > 0 && b.width * b.height < 400; } catch { return false; } });
    if (tiny.length > 2) problems.push(`parts are too small to see: ${tiny.join(', ')}`);
  } finally { probe.remove(); }
  return problems;
}

function parseSVG(svgText) {
  if (!svgText.trim()) return null;
  let doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.documentElement.nodeName !== 'svg' || doc.querySelector('parsererror')) {
    doc = new DOMParser().parseFromString(svgText.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/gi, '&amp;'), 'image/svg+xml');
    if (doc.documentElement.nodeName !== 'svg' || doc.querySelector('parsererror')) return null;
  }
  return doc.documentElement;
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
    let result = await askAI(q, lang, level, model, ctrl.signal);
    if (ctrl.signal.aborted) return;
    // check the drawing; if it's broken, ask once more with the list of problems
    let problems = checkResult(result);
    if (problems.length) {
      setLoading('Checking the drawing…', `Found ${problems.length} problem${problems.length > 1 ? 's' : ''}; asking for a better one`);
      try {
        const again = await askAI(q, lang, level, model, ctrl.signal, problems);
        if (ctrl.signal.aborted) return;
        const p2 = checkResult(again);
        if (p2.length <= problems.length) { result = again; problems = p2; }
      } catch (e) { if (e.name === 'AbortError') throw e; /* keep the first drawing */ }
    }
    result.lang = lang; result.cost = state.cost; result.model = model; result.problems = problems;
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
  $('#parts-hint').textContent = result.kind === 'diagram' || result.kind === 'process' ? 'Tap a part or a name' : 'Tap a part or a name · drag to pull apart';
  $('#r-title').textContent = result.title || q;
  $('#r-hook').textContent = result.hook || '';
  $('#fact').textContent = result.fun_fact || '';
  $('#shared-note').hidden = !shared;
  $('#hero-live').hidden = true;
  $('#gallery-add').textContent = 'Add to gallery';
  renderAdmin();
  $('#cost').textContent = shared ? '' : free ? 'Free (already drawn)' : result.cost ? `This drawing cost $${result.cost.toFixed(3)}` : '';

  partsById = {};
  (result.parts || []).forEach((p, i) => { partsById[p.id] = { ...p, n: i + 1 }; });

  // steps and parts lists
  const steps = $('#steps'); steps.innerHTML = '';
  const n = (result.steps || []).length;
  (result.steps || []).forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="num">${i + 1}</span><strong></strong><span></span>`;
    li.querySelector('strong').textContent = s.title;
    li.querySelector('span:not(.num)').textContent = s.text;
    const at = typeof s.at === 'number' && isFinite(s.at) ? Math.min(100, Math.max(0, s.at)) : (i / n) * 100;
    li.dataset.at = at;
    li.addEventListener('click', () => { seekTo(at); highlight(s.parts || [], li); setTimeout(clearHighlight, 2500); });
    steps.appendChild(li);
  });
  state.loop = typeof result.loop_seconds === 'number' && result.loop_seconds > 0.5 ? Math.min(result.loop_seconds, 20) : 4;
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

  setView('works');            // the drawing must be visible before it is measured
  drawSVG(result.svg || '');
  setView('works');
  startTicker();
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
  let svg = parseSVG(svgText);
  if (!svg) { stage.innerHTML = '<p class="empty">The drawing came back broken. Try “Draw it again”.</p>'; return; }
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
    wrap.dataset.auto = (Math.abs(wrap.dataset.dx) + Math.abs(wrap.dataset.dy) > 20) ? '' : '1';
    g.parentNode.insertBefore(wrap, g);
    wrap.appendChild(g);
    wrap.addEventListener('click', (e) => { e.stopPropagation(); highlight([id]); openCallout(id); });
  }
  stage.appendChild(svg);
  svg.addEventListener('click', () => { clearHighlight(); $('#callout').hidden = true; });
  placeLabels(svg, 0);
}

// Numbered labels, pull-apart directions and the cropped view all need the drawing to be laid
// out on screen; if it isn't yet (hidden tab, first paint), try again on the next frames.
function placeLabels(svg, attempt) {
  if (!svg.isConnected) return;
  const rect = svg.getBoundingClientRect();
  if ((rect.width < 10 || rect.height < 10) && attempt < 30) { requestAnimationFrame(() => placeLabels(svg, attempt + 1)); return; }

  // labels: one numbered badge per part on a top layer (so no part can cover them), placed on
  // the part's biggest shape (or where the AI said with data-label="x y"), nudged apart.
  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  layer.setAttribute('class', 'tmw-labels');
  svg.appendChild(layer);
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
    l.dataset.cx = cx.toFixed(1); l.dataset.cy = cy.toFixed(1);
    l.setAttribute('transform', `translate(${l.dataset.cx} ${l.dataset.cy})`);
    l.style.cursor = 'pointer';
    l.addEventListener('click', (e) => { e.stopPropagation(); highlight([id]); openCallout(id); });
    layer.appendChild(l);
  }
  fitView(svg);
  fixExplode(svg);
  explode(0);
}

// Crop the view to what is actually drawn (the AI often uses only the middle of the canvas).
function fitView(svg) {
  const vb = (svg.getAttribute('viewBox') || '0 0 800 520').split(/[\s,]+/).map(Number);
  const [vx, vy, vw, vh] = vb;
  // ignore background rectangles that cover most of the canvas
  const bg = $$('rect', svg).filter((r) => (Number(r.getAttribute('width')) || 0) >= vw * 0.9 && (Number(r.getAttribute('height')) || 0) >= vh * 0.9 && !r.closest('[data-part]'));
  bg.forEach((r) => { r.dataset.bg = '1'; r.style.display = 'none'; });
  let b; try { b = svg.getBBox(); } catch { b = null; }
  bg.forEach((r) => { r.style.display = ''; });
  if (!b || b.width < 50 || b.height < 50) return;
  const pad = 36;
  let x = Math.max(vx, b.x - pad), y = Math.max(vy, b.y - pad);
  let w = Math.min(vx + vw, b.x + b.width + pad) - x, h = Math.min(vy + vh, b.y + b.height + pad) - y;
  // keep the frame from getting too narrow or too tall
  if (w / h > 2.2) { const nh = w / 2.2; y -= (nh - h) / 2; h = nh; }
  if (w / h < 1.1) { const nw = h * 1.1; x -= (nw - w) / 2; w = nw; }
  svg.setAttribute('viewBox', `${x.toFixed(0)} ${y.toFixed(0)} ${w.toFixed(0)} ${h.toFixed(0)}`);
  svg.dataset.vb = svg.getAttribute('viewBox');
  bg.forEach((r) => { r.setAttribute('x', x - 1000); r.setAttribute('y', y - 1000); r.setAttribute('width', w + 2000); r.setAttribute('height', h + 2000); });
}

// Give parts without a direction one (radially from the centre), then push all directions out
// until the pulled-apart pieces no longer overlap.
function fixExplode(svg) {
  const wraps = $$('[data-part]', svg);
  const boxes = wraps.map((w) => { try { return w.getBBox(); } catch { return { x: 0, y: 0, width: 0, height: 0 }; } });
  const [vx, vy, vw, vh] = (svg.dataset.vb || svg.getAttribute('viewBox')).split(/[\s,]+/).map(Number);
  const cx = vx + vw / 2, cy = vy + vh / 2;
  wraps.forEach((w, i) => {
    if (w.dataset.auto !== '1') return;
    const b = boxes[i]; const px = b.x + b.width / 2 - cx, py = b.y + b.height / 2 - cy;
    const len = Math.hypot(px, py) || 1; const ang = len < 30 ? (i / wraps.length) * Math.PI * 2 : Math.atan2(py, px);
    w.dataset.dx = Math.round(Math.cos(ang) * 180); w.dataset.dy = Math.round(Math.sin(ang) * 140);
  });
  const overlaps = (k) => {
    let n = 0;
    for (let i = 0; i < wraps.length; i++) for (let j = i + 1; j < wraps.length; j++) {
      const a = boxes[i], b = boxes[j];
      const ax = a.x + wraps[i].dataset.dx * k, ay = a.y + wraps[i].dataset.dy * k, bx = b.x + wraps[j].dataset.dx * k, by = b.y + wraps[j].dataset.dy * k;
      const ox = Math.min(ax + a.width, bx + b.width) - Math.max(ax, bx), oy = Math.min(ay + a.height, by + b.height) - Math.max(ay, by);
      if (ox > 0 && oy > 0 && ox * oy > 0.25 * Math.min(a.width * a.height, b.width * b.height)) n++;
    }
    return n;
  };
  let scale = 1;
  while (overlaps(scale) > 0 && scale < 2.6) scale += 0.3;
  if (scale > 1) wraps.forEach((w) => { w.dataset.dx = Math.round(w.dataset.dx * scale); w.dataset.dy = Math.round(w.dataset.dy * scale); });
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
    const l = svg.querySelector(`.tmw-labels [data-label="${CSS.escape(w.dataset.part)}"]`);
    if (l) l.setAttribute('transform', `translate(${+l.dataset.cx + w.dataset.dx * k} ${+l.dataset.cy + w.dataset.dy * k})`);
  });
  // zoom out so pulled-apart pieces stay inside the picture
  if (!svg.dataset.vb) svg.dataset.vb = svg.getAttribute('viewBox');
  const [x, y, w, h] = svg.dataset.vb.split(/[\s,]+/).map(Number);
  const padX = Math.min(maxX * 0.85, w), padY = Math.min(maxY * 0.85, h);
  svg.setAttribute('viewBox', `${x - padX} ${y - padY} ${w + 2 * padX} ${h + 2 * padY}`);
}

// Lights up the step the animation is currently at (and its parts), using the SVG's own clock.
let ticker = null;
function startTicker() {
  cancelAnimationFrame(ticker);
  const tick = () => {
    ticker = requestAnimationFrame(tick);
    const svg = $('#stage svg'); if (!svg || $('#view-drawing').hidden || $('#steps').hidden) return;
    let t; try { t = svg.getCurrentTime(); } catch { return; }
    const pct = ((t % state.loop) / state.loop) * 100;
    const lis = $$('#steps li'); if (!lis.length) return;
    let cur = lis[0];
    for (const li of lis) if (Number(li.dataset.at) <= pct + 0.01) cur = li;
    if (cur.classList.contains('now')) return;
    lis.forEach((li) => li.classList.remove('now'));
    cur.classList.add('now');
    const idx = lis.indexOf(cur);
    const ids = state.result?.steps?.[idx]?.parts || [];
    $$('[data-part]', svg).forEach((w) => w.classList.toggle('now', ids.includes(w.dataset.part)));
  };
  tick();
}
function seekTo(pct) {
  const svg = $('#stage svg'); if (!svg) return;
  try { svg.setCurrentTime((pct / 100) * state.loop); } catch {}
  setPlaying(true);
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
  if (view !== 'works') $$('.now', document).forEach((n) => n.classList.remove('now'));
  const diagram = state.result?.kind === 'diagram' || state.result?.kind === 'process';
  $('#explode').parentElement.hidden = diagram;
  if (view === 'parts') {
    svg?.classList.add('exploded');
    try { svg?.pauseAnimations(); } catch {}
    explode(diagram ? 0 : $('#explode').value / 100);
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
    let data = null;
    try { const r = await fetch(`${LINKS_API}/wiki?t=${encodeURIComponent(title)}`); if (r.ok) data = await r.json(); } catch {}
    if (!data?.pics?.length) data = await wikiDirect(title);
    if (!data.pics.length) throw new Error('the article has no usable pictures');
    box.innerHTML = '';
    let failed = 0;
    data.pics.forEach((it, i) => {
      const fig = document.createElement('figure'); if (i === 0) fig.className = 'wide';
      const img = document.createElement('img'); img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.alt = it.caption;
      const tries = [it.src, it.small].filter((u, k, arr) => u && arr.indexOf(u) === k);
      img.src = tries.shift();
      img.addEventListener('error', () => {
        if (tries.length) { img.src = tries.shift(); return; }
        failed++;
        fig.classList.add('broken');
        if (failed === data.pics.length) box.insertAdjacentHTML('afterbegin', `<p class="empty">The photos exist but would not load here. <a href="${escapeHTML(data.url)}" target="_blank" rel="noopener">See them on Wikipedia</a><br><small>First one tried: <a href="${escapeHTML(data.pics[0].src)}" target="_blank" rel="noopener">${escapeHTML(data.pics[0].src)}</a></small></p>`);
      });
      const cap = document.createElement('figcaption'); cap.textContent = it.caption;
      fig.append(img, cap);
      box.appendChild(fig);
    });
    $('#gallery-credit').innerHTML = `Photos from the Wikipedia article <a href="${escapeHTML(data.url)}" target="_blank" rel="noopener"></a>, each under its own licence.`;
    $('#gallery-credit a').textContent = data.page;
  } catch (e) {
    box.innerHTML = `<p class="empty">No photos found${e?.message ? ` (${escapeHTML(e.message)})` : ''}. <a href="https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(title)}" target="_blank" rel="noopener">Search Wikipedia</a></p>`;
  }
}

// Wikipedia's media list points at thumb.wikimedia.org with tracking parameters meant for its own
// pages; that host refuses other sites. upload.wikimedia.org serves the same files to anyone.
function wikiImageUrl(src) {
  return ('https:' + String(src).replace(/^https?:/, '')).replace(/^https:\/\/thumb\.wikimedia\.org\//, 'https://upload.wikimedia.org/').split('?')[0];
}
// Straight from the browser, when the link service can't be reached.
async function wikiDirect(title) {
  let page = title;
  const s = await (await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(title)}&srlimit=1&format=json&origin=*`)).json();
  if (s.query?.search?.[0]) page = s.query.search[0].title;
  const enc = encodeURIComponent(page.replace(/ /g, '_'));
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/media-list/${enc}`);
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`);
  const { items } = await res.json();
  const pics = (items || []).filter((it) => it.type === 'image' && it.srcset?.length && !BAD_IMAGE.test(it.title)).slice(0, 9)
    .map((it) => { const small = wikiImageUrl(it.srcset[0].src); return { src: small.replace(/\/(\d+)px-/, '/720px-'), small, caption: it.caption?.text || it.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '').replace(/_/g, ' ') }; });
  return { page, url: `https://en.wikipedia.org/wiki/${enc}`, pics };
}

// ---------- 3D models (Sketchfab) ----------
async function load3D(terms, known) {
  const box = $('#model3d'); box.innerHTML = '<p class="empty">Looking for a 3D model…</p>';
  state.model3d = known || null;
  $('#model3d-credit').textContent = '';
  const searchLink = `https://sketchfab.com/search?q=${encodeURIComponent(terms)}&type=models`;
  try {
    let models = null;
    try { const r = await fetch(`${LINKS_API}/3d?q=${encodeURIComponent(terms)}`); if (r.ok) models = (await r.json()).models; } catch {}
    if (!models?.length) {
      const res = await fetch(`https://api.sketchfab.com/v3/search?type=models&q=${encodeURIComponent(terms)}&count=24&downloadable=false`);
      if (!res.ok) throw new Error();
      const { results } = await res.json();
      const words = terms.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      const score = (m) => words.filter((w) => (m.name || '').toLowerCase().includes(w)).length;
      models = (results || []).filter((m) => m.uid && m.isAgeRestricted !== true).map((m, i) => ({ m, i, s: score(m) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 8).map(({ m }) => m);
    }
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
  renderAdmin();
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
  $$('[data-part]', clone).forEach((w) => { w.removeAttribute('style'); w.classList.remove('hot', 'now'); });
  $$('.tmw-labels [data-label]', clone).forEach((l) => l.setAttribute('transform', `translate(${l.dataset.cx} ${l.dataset.cy})`));
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

// ---------- gallery (curated answers, free to open) and the live drawing on the home page ----------
function galleryItems() {
  const demo = typeof DEMO !== 'undefined' ? Object.entries(DEMO).map(([q, d]) => ({ id: null, demo: q, title: d.title, hook: d.hook, lang: 'English', svg: d.svg })) : [];
  return [...state.gallery, ...demo.filter((d) => !state.gallery.some((g) => g.title === d.title))];
}
async function loadGallery() {
  try { const r = await fetch(`${LINKS_API}/gallery`); if (r.ok) state.gallery = (await r.json()).filter((g) => g && g.id && g.svg); } catch {}
  renderGallery();
  renderHeroLive();
}
function thumbSVG(svgText) {
  const svg = parseSVG(svgText); if (!svg) return null;
  $$('script, foreignObject, image, iframe, object, embed, a', svg).forEach((n) => n.remove());
  $$('*', svg).forEach((el) => { for (const a of [...el.attributes]) if (a.name.toLowerCase().startsWith('on')) el.removeAttribute(a.name); });
  svg.removeAttribute('width'); svg.removeAttribute('height');
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', '0 0 800 520');
  return document.importNode(svg, true);
}
function renderGallery() {
  const items = galleryItems();
  const box = $('#gallery-home'); const grid = $('#gallery-grid'); grid.innerHTML = '';
  box.hidden = items.length === 0;
  items.slice(0, 24).forEach((g) => {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'gcard';
    card.innerHTML = '<div class="gthumb"></div><strong></strong><span></span>';
    const svg = thumbSVG(g.svg); if (svg) $('.gthumb', card).appendChild(svg);
    $('strong', card).textContent = g.title; $('span', card).textContent = g.hook || '';
    if (RTL.test(g.lang || '')) card.setAttribute('dir', 'rtl');
    card.addEventListener('click', () => openGalleryItem(g));
    grid.appendChild(card);
  });
}
async function openGalleryItem(g) {
  if (g.demo) { $('#lang').value = 'English'; ask(g.demo); return; }
  try {
    startLoading(g.title);
    const r = await (await fetch(`${LINKS_API}/${g.id}`)).json();
    const q = r.q || r.title; delete r.q;
    location.hash = `${encodeURIComponent(g.title.replace(/[^\p{L}\p{N}-]+/gu, '-').toLowerCase())}/s=${g.id}`;
    show(r, q, { free: true }); state.shortId = g.id; renderAdmin();
  } catch { showError('Could not open that answer right now.'); }
}
// A moving drawing right under the headline, so the first second shows what the page does.
function renderHeroLive() {
  if (document.body.classList.contains('has-result')) return;
  const items = galleryItems(); const box = $('#hero-live'); if (!items.length) { box.hidden = true; return; }
  const g = items[Math.floor(Math.random() * Math.min(items.length, 8))];
  const svg = thumbSVG(g.svg); if (!svg) { box.hidden = true; return; }
  $('#hero-live-stage').innerHTML = ''; $('#hero-live-stage').appendChild(svg);
  $('#hero-live-title').textContent = g.title;
  box.hidden = false;
  box.onclick = () => openGalleryItem(g);
}
// Owner mode: open the page once with #admin=<secret> and "Add to gallery" appears on every answer.
async function galleryAdd() {
  if (!state.result || !state.admin) return;
  await shareUrl();
  if (!state.shortId) { $('#gallery-add').textContent = 'Could not store the answer (link service unreachable)'; return; }
  const r = state.result;
  const res = await fetch(`${LINKS_API}/gallery`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': state.admin }, body: JSON.stringify({ id: state.shortId, title: r.title, hook: r.hook, lang: r.lang, q: state.query, svg: sharePayload(r).svg }) });
  const j = await res.json().catch(() => ({}));
  $('#gallery-add').textContent = res.ok ? `In the gallery (${j.count})` : `Not added: ${j.error || res.status}`;
  if (res.ok) loadGallery();
}
async function galleryRemove() {
  if (!state.shortId || !state.admin) return;
  const res = await fetch(`${LINKS_API}/gallery/${state.shortId}`, { method: 'DELETE', headers: { 'X-Admin': state.admin } });
  $('#gallery-add').textContent = res.ok ? 'Removed from the gallery' : 'Could not remove';
  if (res.ok) loadGallery();
}
function renderAdmin() {
  $('#gallery-add').hidden = !state.admin || !state.result || state.result.kind === 'refused';
  $('#gallery-remove').hidden = !state.admin || !state.shortId || !state.gallery.some((g) => g.id === state.shortId);
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
$('#gallery-add').addEventListener('click', galleryAdd);
$('#gallery-remove').addEventListener('click', galleryRemove);
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
  if (h.get('admin')) { store.set('tmw_admin', h.get('admin')); history.replaceState(null, '', callbackUrl()); }
  state.admin = store.get('tmw_admin');
  loadGallery();
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
