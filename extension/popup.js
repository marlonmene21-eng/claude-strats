const S = t => (document.getElementById('s').textContent = t);

// NDX options → gamma levels (call wall, put wall, gamma flip, pivots); same maths as the TopstepX version
async function cboeGex() {
  const j = await fetch('https://cdn.cboe.com/api/global/delayed_quotes/options/_NDX.json').then(r => r.json());
  const d = j.data, S0 = d.current_price, now = Date.now(), o = [];
  for (const x of d.options) {
    const m = /^NDXP?(\d\d)(\d\d)(\d\d)([CP])(\d{8})$/.exec(x.option); if (!m || !x.open_interest || !x.iv) continue;
    const T = (Date.UTC(2000 + +m[1], m[2] - 1, +m[3], 20) - now) / 31536e6; if (T <= 0 || T > 60 / 365) continue;
    o.push({ K: m[5] / 1e3, c: m[4] == 'C', oi: x.open_interest, iv: x.iv, T });
  }
  const g = (s, q) => { const v = q.iv * Math.sqrt(q.T), d1 = (Math.log(s / q.K) + q.iv * q.iv * q.T / 2) / v; return Math.exp(-d1 * d1 / 2) / 2.5066 / (s * v); };
  const B = new Map(); for (const q of o) { const v = g(S0, q) * q.oi * S0 * S0, r = B.get(q.K) || { K: q.K, c: 0, p: 0 }; q.c ? r.c += v : r.p += v; B.set(q.K, r); }
  const k = [...B.values()].filter(r => r.K > S0 * .9 && r.K < S0 * 1.1);
  const cw = k.reduce((a, r) => r.c > a.c ? r : a).K, pw = k.reduce((a, r) => r.p > a.p ? r : a).K;
  const n = s => o.reduce((a, q) => a + (q.c ? 1 : -1) * g(s, q) * q.oi * s * s, 0);
  let f = null, P = null; for (let s = S0 * .92; s <= S0 * 1.08; s += S0 * .001) { const v = n(s); if (P && Math.sign(v) != Math.sign(P.v)) { const z = P.s + (s - P.s) * Math.abs(P.v) / (Math.abs(P.v) + Math.abs(v)); if (f == null || Math.abs(z - S0) < Math.abs(f - S0)) f = z; } P = { s, v }; }
  const pv = []; for (const r of k.map(r => ({ K: r.K, n: r.c - r.p })).sort((a, b) => Math.abs(b.n) - Math.abs(a.n))) if (pv.length < 2 && r.K != cw && r.K != pw && Math.abs(r.K - S0) < S0 * .03 && !pv.some(q => Math.abs(q - r.K) < S0 * .002)) pv.push(r.K);
  return { type: 'claude_gex', S: S0, ts: Date.parse(j.timestamp.replace(' ', 'T') + 'Z'), cw, pw, flip: f, piv: pv, regime: n(S0) >= 0 ? 'Positive' : 'Negative', at: Date.now() };
}
// Deribit options for BTC / ETH (fetched here because TradingView blocks it from the page)
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

document.querySelectorAll('.b').forEach(btn => btn.onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/tradingview\.com|topstepx\.com|vestmarkets\.com/.test(tab.url || '')) return S('Open a TradingView, TopstepX or Vest chart first.');
  const tool = btn.dataset.t;
  try {
    if (tool === 'amdw.js') {
      S('Loading gamma levels…');
      const [{ result: sym }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: () => {
        try { const f = document.querySelector('iframe[id^="tradingview_"]'); const api = f ? f.contentWindow.tradingViewApi : window.TradingViewApi; const c = api.activeChart(); return (c.symbol() + ' ' + ((c.symbolExt() || {}).name || '')).toUpperCase(); } catch (e) { return ''; } } });
      if (/NQ|NDX|NAS/.test(sym)) { const raw = await cboeGex(); await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: r => localStorage.setItem('claude_gex_raw', JSON.stringify(r)), args: [raw] }); }
      else { const cur = /ETH/.test(sym) ? 'ETH' : /BTC|XBT/.test(sym) ? 'BTC' : null; if (cur) { const g = await deribit(cur); await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: (c, g) => { (window.__claudeGex = window.__claudeGex || {})[c] = g; }, args: [cur, g] }); } }
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files: ['core.js', tool] });
    S(btn.textContent + ' toggled on this chart.');
  } catch (e) { S('Error: ' + e.message); }
});
