// Prints what the link service holds for one page: its factory versions, which picture each zone's
// before/after uses, and whether each picture loads. For finding gaps without a browser.
//   PAGE=6bwrrrc node scripts/inspect-page.mjs
const API = 'https://how-links.jamal-akuna-matata.workers.dev';
const id = (process.env.PAGE || '').replace(/^.*s=/, '').trim();
if (!/^[a-z0-9]{5,12}$/.test(id)) { console.error('Set PAGE to a page id or share link.'); process.exit(1); }
const about = await (await fetch(`${API}/`)).json().catch(() => ({}));
console.log(`Link service version: ${about.version || '1 (old: copies every picture on every save)'}\n`);
const page = await (await fetch(`${API}/${id}`)).json();
console.log(`${page.title} · shown version: ${page.factory_mode || '-'} · other versions: ${Object.keys(page.factories || {}).join(', ') || 'none'}`);
const versions = { [page.factory_mode || 'mixed']: { factory: page.factory, state_keys: page.state_keys, where: '' } };
for (const [m, v] of Object.entries(page.factories || {})) versions[m] = { ...v, where: m };
const status = async (url) => { try { const r = await fetch(url, { method: 'GET' }); return r.status; } catch { return 'ERR'; } };
const keyOf = (states, st, i, w) => {
  if (st[w]?.same_as) return st[w].same_as;
  if (w === 'before' && st.before_from) { const p = states[st.before_from - 1]; return p ? keyOf(states, p, st.before_from - 1, 'after') : `z${st.before_from}a`; }
  return `z${i + 1}${w === 'before' ? 'b' : 'a'}`;
};
for (const [m, v] of Object.entries(versions)) {
  const f = v.factory; if (!f) continue;
  console.log(`\n== ${m}: ${f.zones.length} zones, ${f.states?.length || 0} described; stored pictures: ${(v.state_keys || []).join(' ') || 'none'}`);
  for (let i = 0; i < f.zones.length; i++) {
    const st = f.states?.[i];
    if (!st) { console.log(`  ${i + 1}. ${f.zones[i].name}: NOT DESCRIBED`); continue; }
    const out = [];
    for (const w of ['before', 'after']) {
      let k = keyOf(f.states, st, i, w), owner = m;
      if (k.includes(':')) [owner, k] = k.split(':');
      const ov = versions[owner];
      const url = `${API}/img/${id}/s/${ov?.where ? `${ov.where}/` : ''}${k}`;
      const stored = ov?.state_keys?.includes(k);
      out.push(`${w} ${owner === m ? '' : `${owner}:`}${k}${stored ? '' : ' (not stored)'} → ${await status(url)}${st[w].same_as ? ' [shared]' : ''}${w === 'before' && st.before_from ? ` [from zone ${st.before_from}]` : ''}`);
    }
    console.log(`  ${i + 1}. ${f.zones[i].name}: ${out.join(' | ')}`);
  }
}

// Can the link service still store anything? A tiny save tells a full store (Cloudflare's daily
// write allowance used up) apart from a problem with this page's own save.
const probe = await fetch(`${API}/`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://how.sala.company' }, body: JSON.stringify({ title: 'save test' }) }).catch((e) => ({ status: e.message, text: async () => '' }));
const said = await probe.text();
console.log(`\nSave test: ${probe.status} ${(/<title>([^<]*)/.exec(said)?.[1] || said).slice(0, 200)}`);
