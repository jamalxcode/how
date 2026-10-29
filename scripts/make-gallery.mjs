// Makes complete gallery pages on the live site — the page, all three factory versions (hand-made,
// mixed, automated) and the money estimate — and adds each one to the gallery. It drives the real
// page in a headless browser, so the pages come out exactly as a visitor would make them.
//
//   OPENROUTER_KEY=sk-or-… HOW_ADMIN_SECRET=… node scripts/make-gallery.mjs
//
// About 30¢ and 5–10 minutes per thing. Optional: ITEMS="kettle, bicycle" (default: the list below), REGION (Money tab), MAX_SPEND in US
// dollars (default 15: stops before starting a new item once spent), HOW_SITE (default the live site).
// Runs from GitHub Actions too: see .github/workflows/gallery.yml.
import { chromium } from 'playwright';

export const DEFAULT_ITEMS = ['kettle', 'toaster', 'bicycle', 'can opener', 'zipper', 'electric motor', 'ballpoint pen', 'umbrella', 'padlock',
  'stapler', 'flashlight', 'ceiling fan', 'refrigerator', 'internal combustion engine', 'toilet flush', 'computer mouse', 'electric toothbrush', 'pressure cooker'];
const MODES = ['mixed', 'manual', 'auto'];

// One thing, start to finish, on a page that is already open on the site.
export async function makeOne(page, item, { region, log = console.log } = {}) {
  const t0 = Date.now(); const out = { item, ok: false, cost: 0 };
  await page.evaluate(() => loadFeatures()); // the Factory and Money code loads on demand
  await page.evaluate((q) => { $('#lang').value = 'English'; $('#level').value = 'curious adult'; ask(q, { force: true }); }, item);
  await page.waitForFunction(() => state.result && (state.result.kind === 'refused' || (state.result.painting === false && state.shortId)) || !$('#error').hidden, null, { timeout: 15 * 60e3 });
  const first = await page.evaluate(() => ({ error: $('#error').hidden ? '' : $('#error-msg').textContent, kind: state.result?.kind, title: state.result?.title }));
  if (first.error || first.kind === 'refused') { out.error = first.error || 'refused'; return out; }
  log(`  page: ${first.title}`);
  for (const mode of MODES) {
    const r = await page.evaluate(async (m) => { setView('factory'); switchMode(state.result, m); await makeFactory(); return { error: state.result.factory_error || '', ok: !!state.result.factory?.applicable }; }, mode);
    log(`  factory ${mode}: ${r.ok ? 'ok' : 'no plan'}${r.error ? ` (${r.error})` : ''}`);
    if (!r.ok) break;
  }
  const m = await page.evaluate(async (reg) => { setView('money'); await makeMoney(reg); return { error: state.result.money_error || '', ok: !!state.result.financials }; }, region);
  log(`  money: ${m.ok ? 'ok' : 'failed'}${m.error ? ` (${m.error})` : ''}`);
  const g = await page.evaluate(async () => { await galleryAdd(); return { text: $('#gallery-add').textContent, id: state.shortId, cost: state.cost }; });
  Object.assign(out, { ok: /In the gallery/.test(g.text), id: g.id, cost: g.cost, gallery: g.text, minutes: Math.round((Date.now() - t0) / 6e4) });
  return out;
}

async function main() {
  const key = process.env.OPENROUTER_KEY, admin = process.env.HOW_ADMIN_SECRET;
  if (!key || !admin) { console.error('Set OPENROUTER_KEY and HOW_ADMIN_SECRET.'); process.exit(1); }
  const site = process.env.HOW_SITE || 'https://how.sala.company/';
  const region = process.env.REGION || 'Gulf (Kuwait, UAE, Saudi Arabia)';
  const maxSpend = Number(process.env.MAX_SPEND || 15);
  const items = (process.env.ITEMS || DEFAULT_ITEMS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript(([k, a, reg]) => { localStorage.setItem('or_key', k); localStorage.setItem('how_admin', a); localStorage.setItem('how_region', reg); }, [key, admin, region]);
  let spent = 0; const done = [];
  for (const item of items) {
    if (spent >= maxSpend) { console.log(`Stopping: $${spent.toFixed(2)} spent, limit $${maxSpend}.`); break; }
    console.log(`${item}…`);
    const page = await ctx.newPage();
    try {
      await page.goto(site); await page.waitForFunction(() => typeof loadFeatures === 'function');
      const r = await makeOne(page, item, { region });
      spent += r.cost || 0; done.push(r);
      console.log(`  ${r.ok ? 'added to the gallery' : `not added: ${r.error || r.gallery}`} · $${(r.cost || 0).toFixed(2)} · ${r.minutes ?? '?'} min · total $${spent.toFixed(2)}`);
    } catch (e) { console.log(`  failed: ${e.message.split('\n')[0]}`); }
    await page.close();
  }
  await browser.close();
  console.log(`\nDone: ${done.filter((d) => d.ok).length} of ${items.length} added, $${spent.toFixed(2)} spent.`);
  for (const d of done) console.log(`- ${d.item}: ${d.ok ? `${site}#s=${d.id}` : d.error || d.gallery}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
