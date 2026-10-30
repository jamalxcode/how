// How — the map at the top of "What it costs": where the raw materials come from, and what it would
// cost to make the thing in each country. Claude estimates once per page where each material usually
// comes from, and the factory wage, power price and rent in 20–30 likely countries; the shading and
// the quick per-country costs are worked out here by scaling the money estimate (with the reader's
// own numbers). Uses app.js, factory.js and money.js, and world.json (country outlines, drawn here).
'use strict';

const ATLAS_COST = '~2¢';
const ISO = /^[A-Z]{2}$/;
// the Money chapter's regions, as the country the factory dot goes in
const REGION_ISO = { 'Gulf (Kuwait, UAE, Saudi Arabia)': 'KW', 'United States': 'US', 'Western Europe': 'DE', 'Eastern Europe': 'PL', Turkey: 'TR', China: 'CN',
  India: 'IN', 'Southeast Asia': 'VN', Mexico: 'MX', Brazil: 'BR', 'East Africa': 'KE' };
const SHADES = ['#1f8a8a', '#7cc0a8', '#ecc85c', '#e8955f', '#c9431c']; // cheaper → dearer
const NO_DATA = '#e4e1da';
const ROUTE_COLOURS = ['#2b4c7e', '#b5830f', '#8f6236', '#3a8a4c', '#7a4f9a', '#1f8a8a', '#d2491f'];

const ATLAS_SCHEMA = { type: 'json_schema', json_schema: { name: 'atlas', strict: true, schema: obj({
  materials: { type: 'array', items: obj({ name: str, origins: { type: 'array', items: obj({ iso2: str, share: int }) } }) },
  countries: { type: 'array', items: obj({ iso2: str, worker_wage: num, power_price: num, rent: num, note: str }) },
}) } };
const ATLAS_RULES = `You are a manufacturing location analyst. Answer as JSON only, with plain numbers (no symbols, no ranges).
"materials": for each raw material in the request, 1–3 countries it typically comes from for a factory like this ("iso2": ISO 3166-1 alpha-2 code), with "share" in percent, adding up to about 100. Keep each material's name as given.
"countries": 20–30 countries that are realistic places to make this product, always including the current location the request names, and a spread from cheap to expensive. "worker_wage": typical gross monthly pay of a factory worker there, in US dollars, benefits included. "power_price": industrial electricity, US dollars per kWh. "rent": industrial building rent, US dollars per m² per month. "note" ≤ 12 words, in the request's language: the main reason it is a good or poor place to make this.`;

function cleanAtlas(a) {
  if (!a || typeof a !== 'object') return null;
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const n = (v, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(0, x)) : 0; };
  const list = (v, max, fn) => (Array.isArray(v) ? v.slice(0, max).filter((x) => x && typeof x === 'object').map(fn).filter(Boolean) : []);
  const countries = list(a.countries, 40, (c) => (ISO.test(c.iso2 || '') ? { iso2: c.iso2, worker_wage: n(c.worker_wage, 50000), power_price: n(c.power_price, 5), rent: n(c.rent, 500), note: s(c.note, 120) } : null));
  return {
    materials: list(a.materials, 10, (m) => ({ name: s(m.name, 80), origins: list(m.origins, 3, (o) => (ISO.test(o.iso2 || '') ? { iso2: o.iso2, share: Math.round(n(o.share, 100)) } : null)) })),
    countries: [...new Map(countries.map((c) => [c.iso2, c])).values()],
  };
}

// ---------- the world outlines (loaded once, when the map is first drawn) ----------
let worldMap = null, worldLoading = null;
function loadWorld() {
  if (worldMap) return Promise.resolve(worldMap);
  return (worldLoading = worldLoading || fetch('world.json?v=1').then((r) => { if (!r.ok) throw new Error('map'); return r.json(); }).then((w) => (worldMap = w)).catch((e) => { worldLoading = null; throw e; }));
}
const countryName = (iso) => worldMap?.c[iso]?.n || iso;
const flag = (iso) => String.fromCodePoint(...[...iso].map((ch) => 0x1f1a5 + ch.charCodeAt(0)));

// Where the factory is now: the money estimate's place (a region or a country name), as a country code.
function factoryIso(r) {
  const place = r.financials?.region || moneyRegion();
  if (REGION_ISO[place]) return REGION_ISO[place];
  if (ISO.test(place)) return place;
  const hit = worldMap && Object.entries(worldMap.c).find(([, c]) => c.n.toLowerCase() === place.toLowerCase());
  return hit ? hit[0] : 'KW';
}

