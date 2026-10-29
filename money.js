// How — the Money tab: approximate financials for the three ways to set up the factory
// (hand-made, mixed, automated), side by side. Claude estimates the inputs (land, people and
// salaries, equipment, power, other running costs, materials) for a region; every total, cost per
// unit and payback is worked out here, so the numbers always add up. Uses app.js and factory.js.
'use strict';

const REGIONS = ['Gulf (Kuwait, UAE, Saudi Arabia)', 'United States', 'Western Europe', 'Eastern Europe', 'Turkey', 'China', 'India', 'Southeast Asia', 'Mexico', 'Brazil', 'East Africa'];
const MONEY_COST = '~2¢';
const PAYBACK_YEARS = 3;

const MONEY_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'financials', strict: true,
    schema: obj({
      region: str, unit_label: str, assumptions: { type: 'array', items: str },
      price_reference: obj({ low: num, high: num, note: str }),
      setups: { type: 'array', items: obj({
        mode: { type: 'string', enum: MODES.map((m) => m.key) }, output_per_month: num, land_m2: num, building_m2: num,
        staff: { type: 'array', items: obj({ role: str, count: int, monthly_salary: num }) },
        capex: { type: 'array', items: obj({ item: str, amount: num }) },
        power: obj({ installed_kw: num, kwh_per_month: num, price_per_kwh: num }),
        opex: { type: 'array', items: obj({ item: str, monthly: num }) },
        material_per_unit: num,
      }) },
    }),
  },
};

const MONEY_RULES = `You are a manufacturing cost analyst. Estimate APPROXIMATE financials for three ways to set up a factory that makes the product in the request, in the region it names. US dollars, today's prices. Answer as JSON only; every amount is a plain number in US dollars (no symbols, no ranges).

The three setups, one entry each in "setups", in this order:
${MODES.map((m) => `"${m.key}": ${m.brief}`).join('\n')}
All three make the SAME output, the one the request gives or a sensible mid-size one; "output_per_month" is that in units per month, "unit_label" names the unit ("pairs", "units"). Where the request lists plans already made, use them, so the numbers match.
For each setup:
"land_m2" (plot, with yard and parking) and "building_m2".
"staff": 4–8 roles covering ALL shifts (total headcount, not per shift) with the typical gross monthly salary for that role in the region, benefits included.
"capex": 6–12 one-off items: land and building (buy, or fit-out of a leased building — say which in the item), each main machine group, robots and automation, tooling and moulds, installation and commissioning, forklifts and racking, IT and software. No working capital.
"power": installed kW, kWh per month, local industrial tariff per kWh.
"opex": 4–8 MONTHLY items NOT counting staff, power or materials: rent or land lease (if not bought), maintenance and spares, consumables, insurance, water and other utilities, outbound transport, plus what is typical for the region (worker housing and visas in the Gulf, for example).
"material_per_unit": raw materials, bought-in parts and packaging for one unit.
"price_reference": the typical factory-gate (wholesale) price range for one unit, and a short note on what that price is for.
"assumptions": 3–5 short lines (working days, shifts, tariffs, wage basis) in the request's language. "role", "item" and "note" in that language too.`;
function moneyRequest(lang, r, region) {
  const known = allVersions(r).map(({ mode, f }) => {
    const s = versionStats(f);
    return `- ${mode.name} (${mode.key}): ${s.staff} people per shift × ${s.shifts} shifts, floor ${Math.round(s.area)} m², output ${f.output}; machines: ${f.zones.flatMap((z) => z.machines.map((m) => `${m.count}× ${m.name}`)).join(', ')}.`;
  }).join('\n');
  const target = allVersions(r)[0]?.f.output;
  return `Product: ${r.title_en || r.wikipedia_title || r.title}. Parts: ${(r.parts || []).map((p) => p.name_en || p.name).join(', ')}.
Region: ${region}. Language: ${lang}.
Output: ${target || 'choose a sensible mid-size output'}.${known ? `\nPlans already made:\n${known}` : ''}`;
}

