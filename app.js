// How — type a thing, see how it works.
// Static page. Claude (via OpenRouter, the visitor's account) works out the parts and steps and
// writes the picture prompt; OpenAI's image model (the visitor's key) paints the exploded view.
// Pictures and answers are stored by the link service (Cloudflare Worker) so links stay short.
'use strict';

const OPENROUTER = 'https://openrouter.ai';
const APP_TITLE = 'How';
const SITE_URL = 'https://how.sala.company/';
const LINKS_API = 'https://how-links.jamal-akuna-matata.workers.dev';
const CACHE_KEY = 'how_cache_v2';
const CACHE_MAX = 24;
const RTL = /^(arabic|urdu|persian|hebrew)$/i;
const PLAN_MODEL = 'anthropic/claude-sonnet-5.5';
const IMAGE_MODEL = 'openai/gpt-image-2.5-flare';
const IMAGE_SIZE = '1536x1024';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const state = { key: null, result: null, query: null, abort: null, cost: 0, model3d: null, shortId: undefined, admin: null, gallery: [] };

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

async function signIn() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  store.set('pkce_verifier', verifier, sessionStorage);
  const auth = new URL(`${OPENROUTER}/auth`);
  auth.searchParams.set('callback_url', callbackUrl());
  auth.searchParams.set('code_challenge', challenge);
  auth.searchParams.set('code_challenge_method', 'S256');
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
      method: 'POST', headers: { 'Content-Type': 'application/json' },
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
  c[k] = { ...result, image: result.image_id ? undefined : result.image, image_whole: result.image_id ? undefined : result.image_whole, at: Date.now() }; // pictures live in the link service
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
    b.addEventListener('click', () => { $('#q').value = q; $('#lang').value = lang; $('#level').value = level; show(c[k], q, { free: true }); });
    list.appendChild(b);
  }
  box.hidden = keys.length === 0;
}

// ---------- step 1: Claude works out the page and writes the picture prompt ----------
const PLAN_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'explainer', strict: true,
    schema: {
      type: 'object', additionalProperties: false,
      required: ['title', 'hook', 'kind', 'wikipedia_title', 'search_terms', 'fun_fact', 'parts', 'steps', 'image_prompt', 'whole_prompt'],
      properties: {
        title: { type: 'string' }, hook: { type: 'string' },
        kind: { type: 'string', enum: ['object', 'diagram', 'process', 'refused'] },
        wikipedia_title: { type: 'string' }, search_terms: { type: 'string' }, fun_fact: { type: 'string' },
        parts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'name_en', 'role'],
          properties: { name: { type: 'string' }, name_en: { type: 'string' }, role: { type: 'string' } } } },
        steps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'text'],
          properties: { title: { type: 'string' }, text: { type: 'string' } } } },
        image_prompt: { type: 'string' },
        whole_prompt: { type: 'string' },
      },
    },
  },
};

function planPrompt(lang, level) {
  return `You write the pages of a children's "how it works" picture encyclopedia: the reader learns by LOOKING. Each page is ONE big picture (an exploded or cutaway view, painted by an image model from your prompt) with numbered parts and a few short steps. Answer as JSON only.

Write title, hook, part names/roles, steps and fun_fact in ${lang}, for ${level}. "title" is just the thing's name ("Skateboard", not "How a Skateboard Works"). "name_en" is the part's English name. Keep text tiny: hook ≤ 20 words; role ≤ 12 words; step text ≤ 22 words; 4–8 parts; 3–6 steps. Choose the parts by what makes the thing DO its job, including hidden ones that matter (a phone: antenna and radio chip; a fridge: compressor and refrigerant loop). A part is a physical thing you could touch.
"kind": "object" for a thing made of parts (engine, scissors, can opener); "diagram" for a principle shown between things (reading glasses, why planes fly); "process" (how a house is built: parts are its stages); "refused" only if unsafe (weapons, explosives, drugs, harming people) or meaningless, then explain in hook and leave the rest empty.
"wikipedia_title": English Wikipedia article title. "search_terms": 2–3 English words to find a 3D model.

Two picture prompts, in English, same style sentence in both so they look like one book. STYLE = "vintage children's encyclopedia illustration, flat bold colours, thick dark outlines, soft cream paper background, three-quarter view, evenly lit, centred with margins, nothing cropped. No text, words or letters anywhere except the number badges."

"whole_prompt" (60–110 words): the thing by name, assembled and complete, as it looks in use, with its real appearance and proportions described in two sentences; where it helps, a hint of its context (a can under the opener, a hand's position) but the thing itself fills the frame. Then: "Each of these parts is marked where it sits with a small white circle containing a bold black number: 1 <name_en of part 1>, 2 <part 2>, …" listing ALL parts in the parts-list order. Then STYLE.

Part descriptions inside both prompts: image models default to the familiar whole object, so for any part that is ONE half of a symmetrical pair (a scissor half, a plier arm, a tong arm, a clamshell half) describe it alone and say what it excludes: "ONE blade with ONE finger ring — a single half, not a complete pair of scissors". For parts that occur several times (4 wheels, 8 bolts) say the count once ("the four wheels as one group").

"image_prompt" (90–170 words), the exploded view; it must match your parts list. In this order:
1. The thing by name, real appearance and proportions, two sentences.
2. The view: for an "object", "exploded view: the parts separated along one axis in their real order, real relative sizes, small gaps, thin grey leader lines"; for a "diagram", a clear cutaway or scene; for a "process", a left-to-right sequence of stages.
3. "Every one of these parts is clearly visible and marked with a white circle containing a bold black number placed right next to that part (not in a column at the edge): 1 <name_en of part 1>, 2 <part 2>, …" listing ALL parts in the parts-list order.
4. STYLE.`;
}

