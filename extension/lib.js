// Shared by the background worker: options data (CBOE / Deribit) and the tool injector. Price bars come live from TradingView itself (core.js).
const chartSym = async tabId => (await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: () => { try { const f = document.querySelector('iframe[id^="tradingview_"]'); const api = f ? f.contentWindow.tradingViewApi : window.TradingViewApi; const c = api.activeChart(); return (c.symbol() + ' ' + ((c.symbolExt() || {}).name || '')).trim(); } catch (e) { return ''; } } }))[0].result;
async function deribit(cur) {
  const [bs, ix] = await Promise.all([
    fetch('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=' + cur + '&kind=option').then(r => r.json()),
    fetch('https://www.deribit.com/api/v2/public/get_index_price?index_name=' + cur.toLowerCase() + '_usd').then(r => r.json())]);
  const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 }, opts = [];
  for (const o of bs.result || []) {
    const m = /^\w+-(\d{1,2})([A-Z]{3})(\d{2})-(\d+)-([CP])$/.exec(o.instrument_name); if (!m || !o.open_interest || !o.mark_iv) continue;
    const T = (Date.UTC(2000 + +m[3], MON[m[2]], +m[1], 8) - Date.now()) / (365 * 864e5); if (T <= 0 || T > 60 / 365) continue;
    opts.push({ K: +m[4], call: m[5] === 'C', oi: o.open_interest, iv: o.mark_iv / 100, T });
  }
  return { at: Date.now() + 6 * 3600e3, S: ix.result.index_price, opts };
}
// options gamma for the AMD Range Model: NDX + QQQ from CBOE (NQ), Deribit (BTC/ETH)
async function loadGex(tabId, force) {
  const sym = (await chartSym(tabId)).toUpperCase();
  if (/NQ|NDX|NAS/.test(sym)) {
    const [{ result: age }] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: () => { try { const r = JSON.parse(localStorage.getItem('claude_gex_raw')); return r && r.src ? Date.now() - r.at : 1e12; } catch (e) { return 1e12; } } });
    if (!force && age < 5 * 60000) return;
    const raw = await gexCalc();
    await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: r => localStorage.setItem('claude_gex_raw', JSON.stringify(r)), args: [raw] });
  } else { const cur = /ETH/.test(sym) ? 'ETH' : /BTC|XBT/.test(sym) ? 'BTC' : null; if (cur) { const g = await deribit(cur); await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: (c, g) => { (window.__claudeGex = window.__claudeGex || {})[c] = g; }, args: [cur, g] }); } }
}
const KEY = { 'po3w.js': 'claude_po3w', 'scrivw.js': 'claude_scrivw', 'ictkz.js': 'claude_ictkz', 'amdw.js': 'claude_amdw' };
// the same code your friends run: latest files from the GitHub repo (falls back to this extension's copy)
async function latest(f) {
  try {
    const j = await fetch('https://api.github.com/repos/marlonmene21-eng/claude-strats/contents/' + f + '?ref=main', { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject());
    return new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\n/g, '')), c => c.charCodeAt(0)));
  } catch (e) {
    try { const r = await fetch('https://raw.githubusercontent.com/marlonmene21-eng/claude-strats/main/' + f + '?t=' + Date.now(), { cache: 'no-store' }); return r.ok ? r.text() : null; } catch (x) { return null; }
  }
}
// TradingView: run the code saved in TradingView's localStorage (refreshed from GitHub on every click, so it always matches TopstepX)
async function inject(tabId, url, tool) {
  if (!/tradingview\.com/.test(url)) return chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['core.js', tool] });
  const ver = chrome.runtime.getManifest().version;
  const [core, src] = await Promise.all(['core.js', tool].map(f => fetch(chrome.runtime.getURL(f)).then(r => r.text())));
  let [gCore, gSrc] = await Promise.all([latest('core.js'), latest(tool)]);
  if (!gCore || !/tvEnv/.test(gCore) || !gSrc) gCore = gSrc = null;   // only use GitHub once it has the TradingView-capable engine
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', args: [core, src, gCore, gSrc, KEY[tool], ver], func: (core, src, gCore, gSrc, key, ver) => new Promise(ok => {
    const ls = localStorage, seed = (k, v) => { if (ls.getItem('claude_ext_seed_' + k) !== ver || !ls.getItem(k)) { ls.setItem(k, v); ls.setItem('claude_ext_seed_' + k, ver); } };
    if (gCore) { ls.setItem('claude_core', gCore); ls.setItem(key, gSrc); } else { seed('claude_core', core); seed(key, src); }
    const u = URL.createObjectURL(new Blob([ls.getItem('claude_core') + '\n;\n' + ls.getItem(key)], { type: 'text/javascript' }));
    const s = document.createElement('script'); s.src = u; s.onload = () => { URL.revokeObjectURL(u); s.remove(); ok('ok'); }; s.onerror = () => ok('blocked'); document.head.appendChild(s);
  }) });
  if (result !== 'ok') throw Error('TradingView blocked the script');
}
