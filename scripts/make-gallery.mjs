// Makes complete gallery pages on the live site — the page, all three factory versions (hand-made,
// mixed, automated) and the money estimate — and adds each one to the gallery. It drives the real
// page in a headless browser, so the pages come out exactly as a visitor would make them.
//
//   OPENROUTER_KEY=sk-or-… HOW_ADMIN_SECRET=… node scripts/make-gallery.mjs
//
// About 30¢ and 5–10 minutes per thing. Optional: ITEMS="kettle, bicycle" (default: the list below), REGION (Money tab), MAX_SPEND in US
// dollars (default 15: stops before starting a new item once spent), HOW_SITE (default the live site).
// CHECK_ONLY=true checks both secrets without spending anything. REPAIR=<page ids or links> paints
// what is missing on stored pages instead of making new ones. Runs from GitHub Actions too: see
// .github/workflows/gallery.yml.

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
  const a = await page.evaluate(async () => { await makeAtlas(); return { error: state.result.atlas_error || '', ok: !!state.result.atlas }; });
  log(`  map: ${a.ok ? 'ok' : 'failed'}${a.error ? ` (${a.error})` : ''}`);
  log(`  gaps: ${await fillGaps(page)}`);
  const g = await page.evaluate(async () => { await galleryAdd(); return { text: $('#gallery-add').textContent, id: state.shortId, cost: state.cost }; });
  Object.assign(out, { ok: /In the gallery/.test(g.text), id: g.id, cost: g.cost, gallery: g.text, minutes: Math.round((Date.now() - t0) / 6e4) });
  return out;
}

// Free check of both secrets: OpenRouter describes the key; the link service answers "unknown id"
// to a gallery add with the right admin secret (and "not allowed" with a wrong one).
async function check(key, admin) {
  let ok = true;
  const k = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` } });
  const kj = await k.json().catch(() => ({}));
  if (k.ok) {
    const d = kj.data || {};
    console.log(`OPENROUTER_KEY works: "${d.label || 'key'}", used $${Number(d.usage || 0).toFixed(2)}${d.limit != null ? ` of a $${d.limit} limit` : ', no limit set'}.`);
  } else { ok = false; console.log(`OPENROUTER_KEY does not work (${k.status}: ${kj.error?.message || 'rejected'}).`); }
  const g = await fetch('https://how-links.jamal-akuna-matata.workers.dev/gallery', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': admin }, body: JSON.stringify({ id: 'zzzzz', title: 'check' }) });
  if (g.status === 404) console.log('HOW_ADMIN_SECRET works: the link service accepted it.');
  else if (g.status === 403) { ok = false; console.log('HOW_ADMIN_SECRET is wrong: the link service refused it. Make it match ADMIN_SECRET in Cloudflare.'); }
  else { ok = false; console.log(`HOW_ADMIN_SECRET: unexpected answer ${g.status} from the link service.`); }
  return ok;
}

// Paint any before/after picture still missing, in every factory version. Versions that borrow
// fewest pictures go first, so the ones the others borrow from are complete before they are checked.
export async function fillGaps(page) {
  return page.evaluate(async () => {
    const r = state.result; const out = []; const shown = r.factory_mode || 'mixed';
    const all = { ...(r.factories || {}) }; if (r.factory) all[r.factory_mode || 'mixed'] = { factory: r.factory };
    const borrowed = (f) => (f.states || []).reduce((n, st) => n + !!st.before?.same_as + !!st.after?.same_as, 0);
    const order = Object.entries(all).filter(([, v]) => v.factory?.applicable).sort((a, b) => borrowed(a[1].factory) - borrowed(b[1].factory)).map(([m]) => m);
    for (const m of order) {
      switchMode(state.result, m); setView('factory', { scroll: false });
      const f = state.result.factory; const sts = f.states || [];
      const missing = sts.length < f.zones.length || sts.some((st, i) => ['before', 'after'].some((w) => !stateUrl(state.result, stateKey(st, i, w, sts))));
      if (missing) { await makeStates(); out.push(`${m} ${state.result.factory_error ? `still has gaps (${state.result.factory_error})` : 'filled'}`); }
    }
    if (out.length && (state.result.factory_mode || 'mixed') !== shown) { switchMode(state.result, shown); await saveFactory(state.result); }
    return out.join(', ') || 'none';
  });
}

// Repair stored pages: paint whatever is missing, and swap the repaired page into the gallery.
async function repair(ctx, site, ids) {
  for (const id of ids) {
    const page = await ctx.newPage();
    try {
      await page.goto(`${site}#page/s=${id}`); await page.waitForFunction(() => state.result && state.shortId, null, { timeout: 60000 });
      await page.evaluate(() => loadFeatures());
      console.log(`${id} (${await page.evaluate(() => state.result.title)}): gaps ${await fillGaps(page)}`);
      const r = await page.evaluate(async (old) => {
        const inGallery = state.gallery.some((g) => g.id === old);
        if (inGallery && state.shortId !== old) {
          await fetch(`${LINKS_API}/gallery/${old}`, { method: 'DELETE', headers: { 'X-Admin': state.admin } });
          await galleryAdd();
        }
        return { now: state.shortId, inGallery };
      }, id);
      console.log(`  now ${site}#s=${r.now}${r.inGallery ? ' (replaced in the gallery)' : ''}`);
    } catch (e) { console.log(`  failed: ${e.message.split('\n')[0]}`); }
    await page.close();
  }
}

async function main() {
  const key = process.env.OPENROUTER_KEY, admin = process.env.HOW_ADMIN_SECRET;
  if (!key || !admin) { console.error(`Missing secret: ${[!key && 'OPENROUTER_KEY', !admin && 'HOW_ADMIN_SECRET'].filter(Boolean).join(' and ')}.`); process.exit(1); }
  if (process.env.CHECK_ONLY === 'true') process.exit((await check(key, admin)) ? 0 : 1);
  const site = process.env.HOW_SITE || 'https://how.sala.company/';
  const region = process.env.REGION || 'Gulf (Kuwait, UAE, Saudi Arabia)';
  const maxSpend = Number(process.env.MAX_SPEND || 15);
  const items = (process.env.ITEMS || DEFAULT_ITEMS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const { chromium } = await import('playwright'); // only needed for a full run
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript(([k, a, reg]) => { localStorage.setItem('or_key', k); localStorage.setItem('how_admin', a); localStorage.setItem('how_region', reg); }, [key, admin, region]);
  if (process.env.REPAIR) { await repair(ctx, site, process.env.REPAIR.split(',').map((s) => s.trim().replace(/^.*s=/, '')).filter(Boolean)); await browser.close(); return; }
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