async function askJSON({ model, messages, schema, maxTokens, signal }) {
  let text;
  try {
    text = await callAI({ model, messages, maxTokens, responseFormat: schema, signal });
  } catch (e) {
    if (signal.aborted) throw e;
    if (!/schema|response_format|parameters/i.test(e.message)) throw e;
    text = await callAI({ model, messages: [...messages, { role: 'system', content: 'Reply with the JSON object only, no prose, no code fences.' }], maxTokens, signal });
  }
  return parseJSON(text);
}

async function makePlan(q, lang, level, signal) {
  const ask = `Make the page for: ${q}` + (/\(of .+\)$/.test(q) ? ' (the reader just looked at the larger thing in brackets and tapped this part; explain the part itself)' : '');
  const plan = await askJSON({ model: PLAN_MODEL, maxTokens: 3000, schema: PLAN_SCHEMA, signal, messages: [
    { role: 'system', content: planPrompt(lang, level) },
    { role: 'user', content: ask },
  ] });
  plan.parts = (plan.parts || []).map((p, i) => ({ id: `p${i + 1}`, ...p }));
  return plan;
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch {}
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  throw new Error('The AI answered in a form the page could not read. Try again.');
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
async function withRetry(fn, signal, label) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (e) {
      const retryable = e instanceof RetryableError || (e instanceof TypeError && !signal?.aborted);
      if (!retryable || attempt >= 3) throw e instanceof TypeError ? new Error(`Could not reach ${label}. Check your connection and try again.`) : e;
      const wait = e.retryAfterMs ?? 2000 * 2 ** (attempt - 1);
      setLoading(null, `${label} is busy; trying again in ${Math.ceil(wait / 1000)} s`);
      await sleep(wait, signal);
    }
  }
}

async function callAI({ model, messages, maxTokens, responseFormat, signal }) {
  return withRetry(async () => {
    const res = await fetch(`${OPENROUTER}/api/v1/chat/completions`, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${state.key}`, 'Content-Type': 'application/json', 'HTTP-Referer': callbackUrl(), 'X-Title': APP_TITLE },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, usage: { include: true }, ...(responseFormat && { response_format: responseFormat, provider: { require_parameters: true } }) }),
    });
    if (!res.ok) {
      let msg = `${res.status}`;
      try { const j = await res.json(); msg = j.error?.message || msg; } catch {}
      if (res.status === 401) { signOut(); throw new Error('Your OpenRouter session expired. Please sign in again.'); }
      if (res.status === 402) throw new Error('Your OpenRouter account is out of credit. Add credit at openrouter.ai/settings/credits.');
      if (RETRY_STATUS.has(res.status)) { const after = Number(res.headers.get('retry-after')); throw new RetryableError(`AI request failed: ${msg}`, after > 0 ? Math.min(after, 30) * 1000 : undefined); }
      throw new Error(`AI request failed: ${msg}`);
    }
    const j = await res.json();
    if (j.error) throw new RetryableError(j.error.message || 'The AI returned an error');
    if (j.usage?.cost != null) state.cost += Number(j.usage.cost);
    return j.choices?.[0]?.message?.content || '';
  }, signal, 'OpenRouter');
}

// ---------- step 2: the picture, painted by OpenAI's image model through OpenRouter ----------
async function paint(prompt, signal) {
  return withRetry(async () => {
    const res = await fetch(`${OPENROUTER}/api/v1/images`, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${state.key}`, 'Content-Type': 'application/json', 'HTTP-Referer': callbackUrl(), 'X-Title': APP_TITLE },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: IMAGE_SIZE, quality: $('#quality').value, output_format: 'jpeg', output_compression: 85, n: 1 }),
    });
    if (!res.ok) {
      let msg = `${res.status}`;
      try { const j = await res.json(); msg = j.error?.message || msg; } catch {}
      if (res.status === 401) { signOut(); throw new Error('Your OpenRouter session expired. Please sign in again.'); }
      if (res.status === 402) throw new Error('Your OpenRouter account is out of credit. Add credit at openrouter.ai/settings/credits.');
      if (RETRY_STATUS.has(res.status)) throw new RetryableError(`Image request failed: ${msg}`);
      throw new Error(`Image request failed: ${msg}`);
    }
    const j = await res.json();
    if (j.error) throw new RetryableError(j.error.message || 'The image model returned an error');
    const d = j.data?.[0];
    if (!d?.b64_json) throw new Error('The image model returned no picture.');
    if (j.usage?.cost != null) state.cost += Number(j.usage.cost);
    return `data:${d.media_type || 'image/jpeg'};base64,${d.b64_json}`;
  }, signal, 'OpenRouter');
}

