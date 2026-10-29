// How — the Factory tab: what it would take to make the thing, in the order it happens.
// Claude plans the plant (raw materials → components → fabrication → assembly → quality → packing →
// shipping, each step marked machine / people / both, and the floor zones with real dimensions);
// the image model paints an overview of the floor; the floor plan itself is drawn here, to scale.
// Uses app.js's helpers ($, state, askJSON, paint, escapeHTML, LINKS_API…) only when called, so it can load
// first: app.js may open a page (and draw this tab) as soon as it runs.
'use strict';

const STAGES = [
  { key: 'materials', name: 'Raw materials', color: '#2b4c7e', tint: '#e2e8f2', icon: '<path d="M3 19l3-6h12l3 6zM7 13l2-5h6l2 5M10 8l1-3h2l1 3"/>' },
  { key: 'components', name: 'Components', color: '#1f8a8a', tint: '#dcefee', icon: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/><circle cx="12" cy="12" r="6.5"/>' },
  { key: 'fabrication', name: 'Make the parts', color: '#d2491f', tint: '#f8e1d8', icon: '<path d="M3 21h18M6 21v-8h12v8M9 13V8h6v5M10.5 8V3h3v5M9 17h6"/>' },
  { key: 'assembly', name: 'Assembly', color: '#b5830f', tint: '#f6ecd0', icon: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>' },
  { key: 'quality', name: 'Quality control', color: '#3a8a4c', tint: '#dff0e2', icon: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.2 15.2L21 21M7.8 10.6l2 2 3.6-3.6"/>' },
  { key: 'packing', name: 'Packing', color: '#8f6236', tint: '#efe3d6', icon: '<path d="M3 7.5l9-4.5 9 4.5v9l-9 4.5-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9M7.5 5.2l9 4.6"/>' },
  { key: 'shipping', name: 'Shipping', color: '#56607a', tint: '#e3e5ec', icon: '<path d="M1.5 5.5h12v10h-12zM13.5 9h4.5l3.5 3.5v3h-8z"/><circle cx="5.5" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>' },
];
const STAGE_KEYS = STAGES.map((s) => s.key);
const stageOf = (k) => STAGES.find((s) => s.key === k) || STAGES[2];
const WHO = {
  machine: { icon: '🤖', label: 'Machine' },
  both: { icon: '🤝', label: 'People + machine' },
  human: { icon: '✋', label: 'People' },
};
const FACTORY_STYLE = "vintage children's encyclopedia illustration, flat bold colours, thick dark outlines, soft cream paper background, evenly lit, centred with margins, nothing cropped. No text, words or letters anywhere except the number badges.";
const FACTORY_COST = '~18¢';

// ---------- the plan, from Claude ----------
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const str = { type: 'string' }, num = { type: 'number' }, int = { type: 'integer' }, ints = { type: 'array', items: { type: 'integer' } };
const FACTORY_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'factory', strict: true,
    schema: obj({
      applicable: { type: 'boolean' }, summary: str, output: str, shifts: int, workers_per_shift: int,
      building: obj({ length_m: num, width_m: num, height_m: num }),
      materials: { type: 'array', items: obj({ name: str, form: str, per_unit: str, parts: ints }) },
      components: { type: 'array', items: obj({ part: int, make: { type: 'boolean' }, process: str }) },
      steps: { type: 'array', items: obj({ stage: { type: 'string', enum: STAGE_KEYS }, title: str, text: str, who: { type: 'string', enum: Object.keys(WHO) }, why: str, parts: ints, zone: int }) },
      zones: { type: 'array', items: obj({ name: str, name_en: str, stage: { type: 'string', enum: STAGE_KEYS }, length_m: num, width_m: num, staff: int,
        machines: { type: 'array', items: obj({ name: str, count: int, length_m: num, width_m: num }) } }) },
      floor_prompt: str,
    }),
  },
};

function factoryPrompt(lang, level, r) {
  const parts = (r.parts || []).map((p, i) => `${i + 1} = ${p.name_en || p.name}`).join('; ');
  return `You are a manufacturing engineer. Plan a realistic factory that makes the product below, and explain it for ${level}. Write all text in ${lang}, except "name_en" and "floor_prompt", which are English. Answer as JSON only.

Product: ${r.title_en || r.wikipedia_title || r.title}. Its numbered parts (use these numbers in every "parts" and "part" field): ${parts || 'none listed'}.

Plan a mid-size plant with a sensible output, stated in "output" ("about 12,000 pairs a day"). Follow the material in time order through these stages:
"materials": raw materials arriving and stored; "components": parts bought in and parts made in-house; "fabrication": making each in-house part (cutting, pressing, casting, moulding, machining, heat treatment, finishing, painting); "assembly": joining the parts in order; "quality": inspections and tests, where on the line and with what; "packing"; "shipping".

"materials": 3–7 raw materials. name with grade where it matters ("Stainless steel 420, 2 mm strip"); form as delivered ("coils", "pellets in 25 kg bags"); per_unit is the rough amount in one finished product ("38 g"); parts it becomes.
"components": one entry per numbered part: make true if made in-house; process ≤ 12 words.
"steps": 12–24 steps in time order, every stage at least once. title ≤ 5 words; text ≤ 20 words. "who": "machine" (fully automated), "human" (needs people: judgement, dexterity, feel, low volume) or "both" (people load, set or watch a machine). "why" ≤ 10 words, the reason for that choice. "parts": part numbers involved (may be empty). "zone": number of the zone where it happens.
"zones": 6–10 areas of the factory floor in the order material flows through them (1 = receiving, last = shipping dock). length_m and width_m: realistic floor size in metres (usually 6–40). "machines": the main equipment in it, 1–4 kinds, each with count and its real footprint length_m × width_m in metres. "staff": people per shift.
"building": a rectangle that holds all zones plus aisles; height_m is the clear ceiling height. "workers_per_shift" ≈ sum of zone staff; "shifts" 1–3.
"summary" ≤ 28 words: the whole journey from raw material to truck.
"applicable": false only if nothing physical is manufactured (a natural phenomenon, a principle); then say why in "summary" and leave every list empty. Something built on site (a house) → plan the factory for its main prefabricated parts.
"floor_prompt" (80–150 words, English): an isometric cutaway illustration of this factory floor with the roof removed, the zones in flow order with their machines, a few workers and conveyors, material moving from the receiving dock to the shipping dock. Then: "Each zone is marked with a white circle containing a bold black number: 1 <name_en of zone 1>, 2 <zone 2>, …" listing ALL zones. Then: ${FACTORY_STYLE}`;
}

// Whatever comes back (from the AI, or from a shared page) is trimmed to this shape before it is drawn.
function cleanFactory(f, nParts) {
  if (!f || typeof f !== 'object') return null;
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const n = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo; };
  const list = (v, max, fn) => (Array.isArray(v) ? v.slice(0, max).filter((x) => x && typeof x === 'object').map(fn) : []);
  const partNums = (v) => (Array.isArray(v) ? [...new Set(v.map((x) => Math.round(Number(x))))].filter((k) => k >= 1 && k <= nParts).slice(0, 12) : []);
  const stage = (k) => (STAGE_KEYS.includes(k) ? k : 'fabrication');
  const zones = list(f.zones, 12, (z) => ({
    name: s(z.name, 60), name_en: s(z.name_en, 60), stage: stage(z.stage), length_m: n(z.length_m, 2, 120), width_m: n(z.width_m, 2, 80), staff: Math.round(n(z.staff, 0, 500)),
    machines: list(z.machines, 6, (m) => ({ name: s(m.name, 60), count: Math.round(n(m.count, 1, 60)), length_m: n(m.length_m, 0.3, 60), width_m: n(m.width_m, 0.3, 30) })),
  }));
  const steps = list(f.steps, 30, (st) => ({
    stage: stage(st.stage), title: s(st.title, 60), text: s(st.text, 240), who: WHO[st.who] ? st.who : 'both', why: s(st.why, 140), parts: partNums(st.parts),
    zone: Math.round(n(st.zone, 0, zones.length)),
  })).map((st, i) => ({ st, i })).sort((a, b) => STAGE_KEYS.indexOf(a.st.stage) - STAGE_KEYS.indexOf(b.st.stage) || a.i - b.i).map(({ st }) => st);
  return {
    applicable: f.applicable !== false, summary: s(f.summary, 300), output: s(f.output, 100),
    shifts: Math.round(n(f.shifts, 1, 3)), workers_per_shift: Math.round(n(f.workers_per_shift, 0, 9999)),
    building: { length_m: n(f.building?.length_m, 5, 600), width_m: n(f.building?.width_m, 5, 400), height_m: n(f.building?.height_m, 2, 40) },
    materials: list(f.materials, 10, (m) => ({ name: s(m.name, 80), form: s(m.form, 80), per_unit: s(m.per_unit, 40), parts: partNums(m.parts) })),
    components: list(f.components, 20, (c) => ({ part: Math.round(n(c.part, 0, nParts)), make: !!c.make, process: s(c.process, 160) })).filter((c) => c.part >= 1),
    steps, zones, floor_prompt: s(f.floor_prompt, 2000), states: cleanStates(f.states, zones.length),
  };
}
// Before → after for each zone, in zone order. before_from names an earlier zone whose "after" this
// zone's "before" is (the work just moved on), so that picture is reused rather than painted again.
function cleanStates(v, nZones) {
  const s = (x, n) => (typeof x === 'string' ? x.slice(0, n) : '');
  const look = (o) => ({ label: s(o?.label, 80), prompt: s(o?.prompt, 600) });
  return (Array.isArray(v) ? v.slice(0, nZones) : []).map((st, i) => {
    st = st && typeof st === 'object' ? st : {};
    const k = Math.round(Number(st.before_from));
    return { change: s(st.change, 160), before_from: k >= 1 && k <= i ? k : 0, before: look(st.before), after: look(st.after) };
  });
}

