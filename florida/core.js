// claude_core — shared engine for PO3 Watch, Scriv Model and ICT Killzones (works on Vest + TopstepX)
window.__claudeCore = function (TOOL) {
  const SID = '__' + TOOL.key;
  if (window[SID]) { window[SID].stop(); return; }

  // ---------- time (ET) ----------
  const ETF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const etp = ms => { const o = {}; for (const p of ETF.formatToParts(new Date(ms))) o[p.type] = p.value; const h = +o.hour % 24, mi = +o.minute; return { y: +o.year, mo: +o.month, d: +o.day, h, mi, mins: h * 60 + mi, day: o.year + '-' + o.month + '-' + o.day }; };
  const etMs = (day, h, m) => { const [y, mo, d] = day.split('-').map(Number); const want = Date.UTC(y, mo - 1, d, h, m); let t = want; for (let k = 0; k < 2; k++) { const p = etp(t); t -= Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - want; } return t; };
  const addDays = (day, n) => { const [y, mo, d] = day.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10); };
  const hhmm = ms => { const p = etp(ms); return p.h + ':' + String(p.mi).padStart(2, '0'); };

  // ---------- chart access ----------
  const rcache = {};
  function resolve(df, names) {
    const key = names.join('|'); if (rcache[key]) return Promise.resolve(rcache[key]);
    return names.reduce((p, n) => p.then(r => r || new Promise(ok => { const tm = setTimeout(() => ok(null), 5000); try { df.resolveSymbol(n, si => { clearTimeout(tm); ok(si); }, () => { clearTimeout(tm); ok(null); }); } catch (x) { ok(null); } })), Promise.resolve(null)).then(r => (r && (rcache[key] = r), r));
  }
  const resMin = r => { r = String(r); if (/S$/.test(r)) return (parseInt(r) || 1) / 60; if (/D$/.test(r)) return 1440 * (parseInt(r) || 1); if (/W$/.test(r)) return 10080 * (parseInt(r) || 1); if (/M$/.test(r)) return 43200 * (parseInt(r) || 1); return parseInt(r) || 1; };
  // TradingView data client: one websocket, one chart session per symbol+timeframe, kept live by TradingView's updates
  function tvData(sym, res, n) {
    const D = window.__claudeTVD || (window.__claudeTVD = { ws: null, ready: null, ser: {}, byCs: {} });
    const send = (m, p) => { const t = JSON.stringify({ m, p }); D.ws.send('~m~' + t.length + '~m~' + t); };
    if (!D.ws || D.ws.readyState > 1) {
      D.ser = {}; D.byCs = {};
      D.ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket?from=chart%2F&type=chart');
      D.ready = new Promise((ok, no) => { D.ws.onopen = () => { send('set_auth_token', [(window.user && window.user.auth_token) || 'unauthorized_user_token']); ok(); }; D.ws.onerror = () => no(Error('TradingView data connection failed')); });
      D.ws.onclose = () => { D.ser = {}; D.byCs = {}; };
      D.ws.onmessage = ev => {
        for (const part of String(ev.data).split(/~m~\d+~m~/)) {
          if (!part) continue;
          if (part.startsWith('~h~')) { D.ws.send('~m~' + part.length + '~m~' + part); continue; }
          let j; try { j = JSON.parse(part); } catch (x) { continue; }
          const S = j.p && D.byCs[j.p[0]]; if (!S) continue;
          if (j.m === 'timescale_update' || j.m === 'du') { const d = j.p[1] && j.p[1].s1; if (d && d.s) for (const b of d.s) { const v = b.v; S.map.set(v[0] * 1000, { time: v[0] * 1000, open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0 }); } S.sorted = null; }
          if (j.m === 'series_completed' || j.m === 'symbol_error' || j.m === 'series_error') S.ok();
        }
      };
    }
    return D.ready.then(() => {
      const key = sym + '|' + res; let S = D.ser[key];
      if (!S || S.n < n) {
        if (S) { send('chart_delete_session', [S.cs]); delete D.byCs[S.cs]; }
        const cs = 'cs_' + Math.random().toString(36).slice(2, 14); S = D.ser[key] = { cs, n, map: new Map(), sorted: null }; D.byCs[cs] = S;
        S.done = new Promise(r => { S.ok = r; setTimeout(r, 10000); });
        send('chart_create_session', [cs, '']);
        send('resolve_symbol', [cs, 'sym', '=' + JSON.stringify({ symbol: sym, adjustment: 'splits', session: 'extended' })]);
        send('create_series', [cs, 's1', 's1', 'sym', res, n, '']);
      }
      return S.done.then(() => S.sorted || (S.sorted = [...S.map.values()].sort((a, b) => a.time - b.time)));
    });
  }
  function tvEnv() {
    const c = window.TradingViewApi.activeChart();
    let ms0 = {}; try { ms0 = window._exposed_chartWidgetCollection.activeChartWidget.value().model().mainSeries().symbolInfo() || {}; } catch (x) { }
    const sx = { ...ms0, ...Object.fromEntries(Object.entries(c.symbolExt() || {}).filter(([, v]) => v != null)) };   // tick size comes from the series' symbol info
    // continuous symbols (MNQ1!) → the real front contract (MNQZ2026), the same contract TopstepX charts — no back-adjustment
    const dsym = sx.front_contract ? c.symbol().split(':')[0] + ':' + sx.front_contract : c.symbol();
    const df = {
      resolveSymbol: (n, ok) => ok(sx),
      // Live bars for any timeframe straight from TradingView's own data feed (same real-time data as your chart)
      getBars: (si, res, p, ok) => {
        const want = resMin(res), n = Math.min(5000, Math.max(300, Math.ceil((p.to - p.from) / 60 / want) + 50));
        tvData(dsym, String(res), n).then(b => ok(b.filter(x => x.time >= p.from * 1000 && x.time <= p.to * 1000 + want * 60000)), () => ok([]));
      }
    };
    const tick = (sx.minmov || 1) / (sx.pricescale || 100), dec = Math.max(0, Math.round(Math.log10(sx.pricescale || 100)));
    return { c, df, si: sx, sym: c.symbol(), tick, dec, tv: true };
  }
  async function env() {
    const f = document.querySelector('iframe[id^="tradingview_"]');
    if (!f && window.TradingViewApi && window._exposed_chartWidgetCollection) return tvEnv();
    if (!f) throw new Error('Chart not found on this page');
    const w = f.contentWindow, api = w.tradingViewApi;
    if (!api || !api._chartApiInstance) throw new Error('Chart still loading…');
    const c = api.activeChart();
    const df = api._chartApiInstance._studyEngine._externalDatafeed;
    let ms0 = {}; try { ms0 = window._exposed_chartWidgetCollection.activeChartWidget.value().model().mainSeries().symbolInfo() || {}; } catch (x) { }
    const sx = { ...ms0, ...Object.fromEntries(Object.entries(c.symbolExt() || {}).filter(([, v]) => v != null)) };   // tick size comes from the series' symbol info
    const si = await resolve(df, [c.symbol(), sx.name, sx.full_name, sx.ticker].filter(Boolean)) || sx;
    const tick = (si.minmov || 1) / (si.pricescale || 100);
    const dec = Math.max(0, Math.round(Math.log10(si.pricescale || 100)));
    return { c, df, si, sym: c.symbol(), tick, dec };
  }
  function gb(e, res, from, to, first) {
    return new Promise(r => {
      let done = false; const fin = b => { if (!done) { done = true; clearTimeout(tm); r(b || []); } };
      const tm = setTimeout(() => fin([]), 12000);
      try { e.df.getBars(e.si, res, { from, to, countBack: 1000, firstDataRequest: first }, b => fin(b), () => fin([])); } catch (x) { fin([]); }
    });
  }
  async function bars(e, res, fromMs) {
    let to = Math.floor(Date.now() / 1000), all = [], first = true;
    for (let k = 0; k < 12; k++) {
      const b = await gb(e, res, Math.floor(fromMs / 1000), to, first); first = false;
      if (!b.length) break;
      all = b.concat(all);
      if (e.tv) break;
      const e0 = b[0].time; if (e0 <= fromMs) break;
      const nt = Math.floor(e0 / 1000) - 1; if (nt >= to) break; to = nt;
    }
    const m = new Map(); for (const x of all) m.set(x.time, x);
    return [...m.values()].sort((a, b) => a.time - b.time).filter(x => x.time >= fromMs)
      .map(x => ({ t: x.time, o: +x.open, h: +x.high, l: +x.low, c: +x.close }));
  }
  function agg(b, mins) {
    const ms = mins * 60000, out = []; let cur = null;
    for (const x of b) { const k = Math.floor(x.t / ms) * ms; if (!cur || cur.t !== k) { cur = { t: k, o: x.o, h: x.h, l: x.l, c: x.c }; out.push(cur); } else { if (x.h > cur.h) cur.h = x.h; if (x.l < cur.l) cur.l = x.l; cur.c = x.c; } }
    return out;
  }
  function range(b, t1, t2) {
    let r = null;
    for (const x of b) { if (x.t < t1 || x.t >= t2) continue; if (!r) r = { o: x.o, h: x.h, l: x.l, hT: x.t, lT: x.t }; if (x.h > r.h) { r.h = x.h; r.hT = x.t; } if (x.l < r.l) { r.l = x.l; r.lT = x.t; } }
    return r;
  }
  // first time after tFrom that price trades through p (side +1 = above, -1 = below)
  function takenAt(b, p, side, tFrom) { for (const x of b) { if (x.t < tFrom) continue; if (side > 0 ? x.h > p : x.l < p) return x.t; } return null; }

  // ---------- pattern detection ----------
  const bull = x => x.c > x.o, bear = x => x.c < x.o;
  function fvgs(b, tfMin) {
    const out = [];
    for (let i = 2; i < b.length; i++) {
      if (b[i].t - b[i - 2].t > 2 * tfMin * 60000) continue;   // skip gaps across session breaks / weekends
      let z = null;
      if (b[i - 2].h < b[i].l) z = { dir: 1, top: b[i].l, bot: b[i - 2].h };
      else if (b[i - 2].l > b[i].h) z = { dir: -1, top: b[i - 2].l, bot: b[i].h };
      if (!z) continue;
      z.t = b[i - 2].t; z.i = i; z.ready = b[i].t + tfMin * 60000; z.kind = 'FVG';
      out.push(z);
    }
    return out;
  }
  function swings(b, n = 2) {
    const out = [];
    for (let i = n; i < b.length - n; i++) {
      let hi = true, lo = true;
      for (let k = 1; k <= n; k++) { if (!(b[i].h > b[i - k].h && b[i].h >= b[i + k].h)) hi = false; if (!(b[i].l < b[i - k].l && b[i].l <= b[i + k].l)) lo = false; }
      if (hi) out.push({ side: 1, p: b[i].h, t: b[i].t, i });
      if (lo) out.push({ side: -1, p: b[i].l, t: b[i].t, i });
    }
    return out;
  }
  // rejection blocks: wick zone of a swing candle
  function rbs(b, tfMin) {
    const out = [];
    for (const s of swings(b, 2)) {
      const x = b[s.i], rng = x.h - x.l; if (rng <= 0) continue;
      if (s.side < 0) { const top = Math.min(x.o, x.c); if (top - x.l < rng * 0.3) continue; out.push({ dir: 1, top, bot: x.l, t: x.t, i: s.i, ready: b[s.i + 2].t + tfMin * 60000, kind: 'RB' }); }
      else { const bot = Math.max(x.o, x.c); if (x.h - bot < rng * 0.3) continue; out.push({ dir: -1, top: x.h, bot, t: x.t, i: s.i, ready: b[s.i + 2].t + tfMin * 60000, kind: 'RB' }); }
    }
    return out;
  }
  // tap = price returns to the zone's near edge after it is formed (b = fine bars)
  function tapAt(b, z) { for (const x of b) { if (x.t < z.ready) continue; if (z.dir > 0 ? x.l <= z.top : x.h >= z.bot) return x.t; } return null; }
  // CISD: close back through the open of the run of opposing candles into the extreme at index k
  function cisdAt(b, k, dir, deadline) {
    const opp = dir > 0 ? bear : bull;
    let j = k, back = 0; while (j >= 0 && !opp(b[j]) && back < 3) { j--; back++; }
    if (j < 0 || !opp(b[j])) return null;
    let s = j; while (s - 1 >= 0 && opp(b[s - 1])) s--;
    const lvl = b[s].o;
    for (let m = k; m < b.length && b[m].t < deadline; m++) {
      if (m > k && (dir > 0 ? b[m].l < b[k].l : b[m].h > b[k].h)) return null;
      if (dir > 0 ? b[m].c > lvl : b[m].c < lvl) return { lvl, idx: m, t: b[m].t, s, sT: b[s].t };
    }
    return null;
  }

  // ---------- drawing ----------
  const drawn = new Map(); let drawnSym = null;
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  const sig = i => JSON.stringify(i);
  async function mk(e, i) {
    const base = { lock: true, disableSelection: true, disableSave: true, disableUndo: true, showInObjectsTree: false, zOrder: 'top' };
    if (i.type === 'box') return e.c.createMultipointShape([{ time: i.t1 / 1000, price: i.top }, { time: i.t2 / 1000, price: i.bot }], { ...base, shape: 'rectangle', overrides: { color: i.col, backgroundColor: rgba(i.col, i.a == null ? 0.16 : i.a), linewidth: 1, text: i.label, showLabel: true, textColor: i.col, fontSize: 10, horzLabelsAlign: i.ha || 'left', vertLabelsAlign: i.va || 'top', extendRight: !!i.ext, bold: false, 'middleLine.showLine': !!i.mid, horzTextAlign: 'left' } });
    if (i.type === 'line' && !i.t2) return e.c.createShape({ time: i.t1 / 1000, price: i.p }, { ...base, shape: i.full ? 'horizontal_line' : 'horizontal_ray', overrides: { linecolor: i.col, linewidth: i.w || 1, linestyle: i.style || 0, showLabel: true, text: i.label, textcolor: i.col, fontsize: 10, horzLabelsAlign: i.ha || 'right', vertLabelsAlign: i.va || 'top', bold: !!i.bold } });
    if (i.type === 'line') return e.c.createMultipointShape([{ time: i.t1 / 1000, price: i.p }, { time: (i.t2 || i.t1 + 60000) / 1000, price: i.p }], { ...base, shape: i.t2 ? 'trend_line' : 'horizontal_ray', overrides: { linecolor: i.col, linewidth: i.w || 1, linestyle: i.style || 0, showLabel: true, text: i.label, textcolor: i.col, fontsize: 10, horzLabelsAlign: i.ha || 'right', vertLabelsAlign: i.va || 'top', bold: !!i.bold } });
  }
  function clearAll(e) { for (const d of drawn.values()) { try { e && e.c.removeEntity(d.id); } catch (x) { } } drawn.clear(); }
  async function render(e, items) {
    if (drawnSym !== e.sym) { clearAll(e); drawnSym = e.sym; }
    const want = new Map(items.map(i => [i.k, i]));
    for (const [k, d] of [...drawn]) { const i = want.get(k); if (!i || sig(i) !== d.sig) { try { e.c.removeEntity(d.id); } catch (x) { } drawn.delete(k); } }
    for (const i of items) { if (stopped) return; if (drawn.has(i.k)) continue; try { const id = await mk(e, i); if (stopped) { try { e.c.removeEntity(id); } catch (x) { } return; } if (id && i.type === 'box' && !i.mid) { try { e.c.getShapeById(id).setProperties({ middleLine: { showLine: false } }); } catch (x) { } } if (id) drawn.set(i.k, { id, sig: sig(i) }); } catch (x) { } }
  }

  // ---------- panel ----------
  const P = document.createElement('div');
  const TH = TOOL.theme || null;
  if (TH) P.style.cssText = `position:fixed;top:${TOOL.pos.top}px;right:${TOOL.pos.right}px;z-index:2147483000;width:310px;height:min(640px,82vh);min-width:260px;min-height:220px;display:flex;flex-direction:column;resize:both;overflow:hidden;background:linear-gradient(160deg,rgba(255,255,255,.10) 0%,rgba(255,255,255,.03) 40%,rgba(0,0,0,.10) 100%);backdrop-filter:blur(3px) saturate(150%) brightness(.9);-webkit-backdrop-filter:blur(3px) saturate(150%) brightness(.9);text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 6px rgba(0,0,0,.45);color:#ececf0;font:12px/1.5 -apple-system,'SF Pro Text','Segoe UI',system-ui,sans-serif;border:1px solid rgba(255,255,255,.22);border-radius:22px;box-shadow:0 18px 50px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.35),inset 0 -1px 0 rgba(255,255,255,.06),inset 0 0 0 1px rgba(255,255,255,.04);user-select:none`;
  else P.style.cssText = `position:fixed;top:${TOOL.pos.top}px;right:${TOOL.pos.right}px;z-index:2147483000;width:290px;background:#11151c;color:#d6dbe4;font:12px/1.45 system-ui,Segoe UI,sans-serif;border:1px solid ${TOOL.color};border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.55);user-select:none`;
  const btn = 'background:#1e2430;color:#d6dbe4;border:1px solid #333b4a;border-radius:4px;cursor:pointer;font-size:11px;padding:1px 6px;margin-left:3px';
  if (TH) P.innerHTML = `<style>.c23 ::-webkit-scrollbar{width:6px}.c23 ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:3px}.c23 ::-webkit-scrollbar-track{background:transparent}.c23 [data-a]{background:rgba(255,255,255,.07);color:#d6d6dc;border:1px solid rgba(255,255,255,.12);border-radius:50%;cursor:pointer;font-size:10px;width:22px;height:22px;padding:0;margin-left:5px;backdrop-filter:blur(8px)}.c23 [data-a]:hover{background:rgba(255,255,255,.16);color:#fff}.c23.mini23>*:not([data-h]){display:none!important}.c23.mini23 [data-h]>*:not(img){display:none!important}.c23.mini23 [data-h]{padding:0!important;height:100%;display:flex;align-items:center;justify-content:center;cursor:pointer}.c23.mini23 [data-h] img{height:66px!important;margin:0!important}.c23.mini23{border-radius:0!important;resize:none!important;min-width:0!important;min-height:0!important;padding:0!important;background:transparent!important;border:none!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;overflow:visible!important}.c23.mini23 [data-h]{background:radial-gradient(ellipse 26px 6px at 50% 94%,rgba(0,0,0,.55),rgba(0,0,0,0) 75%)!important}.c23.mini23::before,.c23.mini23::after{display:none!important}.c23.mini23:hover [data-h] img{transform:scale(1.06)}.c23.fade23>*:not([data-h]),.c23.fade23 [data-h]>*:not(img){opacity:0!important;transition:opacity .16s ease}
.c23 [data-x23]{position:absolute;top:5px;right:6px;width:16px;height:16px;border-radius:50%;background:rgba(20,20,24,.75);border:1px solid rgba(255,255,255,.28);color:#e6e6ea;font-size:9px;line-height:14px;text-align:center;cursor:pointer;opacity:0;transition:opacity .15s;z-index:3}.c23 .g23:hover [data-x23]{opacity:1}.c23 [data-x23]:hover{background:rgba(239,83,80,.85)}.c23 .g23{position:relative;background:linear-gradient(180deg,rgba(255,255,255,.07),rgba(255,255,255,.02));border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:8px 11px;margin:9px 0;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}</style><div style="position:absolute;inset:0 0 auto 0;height:120px;border-radius:22px 22px 0 0;background:linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,0));pointer-events:none"></div><div data-h style="position:relative;flex:0 0 auto;padding:12px 10px 6px;cursor:move;text-align:center"><div style="position:absolute;top:10px;right:12px;display:flex;z-index:2"><button data-a="r" title="Refresh">\u21bb</button><button data-a="m" title="Minimize">\u2013</button><button data-a="x" title="Close and remove drawings">\u2715</button></div><img src="${TH.logo}" alt="" draggable="false" style="height:104px;display:block;margin:0 auto;pointer-events:none;image-rendering:auto;transform:translateZ(0);backface-visibility:hidden"><div style="margin-top:6px;font:800 16px/1 -apple-system,'SF Pro Display','Segoe UI',system-ui,sans-serif;letter-spacing:5px;text-transform:uppercase;background:linear-gradient(180deg,#ffffff 0%,#dcdce2 40%,#7c7c84 53%,#cfcfd6 72%,#f6f6f8 100%);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.9))">${TOOL.title}</div><div style="height:1px;margin:9px 26px 0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent)"></div></div><div data-b style="position:relative;flex:1 1 auto;min-height:0;padding:2px 12px 12px;overflow:auto;user-select:text">Loading\u2026</div><div style="position:absolute;right:7px;bottom:6px;width:12px;height:12px;pointer-events:none;opacity:.45;background:linear-gradient(135deg,transparent 0 45%,#fff 45% 52%,transparent 52% 65%,#fff 65% 72%,transparent 72%)"></div>`;
  else P.innerHTML = `<div data-h style="display:flex;align-items:center;padding:6px 8px;cursor:move;background:${rgba(TOOL.color, .14)};border-bottom:1px solid #262d3a;border-radius:8px 8px 0 0"><b style="color:${TOOL.color};flex:1">${TOOL.title}</b><button data-a="r" style="${btn}" title="Refresh">↻</button><button data-a="m" style="${btn}" title="Minimize">–</button><button data-a="x" style="${btn}" title="Close and remove drawings">✕</button></div><div data-b style="padding:7px 9px;max-height:380px;overflow:auto;user-select:text">Loading…</div>`;
  document.body.appendChild(P);
  if (TH) { P.classList.add('c23');
    // remember the size you drag it to
    try { const z = JSON.parse(localStorage.getItem('claude_size_' + TOOL.key) || 'null'); if (z && z.w >= 200 && z.h >= 150) { P.style.width = z.w + 'px'; P.style.height = z.h + 'px'; } } catch (x) { }
    new ResizeObserver(() => { try { if (!P.isConnected || P.offsetWidth < 200 || P.querySelector('[data-b]').style.display === 'none' || P.classList.contains('mini23') || P.dataset.anim) return; localStorage.setItem('claude_size_' + TOOL.key, JSON.stringify({ w: P.offsetWidth, h: P.offsetHeight })); } catch (x) { } }).observe(P);
  }
  const body = P.querySelector('[data-b]');
  (() => { const h = P.querySelector('[data-h]'); let sx, sy, ox, oy, mv = false; h.addEventListener('mousedown', ev => { if (ev.target.tagName === 'BUTTON') return; mv = true; sx = ev.clientX; sy = ev.clientY; const r = P.getBoundingClientRect(); ox = r.left; oy = r.top; ev.preventDefault(); }); window.addEventListener('mousemove', ev => { if (!mv) return; P.style.left = (ox + ev.clientX - sx) + 'px'; P.style.top = (oy + ev.clientY - sy) + 'px'; P.style.right = 'auto'; }); window.addEventListener('mouseup', () => mv = false); })();

  let timer = null, busy = false, lastEnv = null, stopped = false; const hidden = new Set();
  async function tick() {
    if (busy) return; busy = true;
    try {
      const e = await env(); lastEnv = e;
      const out = await TOOL.run(e, H);
      await render(e, out.draws || []);
      body.innerHTML = out.html + `<div style="margin-top:8px;color:${TH ? '#5f5f66' : '#6b7385'};font-size:10px;${TH ? 'text-align:center;letter-spacing:.3px' : ''}">${e.sym} · updated ${new Date().toLocaleTimeString()} · auto every 30s</div>`;
    } catch (err) { body.innerHTML = `<span style="color:#ef5350">⚠ ${err.message}</span>`; }
    busy = false;
  }
  function stop() { stopped = true; clearInterval(timer); clearAll(lastEnv); P.remove(); delete window[SID]; }
  P.addEventListener('click', ev => { const xb = ev.target.closest && ev.target.closest('[data-x23]'); if (xb) { const cd = xb.closest('.g23'); if (cd) { hidden.add(cd.dataset.cid); cd.remove(); } return; } const a = ev.target.dataset && ev.target.dataset.a; if (a === 'r') { hidden.clear(); tick(); } if (a === 'x') stop(); if (a === 'm' && TH) { shrink23(); return; } if (a === 'm') { const hide = body.style.display !== 'none'; body.style.display = hide ? 'none' : ''; if (TH) { if (hide) { P.dataset.h = P.style.height; P.style.height = 'auto'; P.style.minHeight = '0'; P.style.resize = 'none'; } else { P.style.height = P.dataset.h || ''; P.style.minHeight = '220px'; P.style.resize = 'both'; } } } });
  // ---- 23 Model: shrink into the spinning logo, click the logo to bring it back
  let saved23 = null, down23 = null;
  P.addEventListener('mousedown', ev => { down23 = { x: ev.clientX, y: ev.clientY }; }, true);
  const EASE = 'cubic-bezier(.22,1,.36,1)';
  function shrink23() {
    if (P.classList.contains('mini23') || P.dataset.anim) return; P.dataset.anim = '1';
    const r = P.getBoundingClientRect(), img = P.querySelector('[data-h] img'), lr = img ? img.getBoundingClientRect() : r, S = 88;
    saved23 = { w: Math.max(260, r.width), h: Math.max(220, r.height), l: r.left, t: r.top };
    P.style.left = r.left + 'px'; P.style.top = r.top + 'px'; P.style.right = 'auto';
    P.classList.add('fade23');
    setTimeout(() => {
      const L = Math.max(4, lr.left + lr.width / 2 - S / 2), T = Math.max(4, lr.top + lr.height / 2 - S / 2);
      P.classList.add('mini23'); P.classList.remove('fade23');
      Object.assign(P.style, { width: S + 'px', height: S + 'px', left: L + 'px', top: T + 'px' });
      P.animate([{ width: r.width + 'px', height: r.height + 'px', left: r.left + 'px', top: r.top + 'px', borderRadius: '22px' },
                 { width: S + 'px', height: S + 'px', left: L + 'px', top: T + 'px', borderRadius: '50%' }], { duration: 520, easing: EASE });
      const im = P.querySelector('[data-h] img'); if (im) im.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(.9)' }, { transform: 'scale(1)' }], { duration: 620, easing: EASE });
      setTimeout(() => delete P.dataset.anim, 540);
    }, 170);
  }
  function grow23() {
    if (!P.classList.contains('mini23') || P.dataset.anim || !saved23) return; P.dataset.anim = '1';
    const r = P.getBoundingClientRect(), z = saved23;
    const W = Math.min(z.w, innerWidth - 8), Hh = Math.min(z.h, innerHeight - 8);
    const cl = (v, a, b) => Math.max(a, Math.min(v, Math.max(a, b)));
    const L = cl(r.left + r.width / 2 - W / 2, 4, innerWidth - W - 4), T = cl(r.top, 4, innerHeight - Hh - 4);
    P.classList.remove('mini23'); P.classList.add('fade23');
    Object.assign(P.style, { width: W + 'px', height: Hh + 'px', left: L + 'px', top: T + 'px' });
    P.animate([{ width: r.width + 'px', height: r.height + 'px', left: r.left + 'px', top: r.top + 'px', borderRadius: '50%' },
               { width: W + 'px', height: Hh + 'px', left: L + 'px', top: T + 'px', borderRadius: '22px' }], { duration: 560, easing: EASE });
    setTimeout(() => { P.classList.remove('fade23'); delete P.dataset.anim; }, 600);
  }
  P.addEventListener('click', ev => {
    if (!P.classList.contains('mini23')) return;
    if (down23 && Math.hypot(ev.clientX - down23.x, ev.clientY - down23.y) > 4) return;   // that was a drag, not a click
    ev.stopPropagation(); grow23();
  }, true);
  window[SID] = { stop, tick };

  // helpers exposed to tools
  const C = { bull: '#26a69a', bear: '#ef5350', dim: '#787b86', bsl: '#f5a623', ssl: '#42a5f5', entry: '#e0e0e0', sl: '#ef5350', tp: '#00e676' };
  const tday = ms => { const p = etp(ms); return p.h >= 18 ? addDays(p.day, 1) : p.day; };
  function gexLevels(o, SN, R, hasQ, useGm) {
    const bs = (s, q) => { if (!q.iv) return 0; const v = q.iv * Math.sqrt(q.T), d1 = (Math.log(s / q.K) + q.iv * q.iv * q.T / 2) / v; return Math.exp(-d1 * d1 / 2) / 2.5066 / (s * v); };
    const dg = (q, x) => { const s = x / q.sc; return (useGm && x === SN && q.gm > 0 ? q.gm : bs(s, q)) * q.oi * s * s; };
    const st = hasQ ? R : 25, B = new Map;
    for (const q of o) { const v = dg(q, SN), Kn = q.K * q.sc, i = Math.round(Kn / st), r = B.get(i) || { w: 0, kw: 0, c: 0, p: 0 }; q.c ? r.c += v : r.p += v; r.w += v; r.kw += v * Kn; B.set(i, r); }
    const k = [...B.values()].filter(r => r.w > 0).map(r => ({ K: Math.round(r.kw / r.w / 5) * 5, c: r.c, p: r.p })).filter(r => r.K > SN * .9 && r.K < SN * 1.1);
    if (!k.length) return { cw: null, pw: null, flip: null, piv: [], regime: '—' };
    const cw = k.reduce((a, r) => r.c > a.c ? r : a).K, pw = k.reduce((a, r) => r.p > a.p ? r : a).K, n = x => o.reduce((a, q) => a + (q.c ? 1 : -1) * dg(q, x), 0);
    let f = null, P = null;
    for (let x = SN * .94; x <= SN * 1.06; x += SN * .001) { const v = n(x); if (P && Math.sign(v) != Math.sign(P.v)) { const z = P.x + (x - P.x) * Math.abs(P.v) / (Math.abs(P.v) + Math.abs(v)); if (f == null || Math.abs(z - SN) < Math.abs(f - SN)) f = z; } P = { x, v }; }
    const pv = [];
    for (const r of k.map(r => ({ K: r.K, n: r.c - r.p })).sort((a, b) => Math.abs(b.n) - Math.abs(a.n))) if (pv.length < 2 && Math.abs(r.K - cw) > SN * .002 && Math.abs(r.K - pw) > SN * .002 && Math.abs(r.K - SN) < SN * .03 && !pv.some(q => Math.abs(q - r.K) < SN * .002)) pv.push(r.K);
    return { cw, pw, flip: f == null ? null : Math.round(f), piv: pv, regime: n(SN) >= 0 ? 'Positive' : 'Negative' };
  }
  const H = { tday, etp, etMs, addDays, hhmm, bars, agg, range, takenAt, fvgs, swings, rbs, tapAt, cisdAt, C, rgba, gexLevels,
    fmt: (e, p) => p == null ? '–' : p.toLocaleString('en-US', { minimumFractionDigits: e.dec, maximumFractionDigits: e.dec }),
    rt: (e, p) => Math.round(p / e.tick) * e.tick,
    dirName: d => d > 0 ? 'Bullish' : 'Bearish',
    row: (label, val, col) => TH ? `<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.08)"><span style="color:#c4c4cc">${label}</span><span style="color:${col || '#ececef'};text-align:right;font-weight:500">${val}</span></div>`
      : `<div style="display:flex;justify-content:space-between;gap:8px"><span style="color:#8a93a6">${label}</span><span style="color:${col || '#d6dbe4'};text-align:right">${val}</span></div>`,
    card: (title, inner, col, id) => TH ? (hidden.has(id || title || 'card') ? '' : `<div class="g23" data-cid="${String(id || title || 'card').replace(/"/g, '')}"><span data-x23 title="Remove (Refresh brings it back)">✕</span>${title ? `<div style="font-weight:700;font-size:10.5px;letter-spacing:1.4px;text-transform:uppercase;color:${col || '#bdbdc6'};margin-bottom:4px">${title}</div>` : ''}${inner}</div>`) : (title ? `<div style="margin:6px 0 2px;font-weight:600;color:${col || '#d6dbe4'}">${title}</div>` : '') + inner,
    hdr: (t, col) => TH ? `<div style="margin:10px 0 4px;font-weight:700;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:${col || '#c8c8ce'}">${t}</div>`
      : `<div style="margin:6px 0 2px;font-weight:600;color:${col || '#d6dbe4'}">${t}</div>` };


  // ================= 23 Model licensing / login / admin =================
  const LIC = { url: 'https://23model.concretedigital1.workers.dev' };   // set to the Apps Script /exec URL to turn the paywall on; empty = open (current behaviour)
  function startTool() { tick(); timer = setInterval(tick, 30000); }
  if (!TH || !TOOL.license || !LIC.url) { startTool(); return; }

  const jsonp = (params) => new Promise(res => {
    const cb = '__lic' + Math.random().toString(36).slice(2, 9);
    const t = setTimeout(() => { try { delete window[cb]; sc.remove(); } catch (x) { } res({ ok: false, status: 'offline', msg: 'Could not reach the server.' }); }, 12000);
    window[cb] = d => { clearTimeout(t); try { delete window[cb]; sc.remove(); } catch (x) { } res(d); };
    const q = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
    const sc = document.createElement('script'); sc.src = LIC.url + '?' + q + '&cb=' + cb; sc.onerror = () => window[cb]({ ok: false, status: 'offline', msg: 'Could not reach the server.' }); document.head.appendChild(sc);
  });
  const deviceId = () => { try { let d = localStorage.getItem('claude_lic_dev'); if (!d) { d = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem('claude_lic_dev', d); } return d; } catch (x) { return 'd0'; } };
  const platform = () => /tradingview/.test(location.host) ? 'TradingView' : /vest/.test(location.host) ? 'Vest' : /topstep/.test(location.host) ? 'TopstepX' : location.host;
  const getKey = () => { try { return localStorage.getItem('claude_lickey') || ''; } catch (x) { return ''; } };
  const setKey = k => { try { k ? localStorage.setItem('claude_lickey', k) : localStorage.removeItem('claude_lickey'); } catch (x) { } };
  const check = k => jsonp({ action: 'check', key: k, device: deviceId(), platform: platform() });

  let licUser = null, dashOn = false;
  const bodyEl = P.querySelector('[data-b]');
  const screen = html => { bodyEl.innerHTML = html; };

  const loginScreen = (msg) => {
    screen(`<div style="padding:10px 2px 6px;text-align:center">
      <div style="font-weight:700;letter-spacing:2px;color:#cfcfd6;margin-bottom:10px">MEMBER ACCESS</div>
      <input id="lic_k" placeholder="Enter your key" autocomplete="off" style="width:100%;box-sizing:border-box;text-align:center;letter-spacing:1px;font:600 13px ui-monospace,monospace;padding:11px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#fff;outline:none">
      <div id="lic_m" style="min-height:16px;margin:8px 0;font-size:11px;color:${msg && msg.err ? '#ff8a8a' : '#9ad0a0'}">${msg ? msg.t : ''}</div>
      <button id="lic_go" style="width:100%;padding:11px;border-radius:12px;border:none;cursor:pointer;font-weight:800;letter-spacing:1px;background:linear-gradient(180deg,#fff,#d7d7dd);color:#111">UNLOCK</button>
      <button id="lic_req" style="width:100%;margin-top:7px;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.18);cursor:pointer;background:transparent;color:#c9c9d0;font-weight:600">Request a key</button>
    </div>`);
    const kin = bodyEl.querySelector('#lic_k'), mm = bodyEl.querySelector('#lic_m');
    kin.value = getKey(); setTimeout(() => kin.focus(), 50);
    const submit = async () => { const k = kin.value.trim(); if (!k) return; mm.style.color = '#c9c9d0'; mm.textContent = 'Checking…'; const r = await check(k); if (r.ok) { setKey(k); licUser = r; gateOk(); } else { mm.style.color = '#ff8a8a'; mm.textContent = r.msg || 'Invalid key.'; } };
    bodyEl.querySelector('#lic_go').onclick = submit;
    kin.onkeydown = ev => { if (ev.key === 'Enter') submit(); };
    bodyEl.querySelector('#lic_req').onclick = requestScreen;
  };
  const requestScreen = () => {
    screen(`<div style="padding:10px 2px 6px">
      <div style="font-weight:700;letter-spacing:2px;color:#cfcfd6;text-align:center;margin-bottom:10px">REQUEST A KEY</div>
      <label style="font-size:11px;color:#9a9aa4">Discord username</label>
      <input id="rq_d" placeholder="yourname" style="width:100%;box-sizing:border-box;margin:3px 0 9px;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#fff;outline:none">
      <label style="font-size:11px;color:#9a9aa4">Date you bought</label>
      <input id="rq_b" type="date" style="width:100%;box-sizing:border-box;margin:3px 0 9px;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#fff;outline:none">
      <div id="rq_m" style="min-height:16px;font-size:11px;color:#9ad0a0"></div>
      <button id="rq_go" style="width:100%;padding:11px;border-radius:12px;border:none;cursor:pointer;font-weight:800;letter-spacing:1px;background:linear-gradient(180deg,#fff,#d7d7dd);color:#111">SEND REQUEST</button>
      <button id="rq_back" style="width:100%;margin-top:7px;padding:9px;border-radius:12px;border:1px solid rgba(255,255,255,.18);cursor:pointer;background:transparent;color:#c9c9d0">Back</button>
    </div>`);
    const mm = bodyEl.querySelector('#rq_m');
    bodyEl.querySelector('#rq_go').onclick = async () => { const d = bodyEl.querySelector('#rq_d').value.trim(), b = bodyEl.querySelector('#rq_b').value; if (d.length < 2) { mm.style.color = '#ff8a8a'; mm.textContent = 'Enter your Discord username.'; return; } mm.style.color = '#c9c9d0'; mm.textContent = 'Sending…'; const r = await jsonp({ action: 'signup', discord: d, bought: b }); mm.style.color = r.ok ? '#9ad0a0' : '#ff8a8a'; mm.textContent = r.msg || (r.ok ? 'Sent.' : 'Failed.'); };
    bodyEl.querySelector('#rq_back').onclick = () => loginScreen();
  };
  const lockedScreen = (r) => {
    screen(`<div style="padding:18px 6px;text-align:center">
      <div style="font-size:30px;margin-bottom:6px">🔒</div>
      <div style="font-weight:700;color:#fff;margin-bottom:4px">${r.status === 'expired' ? 'Subscription ended' : r.status === 'device' ? 'Key in use elsewhere' : 'Access unavailable'}</div>
      <div style="color:#9a9aa4;font-size:12px;margin-bottom:12px">${r.msg || ''}</div>
      <button id="lk_renew" style="padding:10px 18px;border-radius:12px;border:none;cursor:pointer;font-weight:700;background:linear-gradient(180deg,#fff,#d7d7dd);color:#111">Renew / new key</button>
    </div>`);
    bodyEl.querySelector('#lk_renew').onclick = () => { setKey(''); loginScreen(); };
  };

  // once a valid key is in, run the tool and add the account chip (+ admin dashboard button)
  function gateOk() {
    accountChip();
    if (licUser.admin) adminButton();
    watermark();
    startTool();
    setInterval(async () => { const r = await check(getKey()); if (!r.ok) { clearInterval(timer); licUser = null; lockedScreen(r); } }, 60000);
  }
  function accountChip() {
    const hd = P.querySelector('[data-h]'); if (!hd || hd.querySelector('[data-acct]')) return;
    const c = document.createElement('div'); c.dataset.acct = '1';
    c.style.cssText = 'position:absolute;bottom:6px;left:12px;font-size:9.5px;color:#9a9aa4;letter-spacing:.3px';
    c.textContent = licUser.admin ? 'ADMIN' : (licUser.name || 'Member') + ' · ' + licUser.daysLeft + 'd left';
    hd.appendChild(c);
  }
  function watermark() {
    if (licUser.admin) return;
    const w = document.createElement('div');
    w.style.cssText = 'position:absolute;inset:0;z-index:40;pointer-events:none;display:flex;align-items:center;justify-content:center;opacity:.06;font:800 20px system-ui;color:#fff;transform:rotate(-24deg);white-space:nowrap;overflow:hidden';
    w.textContent = (licUser.name || 'member') + '  ·  ' + (licUser.name || 'member');
    P.appendChild(w);
  }
  function adminButton() {
    const add = () => { const box = P.querySelector('[data-h] [data-m="NY"]'); if (!box) return setTimeout(add, 400); const bar = box.parentElement; if (bar.querySelector('[data-dash]')) return;
      const b = document.createElement('button'); b.dataset.dash = '1'; b.textContent = 'DASHBOARD'; b.className = ''; b.style.cssText = 'font:800 10px system-ui;letter-spacing:1px;padding:5px 9px;border-radius:10px;border:1px solid rgba(255,214,130,.5);background:rgba(255,198,92,.14);color:#ffd76e;cursor:pointer;margin-left:6px';
      b.onclick = ev => { ev.stopPropagation(); dashOn = !dashOn; b.style.background = dashOn ? 'rgba(255,198,92,.4)' : 'rgba(255,198,92,.14)'; if (dashOn) { clearInterval(timer); renderDash(); } else { startTool(); } };
      bar.appendChild(b); };
    add();
  }
  async function renderDash() {
    if (!dashOn) return;
    screen('<div style="padding:16px;text-align:center;color:#9a9aa4">Loading dashboard…</div>');
    const r = await jsonp({ action: 'admin', s: getKey() });
    if (!dashOn) return;
    if (!r.ok) { screen('<div style="padding:16px;color:#ff8a8a">Admin only.</div>'); return; }
    const chip = (lab, val, col) => `<div style="flex:1;min-width:70px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:8px 10px"><div style="font-size:9px;color:#8a8a92;text-transform:uppercase;letter-spacing:.5px">${lab}</div><div style="font:800 17px system-ui;color:${col}">${val}</div></div>`;
    const stcol = s => s === 'active' ? '#5fe0a1' : s === 'pending' ? '#e8c46a' : '#ff8a8a';
    const abtn = (k, what, lab, col, extra) => `<button data-k="${k}" data-what="${what}"${extra || ''} style="font:700 10px system-ui;padding:3px 7px;margin:2px 3px 0 0;border-radius:7px;border:1px solid ${col};background:transparent;color:${col};cursor:pointer">${lab}</button>`;
    const rows = r.users.map(u => `<div style="padding:7px 0;border-bottom:1px solid rgba(255,255,255,.07)">
      <div style="display:flex;justify-content:space-between;align-items:center"><span style="color:#ececf0;font-weight:600">${u.online ? '🟢 ' : ''}${u.discord || '(no name)'}</span><span style="color:${stcol(u.status)};font-size:11px;font-weight:700">${u.status}${u.status === 'active' ? ' · ' + u.daysLeft + 'd' : ''}</span></div>
      <div style="color:#7e7e88;font-size:10px;margin:1px 0 2px">${u.key} · ${u.platform || '—'}${u.bought ? ' · bought ' + u.bought : ''}</div>
      <div>${u.status === 'pending' ? abtn(u.key, 'approve', 'Approve', '#5fe0a1') + abtn(u.key, 'deny', 'Deny', '#ff8a8a') : abtn(u.key, 'extend', '+30d', '#8fb4ff') + (u.status === 'revoked' ? abtn(u.key, 'unban', 'Unban', '#5fe0a1') : abtn(u.key, 'ban', 'Ban', '#ff8a8a')) + (u.device ? abtn(u.key, 'reset', 'Reset device', '#b0b0b8') : '')}</div>
    </div>`).join('');
    screen(`<div style="display:flex;gap:6px;margin-bottom:10px">${chip('Online', r.online, '#5fe0a1')}${chip('Active', r.active, '#fff')}${chip('Pending', r.pending, '#e8c46a')}${chip('Revenue', '$' + r.revenue, '#5fe0a1')}</div>
      <div style="font-weight:700;font-size:10.5px;letter-spacing:1px;color:#c8c8ce;margin-bottom:4px">USERS</div>${rows || '<div style="color:#8a8a92">No users yet.</div>'}`);
    bodyEl.querySelectorAll('[data-what]').forEach(btn => btn.onclick = async () => { btn.textContent = '…'; let days = ''; if (btn.dataset.what === 'approve' || btn.dataset.what === 'extend') days = '&days=30'; await jsonp({ action: 'act', s: getKey(), key: btn.dataset.k, what: btn.dataset.what }); renderDash(); });
  }

  // boot the gate
  (async () => { const k = getKey(); if (!k) { loginScreen(); return; } const r = await check(k); if (r.ok) { licUser = r; gateOk(); } else { loginScreen({ t: r.msg || '', err: true }); } })();
};