// ---------- a look at the finished picture ----------
const REVIEW_MODEL = 'anthropic/claude-haiku-5.5';
const REVIEW_SCHEMA = { type: 'json_schema', json_schema: { name: 'review', strict: true, schema: { type: 'object', additionalProperties: false,
  required: ['ok', 'problems', 'badges'], properties: { ok: { type: 'boolean' }, problems: { type: 'array', items: { type: 'string' } },
  badges: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['n', 'x', 'y'], properties: { n: { type: 'integer' }, x: { type: 'number' }, y: { type: 'number' } } } } } } } };

// Does each numbered badge sit on the part the list says, drawn as described, nothing duplicated or missing?
async function reviewPicture(dataUrl, plan, signal, mode) {
  try {
    const list = plan.parts.map((p, i) => `${i + 1} = ${p.name_en || p.name}`).join('; ');
    const text = await callAI({ model: REVIEW_MODEL, maxTokens: 400, responseFormat: REVIEW_SCHEMA, signal, messages: [
      { role: 'system', content: 'You check illustrations for a children\'s "how it works" book. Be strict, concrete and brief. Answer as JSON only.' },
      { role: 'user', content: [
        { type: 'text', text: `This should be ${mode === 'whole' ? 'the assembled' : 'an exploded view of the'} ${plan.title_en || plan.wikipedia_title || plan.title}, with numbered badges meaning: ${list}.
Check: (a) every number 1–${plan.parts.length} appears exactly once and sits on or points to the right part; (b) each part is drawn as what it is — in particular a part that is ONE half of a pair must not be drawn as the complete object (e.g. a scissor half with two finger rings); (c) no stray text or letters. "ok" true only if all pass. "problems": up to 3 one-sentence fixes for the painter, naming the number and what to change.
"badges": the centre of each number badge as a percentage of the image width (x) and height (y), 0–100, one entry per number you can see.` },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] },
    ] });
    const j = parseJSON(text);
    const badges = (j.badges || []).filter((b) => Number.isInteger(b.n) && b.n >= 1 && b.n <= plan.parts.length && b.x >= 0 && b.x <= 100 && b.y >= 0 && b.y <= 100);
    return { ok: !!j.ok, problems: (j.problems || []).slice(0, 3), badges };
  } catch (e) { if (e?.name === 'AbortError') throw e; return null; }
}

// Paint, look, and repaint once if the look found problems.
async function paintChecked(prompt, plan, signal, mode, onStatus) {
  let img = await paint(prompt, signal);
  let r = await reviewPicture(img, plan, signal, mode);
  if (r && !r.ok && r.problems.length) {
    onStatus?.(`Fixing: ${r.problems[0].slice(0, 60)}…`);
    try {
      const again = await paint(`${prompt}\n\nCorrections to the previous attempt, which must be fixed: ${r.problems.join(' ')}`, signal);
      const r2 = await reviewPicture(again, plan, signal, mode);
      if (!r2 || r2.ok || r2.problems.length <= r.problems.length) { img = again; r = r2 || r; }
    } catch (e) { if (e?.name === 'AbortError') throw e; }
  }
  return { img, badges: r?.badges || [] };
}