const stateKey = (st, i, which) => (which === 'before' && st.before_from ? `z${st.before_from}a` : `z${i + 1}${which === 'before' ? 'b' : 'a'}`);
function stateUrl(r, key) { return r.state_imgs?.[key] || (r.state_keys?.includes(key) && r.image_id ? `${LINKS_API}/img/${r.image_id}/s/${key}` : ''); }
function factoryUrl(r) { return r.image_factory || (r.has_factory_img && r.image_id ? `${LINKS_API}/img/${r.image_id}/factory` : ''); }

async function makeFactory() {
  const r = state.result; if (!r || r.factory_busy) return;
  if (!state.key) { showError('To plan a factory, sign in to OpenRouter first (top right). The scissors demo has one built in.'); $('#signin').focus(); return; }
  const ctrl = new AbortController(); r.factory_ctrl = ctrl;
  r.factory_error = ''; r.factory_busy = 'plan'; renderFactoryIfShown(r);
  const lang = r.lang || $('#lang').value;
  try {
    const f = await askJSON({ model: PLAN_MODEL, maxTokens: 7000, schema: FACTORY_SCHEMA, signal: ctrl.signal, messages: [
      { role: 'system', content: factoryPrompt(lang, $('#level').value, r) },
      { role: 'user', content: `Plan the factory for: ${r.title}` },
    ] });
    r.factory = cleanFactory(f, (r.parts || []).length);
    r.image_factory = null; r.has_factory_img = false; r.floor_badges = undefined;
    r.factory_busy = r.factory?.applicable ? 'all' : null;
    renderFactoryIfShown(r);
    if (r.factory_busy) {
      const floor = r.factory.floor_prompt ? paint(r.factory.floor_prompt, ctrl.signal).then(async (img) => { r.image_factory = img; r.floor_badges = await locateBadges(img, r.factory.zones.length, ctrl.signal); renderFactoryIfShown(r); }) : Promise.resolve();
      const [a, b] = await Promise.allSettled([floor, paintStates(r, ctrl.signal)]);
      if ([a, b].some((x) => x.status === 'rejected' && x.reason?.name === 'AbortError')) throw new DOMException('Cancelled', 'AbortError');
      r.factory_error = [a.status === 'rejected' ? `The floor picture failed: ${a.reason?.message}` : '', b.value || (b.status === 'rejected' ? b.reason?.message : '')].filter(Boolean).join(' ');
    }
  } catch (e) {
    if (e?.name === 'AbortError') { r.factory_busy = null; return; }
    if (!r.factory) r.factory_error = e.message;
  }
  r.factory_busy = null;
  renderFactoryIfShown(r);
  await saveFactory(r);
}