async function makeAtlas() {
  const r = state.result; if (!r || r.atlas_busy) return;
  if (!state.key) { showError('To map it, sign in to OpenRouter first (top right). The scissors demo has a map built in.'); $('#signin').focus(); return; }
  r.atlas_busy = true; r.atlas_error = ''; renderAtlas();
  const mats = [...new Set(allVersions(r).flatMap(({ f }) => f.materials.map((m) => m.name)))];
  const here = factoryIso(r);
  try {
    const a = await askLongJSON({ model: PLAN_MODEL, maxTokens: 6000, schema: ATLAS_SCHEMA, signal: new AbortController().signal, messages: [
      cachedSystem(ATLAS_RULES),
      { role: 'user', content: `Product: ${r.title_en || r.wikipedia_title || r.title}. Parts: ${(r.parts || []).map((p) => p.name_en || p.name).join(', ')}.
Raw materials: ${mats.length ? mats.join('; ') : 'work them out from the parts'}.
Current location: ${countryName(here)} (${here}). Language: ${r.lang || $('#lang').value}.` },
    ] });
    r.atlas = cleanAtlas(a);
    if (!r.atlas?.countries.length) throw new Error('The map came back empty. Try again.');
  } catch (e) { r.atlas_error = e.message; }
  r.atlas_busy = false;
  if (state.result === r) renderAtlas();
  if (r.atlas) await saveFactory(r);
}

// ---------- the sums: cost to make one, country by country ----------
// The money estimate is for one place; elsewhere its people, power and rent scale with the local
// wage, power price and rent (materials and machines cost much the same everywhere).
function countryCosts(r, modeKey) {
  const a = r.atlas; const fin = r.financials; if (!a) return null;
  const by = new Map(a.countries.map((c) => [c.iso2, c]));
  const home = factoryIso(r);
  const med = (k) => { const v = a.countries.map((c) => c[k]).filter((x) => x > 0).sort((x, y) => x - y); return v[Math.floor(v.length / 2)] || 1; };
  const base = by.get(home) || { worker_wage: med('worker_wage'), power_price: med('power_price'), rent: med('rent') };
  const out = new Map();
  const u0 = fin?.setups.find((s) => s.mode === modeKey) || fin?.setups[0];
  const m = u0 ? moneyMath(withEdits(u0, r.money_edits)) : null;
  const n = u0 ? withEdits(u0, r.money_edits).output_per_month : 0;
  for (const c of a.countries) {
    const k = { wage: c.worker_wage / (base.worker_wage || 1), power: c.power_price / (base.power_price || 1), rent: c.rent / (base.rent || 1) };
    if (!m || !n) { out.set(c.iso2, { c, unit: null, score: c.worker_wage }); continue; }
    const running = m.payroll * k.wage + m.power * k.power + m.other * (0.6 + 0.4 * k.rent) + m.materials;
    out.set(c.iso2, { c, unit: running / n, payroll: m.payroll * k.wage, running, score: running / n, vs: m.unit ? (running / n) / m.unit - 1 : 0 });
  }
  return { out, home, base, priced: !!m };
}

// ---------- drawing ----------
let atlasMode = 'mixed', atlasSel = null, atlasFor = null;
function renderAtlas() {
  const box = $('#atlas'); const r = state.result; if (!box || !r || r.kind === 'refused') return;
  if (atlasFor !== r) { atlasFor = r; atlasSel = null; }
  if (r.atlas && !r.atlas._clean) { r.atlas = cleanAtlas(r.atlas); Object.defineProperty(r.atlas, '_clean', { value: true }); }
  const esc = escapeHTML;
  if (r.atlas_busy) {
    box.innerHTML = `<div class="atlas-intro"><h3 class="list-h">🌍 ${tx('atlasTitle')}</h3><p class="fpaint"><button type="button" class="btn btn-prog" data-prog="${tx('mapping')}" disabled style="--prog:50%"><span class="bp-text">${tx('mapping')}</span></button></p></div>`;
    return;
  }
  if (!r.atlas) {
    box.innerHTML = `<div class="atlas-intro"><h3 class="list-h">🌍 ${tx('atlasTitle')}</h3><p>${tx('atlasIntro')}</p>
      ${r.atlas_error ? `<p class="ferror">${esc(r.atlas_error)}</p>` : ''}
      <p class="fpaint">${state.key ? `<button type="button" class="btn btn-ghost" id="atlas-go">🌍 ${tx('atlasBtn')} <small>${ATLAS_COST}</small></button>` : `<span class="hint">${tx('atlasSignIn', { c: ATLAS_COST })}</span>`}</p></div>`;
    $('#atlas-go')?.addEventListener('click', makeAtlas);
    return;
  }
  box.innerHTML = `<div class="atlas"><h3 class="list-h">🌍 ${tx('atlasTitle')}</h3><div class="atlas-body"><p class="empty">…</p></div></div>`;
  loadWorld().then(() => { if (state.result === r) drawAtlas(r); }).catch(() => { $('.atlas-body', box).innerHTML = '<p class="empty">—</p>'; });
}