// ---------- the flow ----------
const LOADING_LINES = ['Working out which part does what', 'Deciding what to pull apart', 'Mixing the paints', 'Painting the exploded view', 'Numbering the parts', 'Looking for a photo of the real thing', 'Finding a 3D model to spin'];
let loadingTimer = null;
function setLoading(title, msg) {
  if (title) $('#loading-title').textContent = title;
  if (msg) $('#loading-msg').textContent = msg;
}
function startLoading(q) {
  $('#loading').hidden = false; $('#result').hidden = true; $('#error').hidden = true; document.body.classList.remove('has-result');
  setLoading(`Drawing ${q}…`, LOADING_LINES[0]);
  let i = 1; clearInterval(loadingTimer);
  loadingTimer = setInterval(() => { setLoading(null, LOADING_LINES[i++ % LOADING_LINES.length]); }, 3200);
  $('#loading').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function stopLoading() { clearInterval(loadingTimer); $('#loading').hidden = true; }
function showError(msg) { stopLoading(); $('#error-msg').textContent = msg; $('#error').hidden = false; }

async function ask(q, { force = false, reusePlan = null } = {}) {
  q = q.trim();
  if (!q) return;
  const lang = $('#lang').value; const level = $('#level').value;
  $('#q').value = q;
  location.hash = `q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}`;

  if (!force) {
    const demo = typeof DEMO !== 'undefined' && DEMO[q.toLowerCase()];
    if (demo && lang === 'English') {
      const painted = state.gallery.find((g) => g.title.toLowerCase() === demo.title.toLowerCase());
      if (painted) { openStored(painted.id, painted.title); return; }
      show(demo, q, { free: true }); return;
    }
    const cached = cacheGet(cacheKey(q, lang, level));
    if (cached) { show(cached, q, { free: true }); return; }
  }
  if (!state.key) { store.set('pending_q', q, sessionStorage); showError('To make a new page, sign in to OpenRouter first (top right). The demo and the gallery are free.'); $('#signin').focus(); return; }

  state.abort?.abort();
  const ctrl = new AbortController(); state.abort = ctrl;
  state.cost = 0;
  startLoading(q);
  try {
    let plan = reusePlan;
    if (!plan) { setLoading(null, 'Working out which part does what'); plan = await makePlan(q, lang, level, ctrl.signal); }
    if (ctrl.signal.aborted) return;
    const result = { ...plan, image: null, image_whole: null, image_id: null, lang, cost: 0, badges: {} };
    if (plan.kind === 'refused') { show(result, q, { keepShort: true }); return; }
    // the words go on screen now; the pictures arrive as they are painted
    state.shortId = null;
    show(result, q, { keepShort: true, painting: true });
    const paintStatus = (which, msg) => { const el = $(`#paint-status-${which}`); if (el) el.textContent = msg; };
    const explodedP = paintChecked(plan.image_prompt, plan, ctrl.signal, 'exploded', (m) => paintStatus('exploded', m))
      .then((r) => { if (ctrl.signal.aborted) return; result.image = r.img; result.badges.exploded = r.badges; if (state.result === result) { $('#tab-whole').hidden = !wholeUrl(result); if (pictureMode === 'exploded') renderPicture(); } });
    const wholeP = plan.whole_prompt
      ? paintChecked(plan.whole_prompt, plan, ctrl.signal, 'whole', (m) => paintStatus('whole', m)).then((r) => { if (ctrl.signal.aborted) return; result.image_whole = r.img; result.badges.whole = r.badges; if (state.result === result) { $('#tab-whole').hidden = false; if (pictureMode === 'whole') renderPicture(); } }).catch((e) => { if (e?.name === 'AbortError') throw e; })
      : Promise.resolve();
    await Promise.all([explodedP, wholeP]);
    if (ctrl.signal.aborted) return;
    const id = await storeResult(result, q, ctrl.signal);
    if (id) { result.image_id = id; result.has_whole = !!result.image_whole; result.image = null; result.image_whole = null; state.shortId = id; } else state.shortId = null;
    result.cost = state.cost;
    cachePut(cacheKey(q, lang, level), result);
    if (state.result === result) { result.painting = false; $('#cost').textContent = result.cost ? `This page cost $${result.cost.toFixed(3)}` : ''; renderAdmin(); renderPicture(); }
  } catch (e) {
    if (e.name === 'AbortError') { stopLoading(); return; }
    showError(e.message);
  }
}

// ---------- rendering ----------
function imageUrl(r) { return r.image || (r.image_id ? `${LINKS_API}/img/${r.image_id}` : ''); }
function wholeUrl(r) { return r.image_whole || (r.has_whole && r.image_id ? `${LINKS_API}/img/${r.image_id}/whole` : ''); }
let pictureMode = 'exploded';

function show(result, q, { free = false, shared = false, keepShort = false, painting = false } = {}) {
  state.result = result; state.query = q; result.painting = painting;
  if (!keepShort) state.shortId = result.image_id || undefined;
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
  $('#hero-live').hidden = true;
  $('#cost').textContent = painting ? 'Painting…' : shared ? '' : free ? 'Free (already made)' : result.cost ? `This page cost $${result.cost.toFixed(3)}` : '';
  $('#gallery-add').textContent = 'Add to gallery';
  $('#flag').textContent = 'Something wrong?'; $('#flag').disabled = false; $('#flag').hidden = result.kind === 'refused';
  renderAdmin();

  $('#tab-whole').hidden = !wholeUrl(result);
  pictureMode = 'exploded';

  const parts = $('#parts'); parts.innerHTML = '';
  (result.parts || []).forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="num"></span><strong></strong><span></span>`;
    li.querySelector('.num').textContent = i + 1;
    li.querySelector('strong').textContent = p.name;
    li.querySelector('span:not(.num)').textContent = p.role;
    const more = document.createElement('button'); more.type = 'button'; more.className = 'ask-more'; more.textContent = 'How does this work? →';
    more.addEventListener('click', (e) => { e.stopPropagation(); followUp(p.name); });
    li.appendChild(more);
    li.addEventListener('click', () => pingPart(i + 1));
    parts.appendChild(li);
  });
  const steps = $('#steps'); steps.innerHTML = '';
  (result.steps || []).forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="num">${i + 1}</span><strong></strong><span></span>`;
    li.querySelector('strong').textContent = s.title;
    li.querySelector('span:not(.num)').textContent = s.text;
    steps.appendChild(li);
  });

  setView('exploded');
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  loadPhotos(result.wikipedia_title || q);
  load3D(result.search_terms || q, result.m3d);
}