async function paintFloor() {
  const r = state.result; if (!r?.factory?.floor_prompt || r.factory_busy) return;
  if (!state.key) { showError('To paint the factory floor, sign in to OpenRouter first (top right).'); return; }
  const ctrl = new AbortController(); r.factory_ctrl = ctrl;
  r.factory_busy = 'paint'; r.factory_error = ''; renderFactoryIfShown(r);
  try { r.image_factory = await paint(r.factory.floor_prompt, ctrl.signal); r.floor_badges = await locateBadges(r.image_factory, r.factory.zones.length, ctrl.signal); }
  catch (e) { if (e?.name !== 'AbortError') r.factory_error = e.message; }
  r.factory_busy = null;
  renderFactoryIfShown(r);
  if (r.image_factory) await saveFactory(r);
}

// ---------- before → after, zone by zone ----------
const STATES_COST = '~12¢';
const STATE_STYLE = "Vintage children's encyclopedia illustration, flat bold colours, thick dark outlines, soft cream paper background, one clear subject centred with generous margins, three-quarter view, evenly lit. No machines, no people, no hands. No text, words, letters or numbers anywhere.";
const LOOK = obj({ label: str, prompt: str });
const STATES_SCHEMA = { type: 'json_schema', json_schema: { name: 'states', strict: true, schema: obj({
  zones: { type: 'array', items: obj({ before: LOOK, after: LOOK, change: str, before_from: int }) },
}) } };
function statesPrompt(lang, level, r) {
  const f = r.factory;
  const zones = f.zones.map((z, i) => {
    const steps = f.steps.filter((s) => s.zone === i + 1).map((s) => s.title).join('; ');
    return `${i + 1}. ${z.name_en || z.name} (machines: ${z.machines.map((m) => m.name).join(', ') || 'none'}${steps ? `; work done here: ${steps}` : ''})`;
  }).join('\n');
  return `You illustrate a factory zone by zone for ${level}, so the reader SEES what each zone does to the work. Answer as JSON only.
Product: ${r.title_en || r.wikipedia_title || r.title}. Parts: ${(r.parts || []).map((p, i) => `${i + 1} = ${p.name_en || p.name}`).join('; ')}.
For EACH zone below, in the same order, one entry: "before" is the work as it ENTERS the zone, "after" as it LEAVES.
"label" in ${lang}, ≤ 8 words ("Steel strip on a 1-tonne coil"). "change" in ${lang}, ≤ 14 words: what the zone does to it.
"before_from": the number of an earlier zone whose "after" is exactly this zone's "before" (the work just moved on from there), otherwise 0 (the work starts here, like goods arriving or bought-in parts). Zone 1 is always 0: its before is what the trucks deliver.
"prompt" (English, 25–50 words): only the object or objects as they look at that moment — real material, colour, finish, shape and how many (one blank, a stack of 20, a sealed carton) — so before and after are clearly different. Same viewpoint and scale for the same object across zones.
Zones:
${zones}`;
}
// Small squares are plenty for these, and keep the stored page small.
async function shrink(dataUrl, max = 512) {
  const img = new Image(); img.src = dataUrl; await img.decode();
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}
async function inPool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
}
async function makeStates() {
  const r = state.result; const f = r?.factory; if (!f || r.factory_busy) return;
  if (!state.key) { showError('To paint the before and after pictures, sign in to OpenRouter first (top right).'); $('#signin').focus(); return; }
  const ctrl = new AbortController(); r.factory_ctrl = ctrl;
  r.factory_busy = 'states'; r.factory_error = ''; renderFactoryIfShown(r);
  try { r.factory_error = await paintStates(r, ctrl.signal); }
  catch (e) { if (e?.name === 'AbortError') { r.factory_busy = null; return; } r.factory_error = e.message; }
  r.factory_busy = null;
  renderFactoryIfShown(r);
  await saveFactory(r);
}
// Describe each zone's before and after (once), then paint every picture still missing.
// Returns a note about pictures that failed, or ''.
async function paintStates(r, signal) {
  const f = r.factory; let failed = 0;
  {
    if (!f.states?.length) {
      const j = await askJSON({ model: PLAN_MODEL, maxTokens: 6000, schema: STATES_SCHEMA, signal, messages: [
        { role: 'system', content: statesPrompt(r.lang || $('#lang').value, $('#level').value, r) },
        { role: 'user', content: `Before and after for each zone of the ${r.title} factory.` },
      ] });
      f.states = cleanStates(j.zones, f.zones.length);
      renderFactoryIfShown(r);
    }
    const jobs = [];
    f.states.forEach((st, i) => {
      jobs.push({ key: stateKey(st, i, 'after'), prompt: st.after.prompt });
      if (!st.before_from) jobs.push({ key: stateKey(st, i, 'before'), prompt: st.before.prompt });
    });
    r.state_imgs = r.state_imgs || {};
    await inPool(jobs.filter((j) => j.prompt && !stateUrl(r, j.key)), 4, async (j) => {
      try {
        r.state_imgs[j.key] = await shrink(await paint(`${j.prompt} ${STATE_STYLE}`, signal, { size: '1024x1024', quality: 'medium' }));
        fillState(r, j.key);
      } catch (e) { if (e?.name === 'AbortError') throw e; failed++; }
    });
  }
  return failed ? `${failed} before/after picture${failed > 1 ? 's' : ''} could not be painted. Press “Paint the missing pictures” to try again.` : '';
}
// Put a finished picture in place without redrawing the whole tab.
function fillState(r, key) {
  if (state.result !== r) return;
  const url = stateUrl(r, key);
  $$(`[data-skey="${key}"]`).forEach((el) => { el.classList.remove('waiting'); el.innerHTML = ''; const img = document.createElement('img'); img.src = url; img.alt = el.dataset.alt || ''; img.decoding = 'async'; el.appendChild(img); });
}

// Store the page again with its factory, so the share link and the gallery carry it. The existing
// pictures travel by id; only new ones (the floor, before/after) are sent. A link service that predates the
// factory drops it (and says nothing about it), so then the plan is kept in this browser only.
async function saveFactory(r) {
  if (!r.factory || (!r.image_id && !r.image)) { cacheFactory(r); return; }
  try {
    const body = sharePayload({ ...r, image: r.image_id ? undefined : r.image, image_whole: r.image_id ? undefined : r.image_whole, q: state.result === r ? state.query : r.q });
    const res = await fetch(`${LINKS_API}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = res.ok ? await res.json() : null;
    if (j?.id && j.factory) {
      r.image_id = j.id; r.image = null; r.image_whole = null;
      if (r.image_factory) { r.has_factory_img = true; r.image_factory = null; }
      const keys = [...new Set([...(r.state_keys || []), ...Object.keys(r.state_imgs || {})])];
      if (keys.length && j.states >= keys.length) { r.state_keys = keys; r.state_imgs = {}; }
      if (state.result === r) {
        state.shortId = j.id;
        if (/\/s=/.test(location.hash)) history.replaceState(null, '', `#${encodeURIComponent(fileSlug())}/s=${j.id}`);
        renderAdmin();
      }
    }
  } catch {}
  cacheFactory(r);
}
function cacheFactory(r) {
  if (state.result !== r || !state.query || r === DEMO_RESULT()) return;
  const { factory_ctrl, factory_busy, factory_error, ...keep } = r;
  cachePut(cacheKey(state.query, r.lang || 'English', $('#level').value), keep);
}
const DEMO_RESULT = () => (typeof DEMO !== 'undefined' ? Object.values(DEMO).find((d) => d === state.result) : undefined);

