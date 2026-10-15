importScripts('gexcalc.js', 'lib.js');
const isOn = async tabId => (await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: () => [window.__claude_po3w, window.__claude_scrivw, window.__claude_ictkz, window.__claude_amdw].map(Boolean) }))[0].result;
async function watch(tabId) { const { tabs = [] } = await chrome.storage.session.get('tabs'); if (!tabs.includes(tabId)) { tabs.push(tabId); await chrome.storage.session.set({ tabs }); } }
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (!m.run) return;
  (async () => {
    const { tabId, url, tool } = m;
    const on = (await isOn(tabId).catch(() => [false, false, false, false]))[Object.keys(KEY).indexOf(tool)];
    if (tool === 'amdw.js' && !on) { await loadGex(tabId, true).catch(() => { }); await watch(tabId); }
    await inject(tabId, url, tool);
    return on ? 'closed' : 'on';
  })().then(r => reply({ ok: r }), e => reply({ err: e.message }));
  return true;
});
// keep the options-gamma levels fresh while the AMD Range Model is open
chrome.alarms.create('gex', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(async () => {
  const { tabs = [] } = await chrome.storage.session.get('tabs'), keep = [];
  for (const id of tabs) { try { const on = await isOn(id); if (!on[3]) continue; await loadGex(id, false).catch(() => { }); keep.push(id); } catch (e) { } }
  await chrome.storage.session.set({ tabs: keep });
});
