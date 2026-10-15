const S = t => (document.getElementById('s').textContent = t);
document.querySelectorAll('.b').forEach(btn => btn.onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/tradingview\.com|topstepx\.com|vestmarkets\.com/.test(tab.url || '')) return S('Open a TradingView chart first.');
  S('Loading ' + btn.textContent + '…');
  const r = await chrome.runtime.sendMessage({ run: true, tabId: tab.id, url: tab.url, tool: btn.dataset.t });
  S(r && r.err ? 'Error: ' + r.err : btn.textContent + (r && r.ok === 'closed' ? ' closed.' : ' is on (live TradingView data).'));
});