// ---------- drawing ----------
function renderFactoryIfShown(r) { if (state.result === r && !$('#view-factory').hidden) renderFactory(); }

function stageIcon(st, size = 26) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${st.icon}</svg>`;
}
function whoChip(who) { const w = WHO[who] || WHO.both; return `<span class="who who-${who}">${w.icon} ${w.label}</span>`; }
function partDots(nums, r) {
  return nums.map((k) => `<button type="button" class="pdot" data-part="${k}" title="${escapeHTML(r.parts?.[k - 1]?.name || `Part ${k}`)}">${k}</button>`).join('');
}
const fmtM = (x) => (Math.round(x * 10) / 10).toLocaleString('en');
const fmtArea = (x) => Math.round(x).toLocaleString('en');

function renderFactory() {
  const box = $('#factory'); const r = state.result; if (!box || !r) return;
  const esc = escapeHTML; const f = r.factory;
  if (r.factory_busy === 'plan') {
    box.innerHTML = `<div class="fintro">${ghostLine(true)}<div class="painting">${loaderSVG()}<p>Planning the factory: materials, machines, people, floor space (30–60 s)</p></div></div>`;
    return;
  }
  if (!f) {
    box.innerHTML = `<div class="fintro">
      ${ghostLine(false)}
      <h3>How would you make ${esc(r.title || 'this')}?</h3>
      <p>See what a factory for it would need, in the order it happens: the raw materials, which parts are made and which are bought, the machines, assembly, quality checks, packing and shipping. Every step is marked 🤖 machine, ✋ people or 🤝 both. You also get a factory floor plan drawn to scale, and before and after pictures for every zone.</p>
      ${r.factory_error ? `<p class="ferror">${esc(r.factory_error)}</p>` : ''}
      ${state.key ? `<button type="button" class="btn btn-primary" id="factory-go">🏭 Plan the factory <small>${FACTORY_COST}</small></button>`
        : `<button type="button" class="btn btn-ghost" id="factory-signin">Sign in to OpenRouter to plan it (${FACTORY_COST})</button><p class="hint">Or open the free <button type="button" class="link" id="factory-demo">scissors demo</button>, which has a factory built in.</p>`}
    </div>`;
    $('#factory-go')?.addEventListener('click', makeFactory);
    $('#factory-signin')?.addEventListener('click', signIn);
    $('#factory-demo')?.addEventListener('click', () => { $('#lang').value = 'English'; ask('scissors'); setTimeout(() => setView('factory'), 50); });
    return;
  }
  if (!f.applicable) {
    box.innerHTML = `<div class="fintro"><h3>Nothing to manufacture here</h3><p>${esc(f.summary)}</p></div>`;
    return;
  }

  const counts = { machine: 0, both: 0, human: 0 };
  f.steps.forEach((s) => { counts[s.who]++; });
  const total = f.steps.length || 1;
  const pct = (k) => Math.round((counts[k] / total) * 100);
  const lay = layoutFloor(f.zones);
  const staff = f.workers_per_shift || f.zones.reduce((a, z) => a + z.staff, 0);
  let stepNo = 0;
  const floorPic = factoryUrl(r);

  box.innerHTML = `
    <p class="fsummary">${esc(f.summary)}</p>
    <div class="ftiles">
      <div class="ftile"><span>Output</span><b>${esc(f.output || '—')}</b></div>
      <div class="ftile"><span>Floor space</span><b>${lay ? `${fmtArea(lay.L * lay.W)} m²` : '—'}</b><small>${lay ? `${fmtM(lay.L)} × ${fmtM(lay.W)} m, ${fmtM(f.building.height_m)} m high` : ''}</small></div>
      <div class="ftile"><span>People</span><b>${staff} per shift</b><small>${f.shifts} shift${f.shifts > 1 ? 's' : ''} a day</small></div>
      <div class="ftile"><span>Automated</span><b>${pct('machine')}% of steps</b><small>${pct('both')}% shared, ${pct('human')}% by hand</small></div>
    </div>

    <h3 class="list-h">The line, in order</h3>
    <ol class="fline${r.factory_busy ? ' busy' : ''}">${STAGES.map((st) => {
      const ss = f.steps.filter((s) => s.stage === st.key);
      const c = (k) => ss.filter((s) => s.who === k).length;
      return `<li style="--c:${st.color};--t:${st.tint}"><button type="button" data-go="${st.key}"><span class="fic">${stageIcon(st)}</span><b>${st.name}</b><small>${ss.length} step${ss.length === 1 ? '' : 's'}</small><span class="fwho">${['machine', 'both', 'human'].filter((k) => c(k)).map((k) => `${WHO[k].icon}${c(k)}`).join(' ')}</span></button></li>`;
    }).join('')}</ol>
    <div class="fauto" role="img" aria-label="${pct('machine')}% machine, ${pct('both')}% people and machine, ${pct('human')}% people">
      <div class="fbar">${['machine', 'both', 'human'].map((k) => (counts[k] ? `<span class="fb-${k}" style="flex:${counts[k]}"></span>` : '')).join('')}</div>
      <p class="flegend">${['machine', 'both', 'human'].map((k) => `<span><i class="fb-${k}"></i>${WHO[k].icon} ${WHO[k].label} <b>${counts[k]}</b></span>`).join('')}</p>
    </div>

    <h3 class="list-h">Factory floor</h3>
    ${floorPic ? `<figure class="ffig"><div class="stage"><div class="ffloor" id="ffloor"><img src="${esc(floorPic)}" alt="${esc(r.title)} factory floor, painted overview" decoding="async"></div></div><figcaption>Painted overview: an impression, not to scale. Point at (or tap) a number to see what that zone does.</figcaption></figure>`
      : r.factory_busy === 'paint' || r.factory_busy === 'all' ? `<div class="stage"><div class="painting">${loaderSVG()}<p>Painting the factory floor (20–40 s)</p></div></div>`
      : f.floor_prompt && state.key ? `<p class="fpaint"><button type="button" class="btn btn-ghost btn-sm" id="factory-paint">🎨 Paint an overview of the floor <small>~4¢</small></button></p>` : ''}
    ${r.factory_error ? `<p class="ferror">${esc(r.factory_error)}</p>` : ''}
    ${lay ? `<figure class="ffig"><div class="stage fplan-scroll">${floorPlanSVG(f, lay)}</div><figcaption>Floor plan drawn to scale from the zone sizes. Material flows along the arrows, from IN to OUT; letters are machines, listed below. Point at (or tap) a zone to see its before and after.<span class="fswipe"> Swipe sideways to see all of it.</span></figcaption></figure>` : ''}
    <div class="ftable-wrap"><table class="ftable">
      <thead><tr><th>#</th><th>Zone</th><th>Size</th><th>Machines (footprint each)</th><th>Staff</th></tr></thead>
      <tbody>${f.zones.map((z, i) => { const st = stageOf(z.stage); return `<tr style="--c:${st.color};--t:${st.tint}">
        <td><span class="znum">${i + 1}</span></td><td><b>${esc(z.name)}</b><small>${st.name}</small></td>
        <td class="nw">${fmtM(z.length_m)} × ${fmtM(z.width_m)} m<small>${fmtArea(z.length_m * z.width_m)} m²</small></td>
        <td>${z.machines.map((m, k) => `<div><span class="mlet">${String.fromCharCode(65 + k)}</span>${m.count} × ${esc(m.name)} <small>${fmtM(m.length_m)} × ${fmtM(m.width_m)} m</small></div>`).join('') || '—'}</td>
        <td class="nw">${z.staff}</td></tr>`; }).join('')}</tbody>
    </table></div>

    <h3 class="list-h">Zone by zone: before → after</h3>
    ${statesHTML(r, f)}

    <h3 class="list-h">Step by step, from raw material to truck</h3>
    <div class="ftimeline">${STAGES.map((st, si) => {
      const ss = f.steps.filter((s) => s.stage === st.key);
      let extra = '';
      if (st.key === 'materials' && f.materials.length) {
        extra = `<div class="fmats">${f.materials.map((m) => `<div class="fmat"><b>${esc(m.name)}</b><span>${esc(m.form)}</span><span class="fmat-foot">${m.per_unit ? `<em>${esc(m.per_unit)} each</em>` : ''}${m.parts.length ? `<span class="fto">→ ${partDots(m.parts, r)}</span>` : ''}</span></div>`).join('')}</div>`;
      }
      if (st.key === 'components' && f.components.length) {
        extra = `<ul class="fcomps">${f.components.map((c) => `<li><span class="pdot-wrap">${partDots([c.part], r)}</span><b>${esc(r.parts?.[c.part - 1]?.name || `Part ${c.part}`)}</b><span class="mk mk-${c.make ? 'make' : 'buy'}">${c.make ? 'Made here' : 'Bought in'}</span><span class="fproc">${esc(c.process)}</span></li>`).join('')}</ul>`;
      }
      if (!ss.length && !extra) return '';
      return `<section class="fstage" id="fstage-${st.key}" style="--c:${st.color};--t:${st.tint}">
        <div class="frail"><span class="fic">${stageIcon(st)}</span></div>
        <div class="fbody"><h4><small>Stage ${si + 1}</small>${st.name}</h4>${extra}
          <ol class="fsteps">${ss.map((s) => { stepNo++; const z = f.zones[s.zone - 1]; return `<li>
            <span class="fn">${stepNo}</span><strong>${esc(s.title)}</strong><p>${esc(s.text)}</p>
            <div class="fmeta">${whoChip(s.who)}${s.why ? `<span class="why">${esc(s.why)}</span>` : ''}</div>
            ${s.parts.length || z ? `<div class="fmeta2">${s.parts.length ? `<span class="fparts">Parts ${partDots(s.parts, r)}</span>` : ''}${z ? `<span class="fzone">Zone ${s.zone} · ${esc(z.name)}</span>` : ''}</div>` : ''}
          </li>`; }).join('')}</ol>
        </div></section>`;
    }).join('')}</div>
    <p class="credit">A rough plan by AI for learning and first estimates, not an engineering quote. Sizes, machines and numbers are typical, not exact.</p>`;

  $$('[data-go]', box).forEach((b) => b.addEventListener('click', () => $(`#fstage-${b.dataset.go}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  $$('.pdot', box).forEach((b) => b.addEventListener('click', () => { setView('exploded'); setTimeout(() => pingPart(Number(b.dataset.part)), 60); }));
  $('#factory-paint')?.addEventListener('click', paintFloor);
  $('#factory-states')?.addEventListener('click', makeStates);
  $$('.fplan [data-zone]', box).forEach((g) => hoverZone(g, r, Number(g.dataset.zone)));
  floorHotspots(r, floorPic);
}