function drawAtlas(r) {
  const body = $('#atlas .atlas-body'); if (!body || !worldMap) return;
  const esc = escapeHTML; const a = r.atlas;
  const sum = countryCosts(r, atlasMode);
  const home = sum.home; if (!atlasSel) atlasSel = home;
  const vals = [...sum.out.values()].map((x) => x.score).filter((x) => x != null).sort((x, y) => x - y);
  const shade = (v) => { if (v == null || !vals.length) return null; const i = vals.findIndex((x) => x >= v); const q = vals.length > 1 ? Math.max(0, i) / (vals.length - 1) : 0; return SHADES[Math.min(SHADES.length - 1, Math.floor(q * SHADES.length))]; };
  const W = worldMap.w, H = worldMap.h;
  const at = (iso) => worldMap.c[iso]?.c;
  const paths = Object.entries(worldMap.c).map(([iso, c]) => {
    const x = sum.out.get(iso); const fill = x ? shade(x.score) : NO_DATA;
    return `<path d="${c.d}" fill="${fill}" data-iso="${iso}" class="${x ? 'pick' : ''}${iso === home ? ' home' : ''}${iso === atlasSel ? ' sel' : ''}"><title>${esc(c.n)}${x?.unit != null ? ` · ${money(x.unit)}` : ''}</title></path>`;
  }).join('');
  // material routes, drawn in once (they do not keep moving: nothing is happening)
  const to = at(home);
  const routes = to ? a.materials.flatMap((m, mi) => m.origins.filter((o) => o.iso2 !== home && at(o.iso2)).map((o) => {
    const [x1, y1] = at(o.iso2), [x2, y2] = to; const dx = x2 - x1, dy = y2 - y1; const d = Math.hypot(dx, dy);
    const cx = (x1 + x2) / 2 - dy * 0.22, cy = (y1 + y2) / 2 + dx * 0.22 - d * 0.08;
    const d2 = `M${x1} ${y1} Q${cx.toFixed(0)} ${cy.toFixed(0)} ${x2} ${y2}`; const w = 2 + o.share / 30; const col = ROUTE_COLOURS[mi % ROUTE_COLOURS.length];
    return `<path class="route casing" d="${d2}" stroke-width="${w + 2.5}" pathLength="1"/><path class="route" d="${d2}" stroke="${col}" stroke-width="${w}" pathLength="1"><title>${esc(m.name)} · ${esc(countryName(o.iso2))} ${o.share}%</title></path><circle cx="${x1}" cy="${y1}" r="4.5" fill="${col}" stroke="#fffdf7" stroke-width="1.5"/>`;
  })).join('') : '';
  const pin = to ? `<g class="pin" transform="translate(${to[0]} ${to[1]})"><circle r="13" fill="#1d2433"/><text y="5" text-anchor="middle" font-size="14">🏭</text></g>` : '';
  const ranked = [...sum.out.values()].filter((x) => x.score != null).sort((x, y) => x.score - y.score);
  const modes = r.financials ? `<div class="atlas-modes">${MODES.filter((m) => r.financials.setups.some((s) => s.mode === m.key)).map((m) => `<button type="button" class="ptab${m.key === atlasMode ? ' active' : ''}" data-amode="${m.key}">${m.icon} ${tx(`mode_${m.key}`)}</button>`).join('')}</div>` : '';
  body.innerHTML = `
    ${modes}
    <div class="stage atlas-map"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tx('atlasTitle'))}">${paths}${routes}${pin}</svg></div>
    <div class="atlas-legend"><span>${tx(sum.priced ? 'atlasLegend' : 'wageLegend')}</span><i>${SHADES.map((c) => `<b style="background:${c}"></b>`).join('')}</i>${sum.priced ? '' : `<small>${tx('atlasNoMoney')}</small>`}</div>
    <div class="atlas-grid">
      <div class="atlas-sel" id="atlas-sel"></div>
      <div class="atlas-rank"><h4>${tx(sum.priced ? 'cheapest' : 'lowestWages')}</h4><ol>${ranked.slice(0, 8).map((x) => `<li><button type="button" data-pick="${x.c.iso2}"${x.c.iso2 === atlasSel ? ' class="on"' : ''}><span>${flag(x.c.iso2)} ${esc(countryName(x.c.iso2))}${x.c.iso2 === home ? ' 🏭' : ''}</span><b>${sum.priced ? money(x.unit) : `${money(x.c.worker_wage)}/${tx('mo_short')}`}</b></button></li>`).join('')}</ol>
        <label class="atlas-all"><span class="sr-only">${tx('pickCountry')}</span><select id="atlas-pick"><option value="">${tx('pickCountry')}…</option>${[...sum.out.values()].sort((x, y) => countryName(x.c.iso2).localeCompare(countryName(y.c.iso2))).map((x) => `<option value="${x.c.iso2}">${esc(countryName(x.c.iso2))}</option>`).join('')}</select></label>
      </div>
    </div>
    <div class="atlas-mats"><h4>${tx('materialsFrom')}</h4>${a.materials.map((m, mi) => `<p><i style="background:${ROUTE_COLOURS[mi % ROUTE_COLOURS.length]}"></i><b>${esc(m.name)}</b> ← ${m.origins.map((o) => `${flag(o.iso2)} ${esc(countryName(o.iso2))} ${o.share}%`).join(', ') || '—'}</p>`).join('')}</div>
    <p class="credit">${tx('mapNote')}</p>`;
  drawPick(r, sum);
  $$('#atlas path.pick').forEach((p) => p.addEventListener('click', () => { atlasSel = p.dataset.iso; drawAtlas(r); }));
  $$('#atlas [data-pick]').forEach((b) => b.addEventListener('click', () => { atlasSel = b.dataset.pick; drawAtlas(r); }));
  $('#atlas-pick').addEventListener('change', (e) => { if (e.target.value) { atlasSel = e.target.value; drawAtlas(r); } });
  $$('#atlas [data-amode]').forEach((b) => b.addEventListener('click', () => { atlasMode = b.dataset.amode; drawAtlas(r); }));
}

