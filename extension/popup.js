const S = t => (document.getElementById('s').textContent = t);

// NDX options → gamma levels (call wall, put wall, gamma flip, pivots); same maths as the TopstepX version
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
      if (/NQ|NDX|NAS/.test(sym)) { const raw = await gexCalc(); await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: r => localStorage.setItem('claude_gex_raw', JSON.stringify(r)), args: [raw] }); }
      else { const cur = /ETH/.test(sym) ? 'ETH' : /BTC|XBT/.test(sym) ? 'BTC' : null; if (cur) { const g = await deribit(cur); await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: (c, g) => { (window.__claudeGex = window.__claudeGex || {})[c] = g; }, args: [cur, g] }); } }
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files: ['core.js', tool] });
    S(btn.textContent + ' toggled on this chart.');
  } catch (e) { S('Error: ' + e.message); }
});