// The seven stations without numbers: on the intro, and (with a moving belt) while the plan is made.
function ghostLine(busy) {
  return `<ol class="fline fline-ghost${busy ? ' busy' : ''}" aria-hidden="true">${STAGES.map((st) => `<li style="--c:${st.color};--t:${st.tint}"><span class="fic">${stageIcon(st)}</span><b>${st.name}</b></li>`).join('')}</ol>`;
}

function statesHTML(r, f) {
  const esc = escapeHTML; const sts = f.states || []; const busy = r.factory_busy === 'states' || r.factory_busy === 'all';
  const missing = sts.length ? sts.reduce((a, st, i) => a + [stateKey(st, i, 'before'), stateKey(st, i, 'after')].filter((k) => !stateUrl(r, k)).length, 0) : 0;
  const button = busy ? ''
    : !sts.length || missing ? (state.key
      ? `<p class="fpaint"><button type="button" class="btn btn-ghost btn-sm" id="factory-states">🖼 ${sts.length ? 'Paint the missing pictures' : 'Show what goes in and comes out of each zone'} <small>${sts.length ? '' : STATES_COST}</small></button></p>`
      : `<p class="hint fpaint">Sign in to OpenRouter (top right) to paint a before and after picture for every zone (${STATES_COST}).</p>`) : '';
  if (!sts.length) return busy ? `<div class="stage"><div class="painting">${loaderSVG()}<p>Working out what each zone does to the work</p></div></div>` : button;
  const pic = (st, i, which) => {
    const key = stateKey(st, i, which); const url = stateUrl(r, key); const lab = st[which].label;
    return `<figure><div class="fbimg${url ? '' : busy ? ' waiting' : ''}" data-skey="${key}" data-alt="${esc(lab)}">${url ? `<img src="${esc(url)}" alt="${esc(lab)}" decoding="async">` : busy ? '<span>Painting…</span>' : '<span>—</span>'}</div><figcaption><small>${which === 'before' ? 'Before' : 'After'}</small>${esc(lab)}</figcaption></figure>`;
  };
  return `${button}<div class="fba">${f.zones.map((z, i) => {
    const st = sts[i]; if (!st) return ''; const sg = stageOf(z.stage);
    return `<article class="fbacard" style="--c:${sg.color};--t:${sg.tint}">
      <header><span class="znum">${i + 1}</span><b>${esc(z.name)}</b></header>
      <div class="fbarow">${pic(st, i, 'before')}<div class="fbarrow"><span aria-hidden="true">→</span><p>${esc(st.change)}</p></div>${pic(st, i, 'after')}</div>
    </article>`;
  }).join('')}</div>`;
}