function cleanMoney(m) {
  if (!m || typeof m !== 'object') return null;
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const n = (v, hi = 1e10) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(0, x)) : 0; };
  const list = (v, max, fn) => (Array.isArray(v) ? v.slice(0, max).filter((x) => x && typeof x === 'object').map(fn) : []);
  const setups = list(m.setups, 3, (u) => ({
    mode: MODES.some((x) => x.key === u.mode) ? u.mode : 'mixed', output_per_month: n(u.output_per_month), land_m2: n(u.land_m2), building_m2: n(u.building_m2),
    staff: list(u.staff, 12, (x) => ({ role: s(x.role, 60), count: Math.round(n(x.count, 5000)), monthly_salary: n(x.monthly_salary, 1e6) })),
    capex: list(u.capex, 16, (x) => ({ item: s(x.item, 80), amount: n(x.amount) })),
    power: { installed_kw: n(u.power?.installed_kw, 1e6), kwh_per_month: n(u.power?.kwh_per_month), price_per_kwh: n(u.power?.price_per_kwh, 10) },
    opex: list(u.opex, 12, (x) => ({ item: s(x.item, 80), monthly: n(x.monthly) })),
    material_per_unit: n(u.material_per_unit, 1e7),
  }));
  return {
    region: s(m.region, 80), unit_label: s(m.unit_label, 30) || 'units', assumptions: (Array.isArray(m.assumptions) ? m.assumptions : []).slice(0, 6).map((a) => s(a, 160)).filter(Boolean),
    price_reference: { low: n(m.price_reference?.low, 1e7), high: n(m.price_reference?.high, 1e7), note: s(m.price_reference?.note, 160) },
    setups: MODES.map((md) => setups.find((u) => u.mode === md.key)).filter(Boolean),
  };
}

// Everything the page shows is worked out from the inputs, here.
// ---------- the reader's own numbers ----------
// r.money_edits = { g: { output, salary, tariff, material, equipment, other }, i: { 'mixed.staff.2.monthly_salary': 900, … } }
// g.salary / equipment / other are percentages of the estimate; output, tariff and material replace it.
// A value the reader typed is theirs, so it is exact; everything the AI estimated is shown as a range.
const BAND = { payroll: 0.15, capex: 0.25, power: 0.1, other: 0.2, materials: 0.15 };
const EDIT_KEY = /^(manual|mixed|auto)\.(staff|capex|opex|power)\.(\d{1,2}|x)\.(count|monthly_salary|amount|monthly|kwh_per_month)$/;
const edits = (r) => (r.money_edits = r.money_edits || { g: {}, i: {} });
const hasEdits = (r) => !!r.money_edits && (Object.keys(r.money_edits.g).length + Object.keys(r.money_edits.i).length > 0);

