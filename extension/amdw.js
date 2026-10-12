// claude_amdw — AMD Range Model (map mode): always shows the confluences, no trade signals.
// Options GEX levels (call wall, put wall, gamma flip), FVGs, IFVGs, OBs, RBs, Powell key opens + KO RBs, recent CISDs. Chart timeframe.
// NQ gamma: receive levels from the CBOE tab (sent by the 'GEX Update' bookmark), and open that tab when levels are stale
if (!window.__claudeGexListen) { window.__claudeGexListen = 1; window.addEventListener('message', ev => { if (!/^https:\/\/[\w.-]*cboe\.com$/.test(ev.origin) || !ev.data || ev.data.type !== 'claude_gex') return; localStorage.setItem('claude_gex_raw', JSON.stringify({ ...ev.data, at: Date.now() })); window.__claude_amdw && window.__claude_amdw.tick(); }); }
if (!window.__claude_amdw) { try { const sy = document.querySelector('iframe[id^="tradingview_"]').contentWindow.tradingViewApi.activeChart().symbol().toUpperCase(); const raw = JSON.parse(localStorage.getItem('claude_gex_raw') || 'null'); if (/NQ|NDX|NAS/.test(sy) && (!raw || !raw.src || Date.now() - raw.at > 6 * 3600e3)) window.open('https://cdn.cboe.com/api/global/delayed_quotes/options/_NDX.json', 'claude_cboe'); } catch (x) { } }
window.__claudeCore({
  key: 'claude_amdw', title: 'AMD Range Model', color: '#26c6da', pos: { top: 330, right: 330 },
  run: async function (e, H) {
    const { etMs, addDays, hhmm, C } = H;
    const res = e.c.resolution();
    const tfMin = /D/.test(res) ? 1440 * (parseInt(res) || 1) : /W/.test(res) ? 10080 : /S/.test(res) ? 1 : parseInt(res) || 1;
    const TF = tfMin >= 1440 ? (tfMin / 1440) + 'D' : tfMin >= 60 ? (tfMin / 60) + 'H' : tfMin + 'm';
    const bres = /S/.test(res) ? '1' : res, BM = tfMin * 60000;
    const b = (await H.bars(e, bres, Date.now() - Math.max(320 * BM, 3.5 * 864e5))).slice(-500);
    if (b.length < 40) return { html: 'Not enough ' + TF + ' data yet.', draws: [] };
    const day = H.tday(Date.now()), prev = addDays(day, -1), sod = etMs(prev, 18, 0);
    const m1 = bres === '1' ? b.filter(x => x.t >= sod) : await H.bars(e, '1', sod);
    const now = b.at(-1).t + BM, last = b.at(-1).c, fut = now + 25 * BM, draws = [];
    const near = (arr, n) => arr.sort((x, y) => Math.abs((x.top + x.bot) / 2 - last) - Math.abs((y.top + y.bot) / 2 - last)).slice(0, n);
    const brokeAt = (z, from) => { for (let i = from; i < b.length; i++) if (z.dir > 0 ? b[i].c < z.bot : b[i].c > z.top) return i; return -1; };
    const tapped = (z, from) => { for (let i = from; i < b.length; i++) if (z.dir > 0 ? b[i].l <= z.top : b[i].h >= z.bot) return true; return false; };

    // ATR
    const atr = []; let a = 0;
    for (let i = 0; i < b.length; i++) { const tr = i ? Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)) : b[i].h - b[i].l; a = i < 14 ? (a * i + tr) / (i + 1) : (a * 13 + tr) / 14; atr.push(a); }

    // ---- latest consolidation range + deviations
    // ---- options GEX levels (Deribit, BTC/ETH): call wall, put wall, gamma flip, biggest net-gamma strikes
    const gex = await (async () => {
      const sym = (e.si.name || e.sym || '').toUpperCase(), cur = /ETH/.test(sym) ? 'ETH' : /BTC|XBT/.test(sym) ? 'BTC' : null;
      if (!cur) { let m = null, raw = null; try { m = JSON.parse(localStorage.getItem('claude_gex_nq')); raw = JSON.parse(localStorage.getItem('claude_gex_raw')); } catch (x) { }
        if (raw && /NQ|NDX|NAS/.test(sym) && (!m || m.rawAt !== raw.at)) {
          // NDX price time: ~15 min delayed in the cash session, otherwise the last 16:00 ET close → read NQ at that moment for the basis
          let ref = raw.ts - 15 * 60000; const p = H.etp(ref), wd = d => new Date(d + 'T12:00:00Z').getUTCDay();
          if (p.mins < 570 || p.mins >= 960 || wd(p.day) % 6 === 0) { let d = p.mins < 570 ? addDays(p.day, -1) : p.day; for (let k = 0; k < 4 && wd(d) % 6 === 0; k++) d = addDays(d, -1); ref = etMs(d, 16, 0) - 60000; }
          const nb = await H.bars(e, '1', ref - 10 * 60000), x = nb.filter(y => y.t <= ref).at(-1) || nb[0];
          if (x) { const basis = x.c - raw.S, r = q => H.rt(e, q + basis); m = { asof: new Date(raw.at).toLocaleString(), rawAt: raw.at, basis, callWall: r(raw.cw), putWall: r(raw.pw), flip: raw.flip == null ? null : r(raw.flip), pivots: raw.piv.map(r), regime: raw.regime, src: raw.src || 'NDX only (old method)', quoteAt: new Date(raw.ts).toLocaleString() }; localStorage.setItem('claude_gex_nq', JSON.stringify(m)); }
        }
        if (m && /NQ|NDX|NAS/.test(sym)) return { cur: 'NDX', snap: (m.quoteAt || m.asof), src: m.src, callWall: m.callWall, putWall: m.putWall, flip: m.flip, pivots: m.pivots, regime: m.regime }; return { err: 'No options-gamma levels loaded for ' + (e.sym || 'this symbol') }; }
      const ck = window.__claudeGex || (window.__claudeGex = {});
      if (!ck[cur] || Date.now() - ck[cur].at > 5 * 60000) {
        const [bs, ix] = await Promise.all([
          fetch('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=' + cur + '&kind=option').then(r => r.json()),
          fetch('https://www.deribit.com/api/v2/public/get_index_price?index_name=' + cur.toLowerCase() + '_usd').then(r => r.json())]);
        const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
        const opts = [];
        for (const o of bs.result || []) {
          const m = /^\w+-(\d{1,2})([A-Z]{3})(\d{2})-(\d+)-([CP])$/.exec(o.instrument_name); if (!m || !o.open_interest || !o.mark_iv) continue;
          const exp = Date.UTC(2000 + +m[3], MON[m[2]], +m[1], 8), T = (exp - Date.now()) / (365 * 864e5);
          if (T <= 0 || T > 60 / 365) continue;
          opts.push({ K: +m[4], call: m[5] === 'C', oi: o.open_interest, iv: o.mark_iv / 100, T });
        }
        ck[cur] = { at: Date.now(), S: ix.result.index_price, opts };
      }
      const { S, opts } = ck[cur];
      const gam = (s, o) => { const v = o.iv * Math.sqrt(o.T), d1 = (Math.log(s / o.K) + 0.5 * o.iv * o.iv * o.T) / v; return Math.exp(-d1 * d1 / 2) / Math.sqrt(2 * Math.PI) / (s * v); };
      const byK = new Map();
      for (const o of opts) { const g = gam(S, o) * o.oi * S * S * 0.01, r = byK.get(o.K) || { K: o.K, c: 0, p: 0 }; if (o.call) r.c += g; else r.p += g; byK.set(o.K, r); }
      const ks = [...byK.values()].filter(r => r.K > S * 0.8 && r.K < S * 1.2);
      if (!ks.length) return { err: 'No options data' };
      const callWall = ks.reduce((a, r) => r.c > a.c ? r : a).K, putWall = ks.reduce((a, r) => r.p > a.p ? r : a).K;
      const net = s => opts.reduce((a, o) => a + (o.call ? 1 : -1) * gam(s, o) * o.oi * s * s * 0.01, 0);
      let flip = null, prev = null;
      for (let s = S * 0.9; s <= S * 1.1; s += S * 0.0025) { const v = net(s); if (prev && Math.sign(v) !== Math.sign(prev.v)) { const f = prev.s + (s - prev.s) * Math.abs(prev.v) / (Math.abs(prev.v) + Math.abs(v)); if (flip == null || Math.abs(f - S) < Math.abs(flip - S)) flip = f; } prev = { s, v }; }
      const pivots = ks.map(r => ({ K: r.K, n: r.c - r.p })).sort((a, b) => Math.abs(b.n) - Math.abs(a.n)).filter(r => r.K !== callWall && r.K !== putWall).slice(0, 3).map(r => r.K);
      const off = last - S;   // map index price → this chart's price
      return { cur, S, off, callWall: callWall + off, putWall: putWall + off, flip: flip == null ? null : flip + off, pivots: pivots.map(k => k + off), regime: net(S) >= 0 ? 'Positive' : 'Negative' };
    })().catch(err => ({ err: 'GEX fetch failed: ' + err.message }));
    if (!gex.err) {
      const L = (k, p, col, label, w) => draws.push({ k: 'gex' + k, type: 'line', full: true, t1: b[0].t, p: H.rt(e, p), col, w: w || 2, style: 0, label: (p >= last ? 'S' : 'L') + ' · ' + label, ha: 'right', va: 'middle' });
      L('cw', gex.callWall, '#ef5350', 'Call Wall');
      L('pw', gex.putWall, '#26a69a', 'Put Wall');
      if (gex.flip != null) L('flip', gex.flip, '#ffca28', 'Gamma Flip');
      gex.pivots.forEach((p, n) => L('pv' + n, p, '#b0bec5', 'GEX Pivot', 1));
    }
    

    // ---- FVGs (unfilled) and IFVGs (closed through, not yet closed back)
    const atrOf = B => { const r = []; let v = 0; for (let i = 0; i < B.length; i++) { const tr = i ? Math.max(B[i].h - B[i].l, Math.abs(B[i].h - B[i - 1].c), Math.abs(B[i].l - B[i - 1].c)) : B[i].h - B[i].l; v = i < 14 ? (v * i + tr) / (i + 1) : (v * 13 + tr) / 14; r.push(v); } return r; };
    const brk = (B, z, from) => { for (let i = from; i < B.length; i++) if (z.dir > 0 ? B[i].c < z.bot : B[i].c > z.top) return i; return -1; };
    const fvgs = [], ifvgs = [], obs = [], rbs = [];
    // fresh = price has not traded back into the zone since it formed (checked on the zone's own TF and on the chart's bars)
    const touch = (z, x) => z.dir > 0 ? x.l <= z.top : x.h >= z.bot;
    const fresh = (z, B, from, readyT) => { for (let i = from; i < B.length; i++) if (touch(z, B[i])) return false; for (const x of b) if (x.t >= readyT && touch(z, x)) return false; return true; };
    const scan = (B, mins, L, ifvgOnly) => {
      const at = atrOf(B), MS = mins * 60000, Bc = B.length && B.at(-1).t + MS > Date.now() ? B.slice(0, -1) : B;   // closed candles only
      for (const z of H.fvgs(B, mins).filter(z => z.top - z.bot >= at[z.i] * 0.15)) {
        const br = brk(B, z, z.i + 1);
        if (br < 0) { if (!ifvgOnly && fresh({ dir: z.dir, top: z.dir > 0 ? (z.top + z.bot) / 2 : z.top, bot: z.dir > 0 ? z.bot : (z.top + z.bot) / 2 }, B, z.i + 1, B[z.i].t + MS)) fvgs.push({ ...z, L }); continue; }
        const iz = { dir: -z.dir, top: z.top, bot: z.bot, t: z.t, L, tInv: B[br].t + MS };
        if (fresh(iz, B, br + 1, B[br].t + MS)) ifvgs.push(iz);
      }
      if (ifvgOnly) return;
      for (const z of H.fvgs(B, mins)) {
        let k = z.i - 2; while (k >= 0 && k >= z.i - 6 && !(z.dir > 0 ? B[k].c < B[k].o : B[k].c > B[k].o)) k--;
        if (k < 0 || k < z.i - 6) continue;
        const ob = { dir: z.dir, top: B[k].h, bot: B[k].l, t: B[k].t, L };
        if (obs.some(o => o.t === ob.t && o.L === L)) continue;
        if (fresh(ob, B, z.i + 1, B[z.i].t + MS)) obs.push(ob);
      }
      for (const z of H.rbs(Bc, mins)) if (fresh(z, B, z.i + 3, z.ready)) rbs.push({ ...z, L });
    };
    // every timeframe, whatever chart you're on (1m: IFVG only)
    const TFS = [['1', 1, '1m', 1.2], ['5', 5, '5m', 3.5], ['15', 15, '15m', 6], ['60', 60, '1H', 20], ['240', 240, '4H', 60], ['1D', 1440, '1D', 300]];
    const TFB = {};
    for (const [r, mins, L, days] of TFS) {
      const B = (r === bres ? b : await H.bars(e, r, Date.now() - days * 864e5)).slice(-400);
      TFB[L] = B; if (B.length > 5) scan(B, mins, L, mins === 1);
    }
    
    const KO = [['18:00', 18, 0, prev], ['00:00', 0, 0], ['02:00', 2, 0], ['08:30', 8, 30], ['09:30', 9, 30], ['10:00', 10, 0], ['13:30', 13, 30]]
      .map(([n, h, m, d]) => { const t = etMs(d || day, h, m); const x = m1.find(y => y.t >= t && y.t < t + 60000); return x ? { n, t, p: x.o } : null; }).filter(Boolean);
    for (const k of KO) draws.push({ k: 'ko' + k.n + k.t, type: 'line', t1: k.t, t2: now, p: k.p, col: '#b0bec5', style: 1, label: k.n + ' Open', ha: 'left' });
    const korb = [];
    for (const [tf, mins] of [['5m', 5], ['15m', 15]]) {
      let bb = H.agg(m1, mins); if (bb.length && bb.at(-1).t + mins * 60000 > Date.now()) bb = bb.slice(0, -1);   // closed candles only
      for (const k of KO) for (const dir of [1, -1]) {
        let cur = null;
        for (const x of bb) {
          if (x.t < k.t) continue;
          if (cur && (dir < 0 ? x.h > cur.top : x.l < cur.bot)) cur = null;
          const rng = x.h - x.l, body = Math.abs(x.c - x.o), up = x.h - Math.max(x.o, x.c), dn = Math.min(x.o, x.c) - x.l;
          if (rng <= 0) continue;
          if (dir < 0 && x.h >= k.p && Math.max(x.o, x.c) < k.p && up >= 0.4 * rng && up >= body && up > dn && (!cur || x.h > cur.top)) cur = { tf, dir, ko: k.n, top: x.h, bot: Math.max(x.o, x.c), t: x.t };
          if (dir > 0 && x.l <= k.p && Math.min(x.o, x.c) > k.p && dn >= 0.4 * rng && dn >= body && dn > up && (!cur || x.l < cur.bot)) cur = { tf, dir, ko: k.n, top: Math.min(x.o, x.c), bot: x.l, t: x.t };
        }
        if (cur && fresh(cur, bb, (bb.findIndex(y => y.t > cur.t) + bb.length + 1) % (bb.length + 1), cur.t + mins * 60000)) korb.push(cur);
      }
    }
    // ---- merge stacked zones: overlapping zones in the same direction become one box with a combined label
    const RUN = /NQ|NDX|NAS/.test((e.sym || '').toUpperCase()) ? 30 : last * 30 / 31200, away = z => Math.max(0, z.bot - last, last - z.top) > Math.max(RUN, 3 * (z.top - z.bot));
    const if1 = ifvgs.filter(z => z.L === '1m' && Date.now() - z.tInv <= 7 * 60000 && !away(z)).sort((x, y) => y.tInv - x.tInv)[0];   // latest 1m IFVG, only if <7 min old and price hasn't run away
    const all = [...ifvgs.filter(z => z.L !== '1m' && !away(z)).concat(if1 ? [if1] : []).map(z => ({ ...z, n: 'IFVG' })), ...rbs.filter(z => z.L === '5m' || z.L === '15m').map(z => ({ ...z, n: 'RB' })), ...korb.map(z => ({ ...z, n: 'KO RB', L: z.tf }))];   // no plain FVGs; RBs only 5m/15m
    // one box per zone, every timeframe, no filtering
    const prio = { IFVG: 0, 'KO RB': 1, OB: 2, FVG: 3, RB: 4 }, tfw = L => (parseInt(L) || 1) * (/H/.test(L) ? 60 : /D/.test(L) ? 1440 : 1);
    const kept = [];
    for (const z of all.sort((x, y) => (prio[x.n] - prio[y.n]) || (tfw(y.L) - tfw(x.L))))
      kept.push(z);
    // only draw zones whose origin candle is inside the chart's loaded history, so each box starts on its real candle
    let cst = 0; try { const ex = await e.c.exportData({ includeTime: true, includeSeries: true }); cst = ex.data[0][0] * 1000; } catch (x) { }
    const shown = near(kept, 999).sort((x, y) => y.top - x.top);
    shown.forEach((c, n) => {
      c.label = c.L + ' ' + H.dirName(c.dir) + ' ' + c.n;
      const clash = shown.slice(0, n).some(p => Math.min(p.top, c.top) > Math.max(p.bot, c.bot));
      if (c.t < cst) c.label += ' ◂'; draws.push({ k: 'z' + c.n + c.L + c.dir + c.t + c.top, type: 'box', t1: Math.max(c.t, cst), t2: now, top: c.top, bot: c.bot, col: c.dir > 0 ? C.bull : C.bear, a: 0.15, label: c.label, va: clash ? 'bottom' : 'top' });
    });

    // ---- recent CISDs
    const cis = [];
    for (const s of H.swings(b, 2)) { const c = H.cisdAt(b, s.i, -s.side, Infinity); if (c) cis.push({ dir: -s.side, c }); }
    cis.slice(-10).sort((x, y) => Math.abs(x.c.lvl - last) - Math.abs(y.c.lvl - last)).slice(0, 1).forEach(({ dir, c }) => draws.push({ k: 'cisd' + c.sT + dir, type: 'line', t1: c.sT, t2: c.t + BM, p: c.lvl, col: dir > 0 ? C.bull : C.bear, style: 2, label: TF + ' ' + H.dirName(dir) + ' CISD' }));

    // ---- panel
    // ---- market structure + daily bias (flips only with precautions)
    const structure = B => { const sw = H.swings(B, 2); let hi = null, lo = null, trend = 0; const ev = [];
      for (let i = 0; i < B.length; i++) { for (const s of sw) if (s.i === i - 2) { if (s.side > 0) hi = s; else lo = s; }
        if (hi && B[i].c > hi.p) { ev.push({ t: B[i].t, i, dir: 1, kind: trend === 1 ? 'BOS' : 'MSS', lvl: hi.p }); trend = 1; hi = null; }
        if (lo && B[i].c < lo.p) { ev.push({ t: B[i].t, i, dir: -1, kind: trend === -1 ? 'BOS' : 'MSS', lvl: lo.p }); trend = -1; lo = null; } }
      return { trend, ev, last: ev.at(-1), sw }; };
    const S4 = structure(TFB['4H'] || []), S1 = structure(TFB['1H'] || []), B15 = TFB['15m'] || [], S15 = structure(B15);
    const mo = KO.find(k => k.n === '00:00'), so = KO.find(k => k.n === '18:00');
    let bias = S4.trend || S1.trend || 1, why = 'set by ' + (S4.trend ? '4H' : '1H') + ' structure', flips = [];
    const at15 = atrOf(B15), dayStart = etMs(prev, 18, 0);
    for (const ev of S15.ev) {
      if (ev.t < dayStart || ev.dir === bias) continue;
      const x = B15[ev.i], nx = B15[ev.i + 1];
      const disp = Math.abs(x.c - x.o) >= at15[ev.i] * 1.0 || H.fvgs(B15.slice(ev.i - 1, ev.i + 3), 15).some(z => z.dir === ev.dir);
      const ref = (mo && ev.t >= mo.t) ? mo : so, side = !ref || (ev.dir > 0 ? x.c > ref.p : x.c < ref.p);
      const held = nx && (ev.dir > 0 ? nx.c > ev.lvl : nx.c < ev.lvl);
      if (disp && side && held) { bias = ev.dir; flips.push({ t: nx.t, dir: ev.dir }); why = 'flipped ' + hhmm(nx.t) + ': 15m MSS + displacement, held, ' + (ev.dir > 0 ? 'above ' : 'below ') + (ref ? ref.n + ' open' : 'open'); }
    }
    // what would flip it next
    const opp = bias > 0 ? [...S15.sw].reverse().find(s => s.side < 0) : [...S15.sw].reverse().find(s => s.side > 0);
    const refNow = mo || so;
    const flipIf = opp ? ('15m close ' + (bias > 0 ? 'below ' : 'above ') + H.fmt(e, opp.p) + ' with displacement' + (refNow ? ', ' + (bias > 0 ? 'under ' : 'over ') + refNow.n + ' open ' + H.fmt(e, refNow.p) : '') + ', then held 1 candle') : '—';
    // mini chart: today's 15m closes coloured by the bias in force
    const day15 = B15.filter(x => x.t >= dayStart);
    let spark = '';
    if (day15.length > 2) {
      const W = 270, Hh = 64, mn = Math.min(...day15.map(x => x.l)), mx = Math.max(...day15.map(x => x.h)), X = i => 4 + i * (W - 8) / (day15.length - 1), Y = p => 4 + (mx - p) * (Hh - 8) / ((mx - mn) || 1);
      let bnow = S4.trend || S1.trend || 1; const fl = [...flips];
      for (let i = 1; i < day15.length; i++) { while (fl.length && fl[0].t <= day15[i].t) bnow = fl.shift().dir; spark += `<line x1="${X(i - 1)}" y1="${Y(day15[i - 1].c)}" x2="${X(i)}" y2="${Y(day15[i].c)}" stroke="${bnow > 0 ? '#26a69a' : '#ef5350'}" stroke-width="2"/>`; }
      if (refNow && refNow.p > mn && refNow.p < mx) spark += `<line x1="4" x2="${W - 4}" y1="${Y(refNow.p)}" y2="${Y(refNow.p)}" stroke="#b0bec5" stroke-dasharray="3 3" stroke-width="1"/><text x="${W - 6}" y="${Y(refNow.p) - 3}" fill="#b0bec5" font-size="9" text-anchor="end">${refNow.n} open</text>`;
      flips.forEach(f => { const i = day15.findIndex(x => x.t >= f.t); if (i >= 0) spark += `<circle cx="${X(i)}" cy="${Y(day15[i].c)}" r="3.5" fill="${f.dir > 0 ? '#26a69a' : '#ef5350'}" stroke="#fff" stroke-width="1"/>`; });
      spark = `<svg width="${W}" height="${Hh}" style="display:block;margin:4px 0;background:#0b0e13;border-radius:4px">${spark}</svg>`;
    }
    const sname = s => s.trend > 0 ? 'Bullish' : s.trend < 0 ? 'Bearish' : '—', scol = s => s.trend > 0 ? '#26a69a' : s.trend < 0 ? '#ef5350' : '#8a93a6', slast = s => s.last ? ' · ' + s.last.kind + ' ' + hhmm(s.last.t) : '';
    let msHtml = H.hdr('Market Structure', '#8a93a6') + `<div style="font-size:15px;font-weight:700;color:${bias > 0 ? '#26a69a' : '#ef5350'}">${bias > 0 ? 'BULLISH' : 'BEARISH'} bias today</div>` + `<div style="color:#8a93a6;font-size:11px">${why}</div>` + spark;
    msHtml += H.row('4H', sname(S4) + slast(S4), scol(S4)) + H.row('1H', sname(S1) + slast(S1), scol(S1)) + H.row('15m', sname(S15) + slast(S15), scol(S15));
    msHtml += H.row('Flips ' + (bias > 0 ? 'bearish' : 'bullish') + ' if', flipIf, '#8a93a6');
    // ---- trade plan: stack confluences in the bias direction, entry at the zone edge, stop past the whole cluster, targets at real levels
    const TRN = /NQ|NDX|NAS/.test((e.sym || '').toUpperCase()) ? 120 : last * 120 / 31200, TK = 'claude_amd_trades';
    let book = {}; try { book = JSON.parse(localStorage.getItem(TK) || '{}'); } catch (x) { }
    let trades = book[e.sym] || [];
    const B1 = TFB['1m'] || b;
    for (const T of trades) {
      if (T.st !== 'pending' && T.st !== 'active') continue;
      for (const x of B1) {
        if (x.t <= T.last) continue; T.last = x.t;
        if (T.st === 'pending') {
          if (T.dir > 0 ? x.h >= T.tp2 : x.l <= T.tp2) { T.st = 'missed (ran to TP2 without fill)'; break; }
          if (x.t - T.created > 4 * 3600e3) { T.st = 'expired'; break; }
          if (T.dir > 0 ? x.l <= T.entry : x.h >= T.entry) { T.st = 'active'; T.filled = x.t; if (T.dir > 0 ? x.l <= T.stop : x.h >= T.stop) { T.st = 'stopped'; break; } }
        } else {
          const sl = T.be ? T.entry : T.stop;
          if (T.dir > 0 ? x.l <= sl : x.h >= sl) { T.st = T.be ? 'breakeven after TP1' : 'stopped'; break; }
          if (!T.tp1hit && (T.dir > 0 ? x.h >= T.tp1 : x.l <= T.tp1)) { T.tp1hit = true; T.be = true; }
          if (T.dir > 0 ? x.h >= T.tp2 : x.l <= T.tp2) { T.st = 'TP2 hit'; break; }
        }
      }
      if (T.st === 'pending' && T.dir !== bias) T.st = 'cancelled (bias flipped)';
    }
    for (const T of trades) if ((T.st === 'pending' || T.st === 'active') && B1.at(-1).t - T.created > 3600e3) T.st = 'cleared (1h old)';   // wipe trades an hour after they were posted
    for (const T of trades) if (T.st === 'pending' && Math.abs(T.entry - last) > TRN) T.st = 'cancelled (price moved away)';
    // track record: a win = TP1 reached (stop then sits at breakeven), a loss = full stop
    const stats = book[e.sym + '#stats'] || { w: 0, l: 0 };
    for (const T of trades) if (!T.counted && ['TP2 hit', 'breakeven after TP1', 'stopped'].includes(T.st)) { T.counted = 1; if (T.st === 'stopped') stats.l++; else stats.w++; }
    book[e.sym + '#stats'] = stats;
    const nDone = stats.w + stats.l, wr = nDone ? stats.w / nDone : null;
    const minScore = 5 + (nDone >= 10 && wr < 0.7 ? 1 : 0);   // tighten automatically if the live hit-rate drops under 70%
    let live = trades.filter(T => T.st === 'pending' || T.st === 'active');
    if (live.length > 1) { live.slice(1).forEach(T => { if (T.st === 'pending') T.st = 'cancelled (one trade at a time)'; }); live = trades.filter(T => T.st === 'pending' || T.st === 'active'); }
    if (live.length < 1) {
      const dir = bias, buf = Math.max(last * 0.0003, e.tick * 4);
      const ov = (a, z) => Math.min(a.top, z.top) > Math.max(a.bot, z.bot);
      const swingsAll = [...(S15.sw || []).map(s => ({ ...s, n: '15m swing' })), ...(S1.sw || []).map(s => ({ ...s, n: '1H swing' }))];
      const pool = [
        ...all.filter(z => z.dir === -dir).map(z => ({ p: dir > 0 ? z.bot : z.top, n: z.L + ' ' + H.dirName(z.dir) + ' ' + z.n })),
        ...(gex.err ? [] : [['Call Wall', gex.callWall], ['Put Wall', gex.putWall], ['Gamma Flip', gex.flip], ...gex.pivots.map(p => ['GEX Pivot', p])].filter(x => x[1] != null).map(([n, p]) => ({ p, n }))),
        ...KO.map(k => ({ p: k.p, n: k.n + ' open' })),
        ...swingsAll.filter(s => s.side === dir).map(s => ({ p: s.p, n: s.n + (dir > 0 ? ' high' : ' low') }))];
      const cands = [];
      for (const z of all) {
        if (z.dir !== dir || (dir > 0 ? z.top >= last : z.bot <= last)) continue;
        const entry = H.rt(e, dir > 0 ? z.top : z.bot);
        if (Math.abs(entry - last) > TRN / 3) continue;   // only entries price is near
        const cl = all.filter(o => o.dir === dir && ov(o, z));
        const far = dir > 0 ? Math.min(...cl.map(o => o.bot)) : Math.max(...cl.map(o => o.top));
        const stop = H.rt(e, far - dir * buf), R = Math.abs(entry - stop);
        if (R < e.tick * 8 || R > TRN * 0.6) continue;
        if (live.some(T => T.dir === dir && Math.abs(T.entry - entry) < R)) continue;
        const beyond = pool.filter(q => dir * (q.p - entry) > 0).sort((a, c) => dir * (a.p - c.p));
        const t1 = beyond.find(q => dir * (q.p - entry) >= 1.5 * R) || { p: entry + dir * 1.5 * R, n: '1.5R' };
        const t2 = beyond.find(q => dir * (q.p - entry) >= 3 * R) || { p: entry + dir * 3 * R, n: '3R' };
        const conf = [...new Set(cl.map(o => o.L + ' ' + o.n))];
        const gexHere = !gex.err && [gex.callWall, gex.putWall, gex.flip, ...gex.pivots].some(p => p != null && p <= Math.max(entry, stop) + buf && p >= Math.min(entry, stop) - buf);
        const pd = mo ? (dir > 0 ? entry < mo.p : entry > mo.p) : false;
        const htf = cl.some(o => ['15m', '1H', '4H', '1D'].includes(o.L));
        const score = conf.length + (htf ? 1 : 0) + (gexHere ? 1 : 0) + (pd ? 1 : 0) + (S1.trend === dir ? 1 : 0);
        const rr = Math.abs(H.rt(e, t2.p) - entry) / R;
        cands.push({ dir, entry, stop, R, tp1: H.rt(e, t1.p), tp1n: t1.n, tp2: H.rt(e, t2.p), tp2n: t2.n, conf, score, rr, gexHere, pd, htf, s1: S1.trend === dir });
      }
      cands.sort((a, c) => (c.score - a.score) || (c.rr - a.rr));
      const best = cands.find(c => c.score >= minScore && c.rr >= 2.5 && c.htf && c.pd && c.s1);
      if (best) { trades.push({ ...best, id: Date.now(), created: B1.at(-1).t, last: B1.at(-1).t, st: 'pending' }); live = trades.filter(T => T.st === 'pending' || T.st === 'active'); }
    }
    book[e.sym] = trades.slice(-12); try { localStorage.setItem(TK, JSON.stringify(book)); } catch (x) { }
    for (const T of live) {
      const k = 'trade' + T.id, side = T.dir > 0 ? 'Long' : 'Short';
      draws.push({ k: k + 'en', type: 'line', t1: T.created, p: T.entry, col: '#e0e0e0', w: 2, label: 'AMD ' + side + ' Entry' });
      draws.push({ k: k + 'sl' + (T.be ? 'be' : ''), type: 'line', t1: T.created, p: T.be ? T.entry : T.stop, col: '#ef5350', w: 2, label: T.be ? 'AMD SL (BE)' : 'AMD SL' });
      if (!T.tp1hit) draws.push({ k: k + 't1', type: 'line', t1: T.created, p: T.tp1, col: '#00e676', label: 'AMD TP1' });
      draws.push({ k: k + 't2', type: 'line', t1: T.created, p: T.tp2, col: '#00e676', w: 2, label: 'AMD TP2' });
    }
    let planHtml = H.hdr('Trade Plan', '#8a93a6') + H.row('Track record', nDone ? stats.w + 'W – ' + stats.l + 'L (' + Math.round(wr * 100) + '% reach TP1)' : 'no closed trades yet', '#8a93a6');
    if (!live.length) planHtml += '<div style="color:#8a93a6">No A-grade setup near price (needs ' + minScore + '+ score, HTF zone, ' + (bias > 0 ? 'discount' : 'premium') + ', 1H agreeing, 2.5R+)</div>';
    for (const T of live) {
      const grade = T.score >= 6 ? 'A+' : T.score >= 5 ? 'A' : T.score >= 4 ? 'B' : 'C';
      planHtml += `<div style="margin-top:3px;font-weight:700;color:${T.dir > 0 ? '#26a69a' : '#ef5350'}">${T.dir > 0 ? 'LONG' : 'SHORT'} · ${T.st === 'active' ? 'IN TRADE' : 'LIMIT – wait for price'} · grade ${grade}</div>`;
      planHtml += H.row('Entry', H.fmt(e, T.entry), '#e0e0e0') + H.row('Stop' + (T.be ? ' (moved to BE)' : ''), H.fmt(e, T.be ? T.entry : T.stop), '#ef5350');
      planHtml += H.row('TP1 · ' + T.tp1n, H.fmt(e, T.tp1) + (T.tp1hit ? ' ✓' : ''), '#00e676') + H.row('TP2 · ' + T.tp2n, H.fmt(e, T.tp2), '#00e676');
      planHtml += H.row('Risk / R:R', H.fmt(e, T.R) + ' pts · ' + T.rr.toFixed(1) + 'R to TP2');
      planHtml += H.row('Confluence', T.conf.join(' + ') + (T.gexHere ? ' + GEX level' : '') + (T.pd ? (T.dir > 0 ? ' + discount' : ' + premium') : ''));
    }
    const done = trades.filter(T => T.st !== 'pending' && T.st !== 'active').slice(-3).reverse();
    if (done.length) planHtml += '<div style="color:#6b7385;font-size:10px;margin-top:3px">Recent: ' + done.map(T => (T.dir > 0 ? 'L ' : 'S ') + H.fmt(e, T.entry) + ' → ' + T.st).join(' · ') + '</div>';
    let html = H.row('Timeframes', '1m IFVG · 5m · 15m · 1H · 4H · 1D') + H.row('Price', H.fmt(e, last)); html += msHtml + planHtml;
    html += H.hdr('Options gamma (GEX)', '#8a93a6');
    if (gex.err) html += `<div style="color:#8a93a6">${gex.err}</div>`;
    else {
      const dist = p => (p >= last ? '+' : '') + H.fmt(e, p - last);
      html += H.row('Regime', gex.regime + ' gamma · ' + (gex.regime === 'Positive' ? 'walls hold, fade extremes' : 'moves expand, walls can break'), gex.regime === 'Positive' ? '#26a69a' : '#ef5350');
      html += H.row((gex.callWall >= last ? 'S' : 'L') + ' · Call Wall', H.fmt(e, gex.callWall) + ' (' + dist(gex.callWall) + ')', '#ef5350');
      if (gex.flip != null) html += H.row((gex.flip >= last ? 'S' : 'L') + ' · Gamma Flip', H.fmt(e, gex.flip) + ' (' + dist(gex.flip) + ')', '#ffca28');
      html += H.row((gex.putWall >= last ? 'S' : 'L') + ' · Put Wall', H.fmt(e, gex.putWall) + ' (' + dist(gex.putWall) + ')', '#26a69a');
      html += H.row('Source', gex.snap ? 'CBOE ' + (gex.src || 'NDX') + ' options · quotes ' + gex.snap + ' · mapped to NQ' : 'Deribit ' + gex.cur + ' options ≤60d, refreshed every 5 min');
    }
    html += H.row('Zones', `${fvgs.length} FVG · ${ifvgs.length} IFVG · ${obs.length} OB · ${rbs.length} RB · ${korb.length} KO RB → ${shown.length} boxes`);
    html += H.hdr('Nearest zones', '#8a93a6');
    [...shown].sort((x, y) => Math.abs((x.top + x.bot) / 2 - last) - Math.abs((y.top + y.bot) / 2 - last)).slice(0, 6).forEach(c => html += H.row(c.label, H.fmt(e, c.bot) + ' – ' + H.fmt(e, c.top), c.dir > 0 ? C.bull : C.bear));
    html += H.hdr('Key opens (NY)', '#8a93a6');
    for (const k of KO) html += H.row(k.n, H.fmt(e, k.p) + (last > k.p ? ' · above' : ' · below'));
    if (cis.length) { const l = cis.at(-1); html += H.row('Last CISD', H.dirName(l.dir) + ' @ ' + hhmm(l.c.t), l.dir > 0 ? C.bull : C.bear); }
    // only draw what is within 120 points of price (NQ); other markets use the same % distance
    const RNG = /NQ|NDX|NAS/.test((e.sym || '').toUpperCase()) ? 120 : last * 120 / 31200;
    const near120 = d => d.k.startsWith('gex') || d.k.startsWith('trade') || (d.type === 'box' ? Math.max(0, d.bot - last, last - d.top) <= RNG : Math.abs(d.p - last) <= RNG);   // GEX levels always shown
    html += `<div style="margin-top:4px;color:#6b7385;font-size:10px">Chart shows zones within ${H.fmt(e, RNG)} pts of price (GEX always)</div>`;
    return { html, draws: draws.filter(near120) };
  }
});
