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
  async function env() {
    const f = document.querySelector('iframe[id^="tradingview_"]');
    if (!f) throw new Error('Chart not found on this page');
    const w = f.contentWindow, api = w.tradingViewApi;
    if (!api || !api._chartApiInstance) throw new Error('Chart still loading…');
    const c = api.activeChart();
    const df = api._chartApiInstance._studyEngine._externalDatafeed;
    const sx = c.symbolExt() || {};
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
  P.style.cssText = `position:fixed;top:${TOOL.pos.top}px;right:${TOOL.pos.right}px;z-index:2147483000;width:290px;background:#11151c;color:#d6dbe4;font:12px/1.45 system-ui,Segoe UI,sans-serif;border:1px solid ${TOOL.color};border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.55);user-select:none`;
  const btn = 'background:#1e2430;color:#d6dbe4;border:1px solid #333b4a;border-radius:4px;cursor:pointer;font-size:11px;padding:1px 6px;margin-left:3px';
  P.innerHTML = `<div data-h style="display:flex;align-items:center;padding:6px 8px;cursor:move;background:${rgba(TOOL.color, .14)};border-bottom:1px solid #262d3a;border-radius:8px 8px 0 0"><b style="color:${TOOL.color};flex:1">${TOOL.title}</b><button data-a="r" style="${btn}" title="Refresh">↻</button><button data-a="m" style="${btn}" title="Minimize">–</button><button data-a="x" style="${btn}" title="Close and remove drawings">✕</button></div><div data-b style="padding:7px 9px;max-height:380px;overflow:auto;user-select:text">Loading…</div>`;
  document.body.appendChild(P);
  const body = P.querySelector('[data-b]');
  (() => { const h = P.querySelector('[data-h]'); let sx, sy, ox, oy, mv = false; h.addEventListener('mousedown', ev => { if (ev.target.tagName === 'BUTTON') return; mv = true; sx = ev.clientX; sy = ev.clientY; const r = P.getBoundingClientRect(); ox = r.left; oy = r.top; ev.preventDefault(); }); window.addEventListener('mousemove', ev => { if (!mv) return; P.style.left = (ox + ev.clientX - sx) + 'px'; P.style.top = (oy + ev.clientY - sy) + 'px'; P.style.right = 'auto'; }); window.addEventListener('mouseup', () => mv = false); })();

  let timer = null, busy = false, lastEnv = null, stopped = false;
  async function tick() {
    if (busy) return; busy = true;
    try {
      const e = await env(); lastEnv = e;
      const out = await TOOL.run(e, H);
      await render(e, out.draws || []);
      body.innerHTML = out.html + `<div style="margin-top:6px;color:#6b7385;font-size:10px">${e.sym} · updated ${new Date().toLocaleTimeString()} · auto every 30s</div>`;
    } catch (err) { body.innerHTML = `<span style="color:#ef5350">⚠ ${err.message}</span>`; }
    busy = false;
  }
  function stop() { stopped = true; clearInterval(timer); clearAll(lastEnv); P.remove(); delete window[SID]; }
  P.addEventListener('click', ev => { const a = ev.target.dataset && ev.target.dataset.a; if (a === 'r') tick(); if (a === 'x') stop(); if (a === 'm') body.style.display = body.style.display === 'none' ? '' : 'none'; });
  window[SID] = { stop, tick };

  // helpers exposed to tools
  const C = { bull: '#26a69a', bear: '#ef5350', dim: '#787b86', bsl: '#f5a623', ssl: '#42a5f5', entry: '#e0e0e0', sl: '#ef5350', tp: '#00e676' };
  const tday = ms => { const p = etp(ms); return p.h >= 18 ? addDays(p.day, 1) : p.day; };
  const H = { tday, etp, etMs, addDays, hhmm, bars, agg, range, takenAt, fvgs, swings, rbs, tapAt, cisdAt, C, rgba,
    fmt: (e, p) => p == null ? '–' : p.toLocaleString('en-US', { minimumFractionDigits: e.dec, maximumFractionDigits: e.dec }),
    rt: (e, p) => Math.round(p / e.tick) * e.tick,
    dirName: d => d > 0 ? 'Bullish' : 'Bearish',
    row: (label, val, col) => `<div style="display:flex;justify-content:space-between;gap:8px"><span style="color:#8a93a6">${label}</span><span style="color:${col || '#d6dbe4'};text-align:right">${val}</span></div>`,
    hdr: (t, col) => `<div style="margin:6px 0 2px;font-weight:600;color:${col || '#d6dbe4'}">${t}</div>` };

  tick(); timer = setInterval(tick, 30000);
};