// One setup's numbers with the reader's changes, each item marked exact (typed) or estimated.
function withEdits(u, ed) {
  const g = ed?.g || {}; const it = ed?.i || {}; const m = u.mode;
  const val = (path, est) => (it[`${m}.${path}`] != null ? { v: it[`${m}.${path}`], exact: true } : { v: est, exact: false });
  const pct = (k) => (g[k] != null ? g[k] / 100 : 1);
  const staff = u.staff.map((x, i) => { const c = val(`staff.${i}.count`, x.count), s = val(`staff.${i}.monthly_salary`, x.monthly_salary);
    return { ...x, count: c.v, monthly_salary: s.v * pct('salary'), exact: s.exact && g.salary == null, edited: c.exact || s.exact }; });
  const capex = u.capex.map((x, i) => { const a = val(`capex.${i}.amount`, x.amount); return { ...x, amount: a.v * pct('equipment'), exact: a.exact && g.equipment == null, edited: a.exact }; });
  const opex = u.opex.map((x, i) => { const a = val(`opex.${i}.monthly`, x.monthly); return { ...x, monthly: a.v * pct('other'), exact: a.exact && g.other == null, edited: a.exact }; });
  const kwh = val('power.x.kwh_per_month', u.power.kwh_per_month);
  return {
    ...u, staff, capex, opex,
    output_per_month: g.output != null ? g.output : u.output_per_month,
    material_per_unit: g.material != null ? g.material : u.material_per_unit, material_exact: g.material != null,
    power: { ...u.power, kwh_per_month: kwh.v, price_per_kwh: g.tariff != null ? g.tariff : u.power.price_per_kwh, exact: kwh.exact && g.tariff != null, edited: kwh.exact },
  };
}
// Totals at the low, middle and high end of the estimate (typed values do not move).
function moneyMath(u) {
  const at = (side) => {
    const f = (band, exact) => (exact ? 1 : 1 + side * band);
    const payroll = u.staff.reduce((a, x) => a + x.count * x.monthly_salary * f(BAND.payroll, x.exact), 0);
    const capex = u.capex.reduce((a, x) => a + x.amount * f(BAND.capex, x.exact), 0);
    const other = u.opex.reduce((a, x) => a + x.monthly * f(BAND.other, x.exact), 0);
    const power = u.power.kwh_per_month * u.power.price_per_kwh * f(BAND.power, u.power.exact);
    const materials = u.material_per_unit * u.output_per_month * f(BAND.materials, u.material_exact);
    const running = payroll + power + other + materials;
    return { payroll, capex, other, power, materials, running, unit: u.output_per_month ? running / u.output_per_month : 0 };
  };
  const mid = at(0);
  return { ...mid, lo: at(-1), hi: at(1), people: u.staff.reduce((a, x) => a + x.count, 0) };
}