function renderPicture() {
  const result = state.result; const picture = $('#picture'); picture.innerHTML = '';
  const url = pictureMode === 'whole' ? wholeUrl(result) : imageUrl(result);
  if (!url) {
    picture.innerHTML = result.painting
      ? `<div class="painting"><div class="loader"><svg viewBox="0 0 120 120" width="72" height="72" aria-hidden="true"><circle cx="60" cy="60" r="44" fill="none" stroke="#d9cdb2" stroke-width="10" stroke-dasharray="40 30" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 60 60" to="360 60 60" dur="6s" repeatCount="indefinite"/></circle><circle cx="60" cy="60" r="22" fill="none" stroke="#e4572e" stroke-width="10" stroke-dasharray="22 14" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="360 60 60" to="0 60 60" dur="3s" repeatCount="indefinite"/></circle></svg></div><p>${pictureMode === 'whole' ? 'Painting the whole thing' : 'Painting the exploded view'} (20–40 s)</p><p class="paint-status" id="paint-status-${pictureMode}"></p></div>`
      : '<p class="empty">No picture for this one.</p>';
    return;
  }
  const img = document.createElement('img'); img.src = url; img.decoding = 'async';
  if (wholeUrl(result)) { img.style.cursor = 'pointer'; img.title = pictureMode === 'whole' ? 'Tap to pull it apart' : 'Tap to put it back together'; img.addEventListener('click', () => setView(pictureMode === 'whole' ? 'exploded' : 'whole')); }
  img.alt = `${result.title}: ${pictureMode === 'whole' ? 'assembled, with numbered parts' : 'exploded view with numbered parts'}`;
  img.addEventListener('error', () => { picture.innerHTML = '<p class="empty">The picture could not be loaded. Try “Draw it again”.</p>'; });
  picture.appendChild(img);
  // tappable number badges, where the reviewer saw them
  const badges = result.badges?.[pictureMode] || [];
  for (const b of badges) {
    const hot = document.createElement('button'); hot.type = 'button'; hot.className = 'hot'; hot.style.left = `${b.x}%`; hot.style.top = `${b.y}%`;
    const part = result.parts?.[b.n - 1]; hot.setAttribute('aria-label', part?.name || `part ${b.n}`); hot.title = part?.name || '';
    hot.addEventListener('click', (e) => { e.stopPropagation(); pingPart(b.n); });
    picture.appendChild(hot);
  }
  // preload the other one so the toggle is instant
  const other = pictureMode === 'whole' ? imageUrl(result) : wholeUrl(result);
  if (other) { const pre = new Image(); pre.src = other; }
}

// Tap a number on the picture → its card lights up and scrolls into view; tap a card → its badge pulses.
function pingPart(n) {
  $$('#parts li').forEach((li, i) => li.classList.toggle('hot', i === n - 1));
  const li = $(`#parts li:nth-child(${n})`); li?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $$('#picture .hot').forEach((h) => h.classList.toggle('pulse', h.title === (state.result.parts?.[n - 1]?.name || '')));
  setTimeout(() => { li?.classList.remove('hot'); $$('#picture .hot.pulse').forEach((h) => h.classList.remove('pulse')); }, 2500);
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
function setView(view) {
  $$('.tab').forEach((t) => { const on = t.dataset.view === view; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); });
  const pic = view === 'exploded' || view === 'whole';
  if (pic) { pictureMode = view; renderPicture(); }
  $('#view-picture').hidden = !pic;
  $('#view-photos').hidden = view !== 'photos';
  $('#view-model3d').hidden = view !== 'model3d';
}