let atlasTimer = null;
function reshadeAtlas() { clearTimeout(atlasTimer); atlasTimer = setTimeout(() => { if (state.result?.atlas && $('#atlas .atlas-body svg')) drawAtlas(state.result); }, 150); }

// The chosen country: its figures, the cost to make one there, and a full estimate for it.
function drawPick(r, sum) {
  const el = $('#atlas-sel'); const esc = escapeHTML;
  const x = sum.out.get(atlasSel);
  if (!x) { el.innerHTML = `<p class="hint">${tx('pickHint')}</p>`; return; }
  const c = x.c; const name = countryName(c.iso2); const homeName = countryName(sum.home);
  el.innerHTML = `<h4>${flag(c.iso2)} ${esc(name)}${c.iso2 === sum.home ? ` <small>🏭 ${tx('factoryHere')}</small>` : ''}</h4>
    ${c.note ? `<p class="atlas-note">${esc(c.note)}</p>` : ''}
    <dl class="mfacts">
      <div><dt>${tx('workerWage')}</dt><dd>${money(c.worker_wage)}/${tx('mo_short')}</dd></div>
      <div><dt>${tx('power')}</dt><dd>$${c.power_price.toFixed(3)}/kWh</dd></div>
      <div><dt>${tx('rentM2')}</dt><dd>$${c.rent.toFixed(1)}/m²/${tx('mo_short')}</dd></div>
    </dl>
    ${x.unit != null ? `<div class="mbig"><span>${tx('costHere')}</span><b>${money(x.unit)}</b>${c.iso2 !== sum.home ? `<small>${tx('vsHome', { p: `${x.vs > 0 ? '+' : ''}${Math.round(x.vs * 100)}%`, place: esc(homeName) })}</small>` : ''}</div>` : ''}
    ${c.iso2 !== sum.home && state.key ? `<p class="fpaint"><button type="button" class="btn btn-ghost btn-sm" id="atlas-use">${tx('useHere', { place: esc(name) })} <small>${MONEY_COST}</small></button></p>` : ''}`;
  $('#atlas-use')?.addEventListener('click', async () => {
    const r2 = state.result; store.set('how_region', name);
    await makeMoney(name);
    if (state.result === r2) { atlasSel = factoryIso(r2); drawAtlas(r2); }
  });
}