// ---------- point at a zone (plan or painted floor) → its before and after ----------
function hoverZone(el, r, n) {
  el.addEventListener('mouseenter', (e) => showZoneTip(e, r, n));
  el.addEventListener('mousemove', moveZoneTip);
  el.addEventListener('mouseleave', hideZoneTip);
  el.addEventListener('click', (e) => { e.stopPropagation(); showZoneTip(e, r, n); clearTimeout(zoneTipTimer); zoneTipTimer = setTimeout(hideZoneTip, 4000); });
}
let zoneTipTimer = null;
function zoneTip() {
  let t = $('#ztip');
  if (!t) {
    t = document.createElement('div'); t.id = 'ztip'; t.className = 'ztip'; t.hidden = true; t.setAttribute('role', 'tooltip');
    document.body.appendChild(t);
    document.addEventListener('click', hideZoneTip);
  }
  return t;
}
function showZoneTip(e, r, n) {
  const f = r.factory; const z = f?.zones?.[n - 1]; if (!z) return;
  const esc = escapeHTML; const sg = stageOf(z.stage); const st = f.states?.[n - 1];
  const pic = (which) => {
    const url = st && stateUrl(r, stateKey(st, n - 1, which));
    return `<figure><div class="fbimg">${url ? `<img src="${esc(url)}" alt="">` : '<span>—</span>'}</div><figcaption><small>${which === 'before' ? 'Before' : 'After'}</small>${esc(st?.[which].label || '')}</figcaption></figure>`;
  };
  const t = zoneTip();
  t.style.setProperty('--c', sg.color); t.style.setProperty('--t', sg.tint);
  t.setAttribute('dir', $('#result').getAttribute('dir') || 'ltr');
  t.innerHTML = `<header><span class="znum">${n}</span><b>${esc(z.name)}</b><small>${fmtM(z.length_m)} × ${fmtM(z.width_m)} m · ${z.staff} staff</small></header>
    ${st ? `<div class="fbarow">${pic('before')}<div class="fbarrow"><span aria-hidden="true">→</span><p>${esc(st.change)}</p></div>${pic('after')}</div>`
      : `<p class="ztip-none">${r.factory_busy ? 'The before and after pictures are on their way.' : 'No before and after pictures for this plan yet: use the button under the zone list.'}</p>`}`;
  t.hidden = false; moveZoneTip(e);
}
function moveZoneTip(e) {
  const t = $('#ztip'); if (!t || t.hidden) return;
  const pad = 16; const w = t.offsetWidth, h = t.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > window.innerWidth - 8) x = Math.max(8, e.clientX - w - pad);
  if (y + h > window.innerHeight - 8) y = Math.max(8, e.clientY - h - pad);
  t.style.left = `${x}px`; t.style.top = `${y}px`;
}
function hideZoneTip() { const t = $('#ztip'); if (t) t.hidden = true; }

// The painted floor's number badges: where they are is asked of the vision model once per page
// (like the exploded view's), then each becomes a spot that shows its zone.
function floorHotspots(r, url) {
  const box = $('#ffloor'); if (!box || !url) return;
  const n = r.factory.zones.length;
  const spots = r.floor_badges || [];
  for (const b of spots) {
    const hot = document.createElement('button'); hot.type = 'button'; hot.className = 'hot';
    hot.style.left = `${b.x}%`; hot.style.top = `${b.y}%`; hot.setAttribute('aria-label', r.factory.zones[b.n - 1]?.name || `zone ${b.n}`);
    hoverZone(hot, r, b.n);
    box.appendChild(hot);
  }
  if (!spots.length && state.key && !r.factory_busy && !r._locatingFloor) {
    r._locatingFloor = true;
    locateBadges(url, n, undefined).then((found) => {
      if (!found.length) return;
      r.floor_badges = found;
      if (state.result === r && $('#ffloor')) floorHotspots(r, url);
      cacheFactory(r);
    });
  }
}

function loaderSVG() {
  return '<div class="loader"><svg viewBox="0 0 120 120" width="72" height="72" aria-hidden="true"><circle cx="60" cy="60" r="44" fill="none" stroke="#d9cdb2" stroke-width="10" stroke-dasharray="40 30" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 60 60" to="360 60 60" dur="6s" repeatCount="indefinite"/></circle><circle cx="60" cy="60" r="22" fill="none" stroke="#e4572e" stroke-width="10" stroke-dasharray="22 14" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="360 60 60" to="0 60 60" dur="3s" repeatCount="indefinite"/></circle></svg></div>';
}