// ---------- photos of the real thing (Wikipedia) ----------
const BAD_IMAGE = /icon|logo|commons-|wiki|edit-|question_book|symbol|flag_of|ambox|disambig|padlock|speaker|sound-|nuvola|crystal_clear|\.ogv|\.webm|\.ogg/i;
function wikiImageUrl(src) {
  return ('https:' + String(src).replace(/^https?:/, '')).replace(/^https:\/\/thumb\.wikimedia\.org\//, 'https://upload.wikimedia.org/').split('?')[0];
}
async function loadPhotos(title) {
  const box = $('#gallery'); box.innerHTML = '<p class="empty">Looking for photos…</p>';
  $('#gallery-credit').textContent = '';
  try {
    let data = null;
    try { const r = await fetch(`${LINKS_API}/wiki?t=${encodeURIComponent(title)}`); if (r.ok) data = await r.json(); } catch {}
    if (!data?.pics?.length) data = await wikiDirect(title);
    if (!data.pics.length) throw new Error('the article has no usable pictures');
    box.innerHTML = '';
    data.pics.forEach((it, i) => {
      const fig = document.createElement('figure'); if (i === 0) fig.className = 'wide';
      const img = document.createElement('img'); img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.alt = it.caption;
      const tries = [wikiImageUrl(it.src), it.small && wikiImageUrl(it.small)].filter((u, k, arr) => u && arr.indexOf(u) === k);
      img.src = tries.shift();
      img.addEventListener('error', () => { if (tries.length) { img.src = tries.shift(); return; } fig.remove(); });
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
      state.model3d = { uid: m.uid, name: m.name, by: m.user?.displayName ?? m.by ?? '', url: m.viewerUrl || m.url || '', thumb: thumbOf(m) };
      iframe.src = `https://sketchfab.com/models/${m.uid}/embed?autostart=0&ui_infos=1&ui_watermark=0&dnt=1`;
      $$('button', thumbs).forEach((b) => b.classList.toggle('active', b === btn));
      $('#model3d-credit').innerHTML = `<a target="_blank" rel="noopener"></a> by ${escapeHTML(state.model3d.by || 'a Sketchfab artist')} on Sketchfab, under its own licence. Drag to spin, pinch or scroll to zoom.`;
      const a = $('#model3d-credit a'); a.href = state.model3d.url || `https://sketchfab.com/3d-models/${m.uid}`; a.textContent = m.name;
    };
    models.forEach((m, i) => {
      const b = document.createElement('button'); b.type = 'button';
      b.innerHTML = `<img alt="" loading="lazy"><span></span>`;
      const t = thumbOf(m); if (t) $('img', b).src = t;
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

// ---------- price estimate ----------
const IMAGE_COST = { low: 0.005, medium: 0.011, high: 0.042, xhigh: 0.075 }; // 1536×1024, OpenAI's own estimates
function updateEstimate() {
  const img = IMAGE_COST[$('#quality').value] ?? 0.04;
  $('#estimate').textContent = `About $${(0.01 + 2 * img).toFixed(2)} per new page (~1¢ for the words, ~${Math.round(img * 100)}¢ for each of the two pictures), charged to your OpenRouter account. Reopening a page is free.`;
}

// ---------- storing & sharing ----------
// The whole page (picture included) is stored by the link service; the browser keeps only the id.
async function storeResult(result, q, signal) {
  try {
    const res = await fetch(`${LINKS_API}/`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sharePayload({ ...result, q })) });
    const j = res.ok ? await res.json() : null;
    return j?.id || null;
  } catch (e) { if (e?.name === 'AbortError') throw e; return null; }
}
function sharePayload(result) {
  const { title, hook, kind, wikipedia_title, search_terms, parts, steps, fun_fact, lang, image, image_whole, image_id, image_prompt, whole_prompt, has_whole, badges } = result;
  const m = state.model3d;
  const m3d = m?.uid ? { uid: m.uid, name: m.name, by: m.by, url: m.url } : undefined;
  return { title, hook, kind, wikipedia_title, search_terms, parts, steps, fun_fact, lang, image: image || undefined, image_whole: image_whole || undefined, has_whole: has_whole || !!image_whole || undefined, image_id: image_id || undefined, image_prompt, whole_prompt, badges: badges || undefined, m3d, q: result.q || state.query };
}
async function shareUrl() {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
  const base = local ? SITE_URL : location.origin + location.pathname;
  if (!state.shortId) {
    // the demo, or a page whose id was lost: store it now (the picture travels as its URL/data)
    const r = state.result;
    let image = r.image;
    if (!image && r.image_id) image = undefined; // already stored; the server copies the picture by id
    if (!image && !r.image_id) { try { image = await blobToDataUrl(await pictureBlob()); } catch {} }
    state.shortId = await storeResult({ ...r, image }, state.query) || null;
  }
  renderAdmin();
  return state.shortId ? `${base}#${encodeURIComponent(fileSlug())}/s=${state.shortId}` : location.href;
}
function openShare() {
  if (!state.result) return;
  $('#share-status').textContent = '';
  $('#share-native').hidden = !navigator.share;
  $('#share-dialog').showModal();
}
function shareStatus(msg) { $('#share-status').textContent = msg; }
function fileSlug() { return (state.result?.title || 'how').replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'how'; }
function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function pictureBlob() { return (await fetch(imageUrl(state.result))).blob(); }
function blobToDataUrl(b) { return new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(b); }); }

// One self-contained HTML file: picture, parts, steps, fact, links. Opens anywhere, offline.
async function buildReport() {
  const r = state.result; const esc = escapeHTML;
  const rtl = RTL.test(r.lang || '');
  const link = await shareUrl();
  let img = imageUrl(r);
  try { img = await blobToDataUrl(await (await fetch(imageUrl(r))).blob()); } catch {}
  let whole = wholeUrl(r);
  if (whole) { try { whole = await blobToDataUrl(await (await fetch(whole)).blob()); } catch {} }
  const parts = (r.parts || []).map((p, i) => `<li><span class="n">${i + 1}</span><b>${esc(p.name)}</b><span>${esc(p.role)}</span></li>`).join('');
  const steps = (r.steps || []).map((st, i) => `<li><span class="n">${i + 1}</span><b>${esc(st.title)}</b><span>${esc(st.text)}</span></li>`).join('');
  const wiki = `https://en.wikipedia.org/wiki/${encodeURIComponent((r.wikipedia_title || state.query || '').replace(/ /g, '_'))}`;
  const sk = `https://sketchfab.com/search?q=${encodeURIComponent(r.search_terms || state.query || '')}&type=models`;
  const m = state.model3d;
  const model = m?.uid ? `<h2>In 3D</h2><div class="stage three"><iframe title="3D model" src="https://sketchfab.com/models/${esc(m.uid)}/embed?autostart=0&ui_infos=1&ui_watermark=0&dnt=1" allow="autoplay; fullscreen; xr-spatial-tracking" allowfullscreen></iframe></div><p class="credit"><a href="${esc(m.url || 'https://sketchfab.com/3d-models/' + m.uid)}">${esc(m.name || '3D model')}</a> by ${esc(m.by || 'a Sketchfab artist')} on Sketchfab (needs an internet connection).</p>` : '';
  return `<!doctype html><html lang="${langCode(r.lang)}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.title)} — How</title>
<style>
body{margin:0;background:#fbf4e4;color:#1d2433;font:17px/1.5 Nunito,system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(100% - 32px,900px);margin:0 auto;padding:24px 0 40px}
.eyebrow{margin:0;text-transform:uppercase;letter-spacing:.14em;font-size:12px;font-weight:800;color:#1f8a8a;text-align:center}
h1{font-family:Fraunces,Georgia,serif;font-size:clamp(32px,6vw,52px);margin:4px 0 6px;text-align:center;line-height:1.05}
.hook{text-align:center;font-style:italic;color:#4a5263;font-size:19px;max-width:640px;margin:0 auto 18px;font-family:Fraunces,Georgia,serif}
.stage{border:2px solid #1d2433;border-radius:18px;overflow:hidden;background:#fbf4e4;box-shadow:0 10px 30px -14px rgba(29,36,51,.35)}
.stage img{display:block;width:100%;height:auto}
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
${whole ? `<div class="stage"><img src="${esc(whole)}" alt="${esc(r.title)}"></div><h2>Pulled apart</h2>` : ''}
<div class="stage"><img src="${esc(img)}" alt="${esc(r.title)}"></div>
<h2>Parts</h2><ol>${parts}</ol>
<h2>Step by step</h2><ol>${steps}</ol>
${r.fun_fact ? `<p class="fact"><b>Did you know?</b> ${esc(r.fun_fact)}</p>` : ''}
${model}
<div class="links"><a class="main" href="${esc(link)}">Open on How (photos, 3D)</a><a href="${wiki}">Photos on Wikipedia</a><a href="${esc(sk)}">3D models on Sketchfab</a></div>
<footer>Made with <a href="${SITE_URL}">How</a> — type a thing, see how it works. Picture by AI; check important details against a trusted source.</footer>
</main></body></html>`;
}

// "Something wrong?": flag the page in the link service.
async function flagWrong() {
  if (!state.result) return;
  const reason = prompt('What is wrong with this page? (optional)') ?? null;
  if (reason === null) return;
  await shareUrl();
  if (!state.shortId) { $('#flag').textContent = 'Could not send (link service unreachable)'; return; }
  try {
    const res = await fetch(`${LINKS_API}/flag`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: state.shortId, reason }) });
    $('#flag').textContent = res.ok ? 'Thanks, noted' : 'Could not send';
  } catch { $('#flag').textContent = 'Could not send'; }
  $('#flag').disabled = true;
}
async function showFlags() {
  if (!state.admin) { showError('Open the page with #admin=<secret> first.'); return; }
  try {
    const list = await (await fetch(`${LINKS_API}/flags`, { headers: { 'X-Admin': state.admin } })).json();
    const grid = $('#gallery-grid'); grid.innerHTML = '';
    $('#gallery-home').hidden = false; $('.gallery-h', $('#gallery-home')).innerHTML = 'Flagged <em>pages</em> <small>owner only</small>';
    if (!list.length) { grid.innerHTML = '<p class="empty">Nothing flagged yet.</p>'; return; }
    for (const f of list) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'gcard';
      card.innerHTML = '<strong></strong><span></span>';
      $('strong', card).textContent = f.title || f.q; $('span', card).textContent = `${f.reason || 'no reason given'} · ${f.at.slice(0, 10)}`;
      card.addEventListener('click', () => openStored(f.id, f.title || f.q));
      grid.appendChild(card);
    }
  } catch { showError('Could not load the flags.'); }
}

