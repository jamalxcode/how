// How — the page's own labels in each language (the AI writes the content itself in the chosen language).
// tx('key', { n: 3 }) picks the result's language, falls back to English, and fills {placeholders}.
'use strict';

const I18N = {};
I18N.en = {
  tab_exploded: '⊕ Pulled apart', tab_whole: '◉ Whole', tab_photos: '📷 Real thing', tab_3d: '🧊 3D', tab_factory: '🏭 Factory', tab_money: '💰 Money',
  parts: 'Parts', steps: 'Step by step', didYouKnow: 'Did you know?', howItWorks: 'How it works', howItIsDone: 'How it is done', howDoesThisWork: 'How does this work? →',
  share: '↗ Share', paintAgain: 'Paint again', remake: 'Remake', somethingWrong: 'Something wrong?',
  stage_materials: 'Raw materials', stage_components: 'Components', stage_fabrication: 'Make the parts', stage_assembly: 'Assembly', stage_quality: 'Quality control', stage_packing: 'Packing', stage_shipping: 'Shipping',
  who_machine: 'Machine', who_both: 'People + machine', who_human: 'People',
  mode_manual: 'Hand-made', mode_mixed: 'Mixed', mode_auto: 'Automated',
  modeNote_manual: 'Mostly people, simple tools', modeNote_mixed: 'Machines with people', modeNote_auto: 'Robots; people only where needed',
  planned: 'planned', planning: 'planning…', notPlanned: 'not planned yet · {c}',
  planningText: 'Working out the materials, machines, people and floor space. The page appears as soon as the plan is ready, and the pictures fill in while you look around.',
  planningBtn: 'Planning…', versionTitle: 'This factory, {name}', howMake: 'How would you make {thing}?',
  factoryIntro: 'See what a factory for it would need, in the order it happens: raw materials, parts made or bought, machines, assembly, quality checks, packing and shipping. Every step is marked 🤖 machine, ✋ people or 🤝 both. You also get a floor plan drawn to scale, and before and after pictures for every zone.',
  planBtn: 'Plan the factory: {name}', signInPlan: 'Sign in to OpenRouter to plan it ({c})', orDemo: 'Or open the free {demo}, which has it built in.', scissorsDemo: 'scissors demo',
  nothingToMake: 'Nothing to manufacture here',
  output: 'Output', floorSpace: 'Floor space', mHigh: '{l} × {w} m, {h} m high', people: 'People', perShift: '{n} per shift', shiftsDay: 'Shifts a day: {n}',
  automated: 'Automated', pctSteps: '{p}% of steps', sharedByHand: '{a}% shared, {b}% by hand', investment: 'Investment', machinesFitout: 'machines and fit-out',
  costOne: 'Cost to make one', matLabMach: 'materials, labour, machines',
  lineInOrder: 'The line, in order', nSteps: 'Steps: {n}', factoryFloor: 'Factory floor',
  floorCaption: 'Painted overview: an impression, not to scale. Point at (or tap) a number to see what that zone does.',
  planCaption: 'Floor plan drawn to scale from the zone sizes. Material flows along the arrows from IN to OUT; letters are machines, listed below. Point at (or tap) a zone to see its before and after.',
  swipe: 'Swipe sideways to see all of it.',
  zone: 'Zone', size: 'Size', machinesEach: 'Machines (footprint each)', staff: 'Staff', staffPerShift: 'People per shift',
  zoneByZone: 'Zone by zone: before → after', stepByStepTruck: 'Step by step, from raw material to truck', stageN: 'Stage {n}', eachUnit: '{v} each', partN: 'Part {n}',
  madeHere: 'Made here', boughtIn: 'Bought in', zoneN: 'Zone {n}',
  factoryCredit: 'A rough plan by AI for learning and first estimates, not an engineering quote. Sizes, machines and numbers are typical, not exact.',
  xShifts: '× {n} shifts', cmpMachine: 'Steps by machine alone', cmpHand: 'Steps by hand',
  paintingBtn: 'Painting…', describingBtn: 'Describing each zone…', paintMissing: 'Paint the missing pictures', showInOut: 'Show what goes in and comes out of each zone',
  signInStates: 'Sign in to OpenRouter (top right) to paint before and after pictures for every zone ({c}).', workingStates: 'Working out what each zone takes in and sends out… the pictures follow.',
  before: 'Before', after: 'After', paintingNow: 'Painting now…', inQueue: 'In the queue',
  paintOverview: 'Paint an overview of the floor', paintingFloor: 'Painting the floor…', paintingFactoryFloor: 'Painting the factory floor',
  task_plan: 'Plan the factory', task_floor: 'Paint the floor', task_numbers: 'Find the zone numbers', task_states: 'Describe each zone', task_pics: 'Paint before & after',
  done: 'Done', pctLeft: '{p} · about {t} left', progRun: 'Building the factory page', progDone: 'All done', progGaps: 'Finished, with a few gaps', progIn: 'in {t}',
  progSteps: '{d} of {n} steps done · about {t} left', kOfN: '{k} of {n}',
  progHintPlan: 'The page appears as soon as the plan is ready; then you can look around while the pictures are painted.',
  progHintRest: 'Look around while it works: the plan, floor plan and zone list are ready, and each picture appears as soon as it is painted.',
  tipWorking: 'Working out what this zone takes in and sends out; its pictures follow.', tipNone: 'No before and after pictures for this plan yet: use the button under the zone list.',
  staffN: '{n} staff', aisle: 'forklift aisle · {m} m', planIn: 'IN', planOut: 'OUT', scaleCeiling: '{u} m · ceiling {h} m',
  never: 'never at this markup', over20: 'over 20 years', yrMo: '{y} yr {m} mo', yr: '{y} yr', mo: '{m} months',
  estimatingPct: 'Estimating… {p}% · about {t} left', estimating: 'Estimating…',
  materials: 'Materials', power: 'Power', otherRunning: 'Other running costs', where: 'Where',
  workingMoney: 'Working out the money', workingMoneyText: 'Land, people and salaries, equipment, power and running costs for the hand-made, mixed and automated factory in {region}.',
  moneyTitle: 'What would it cost to make {thing}?',
  moneyIntro: 'Approximate numbers for three ways to set up the factory — ✋ hand-made, 🤝 mixed and 🤖 automated — side by side: land, people and monthly salaries, equipment, the power bill and other running costs. Then pick a markup and see how long each takes to pay back.',
  estimateMoney: 'Estimate the money', signInToEstimate: 'Sign in to OpenRouter to estimate it ({c})',
  ofEstimate: 'of the estimate', estimateWas: 'AI estimate: {v}',
  moneyLead: 'Approximate figures for <b>{region}</b>, in US dollars, all three making <b>{n} {unit} a month</b>. For a first feel of the numbers, not a business plan.',
  estimateAgain: 'Estimate again', yourNumbers: 'Your numbers',
  yourNumbersNote: 'Change any number to your own; everything below updates at once. Numbers you type are used exactly; AI estimates are shown as a range.',
  outputPerMonth: 'Output per month', salaries: 'Salaries', powerPrice: 'Power price', materialPerUnit: 'Materials per unit', equipmentPrices: 'Equipment prices', otherCosts: 'Other running costs',
  resetEstimate: 'Reset to the AI estimate', markupTitle: 'Your markup, and when the set-up pays back', markupLabel: 'Markup on the cost to make one',
  marketPrice: 'Typical factory-gate price', perUnit: 'per {unit}', theDetail: 'The detail', detailNote: 'Every figure below can be changed: type your own quote or salary and press Enter.',
  moneyCredit: 'Estimates by AI from typical prices; real quotes for land, machines, wages and power can differ a lot. Use them to compare the three setups and to see which costs matter most.',
  confirmRedo: 'A new estimate replaces the numbers you changed. Continue?',
  toSetUp: 'To set up', toSetUpNote: 'land or building, equipment, installation', toRun: 'To run, per month', toRunNote: 'people, materials, power and the rest',
  costOneNote: 'per {unit}, before paying back the set-up', payroll: 'payroll', mo_short: 'mo', land: 'Land', building: 'building',
  whereMoneyGoes: 'Where the money goes each month', whatToSetUp: 'What it takes to set up', editValue: 'Change this figure',
  peopleSalaries: 'People and monthly salaries', nPeople: '{n} people', equipmentSetUp: 'Equipment and set-up', total: 'Total', installed: 'Installed', usedPerMonth: 'Used per month',
  tariff: 'Tariff', powerBill: 'Power bill', materialsPackaging: 'Materials and packaging', totalNoPeoplePower: 'Total, without people and power', assumptions: 'Assumptions',
  rangeNote: 'Ranges: equipment ±25%, other running costs ±20%, salaries and materials ±15%, power ±10%, unless you typed the number.',
  sellAt: 'Sell at', aboveMarket: 'above the usual market price', profit: 'Profit', aMonth: 'a month', paysBackIn: 'Pays back in',
  needMarkup: 'To pay back in {y} years you need about <b>{p}%</b> markup.',
  atlasTitle: "Where it comes from, and where to make it", atlasIntro: "See where the raw materials usually come from, and how the cost to make one changes from country to country.", atlasBtn: "Map it", atlasSignIn: "Sign in to OpenRouter to map it ({c}).", mapping: "Mapping…", atlasLegend: "Cost to make one: cheaper → dearer", wageLegend: "Factory wage: lower → higher", atlasNoMoney: "Estimate the money below to compare the cost to make one; until then the map is shaded by factory wages.", cheapest: "Cheapest places to make one", lowestWages: "Lowest factory wages", pickCountry: "Pick a country", materialsFrom: "Raw materials come from", mapNote: "Rough figures by AI: typical wages, power prices and rents, which vary a lot by city and year. Costs elsewhere are your estimate scaled by them.", pickHint: "Tap a country to see what it would cost to make one there.", factoryHere: "the factory", workerWage: "Factory wage", rentM2: "Rent", costHere: "Cost to make one here", vsHome: "{p} compared with {place}", useHere: "Estimate the money for {place}",
  ch_works: "How it works", ch_made: "How it's made", ch_costs: "What it costs", ch_made_lead: "From raw material to the truck: the factory that would make it, three ways.", ch_costs_lead: "What it takes to set that factory up and run it, and when it pays back.",
};

// Each other language lives in i18n/<code>.js (same keys, same {placeholders}) and is loaded only
// when a page in that language opens; until then, and for anything missing, English is used.
const langLoads = {};
function loadLang(code, then) {
  if (code === 'en' || I18N[code]) return;
  if (!langLoads[code]) {
    langLoads[code] = new Promise((ok) => { const el = document.createElement('script'); el.src = `i18n/${code}.js?v=3`; el.onload = ok; el.onerror = ok; document.head.appendChild(el); });
  }
  langLoads[code].then(() => { if (I18N[code]) then?.(); });
}

function tx(key, vars) {
  const code = typeof langCode === 'function' ? langCode(state?.result?.lang || 'English') : 'en';
  let s = (I18N[code] && I18N[code][key]) ?? I18N.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  return s;
}