const money = (x) => {
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1e6) return `$${(x / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (a >= 1e4) return `$${Math.round(x / 1e3).toLocaleString('en')}k`;
  if (a >= 100) return `$${Math.round(x).toLocaleString('en')}`;
  return `$${x.toFixed(2)}`;
};
// "$4.1–5.6M": two significant figures on the ends, one unit; a single figure when they meet.
function moneyRange(lo, hi) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return '—';
  if (hi - lo <= Math.abs(hi) * 0.03) return money((lo + hi) / 2);
  const top = Math.max(Math.abs(lo), Math.abs(hi));
  const [d, suf] = top >= 1e6 ? [1e6, 'M'] : top >= 1e4 ? [1e3, 'k'] : [1, ''];
  const fmt = (x) => { const v = x / d; if (d === 1) return top < 100 ? v.toFixed(2) : Math.round(v).toLocaleString('en'); return v >= 10 ? Math.round(v).toLocaleString('en') : v.toFixed(1).replace(/\.0$/, ''); };
  return `$${fmt(lo)}–${fmt(hi)}${suf}`;
}
const months = (m) => {
  if (!Number.isFinite(m) || m <= 0) return tx('never');
  if (m > 240) return tx('over20');
  const y = Math.floor(m / 12), mo = Math.round(m % 12);
  return y ? tx(mo ? 'yrMo' : 'yr', { y, m: mo }) : tx('mo', { m: Math.max(1, mo) });
};
function monthsRange(a, b) { const x = months(a), y = months(b); return x === y ? x : `${x} – ${y}`; }

function moneyRegion() { return store.get('how_region') || REGIONS[0]; }

async function makeMoney(region) {
  const r = state.result; if (!r || r.money_busy) return;
  if (!state.key) { showError('To estimate the money, sign in to OpenRouter first (top right). The scissors demo has it built in.'); $('#signin').focus(); return; }
  r.money_busy = true; r.money_error = ''; r.money_t0 = Date.now();
  const ctrl = new AbortController();
  renderMoney();
  const timer = setInterval(() => drawMoneyProgress(r), 1000);
  try {
    const m = await askLongJSON({ model: PLAN_MODEL, maxTokens: 9000, schema: MONEY_SCHEMA, signal: ctrl.signal, messages: [
      cachedSystem(MONEY_RULES),
      { role: 'user', content: moneyRequest(r.lang || $('#lang').value, r, region) },
    ] });
    r.financials = cleanMoney(m);
    if (!r.financials?.setups.length) throw new Error('The estimate came back empty. Try again.');
    r.money_edits = undefined; // a new estimate starts clean
  } catch (e) { r.money_error = e.message; }
  clearInterval(timer);
  r.money_busy = false;
  if (state.result === r) renderMoney();
  if (r.financials) await saveFactory(r);
}
function drawMoneyProgress(r) {
  const b = $('[data-money-prog]'); if (!b || state.result !== r) return;
  const est = 40; const el = (Date.now() - r.money_t0) / 1000;
  const pct = Math.min(95, Math.round(el / (el + Math.max(est - el, 4)) * 100));
  b.style.setProperty('--prog', `${pct}%`);
  b.querySelector('.bp-text').textContent = tx('estimatingPct', { p: pct, t: fmtSecs(Math.max(est - el, 4)) });
}

let moneyMarkup = 30;
const PARTS = [['payroll', 'people', '#1f8a8a'], ['materials', 'materials', '#2b4c7e'], ['power', 'power', '#e8b43a'], ['other', 'otherRunning', '#8f6236']];

function renderMoney() {
  const box = $('#money'); const r = state.result; if (!box || !r) return;
  if (r.financials && !r.financials._clean) { r.financials = cleanMoney(r.financials); Object.defineProperty(r.financials, '_clean', { value: true }); }
  const esc = escapeHTML; const fin = r.financials;
  const region = fin?.region || moneyRegion();
  const regionPicker = `<label class="opt mregion"><span>${tx('where')}</span><select id="money-region">${REGIONS.map((x) => `<option${x === moneyRegion() ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>`;
  if (r.money_busy) {
    box.innerHTML = `<div class="fintro"><h3>${tx('workingMoney')}</h3><p>${tx('workingMoneyText', { region: esc(moneyRegion()) })}</p>
      <p class="fpaint"><button type="button" class="btn btn-prog" data-money-prog disabled><span class="bp-text">${tx('estimating')}</span></button></p></div>`;
    drawMoneyProgress(r);
    return;
  }
  if (!fin) {
    box.innerHTML = `<div class="fintro">
      <h3>${tx('moneyTitle', { thing: esc(r.title || '') })}</h3>
      <p>${tx('moneyIntro')}</p>
      ${regionPicker}
      ${r.money_error ? `<p class="ferror">${esc(r.money_error)}</p>` : ''}
      <p class="fpaint">${state.key ? `<button type="button" class="btn btn-primary" id="money-go">💰 ${tx('estimateMoney')} <small>${MONEY_COST}</small></button>`
        : `<button type="button" class="btn btn-ghost" id="money-signin">${tx('signInToEstimate', { c: MONEY_COST })}</button>`}</p>
      ${state.key ? '' : `<p class="hint">${tx('orDemo', { demo: `<button type="button" class="link" id="money-demo">${tx('scissorsDemo')}</button>` })}</p>`}
    </div>`;
    $('#money-region').addEventListener('change', (e) => store.set('how_region', e.target.value));
    $('#money-go')?.addEventListener('click', () => makeMoney($('#money-region').value));
    $('#money-signin')?.addEventListener('click', signIn);
    $('#money-demo')?.addEventListener('click', () => openDemo('money'));
    return;
  }

  const g = edits(r).g; const u0 = fin.setups[0];
  const pctInput = (k, label) => `<label class="madj"><span>${label}</span><span class="madj-in"><input type="range" min="50" max="200" step="5" data-g="${k}" value="${g[k] ?? 100}"><b>${g[k] ?? 100}%</b></span><small>${tx('ofEstimate')}</small></label>`;
  const numInput = (k, label, est, step, unit) => `<label class="madj"><span>${label}</span><span class="madj-in"><input type="number" min="0" step="${step}" data-g="${k}" value="${g[k] ?? ''}" placeholder="${est}"><em dir="ltr">${unit}</em></span><small>${tx('estimateWas', { v: est })}</small></label>`;
  const avgTariff = fin.setups.reduce((a, u) => a + u.power.price_per_kwh, 0) / fin.setups.length;
  const avgMat = fin.setups.reduce((a, u) => a + u.material_per_unit, 0) / fin.setups.length;

  box.innerHTML = `
    <div class="mhead">
      <p class="mlead" id="mlead"></p>
      <div class="mredo">${regionPicker}${state.key ? `<button type="button" class="btn btn-ghost btn-sm" id="money-redo">${tx('estimateAgain')} <small>${MONEY_COST}</small></button>` : ''}</div>
    </div>
    ${r.money_error ? `<p class="ferror">${esc(r.money_error)}</p>` : ''}
    <details class="mdet madjust"${hasEdits(r) || window.innerWidth > 760 ? ' open' : ''}><summary>✏️ ${tx('yourNumbers')}</summary>
      <p class="mnote">${tx('yourNumbersNote')}</p>
      <div class="madj-grid">
        ${numInput('output', tx('outputPerMonth'), Math.round(u0.output_per_month), 1000, esc(fin.unit_label))}
        ${pctInput('salary', tx('salaries'))}
        ${numInput('tariff', tx('powerPrice'), avgTariff.toFixed(3), 0.005, '$/kWh')}
        ${numInput('material', tx('materialPerUnit'), avgMat.toFixed(2), 0.01, '$')}
        ${pctInput('equipment', tx('equipmentPrices'))}
        ${pctInput('other', tx('otherCosts'))}
      </div>
      <p class="mreset"${hasEdits(r) ? '' : ' hidden'}><button type="button" class="link" id="money-reset">${tx('resetEstimate')}</button></p>
    </details>
    <div class="mcards" id="mcards"></div>
    <section class="mmarkup">
      <h3 class="list-h">${tx('markupTitle')}</h3>
      <label class="mslider"><span>${tx('markupLabel')}</span><input type="range" id="markup" min="0" max="200" step="5" value="${moneyMarkup}"><b id="markup-val">${moneyMarkup}%</b></label>
      ${fin.price_reference.high ? `<p class="mmarket">${tx('marketPrice')}: <b>${money(fin.price_reference.low)}–${money(fin.price_reference.high)}</b> ${tx('perUnit', { unit: esc(fin.unit_label.replace(/s$/, '')) })}${fin.price_reference.note ? ` <small>(${esc(fin.price_reference.note)})</small>` : ''}</p>` : ''}
      <div class="mpay" id="mpay"></div>
    </section>
    <div id="mbars"></div>
    <h3 class="list-h">${tx('theDetail')}</h3>
    <p class="mnote">${tx('detailNote')}</p>
    <div id="mdetail"></div>
    <p class="credit">${tx('moneyCredit')}</p>`;

  $('#money-region').addEventListener('change', (e) => store.set('how_region', e.target.value));
  $('#money-redo')?.addEventListener('click', () => { if (!hasEdits(r) || confirm(tx('confirmRedo'))) makeMoney($('#money-region').value); });
  $('#markup').addEventListener('input', (e) => { moneyMarkup = Number(e.target.value); $('#markup-val').textContent = `${moneyMarkup}%`; drawPayback(r); });
  $$('[data-g]', box).forEach((inp) => inp.addEventListener('input', () => {
    const v = inp.value === '' ? null : Number(inp.value);
    if (inp.type === 'range') inp.nextElementSibling.textContent = `${v}%`;
    if (v == null || !Number.isFinite(v) || (inp.type === 'range' && v === 100)) delete g[inp.dataset.g]; else g[inp.dataset.g] = Math.max(0, v);
    $('#money-reset').parentElement.hidden = !hasEdits(r);
    drawMoney(r); saveEditsSoon(r);
  }));
  $('#money-reset').addEventListener('click', () => { r.money_edits = undefined; renderMoney(); saveEditsSoon(r); });
  drawMoney(r);
}

// The parts that change with every edit; the inputs themselves stay put.
function drawMoney(r) {
  const fin = r.financials; const esc = escapeHTML; const unitL = esc(fin.unit_label); const one = unitL.replace(/s$/, '');
  $('#mlead').innerHTML = tx('moneyLead', { region: esc(fin.region || moneyRegion()), n: Math.round(withEdits(fin.setups[0], r.money_edits).output_per_month).toLocaleString('en'), unit: unitL });
  const us = fin.setups.map((u0) => { const u = withEdits(u0, r.money_edits); return { u, u0, mode: modeOf(u.mode), m: moneyMath(u) }; });
  const col = (fn) => us.map(fn).join('');
  const ed = r.money_edits;
  $('#mcards').innerHTML = col(({ mode, u, m }) => `<section class="mcard">
      <header><span class="fm-ic">${mode.icon}</span><b>${tx('mode_' + mode.key)}</b><small>${tx('modeNote_' + mode.key)}</small></header>
      <div class="mbig"><span>${tx('toSetUp')}</span><b>${moneyRange(m.lo.capex, m.hi.capex)}</b><small>${tx('toSetUpNote')}</small></div>
      <div class="mbig"><span>${tx('toRun')}</span><b>${moneyRange(m.lo.running, m.hi.running)}</b><small>${tx('toRunNote')}</small></div>
      <div class="mbig"><span>${tx('costOne')}</span><b>${moneyRange(m.lo.unit, m.hi.unit)}</b><small>${tx('costOneNote', { unit: one })}</small></div>
      <dl class="mfacts">
        <div><dt>${tx('people')}</dt><dd>${m.people.toLocaleString('en')} <small>· ${tx('payroll')} <bdi>${moneyRange(m.lo.payroll, m.hi.payroll)}</bdi>/${tx('mo_short')}</small></dd></div>
        <div><dt>${tx('land')}</dt><dd>${Math.round(u.land_m2).toLocaleString('en')} m² <small>· ${tx('building')} ${Math.round(u.building_m2).toLocaleString('en')} m²</small></dd></div>
        <div><dt>${tx('power')}</dt><dd><bdi>${moneyRange(m.lo.power, m.hi.power)}</bdi>/${tx('mo_short')} <small>· ${Math.round(u.power.installed_kw).toLocaleString('en')} kW</small></dd></div>
      </dl>
    </section>`);
  const maxRun = Math.max(...us.map((x) => x.m.running), 1); const maxCap = Math.max(...us.map((x) => x.m.capex), 1);
  $('#mbars').innerHTML = `<h3 class="list-h">${tx('whereMoneyGoes')}</h3>
    <div class="mbars">${col(({ mode, m }) => `<div class="mbar-row"><span class="mbar-name">${mode.icon} ${tx('mode_' + mode.key)}</span>
      <div class="mbar" style="width:${(m.running / maxRun) * 100}%" role="img" aria-label="${PARTS.map(([k, l]) => `${tx(l)} ${money(m[k])}`).join(', ')}">${PARTS.map(([k, l, c]) => (m[k] > 0 ? `<i style="flex:${m[k]};background:${c}" title="${tx(l)}: ${money(m[k])}"></i>` : '')).join('')}</div>
      <b>${money(m.running)}</b></div>`)}
      <p class="flegend">${PARTS.map(([, l, c]) => `<span><i style="background:${c}"></i>${tx(l)}</span>`).join('')}</p>
    </div>
    <h3 class="list-h">${tx('whatToSetUp')}</h3>
    <div class="mbars">${col(({ mode, m }) => `<div class="mbar-row"><span class="mbar-name">${mode.icon} ${tx('mode_' + mode.key)}</span>
      <div class="mbar mbar-cap" style="width:${(m.capex / maxCap) * 100}%" role="img" aria-label="${money(m.capex)}"><i style="flex:1"></i></div><b>${money(m.capex)}</b></div>`)}</div>`;

  // detail tables: the AI's figures as editable fields (typed ones are marked), totals as ranges
  const open = new Set($$('#mdetail details[open]').map((d) => d.dataset.k));
  const fresh = !$('#mdetail').children.length;
  const field = (u0, path, v, step) => { const k = `${u0.mode}.${path}`; const mine = ed?.i?.[k] != null;
    return `<input type="number" class="mnum${mine ? ' edited' : ''}" min="0" step="${step}" data-i="${k}" value="${mine ? ed.i[k] : v}" title="${tx('estimateWas', { v })}" aria-label="${tx('editValue')}">`; };
  const det = (k, title, fn) => `<details class="mdet" data-k="${k}"${(fresh ? k === 'staff' : open.has(k)) ? ' open' : ''}><summary>${title}</summary><div class="mcols">${us.map((x) => `<div><h4>${x.mode.icon} ${tx('mode_' + x.mode.key)}</h4>${fn(x)}</div>`).join('')}</div></details>`;
  $('#mdetail').innerHTML = `
    ${det('staff', `👷 ${tx('peopleSalaries')}`, ({ u0, u, m }) => `<table class="mtable">${u0.staff.map((x, i) => `<tr><td>${esc(x.role)}</td><td class="nw">${field(u0, `staff.${i}.count`, x.count, 1)} × ${field(u0, `staff.${i}.monthly_salary`, x.monthly_salary, 50)}</td><td class="nw">${money(u.staff[i].count * u.staff[i].monthly_salary)}</td></tr>`).join('')}<tr class="mtot"><td>${tx('nPeople', { n: m.people })}</td><td></td><td class="nw">${moneyRange(m.lo.payroll, m.hi.payroll)}/${tx('mo_short')}</td></tr></table>`)}
    ${det('capex', `🏗 ${tx('equipmentSetUp')}`, ({ u0, m }) => `<table class="mtable">${u0.capex.map((x, i) => `<tr><td>${esc(x.item)}</td><td class="nw">$${field(u0, `capex.${i}.amount`, Math.round(x.amount), 1000)}</td></tr>`).join('')}<tr class="mtot"><td>${tx('total')}</td><td class="nw">${moneyRange(m.lo.capex, m.hi.capex)}</td></tr></table>`)}
    ${det('power', `⚡ ${tx('power')}`, ({ u0, u, m }) => `<table class="mtable"><tr><td>${tx('installed')}</td><td class="nw">${Math.round(u.power.installed_kw).toLocaleString('en')} kW</td></tr><tr><td>${tx('usedPerMonth')}</td><td class="nw">${field(u0, 'power.x.kwh_per_month', Math.round(u0.power.kwh_per_month), 1000)} kWh</td></tr><tr><td>${tx('tariff')}</td><td class="nw">$${u.power.price_per_kwh.toFixed(3)}/kWh</td></tr><tr class="mtot"><td>${tx('powerBill')}</td><td class="nw">${moneyRange(m.lo.power, m.hi.power)}/${tx('mo_short')}</td></tr></table>`)}
    ${det('opex', `🧾 ${tx('otherRunning')}`, ({ u0, u, m }) => `<table class="mtable">${u0.opex.map((x, i) => `<tr><td>${esc(x.item)}</td><td class="nw">$${field(u0, `opex.${i}.monthly`, Math.round(x.monthly), 100)}</td></tr>`).join('')}<tr><td>${tx('materialsPackaging')} <small>(${money(u.material_per_unit)} × ${Math.round(u.output_per_month).toLocaleString('en')})</small></td><td class="nw">${money(m.materials)}</td></tr><tr class="mtot"><td>${tx('totalNoPeoplePower')}</td><td class="nw">${moneyRange(m.lo.other + m.lo.materials, m.hi.other + m.hi.materials)}/${tx('mo_short')}</td></tr></table>`)}
    ${fin.assumptions.length ? `<details class="mdet" data-k="assume"${open.has('assume') ? ' open' : ''}><summary>📌 ${tx('assumptions')}</summary><ul class="massume">${fin.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}<li>${tx('rangeNote')}</li></ul></details>` : ''}`;
  $$('#mdetail [data-i]').forEach((inp) => inp.addEventListener('change', () => {
    const it = edits(r).i; const v = inp.value === '' ? null : Number(inp.value);
    if (v == null || !Number.isFinite(v)) delete it[inp.dataset.i]; else it[inp.dataset.i] = Math.max(0, v);
    const reset = $('#money-reset'); if (reset) reset.parentElement.hidden = !hasEdits(r);
    drawMoney(r); saveEditsSoon(r);
  }));
  drawPayback(r);
}

// Markup → selling price, profit a month, and how long until the set-up is paid back (as a range).
function drawPayback(r) {
  const box = $('#mpay'); const fin = r.financials; if (!box || !fin) return;
  const k = moneyMarkup / 100; const one = escapeHTML(fin.unit_label.replace(/s$/, ''));
  const rows = fin.setups.map((u0) => {
    const u = withEdits(u0, r.money_edits); const m = moneyMath(u); const mode = modeOf(u.mode);
    const price = m.unit * (1 + k); const n = u.output_per_month;
    const profit = (price - m.unit) * n;
    const best = (price - m.lo.unit) * n > 0 ? m.lo.capex / ((price - m.lo.unit) * n) : Infinity;
    const worst = (price - m.hi.unit) * n > 0 ? m.hi.capex / ((price - m.hi.unit) * n) : Infinity;
    const mid = profit > 0 ? m.capex / profit : Infinity;
    const need = m.unit && n ? m.capex / (PAYBACK_YEARS * 12 * m.unit * n) : 0;
    return { mode, price, profit, best, worst, mid, need, over: fin.price_reference.high && price > fin.price_reference.high };
  });
  const maxPay = Math.min(Math.max(...rows.map((x) => (Number.isFinite(x.worst) ? x.worst : Number.isFinite(x.mid) ? x.mid : 0)), 12), 120);
  const w = (m) => (Number.isFinite(m) ? Math.min(100, (m / maxPay) * 100) : 100);
  box.innerHTML = rows.map((x) => `<div class="mpay-row${x.over ? ' over' : ''}">
    <span class="mbar-name">${x.mode.icon} ${tx('mode_' + x.mode.key)}</span>
    <div class="mpay-nums"><span>${tx('sellAt')} <b>${money(x.price)}</b> ${tx('perUnit', { unit: one })}${x.over ? ` <em>${tx('aboveMarket')}</em>` : ''}</span><span>${tx('profit')} <b>${money(x.profit)}</b> ${tx('aMonth')}</span><span>${tx('paysBackIn')} <b>${months(x.mid)}</b> <small class="mrange">(${monthsRange(x.best, x.worst)})</small></span></div>
    <div class="mpay-bar" role="img" aria-label="${tx('paysBackIn')} ${monthsRange(x.best, x.worst)}"><i class="lo" style="width:${w(x.best)}%"></i><i class="hi" style="width:${w(x.worst)}%"></i></div>
    <small>${tx('needMarkup', { y: PAYBACK_YEARS, p: Math.ceil(x.need * 100) })}</small>
  </div>`).join('');
}

// Edits live with the page in this browser (the cache); a short pause after typing before saving.
let editTimer = null;
function saveEditsSoon(r) { clearTimeout(editTimer); editTimer = setTimeout(() => cacheFactory(r), 600); }