// A follow-up question about one part, same language and audience.
function followUp(partName) {
  const parent = state.result?.title || state.query || '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  ask(parent ? `${partName} (of ${parent})` : partName);
}

// ---------- gallery (curated pages, free to open) and the picture under the headline ----------
function galleryItems() {
  const demo = typeof DEMO !== 'undefined' ? Object.entries(DEMO).map(([q, d]) => ({ id: null, demo: q, title: d.title, hook: d.hook, lang: 'English', image: imageUrl(d) })) : [];
  return [...state.gallery, ...demo.filter((d) => !state.gallery.some((g) => g.title === d.title))];
}
async function loadGallery() {
  try { const r = await fetch(`${LINKS_API}/gallery`); if (r.ok) state.gallery = (await r.json()).filter((g) => g && g.id).map((g) => ({ ...g, image: `${LINKS_API}/img/${g.id}` })); } catch {}
  renderGallery();
  renderHeroLive();
}
function renderGallery() {
  const items = galleryItems();
  const box = $('#gallery-home'); const grid = $('#gallery-grid'); grid.innerHTML = '';
  box.hidden = items.length === 0;
  items.slice(0, 24).forEach((g) => {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'gcard';
    card.innerHTML = '<div class="gthumb"><img alt="" loading="lazy"></div><strong></strong><span></span>';
    $('img', card).src = g.image;
    $('strong', card).textContent = g.title; $('span', card).textContent = g.hook || '';
    if (RTL.test(g.lang || '')) card.setAttribute('dir', 'rtl');
    card.addEventListener('click', () => openGalleryItem(g));
    grid.appendChild(card);
  });
}
function openGalleryItem(g) {
  if (g.demo) { $('#lang').value = 'English'; ask(g.demo); return; }
  openStored(g.id, g.title);
}
async function openStored(id, title, { shared = false } = {}) {
  try {
    startLoading(title || 'the page');
    const res = await fetch(`${LINKS_API}/${id}`);
    if (!res.ok) throw new Error();
    const r = await res.json();
    const q = r.q || r.title; delete r.q;
    r.image = undefined; r.image_whole = undefined; r.image_id = id; // pictures are served by the link service
    $('#q').value = q; if (r.lang && $(`#lang option[value="${CSS.escape(r.lang)}"]`)) $('#lang').value = r.lang;
    location.hash = `${encodeURIComponent((r.title || q).replace(/[^\p{L}\p{N}-]+/gu, '-').toLowerCase())}/s=${id}`;
    state.shortId = id;
    show(r, q, { free: true, shared, keepShort: true });
    cachePut(cacheKey(q, r.lang || 'English', $('#level').value), r);
  } catch { showError('This page could not be opened. The link may be mistyped, or the link service is unreachable right now.'); }
}
function renderHeroLive() {
  if (document.body.classList.contains('has-result')) return;
  const items = galleryItems(); const box = $('#hero-live'); if (!items.length) { box.hidden = true; return; }
  const g = items[Math.floor(Math.random() * Math.min(items.length, 8))];
  $('#hero-live-stage').innerHTML = ''; const img = document.createElement('img'); img.src = g.image; img.alt = g.title; $('#hero-live-stage').appendChild(img);
  $('#hero-live-title').textContent = g.title;
  box.hidden = false;
  box.onclick = () => openGalleryItem(g);
}
async function galleryAdd() {
  if (!state.result || !state.admin) return;
  await shareUrl();
  if (!state.shortId) { $('#gallery-add').textContent = 'Could not store the page (link service unreachable)'; return; }
  const r = state.result;
  const res = await fetch(`${LINKS_API}/gallery`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': state.admin }, body: JSON.stringify({ id: state.shortId, title: r.title, hook: r.hook, lang: r.lang, q: state.query }) });
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
$('#signin').addEventListener('click', signIn);
$('#signout').addEventListener('click', signOut);
$('#paste-key').addEventListener('click', () => { $('#key-input').value = ''; $('#key-dialog').showModal(); });
$('#key-cancel').addEventListener('click', () => $('#key-dialog').close());
$('#key-form').addEventListener('submit', () => {
  const k = $('#key-input').value.trim(); if (!k) return;
  setKey(k);
  const pending = store.get('pending_q', sessionStorage);
  if (pending) { store.del('pending_q', sessionStorage); setTimeout(() => ask(pending), 50); }
});
$('#cancel').addEventListener('click', () => state.abort?.abort());
$('#error-close').addEventListener('click', () => { $('#error').hidden = true; });
$('#quality').addEventListener('change', updateEstimate);
$$('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
$('#redraw').addEventListener('click', () => ask(state.query, { force: true, reusePlan: state.result?.image_prompt ? { ...state.result, image: null, image_whole: null, image_id: null, has_whole: false, badges: {} } : null }));
$('#remake').addEventListener('click', () => ask(state.query, { force: true }));
$('#share').addEventListener('click', openShare);
$('#gallery-add').addEventListener('click', galleryAdd);
$('#gallery-remove').addEventListener('click', galleryRemove);
$('#flag').addEventListener('click', flagWrong);
$('#share-link').addEventListener('click', async () => {
  shareStatus('Making the link…');
  const url = await shareUrl();
  try { await navigator.clipboard.writeText(url); shareStatus('Link copied. Anyone who opens it sees this page, no sign-in needed.'); }
  catch { prompt('Copy this link:', url); }
});
$('#share-native').addEventListener('click', async () => {
  const url = await shareUrl();
  try { await navigator.share({ title: `${state.result?.title} — How`, text: state.result?.hook || '', url }); } catch {}
});
$('#share-report').addEventListener('click', async () => {
  shareStatus('Building the report…');
  const html = await buildReport();
  downloadBlob(new Blob([html], { type: 'text/html' }), `${fileSlug()}-how.html`);
  shareStatus('Report saved. It opens in any browser, offline.');
});
$('#share-svg').addEventListener('click', async () => {
  try { downloadBlob(await pictureBlob(), `${fileSlug()}.jpg`); shareStatus('Picture saved.'); } catch { shareStatus('Could not download the picture.'); }
});
$('#privacy').addEventListener('click', () => $('#privacy-dialog').showModal());

(async function init() {
  state.key = store.get('or_key');
  await finishSignIn();
  renderAuth();
  renderRecent();
  updateEstimate();
  const h = new URLSearchParams(location.hash.slice(1).replace(/^[^=]*\//, ''));
  if (h.get('admin')) { store.set('how_admin', h.get('admin')); history.replaceState(null, '', callbackUrl()); }
  state.admin = store.get('how_admin') || store.get('tmw_admin');
  if (location.hash === '#flags') { await loadGallery(); showFlags(); return; }
  loadGallery();
  const shortId = h.get('s');
  if (shortId && /^[a-z0-9]{5,12}$/.test(shortId)) { openStored(shortId, '', { shared: true }); return; }
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