// ---------- the floor plan, to scale ----------
// Zones go in flow order along rows; a long line folds back on itself (a U or S shape, as real
// plants do) so the building stays a sensible shape. Sizes in metres.
const GAP = 1.5, AISLE = 4, WALL = 1.5;
function layoutFloor(zones) {
  if (!zones?.length) return null;
  const total = zones.reduce((a, z) => a + z.length_m, 0) + GAP * (zones.length - 1);
  let best = null;
  for (let rows = 1; rows <= Math.min(3, zones.length); rows++) {
    const target = total / rows; const split = [[]]; let acc = 0;
    zones.forEach((z, i) => {
      if (split[split.length - 1].length && acc + z.length_m / 2 > target && split.length < rows) { split.push([]); acc = 0; }
      split[split.length - 1].push(i); acc += z.length_m + GAP;
    });
    const lens = split.map((row) => row.reduce((a, i) => a + zones[i].length_m, 0) + GAP * (row.length - 1));
    const heights = split.map((row) => Math.max(...row.map((i) => zones[i].width_m)));
    const L = Math.max(...lens) + 2 * WALL, W = heights.reduce((a, b) => a + b, 0) + AISLE * (split.length - 1) + 2 * WALL;
    const score = Math.abs(Math.log(L / W / 2.3));
    if (!best || score < best.score - 0.05) best = { score, split, heights, L, W };
  }
  const boxes = []; let y = WALL;
  best.split.forEach((row, ri) => {
    const back = ri % 2 === 1; let x = back ? best.L - WALL : WALL;
    row.forEach((i) => {
      const z = zones[i];
      if (back) { x -= z.length_m; boxes[i] = { x, y, w: z.length_m, h: z.width_m, row: ri, back }; x -= GAP; }
      else { boxes[i] = { x, y, w: z.length_m, h: z.width_m, row: ri, back }; x += z.length_m + GAP; }
    });
    y += best.heights[ri] + AISLE;
  });
  return { boxes, L: best.L, W: best.W, rows: best.split.length, heights: best.heights };
}

