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

function moneyPrompt(lang, r, region) {
  const known = allVersions(r).map(({ mode, f }) => {
    const s = versionStats(f);
    return `- ${mode.name} (${mode.key}), already planned: ${s.staff} people per shift × ${s.shifts} shifts, floor ${Math.round(s.area)} m², output ${f.output}; machines: ${f.zones.flatMap((z) => z.machines.map((m) => `${m.count}× ${m.name}`)).join(', ')}.`;
  }).join('\n');
  const target = allVersions(r)[0]?.f.output;
  return `You are a manufacturing cost analyst. Estimate APPROXIMATE financials for three ways to set up a factory that makes the product below, located in: ${region}. US dollars, today's prices. Answer as JSON only; every amount is a plain number in US dollars (no symbols, no ranges).
Product: ${r.title_en || r.wikipedia_title || r.title}. Parts: ${(r.parts || []).map((p) => p.name_en || p.name).join(', ')}.

The three setups, one entry each in "setups", in this order:
${MODES.map((m) => `"${m.key}": ${m.brief}`).join('\n')}
All three make the SAME output${target ? `: ${target}` : ' (choose a sensible mid-size output)'}; "output_per_month" is that in units per month, "unit_label" names the unit ("pairs", "units").
${known ? `Use these plans where given, so the numbers match them:\n${known}\n` : ''}
For each setup:
"land_m2" (plot, with yard and parking) and "building_m2".
"staff": 4–8 roles covering ALL shifts (total headcount, not per shift) with the typical gross monthly salary for that role in ${region}, benefits included.
"capex": 6–12 one-off items: land and building (buy, or fit-out of a leased building — say which in the item), each main machine group, robots and automation, tooling and moulds, installation and commissioning, forklifts and racking, IT and software. No working capital.
"power": installed kW, kWh per month, local industrial tariff per kWh.
"opex": 4–8 MONTHLY items NOT counting staff, power or materials: rent or land lease (if not bought), maintenance and spares, consumables, insurance, water and other utilities, outbound transport, plus what is typical for ${region} (worker housing and visas in the Gulf, for example).
"material_per_unit": raw materials, bought-in parts and packaging for one unit.
"price_reference": the typical factory-gate (wholesale) price range for one unit, and a short note on what that price is for.
"assumptions": 3–5 short lines (working days, shifts, tariffs, wage basis) in ${lang}. "role", "item" and "note" in ${lang}.`;
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
function moneyMath(u) {
  const people = u.staff.reduce((a, x) => a + x.count, 0);
  const payroll = u.staff.reduce((a, x) => a + x.count * x.monthly_salary, 0);
  const power = u.power.kwh_per_month * u.power.price_per_kwh;
  const other = u.opex.reduce((a, x) => a + x.monthly, 0);
  const materials = u.material_per_unit * u.output_per_month;
  const running = payroll + power + other + materials;
  const capex = u.capex.reduce((a, x) => a + x.amount, 0);
  const unit = u.output_per_month ? running / u.output_per_month : 0;
  return { people, payroll, power, other, materials, running, capex, unit };
}
const money = (x) => {
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1e6) return `$${(x / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (a >= 1e4) return `$${Math.round(x / 1e3).toLocaleString('en')}k`;
  if (a >= 100) return `$${Math.round(x).toLocaleString('en')}`;
  return `$${x.toFixed(2)}`;
};
const months = (m) => {
  if (!Number.isFinite(m) || m <= 0) return 'never at this markup';
  if (m > 240) return 'over 20 years';
  const y = Math.floor(m / 12), mo = Math.round(m % 12);
  return y ? `${y} yr${mo ? ` ${mo} mo` : ''}` : `${Math.max(1, mo)} months`;
};

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
      { role: 'system', content: moneyPrompt(r.lang || $('#lang').value, r, region) },
      { role: 'user', content: `Approximate financials for a ${r.title} factory in ${region}.` },
    ] });
    r.financials = cleanMoney(m);
    if (!r.financials?.setups.length) throw new Error('The estimate came back empty. Try again.');
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
  b.querySelector('.bp-text').textContent = `Estimating… ${pct}% · about ${fmtSecs(Math.max(est - el, 4))} left`;
}

let moneyMarkup = 30;
function renderMoney() {
  const box = $('#money'); const r = state.result; if (!box || !r) return;
  const esc = escapeHTML; const fin = r.financials;
  const region = fin?.region || moneyRegion();
  const regionPicker = `<label class="opt mregion"><span>Where</span><select id="money-region">${REGIONS.map((x) => `<option${x === moneyRegion() ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>`;
  if (r.money_busy) {
    box.innerHTML = `<div class="fintro"><h3>Working out the money</h3><p>Land, people and salaries, equipment, power and running costs for the hand-made, mixed and automated factory in ${esc(moneyRegion())}.</p>
      <p class="fpaint"><button type="button" class="btn btn-prog" data-money-prog disabled><span class="bp-text">Estimating…</span></button></p></div>`;
    drawMoneyProgress(r);
    return;
  }
  if (!fin) {
    box.innerHTML = `<div class="fintro">
      <h3>What would it cost to make ${esc(r.title || 'this')}?</h3>
      <p>Approximate numbers for three ways to set up the factory — ✋ hand-made, 🤝 mixed and 🤖 automated — side by side: the land, the people and their monthly salaries, the equipment, the power bill and other running costs. Then pick a markup and see how long each one takes to pay back.</p>
      ${regionPicker}
      ${r.money_error ? `<p class="ferror">${esc(r.money_error)}</p>` : ''}
      <p class="fpaint">${state.key ? `<button type="button" class="btn btn-primary" id="money-go">💰 Estimate the money <small>${MONEY_COST}</small></button>`
        : `<button type="button" class="btn btn-ghost" id="money-signin">Sign in to OpenRouter to estimate it (${MONEY_COST})</button>`}</p>
      ${state.key ? '' : '<p class="hint">Or open the free <button type="button" class="link" id="money-demo">scissors demo</button>, which has it built in.</p>'}
    </div>`;
    $('#money-region').addEventListener('change', (e) => store.set('how_region', e.target.value));
    $('#money-go')?.addEventListener('click', () => makeMoney($('#money-region').value));
    $('#money-signin')?.addEventListener('click', signIn);
    $('#money-demo')?.addEventListener('click', () => { $('#lang').value = 'English'; ask('scissors'); setTimeout(() => setView('money'), 50); });
    return;
  }

  const us = fin.setups.map((u) => ({ u, mode: modeOf(u.mode), m: moneyMath(u) }));
  const unitL = esc(fin.unit_label);
  const maxRun = Math.max(...us.map((x) => x.m.running), 1);
  const maxCap = Math.max(...us.map((x) => x.m.capex), 1);
  const col = (fn) => us.map(fn).join('');
  const PARTS = [['payroll', 'People', '#1f8a8a'], ['materials', 'Materials', '#2b4c7e'], ['power', 'Power', '#e8b43a'], ['other', 'Other running costs', '#8f6236']];

  box.innerHTML = `
    <div class="mhead">
      <p class="mlead">Approximate figures for <b>${esc(region)}</b>, in US dollars, all three making <b>${Math.round(us[0].u.output_per_month).toLocaleString('en')} ${unitL} a month</b>. For a first feel of the numbers, not a business plan.</p>
      <div class="mredo">${regionPicker}${state.key ? `<button type="button" class="btn btn-ghost btn-sm" id="money-redo">Estimate again <small>${MONEY_COST}</small></button>` : ''}</div>
    </div>
    ${r.money_error ? `<p class="ferror">${esc(r.money_error)}</p>` : ''}

    <div class="mcards">${col(({ mode, u, m }) => `<section class="mcard">
      <header><span class="fm-ic">${mode.icon}</span><b>${mode.name}</b><small>${mode.note}</small></header>
      <div class="mbig"><span>To set up</span><b>${money(m.capex)}</b><small>land or building, equipment, installation</small></div>
      <div class="mbig"><span>To run, per month</span><b>${money(m.running)}</b><small>people, materials, power and the rest</small></div>
      <div class="mbig"><span>Cost to make one</span><b>${money(m.unit)}</b><small>per ${unitL.replace(/s$/, '')}, before paying back the set-up</small></div>
      <dl class="mfacts">
        <div><dt>People</dt><dd>${m.people.toLocaleString('en')} <small>· payroll ${money(m.payroll)}/mo</small></dd></div>
        <div><dt>Land</dt><dd>${Math.round(u.land_m2).toLocaleString('en')} m² <small>· building ${Math.round(u.building_m2).toLocaleString('en')} m²</small></dd></div>
        <div><dt>Power</dt><dd>${money(m.power)}/mo <small>· ${Math.round(u.power.installed_kw).toLocaleString('en')} kW installed</small></dd></div>
      </dl>
    </section>`)}</div>

    <section class="mmarkup">
      <h3 class="list-h">Your markup, and when the set-up pays back</h3>
      <label class="mslider"><span>Markup on the cost to make one</span><input type="range" id="markup" min="0" max="200" step="5" value="${moneyMarkup}"><b id="markup-val">${moneyMarkup}%</b></label>
      ${fin.price_reference.high ? `<p class="mmarket">Typical factory-gate price: <b>${money(fin.price_reference.low)}–${money(fin.price_reference.high)}</b> per ${unitL.replace(/s$/, '')}${fin.price_reference.note ? ` <small>(${esc(fin.price_reference.note)})</small>` : ''}</p>` : ''}
      <div class="mpay" id="mpay"></div>
    </section>

    <h3 class="list-h">Where the money goes each month</h3>
    <div class="mbars">${col(({ mode, m }) => `<div class="mbar-row"><span class="mbar-name">${mode.icon} ${mode.name}</span>
      <div class="mbar" style="width:${(m.running / maxRun) * 100}%">${PARTS.map(([k, , c]) => (m[k] > 0 ? `<i style="flex:${m[k]};background:${c}" title="${PARTS.find((p) => p[0] === k)[1]}: ${money(m[k])}"></i>` : '')).join('')}</div>
      <b>${money(m.running)}</b></div>`)}
      <p class="flegend">${PARTS.map(([, label, c]) => `<span><i style="background:${c}"></i>${label}</span>`).join('')}</p>
    </div>
    <h3 class="list-h">What it takes to set up</h3>
    <div class="mbars">${col(({ mode, m }) => `<div class="mbar-row"><span class="mbar-name">${mode.icon} ${mode.name}</span>
      <div class="mbar mbar-cap" style="width:${(m.capex / maxCap) * 100}%"><i style="flex:1"></i></div><b>${money(m.capex)}</b></div>`)}</div>

    <h3 class="list-h">The detail</h3>
    ${detail('👷 People and monthly salaries', us, ({ u, m }) => `<table class="mtable">${u.staff.map((x) => `<tr><td>${esc(x.role)}</td><td class="nw">${x.count} × ${money(x.monthly_salary)}</td><td class="nw">${money(x.count * x.monthly_salary)}</td></tr>`).join('')}<tr class="mtot"><td>${m.people} people</td><td></td><td class="nw">${money(m.payroll)}/mo</td></tr></table>`, true)}
    ${detail('🏗 Equipment and set-up', us, ({ u, m }) => `<table class="mtable">${u.capex.map((x) => `<tr><td>${esc(x.item)}</td><td class="nw">${money(x.amount)}</td></tr>`).join('')}<tr class="mtot"><td>Total</td><td class="nw">${money(m.capex)}</td></tr></table>`)}
    ${detail('⚡ Power', us, ({ u, m }) => `<table class="mtable"><tr><td>Installed</td><td class="nw">${Math.round(u.power.installed_kw).toLocaleString('en')} kW</td></tr><tr><td>Used per month</td><td class="nw">${Math.round(u.power.kwh_per_month).toLocaleString('en')} kWh</td></tr><tr><td>Tariff</td><td class="nw">$${u.power.price_per_kwh.toFixed(3)}/kWh</td></tr><tr class="mtot"><td>Power bill</td><td class="nw">${money(m.power)}/mo</td></tr></table>`)}
    ${detail('🧾 Other running costs', us, ({ u, m }) => `<table class="mtable">${u.opex.map((x) => `<tr><td>${esc(x.item)}</td><td class="nw">${money(x.monthly)}</td></tr>`).join('')}<tr><td>Materials and packaging <small>(${money(u.material_per_unit)} × ${Math.round(u.output_per_month).toLocaleString('en')})</small></td><td class="nw">${money(m.materials)}</td></tr><tr class="mtot"><td>Total, without people and power</td><td class="nw">${money(m.other + m.materials)}/mo</td></tr></table>`)}
    ${fin.assumptions.length ? `<details class="mdet"><summary>📌 Assumptions</summary><ul class="massume">${fin.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></details>` : ''}
    <p class="credit">Estimates by AI from typical prices; real quotes for land, machines, wages and power can differ a lot. Use them to compare the three setups and to see which costs matter most.</p>`;

  $('#money-region').addEventListener('change', (e) => store.set('how_region', e.target.value));
  $('#money-redo')?.addEventListener('click', () => makeMoney($('#money-region').value));
  $('#markup').addEventListener('input', (e) => { moneyMarkup = Number(e.target.value); $('#markup-val').textContent = `${moneyMarkup}%`; drawPayback(us, fin); });
  drawPayback(us, fin);
}

function detail(title, us, fn, open = false) {
  return `<details class="mdet"${open ? ' open' : ''}><summary>${title}</summary><div class="mcols">${us.map((x) => `<div><h4>${x.mode.icon} ${x.mode.name}</h4>${fn(x)}</div>`).join('')}</div></details>`;
}

// Markup → selling price, profit a month, and how long until the set-up is paid back.
function drawPayback(us, fin) {
  const box = $('#mpay'); if (!box) return;
  const k = moneyMarkup / 100; const unitL = escapeHTML(fin.unit_label.replace(/s$/, ''));
  const rows = us.map(({ mode, u, m }) => {
    const price = m.unit * (1 + k); const profit = (price - m.unit) * u.output_per_month;
    const pay = profit > 0 ? m.capex / profit : Infinity;
    const need = m.unit && u.output_per_month ? m.capex / (PAYBACK_YEARS * 12 * m.unit * u.output_per_month) : 0;
    const over = fin.price_reference.high && price > fin.price_reference.high;
    return { mode, price, profit, pay, need, over };
  });
  const maxPay = Math.min(Math.max(...rows.map((x) => (Number.isFinite(x.pay) ? x.pay : 0)), 12), 120);
  box.innerHTML = rows.map((x) => `<div class="mpay-row${x.over ? ' over' : ''}">
    <span class="mbar-name">${x.mode.icon} ${x.mode.name}</span>
    <div class="mpay-nums"><span>Sell at <b>${money(x.price)}</b> per ${unitL}${x.over ? ' <em>above the usual market price</em>' : ''}</span><span>Profit <b>${money(x.profit)}</b> a month</span><span>Pays back in <b>${months(x.pay)}</b></span></div>
    <div class="mpay-bar"><i style="width:${Number.isFinite(x.pay) ? Math.min(100, (x.pay / maxPay) * 100) : 100}%"></i></div>
    <small>To pay back in ${PAYBACK_YEARS} years you need about <b>${Math.ceil(x.need * 100)}%</b> markup.</small>
  </div>`).join('');
}