function floorPlanSVG(f, lay) {
  const esc = escapeHTML; const zones = f.zones;
  const PX = 900; const s = PX / lay.L;
  const padL = 58, padR = 52, padT = 44, padB = 40;
  const X = (m) => padL + m * s, Y = (m) => padT + m * s;
  const Wpx = padL + PX + padR, Hpx = Math.round(padT + lay.W * s + padB);
  const ink = '#1d2433', muted = '#4a5263';
  const out = [];
  out.push(`<svg class="fplan" viewBox="0 0 ${Wpx} ${Hpx}" width="${Wpx}" height="${Hpx}" role="img" aria-label="Factory floor plan, ${fmtM(lay.L)} by ${fmtM(lay.W)} metres" font-family="Nunito, system-ui, sans-serif">`);
  out.push(`<defs><marker id="fa" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${ink}"/></marker>
    <pattern id="fhatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#d9cdb2" stroke-width="2"/></pattern></defs>`);
  // building
  out.push(`<rect x="${X(0)}" y="${Y(0)}" width="${lay.L * s}" height="${lay.W * s}" fill="url(#fhatch)" stroke="${ink}" stroke-width="4"/>`);
  // aisles
  for (let ri = 0; ri < lay.rows - 1; ri++) {
    const ay = WALL + lay.heights.slice(0, ri + 1).reduce((a, b) => a + b, 0) + AISLE * ri;
    out.push(`<rect x="${X(WALL)}" y="${Y(ay)}" width="${(lay.L - 2 * WALL) * s}" height="${AISLE * s}" fill="#fffaf0"/>`);
    out.push(`<text x="${X(lay.L / 2)}" y="${Y(ay + AISLE / 2) + 4}" text-anchor="middle" font-size="11" font-style="italic" fill="${muted}">forklift aisle · ${AISLE} m</text>`);
  }
  // zones
  zones.forEach((z, i) => {
    const b = lay.boxes[i]; const st = stageOf(z.stage);
    const x = X(b.x), y = Y(b.y), w = b.w * s, h = b.h * s;
    out.push(`<g class="fzg" data-zone="${i + 1}">`);
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${st.tint}" stroke="${st.color}" stroke-width="2"/>`);
    // machines, packed in shelves under the label band
    const top = y + 38, left = x + 6, right = x + w - 6, bottom = y + h - 6, sp = Math.max(4, 0.6 * s);
    let cx = left, cy = top, rowH = 0;
    z.machines.forEach((m, k) => {
      for (let c = 0; c < Math.min(m.count, 12); c++) {
        let mw = m.length_m * s, mh = m.width_m * s;
        if (mw > right - left && mh <= right - left) [mw, mh] = [mh, mw];
        if (cx + mw > right) { cx = left; cy += rowH + sp; rowH = 0; }
        if (cx + mw > right || cy + mh > bottom || mw < 3 || mh < 3) continue;
        out.push(`<rect x="${cx}" y="${cy}" width="${mw}" height="${mh}" rx="1.5" fill="#fffdf7" stroke="${st.color}" stroke-width="1.2"/>`);
        if (mw >= 11 && mh >= 11) out.push(`<text x="${cx + mw / 2}" y="${cy + mh / 2 + 3.5}" text-anchor="middle" font-size="${Math.min(10, mh - 2)}" font-weight="800" fill="${st.color}">${String.fromCharCode(65 + k)}</text>`);
        cx += mw + sp; rowH = Math.max(rowH, mh);
      }
    });
    // label band: number, name, size
    out.push(`<circle cx="${x + 13}" cy="${y + 13}" r="9.5" fill="${st.color}"/><text x="${x + 13}" y="${y + 17}" text-anchor="middle" font-size="11.5" font-weight="900" fill="#fff">${i + 1}</text>`);
    const room = w - 30; const name = fitText(z.name, room, 12);
    if (name) out.push(`<text x="${x + 27}" y="${y + 17}" font-size="12" font-weight="800" fill="${ink}">${esc(name)}</text>`);
    const dims = w > 118 ? `${fmtM(z.length_m)} × ${fmtM(z.width_m)} m · ${fmtArea(z.length_m * z.width_m)} m²` : `${fmtM(z.length_m)}×${fmtM(z.width_m)} m`;
    if (w > 40) out.push(`<text x="${x + 6}" y="${y + 32}" font-size="10.5" fill="${muted}">${esc(fitText(dims, w - 10, 10.5))}</text>`);
    out.push('</g>');
  });
  // flow: arrows in the gaps between zones, and a turn through the aisle at each row's end
  zones.forEach((z, i) => {
    if (i === zones.length - 1) return;
    const a = lay.boxes[i], b = lay.boxes[i + 1];
    if (a.row === b.row) {
      const yy = Y(a.y + Math.min(a.h, b.h) / 2);
      const x1 = a.back ? X(a.x) + 2 : X(a.x + a.w) - 2, x2 = a.back ? X(b.x + b.w) - 1 : X(b.x) + 1;
      out.push(`<line x1="${x1}" y1="${yy}" x2="${x2}" y2="${yy}" stroke="${ink}" stroke-width="2.4" marker-end="url(#fa)"/>`);
    } else {
      const xa = X(a.x + a.w / 2), xb = X(b.x + b.w / 2), ya = Y(a.y + a.h), yb = Y(b.y);
      out.push(`<path d="M${xa} ${ya} C ${xa} ${(ya + yb) / 2}, ${xb} ${(ya + yb) / 2}, ${xb} ${yb - 2}" fill="none" stroke="${ink}" stroke-width="2.4" stroke-dasharray="6 4" marker-end="url(#fa)"/>`);
    }
  });
  // doors: material in at the first zone, trucks out at the last
  const door = (b, side, label) => {
    const yy = Y(b.y + b.h / 2); const xw = side === 'left' ? X(0) : X(lay.L);
    out.push(`<rect x="${xw - 4}" y="${yy - 14}" width="8" height="28" fill="#fbf4e4" stroke="${ink}" stroke-width="1.5"/>`);
    const dir = label === 'IN' ? 1 : -1; const outer = side === 'left' ? xw - 44 : xw + 44, inner = side === 'left' ? xw - 8 : xw + 8;
    const [from, to] = dir === 1 ? [outer, inner] : [inner, outer];
    out.push(`<line x1="${from}" y1="${yy}" x2="${to}" y2="${yy}" stroke="${label === 'IN' ? '#2b4c7e' : '#d2491f'}" stroke-width="3" marker-end="url(#fa)"/>`);
    out.push(`<text x="${outer}" y="${yy - 8}" text-anchor="${side === 'left' ? 'start' : 'end'}" font-size="11" font-weight="900" fill="${label === 'IN' ? '#2b4c7e' : '#d2491f'}">${label}</text>`);
  };
  const first = lay.boxes[0], last = lay.boxes[zones.length - 1];
  door(first, 'left', 'IN');
  door(last, last.back ? 'left' : 'right', 'OUT');
  // overall dimensions
  const dy = padT - 20;
  out.push(`<g stroke="${ink}" stroke-width="1.2"><line x1="${X(0)}" y1="${dy}" x2="${X(lay.L)}" y2="${dy}"/><line x1="${X(0)}" y1="${dy - 6}" x2="${X(0)}" y2="${dy + 6}"/><line x1="${X(lay.L)}" y1="${dy - 6}" x2="${X(lay.L)}" y2="${dy + 6}"/></g>`);
  out.push(`<rect x="${X(lay.L / 2) - 34}" y="${dy - 9}" width="68" height="18" fill="#fbf4e4"/><text x="${X(lay.L / 2)}" y="${dy + 4.5}" text-anchor="middle" font-size="12.5" font-weight="900" fill="${ink}">${fmtM(lay.L)} m</text>`);
  const dx = X(lay.L) + 30;
  out.push(`<g stroke="${ink}" stroke-width="1.2"><line x1="${dx}" y1="${Y(0)}" x2="${dx}" y2="${Y(lay.W)}"/><line x1="${dx - 6}" y1="${Y(0)}" x2="${dx + 6}" y2="${Y(0)}"/><line x1="${dx - 6}" y1="${Y(lay.W)}" x2="${dx + 6}" y2="${Y(lay.W)}"/></g>`);
  out.push(`<rect x="${dx - 9}" y="${Y(lay.W / 2) - 30}" width="18" height="60" fill="#fbf4e4"/><text transform="translate(${dx + 4.5} ${Y(lay.W / 2)}) rotate(-90)" text-anchor="middle" font-size="12.5" font-weight="900" fill="${ink}">${fmtM(lay.W)} m</text>`);
  // scale bar
  const unit = [5, 10, 20, 50, 100].find((u) => u * s >= 60) || 100; const sy = Y(lay.W) + 22;
  out.push(`<g fill="${ink}"><rect x="${X(0)}" y="${sy}" width="${unit * s / 2}" height="5"/><rect x="${X(0) + unit * s / 2}" y="${sy}" width="${unit * s / 2}" height="5" fill="#fbf4e4" stroke="${ink}" stroke-width="1"/></g>`);
  out.push(`<text x="${X(0) + unit * s + 8}" y="${sy + 6}" font-size="11" fill="${muted}">${unit} m · ceiling ${fmtM(f.building.height_m)} m</text>`);
  out.push('</svg>');
  return out.join('');
}
// Shorten a label to fit a width (rough: average glyph ≈ 0.56 em).
function fitText(t, px, size) {
  const max = Math.floor(px / (size * 0.56));
  if (max < 3) return '';
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

// ---------- the report (Download report) gets a factory section too ----------
function factoryReportHTML(r) {
  const f = r.factory; if (!f?.applicable) return null;
  const esc = escapeHTML; const lay = layoutFloor(f.zones);
  const pic = factoryUrl(r);
  let n = 0;
  const steps = STAGES.map((st) => {
    const ss = f.steps.filter((s) => s.stage === st.key); if (!ss.length) return '';
    return `<h3 style="color:${st.color}">${st.name}</h3><ol>${ss.map((s) => `<li><span class="n" style="background:${st.color}">${++n}</span><b>${esc(s.title)} · ${WHO[s.who].icon} ${WHO[s.who].label}</b><span>${esc(s.text)}${s.why ? ` <i>(${esc(s.why)})</i>` : ''}</span></li>`).join('')}</ol>`;
  }).join('');
  const mats = f.materials.map((m) => `<li><b>${esc(m.name)}</b><span>${esc(m.form)}${m.per_unit ? ` · ${esc(m.per_unit)} each` : ''}</span></li>`).join('');
  const zones = f.zones.map((z, i) => `<tr><td>${i + 1}</td><td>${esc(z.name)}</td><td>${fmtM(z.length_m)} × ${fmtM(z.width_m)} m</td><td>${z.machines.map((m, k) => `${String.fromCharCode(65 + k)}: ${m.count} × ${esc(m.name)} (${fmtM(m.length_m)} × ${fmtM(m.width_m)} m)`).join('<br>')}</td><td>${z.staff}</td></tr>`).join('');
  return { pic, html: `<h2>How it's made</h2><p>${esc(f.summary)}</p>
<p><b>Output:</b> ${esc(f.output)} · <b>Floor:</b> ${lay ? `${fmtM(lay.L)} × ${fmtM(lay.W)} m (${fmtArea(lay.L * lay.W)} m²)` : '—'} · <b>People:</b> ${f.workers_per_shift} per shift, ${f.shifts} shift(s)</p>
%%FACTORY_PIC%%
${lay ? `<div class="stage plan">${floorPlanSVG(f, lay)}</div>` : ''}
<table class="zt"><tr><th>#</th><th>Zone</th><th>Size</th><th>Machines</th><th>Staff</th></tr>${zones}</table>
<h3>Raw materials</h3><ol>${mats}</ol>${steps}` };
}
