// claude_amdw — AMD Range Model: confluences on every timeframe, market-structure bias, live-repriced GEX levels, and one trade plan.
// Deterministic: same bars → same zones and the same trade at the same 5-minute close on TopstepX, Vest and TradingView.
// NQ gamma: receive levels from the CBOE tab (sent by the 'GEX Update' bookmark), and open that tab when levels are stale
if (!window.__claudeGexListen) { window.__claudeGexListen = 1; window.addEventListener('message', ev => { if (!/^https:\/\/[\w.-]*cboe\.com$/.test(ev.origin) || !ev.data || ev.data.type !== 'claude_gex') return; localStorage.setItem('claude_gex_raw', JSON.stringify({ ...ev.data, at: Date.now() })); window.__claude_amdw && window.__claude_amdw.tick(); }); }
if (!window.__claude_amdw) { try { const sy = document.querySelector('iframe[id^="tradingview_"]').contentWindow.tradingViewApi.activeChart().symbol().toUpperCase(); const raw = JSON.parse(localStorage.getItem('claude_gex_raw') || 'null'); if (/NQ|NDX|NAS/.test(sy) && (!raw || !raw.chain || Date.now() - raw.at > 6 * 3600e3)) window.open('https://cdn.cboe.com/api/global/delayed_quotes/options/_NDX.json', 'claude_cboe'); } catch (x) { } }
window.__claudeCore({
  key: 'claude_amdw', title: 'AMD Range Model', color: '#26c6da', pos: { top: 330, right: 330 },
  run: async function (e, H) {
    const { etMs, addDays, hhmm, C } = H;
    const res = e.c.resolution();
    const tfMin = /D/.test(res) ? 1440 * (parseInt(res) || 1) : /W/.test(res) ? 10080 : /S/.test(res) ? 1 : parseInt(res) || 1;
    const TF = tfMin >= 1440 ? (tfMin / 1440) + 'D' : tfMin >= 60 ? (tfMin / 60) + 'H' : tfMin + 'm';
    const bres = /S/.test(res) ? '1' : res, BM = tfMin * 60000;
    const NOW = Date.now(), day = H.tday(NOW), wd = d => new Date(d + 'T12:00:00Z').getUTCDay();
    // start of the session n trading sessions before session `d0` (weekends skipped), 18:00 ET
    const ses = (n, d0 = day) => { let d = d0; for (let k = 0; k < n; k++) { d = addDays(d, -1); while (wd(d) % 6 === 0) d = addDays(d, -1); } return etMs(addDays(d, -1), 18, 0); };
    const NQ = /NQ|NDX|NAS/.test((e.sym || '').toUpperCase());

    // ---- data: fixed windows anchored to the 18:00 ET session open, so TopstepX, Vest and TradingView all compute from the same bars
    const R1 = await H.bars(e, '1', ses(2)), R5 = await H.bars(e, '5', ses(4)), R15 = await H.bars(e, '15', ses(7)), R60 = await H.bars(e, '60', ses(92));
    if (R1.length < 60 || R5.length < 40) return { html: 'Not enough data yet.', draws: [] };
    const b = bres === '1' ? R1 : bres === '5' ? R5 : bres === '15' ? R15 : bres === '60' ? R60 : (await H.bars(e, bres, NOW - Math.max(320 * BM, 3.5 * 864e5))).slice(-500);   // chart timeframe: only for the CISD drawing
    if (b.length < 5) return { html: 'Not enough ' + TF + ' data yet.', draws: [] };
    // 4H and 1D are built from 1H, anchored to the 18:00 ET open (identical on every platform)
    const sesC = new Map(), sesOf = t => { const d = H.tday(t); let s = sesC.get(d); if (s == null) { s = etMs(addDays(d, -1), 18, 0); sesC.set(d, s); } return s; };
    const build = (B, f) => { const out = []; let cur = null; for (const x of B) { const k = f(x.t); if (!cur || cur.t !== k) { cur = { t: k, o: x.o, h: x.h, l: x.l, c: x.c }; out.push(cur); } else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; } } return out; };
    const R240 = build(R60, t => { const s = sesOf(t); return s + Math.floor((t - s) / 144e5) * 144e5; }), RD = build(R60, sesOf);
    const TFS = [['1m', 1, R1, 1], ['5m', 5, R5, 3], ['15m', 15, R15, 6], ['1H', 60, R60, 20], ['4H', 240, R240, 60], ['1D', 1440, RD, 90]];
    const TRN = NQ ? 120 : R1.at(-1).c * 120 / 31200, C5 = 300000;

    // bars as they stood at time `asOf` (closed candles + the forming candle rebuilt from 1m) — no look-ahead
    const upTo = (B, MS, asOf) => {
      if (asOf === Infinity) return B;
      const out = [];
      for (const x of B) {
        if (x.t >= asOf) break;
        if (x.t + MS <= asOf) { out.push(x); continue; }
        let o = null; for (const y of R1) { if (y.t < x.t) continue; if (y.t >= asOf) break; if (!o) o = { t: x.t, o: y.o, h: y.h, l: y.l, c: y.c }; else { o.h = Math.max(o.h, y.h); o.l = Math.min(o.l, y.l); o.c = y.c; } }
        if (o) out.push(o); break;
      }
      return out;
    };
    const atrOf = B => { const r = []; let v = 0; for (let i = 0; i < B.length; i++) { const tr = i ? Math.max(B[i].h - B[i].l, Math.abs(B[i].h - B[i - 1].c), Math.abs(B[i].l - B[i - 1].c)) : B[i].h - B[i].l; v = i < 14 ? (v * i + tr) / (i + 1) : (v * 13 + tr) / 14; r.push(v); } return r; };
    const brk = (B, z, from) => { for (let i = from; i < B.length; i++) if (z.dir > 0 ? B[i].c < z.bot : B[i].c > z.top) return i; return -1; };
    const touch = (z, x) => z.dir > 0 ? x.l <= z.top : x.h >= z.bot;
    const structure = B => { const sw = H.swings(B, 2); let hi = null, lo = null, trend = 0; const ev = [];
      for (let i = 0; i < B.length; i++) { for (const s of sw) if (s.i === i - 2) { if (s.side > 0) hi = s; else lo = s; }
        if (hi && B[i].c > hi.p) { ev.push({ t: B[i].t, i, dir: 1, kind: trend === 1 ? 'BOS' : 'MSS', lvl: hi.p }); trend = 1; hi = null; }
        if (lo && B[i].c < lo.p) { ev.push({ t: B[i].t, i, dir: -1, kind: trend === -1 ? 'BOS' : 'MSS', lvl: lo.p }); trend = -1; lo = null; } }
      return { trend, ev, last: ev.at(-1), sw }; };

    // ---- the whole model, evaluated as of a moment in time (Infinity = live)
    function analyze(asOf) {
      const nowT = asOf === Infinity ? NOW : asOf;
      const dayA = H.tday(nowT - 1), prevA = addDays(dayA, -1), sod = etMs(prevA, 18, 0), s1st = ses(1, dayA);
      const M1 = upTo(R1.filter(x => x.t >= s1st), 60000, asOf); if (M1.length < 30) return null;
      const last = M1.at(-1).c;
      const m1 = M1.filter(x => x.t >= sod);
      const fvgs = [], ifvgs = [], obs = [], rbs = [], TFB = {};
      // fresh = price has not traded back into the zone since it formed (zone's own TF + every 1m bar)
      const fresh = (z, B, from, readyT) => { for (let i = from; i < B.length; i++) if (touch(z, B[i])) return false; for (const x of M1) if (x.t >= readyT && touch(z, x)) return false; return true; };
      const scan = (B, mins, L, ifvgOnly) => {
        const at = atrOf(B), MS = mins * 60000, Bc = B.length && B.at(-1).t + MS > nowT ? B.slice(0, -1) : B;   // closed candles only for RBs
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
      for (const [L, mins, RB, back] of TFS) {
        const from = ses(back, dayA), B = upTo(RB.filter(x => x.t >= from), (L === '1D' ? 1380 : mins) * 60000, asOf).slice(-400);
        TFB[L] = B; if (B.length > 5) scan(B, mins, L, mins === 1);
      }
      const KO = [['18:00', 18, 0, prevA], ['00:00', 0, 0], ['02:00', 2, 0], ['08:30', 8, 30], ['09:30', 9, 30], ['10:00', 10, 0], ['13:30', 13, 30]]
        .map(([n, h, m, d]) => { const t = etMs(d || dayA, h, m); const x = m1.find(y => y.t >= t && y.t < t + 60000); return x ? { n, t, p: x.o } : null; }).filter(Boolean);
      const korb = [];
      for (const [tf, mins] of [['5m', 5], ['15m', 15]]) {
        let bb = H.agg(m1, mins); if (bb.length && bb.at(-1).t + mins * 60000 > nowT) bb = bb.slice(0, -1);   // closed candles only
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
      const RUN = NQ ? 30 : last * 30 / 31200, away = z => Math.max(0, z.bot - last, last - z.top) > Math.max(RUN, 3 * (z.top - z.bot));
      const if1 = ifvgs.filter(z => z.L === '1m' && nowT - z.tInv <= 7 * 60000 && !away(z)).sort((x, y) => y.tInv - x.tInv)[0];   // latest 1m IFVG, only if <7 min old and price hasn't run away
      const all = [...ifvgs.filter(z => z.L !== '1m' && !away(z)).concat(if1 ? [if1] : []).map(z => ({ ...z, n: 'IFVG' })), ...rbs.filter(z => z.L === '5m' || z.L === '15m').map(z => ({ ...z, n: 'RB' })), ...korb.map(z => ({ ...z, n: 'KO RB', L: z.tf }))];
      // market structure + daily bias (flips only with precautions)
      const S4 = structure(TFB['4H'] || []), S1 = structure(TFB['1H'] || []), B15 = TFB['15m'] || [], S15 = structure(B15);
      const mo = KO.find(k => k.n === '00:00'), so = KO.find(k => k.n === '18:00');
      let bias = S4.trend || S1.trend || 1, why = 'set by ' + (S4.trend ? '4H' : '1H') + ' structure'; const flips = [];
      const at15 = atrOf(B15);
      for (const ev of S15.ev) {
        if (ev.t < sod || ev.dir === bias) continue;
        const x = B15[ev.i], nx = B15[ev.i + 1];
        const disp = Math.abs(x.c - x.o) >= at15[ev.i] * 1.0 || H.fvgs(B15.slice(ev.i - 1, ev.i + 3), 15).some(z => z.dir === ev.dir);
        const ref = (mo && ev.t >= mo.t) ? mo : so, side = !ref || (ev.dir > 0 ? x.c > ref.p : x.c < ref.p);
        const held = nx && nx.t + 15 * 60000 <= nowT && (ev.dir > 0 ? nx.c > ev.lvl : nx.c < ev.lvl);
        if (disp && side && held) { bias = ev.dir; flips.push({ t: nx.t, dir: ev.dir }); why = 'flipped ' + hhmm(nx.t) + ': 15m MSS + displacement, held, ' + (ev.dir > 0 ? 'above ' : 'below ') + (ref ? ref.n + ' open' : 'open'); }
      }
      // trade candidates: stack confluences in the bias direction, entry at the zone edge, stop past the cluster, targets at real levels (price only — no GEX, so every platform agrees)
      const dir = bias, buf = Math.max(last * 0.0003, e.tick * 4), ov = (a, z) => Math.min(a.top, z.top) > Math.max(a.bot, z.bot);
      const swingsAll = [...(S15.sw || []).map(s => ({ ...s, n: '15m swing' })), ...(S1.sw || []).map(s => ({ ...s, n: '1H swing' }))];
      const pool = [...all.filter(z => z.dir === -dir).map(z => ({ p: dir > 0 ? z.bot : z.top, n: z.L + ' ' + H.dirName(z.dir) + ' ' + z.n })), ...KO.map(k => ({ p: k.p, n: k.n + ' open' })), ...swingsAll.filter(s => s.side === dir).map(s => ({ p: s.p, n: s.n + (dir > 0 ? ' high' : ' low') }))];
      const cands = [];
      for (const z of all) {
        if (z.dir !== dir || (dir > 0 ? z.top >= last : z.bot <= last)) continue;
        const entry = H.rt(e, dir > 0 ? z.top : z.bot);
        if (Math.abs(entry - last) > TRN / 3) continue;   // only entries price is near
        const cl = all.filter(o => o.dir === dir && ov(o, z));
        const far = dir > 0 ? Math.min(...cl.map(o => o.bot)) : Math.max(...cl.map(o => o.top));
        const stop = H.rt(e, far - dir * buf), R = Math.abs(entry - stop);
        if (R < e.tick * 8 || R > TRN * 0.6) continue;
        const beyond = pool.filter(q => dir * (q.p - entry) > 0).sort((a, c) => dir * (a.p - c.p));
        const t1 = beyond.find(q => dir * (q.p - entry) >= 1.5 * R) || { p: entry + dir * 1.5 * R, n: '1.5R' };
        const t2 = beyond.find(q => dir * (q.p - entry) >= 3 * R) || { p: entry + dir * 3 * R, n: '3R' };
        const conf = [...new Set(cl.map(o => o.L + ' ' + o.n))];
        const pd = mo ? (dir > 0 ? entry < mo.p : entry > mo.p) : false, htf = cl.some(o => ['15m', '1H', '4H', '1D'].includes(o.L)), s1 = S1.trend === dir;
        const score = conf.length + (htf ? 1 : 0) + (pd ? 1 : 0) + (s1 ? 1 : 0), rr = Math.abs(H.rt(e, t2.p) - entry) / R;
        cands.push({ dir, entry, stop, R, tp1: H.rt(e, t1.p), tp1n: t1.n, tp2: H.rt(e, t2.p), tp2n: t2.n, conf, score, rr, pd, htf, s1 });
      }
      const best = cands.filter(c => c.score >= 5 && c.rr >= 2.5 && c.htf && c.pd && c.s1).sort((a, c) => (c.rr - a.rr) || (c.score - a.score) || (a.entry - c.entry))[0] || null;   // most profitable qualifying setup
      return { last, dayA, sod, M1, m1, TFB, fvgs, ifvgs, obs, rbs, korb, all, KO, mo, so, S4, S1, S15, B15, bias, why, flips, best };
    }

    // ---- trade plan, replayed from fixed 5-minute closes (anchored to the clock), so every platform shows the same trade at the same time
    const live = T => T && (T.st === 'pending' || T.st === 'active');
    const adv = (T, x) => {
      if (T.st === 'pending') {
        if (T.dir > 0 ? x.h >= T.tp2 : x.l <= T.tp2) { T.st = 'missed (ran to TP2 without fill)'; return; }
        if (T.dir > 0 ? x.l <= T.entry : x.h >= T.entry) { T.st = 'active'; T.filled = x.t; if (T.dir > 0 ? x.l <= T.stop : x.h >= T.stop) T.st = 'stopped'; }
      } else if (T.st === 'active') {
        const sl = T.be ? T.entry : T.stop;
        if (T.dir > 0 ? x.l <= sl : x.h >= sl) { T.st = T.be ? 'breakeven after TP1' : 'stopped'; return; }
        if (!T.tp1hit && (T.dir > 0 ? x.h >= T.tp1 : x.l <= T.tp1)) { T.tp1hit = true; T.be = true; }
        if (T.dir > 0 ? x.h >= T.tp2 : x.l <= T.tp2) T.st = 'TP2 hit';
      }
    };
    const cache = window.__claudeAmdCache || (window.__claudeAmdCache = new Map());
    const A = Math.floor(NOW / 36e5) * 36e5 - 36e5, lastB = Math.floor(NOW / C5) * C5, done = [];
    for (const k of [...cache.keys()]) if (+k.split('|')[1] < A) cache.delete(k);
    let T = null;
    for (let t = A; t <= lastB; t += C5) {
      if (T) for (const x of R1) { if (x.t < T.last) continue; if (x.t + 60000 > t) break; adv(T, x); T.last = x.t + 60000; if (!live(T)) break; }
      const key = e.sym + '|' + t;
      let a = cache.get(key);
      if (!a) { const r = analyze(t); a = r ? { best: r.best, bias: r.bias, last: r.last } : { best: null, bias: 0, last: null }; cache.set(key, a); }
      if (live(T) && T.st === 'pending' && a.bias && T.dir !== a.bias) T.st = 'cancelled (bias flipped)';
      if (live(T) && T.st === 'pending' && a.last != null && Math.abs(T.entry - a.last) > TRN) T.st = 'cancelled (price moved away)';
      if (live(T) && t - T.created >= 36e5) T.st = 'cleared (1h old)';   // trades are wiped an hour after they were posted
      if (T && !live(T)) { done.push(T); T = null; }
      if (!T && a.best) T = { ...a.best, id: t, created: t, last: t, st: 'pending' };
    }
    if (live(T)) for (const x of R1) { if (x.t < T.last) continue; adv(T, x); if (!live(T)) break; }
    if (live(T) && NOW - T.created >= 36e5) T.st = 'cleared (1h old)';
    if (T && !live(T)) { done.push(T); T = null; }

    // ---- live picture (zones, structure) for the chart and panel
    const L = analyze(Infinity);
    if (!L) return { html: 'Not enough data yet.', draws: [] };
    const last = L.last, now = R1.at(-1).t + 60000, draws = [];

    // ---- options GEX levels: NQ from CBOE (NDX + QQQ, re-priced live with the live futures price), BTC/ETH from Deribit
    const gex = await (async () => {
      const sym = (e.si.name || e.sym || '').toUpperCase(), cur = /ETH/.test(sym) ? 'ETH' : /BTC|XBT/.test(sym) ? 'BTC' : null;
      if (!cur) {
        let m = null, raw = null; try { m = JSON.parse(localStorage.getItem('claude_gex_nq')); raw = JSON.parse(localStorage.getItem('claude_gex_raw')); } catch (x) { }
        if (!raw || !NQ) return { err: 'No options-gamma levels loaded for ' + (e.sym || 'this symbol') };
        if (!m || m.rawAt !== raw.at) {
          // NDX quote time: ~15 min delayed in the cash session, otherwise the last 16:00 ET close → NQ at that moment gives the futures-vs-index basis
          let ref = raw.ts - 15 * 60000; const p = H.etp(ref), wd = d => new Date(d + 'T12:00:00Z').getUTCDay();
          if (p.mins < 570 || p.mins >= 960 || wd(p.day) % 6 === 0) { let d = p.mins < 570 ? addDays(p.day, -1) : p.day; for (let k = 0; k < 4 && wd(d) % 6 === 0; k++) d = addDays(d, -1); ref = etMs(d, 16, 0) - 60000; }
          const nb = await H.bars(e, '1', ref - 10 * 60000), x = nb.filter(y => y.t <= ref).at(-1) || nb[0];
          if (!x) return { err: 'Could not map the options levels to this contract yet' };
          m = { rawAt: raw.at, basis: x.c - raw.S }; localStorage.setItem('claude_gex_nq', JSON.stringify(m));
        }
        const r = q => q == null ? null : H.rt(e, q + m.basis);
        let lv = raw, liveG = false;
        if (raw.chain && raw.chain.length) {   // live: re-price every option's gamma at the live futures price (minus basis) and today's time to expiry
          const x = last - m.basis, o = [];
          for (const [K, sc, c, oi, iv, X] of raw.chain) { const T = (X - NOW) / 31536e6; if (T > 0) o.push({ K, sc, c: c > 0, oi, iv, T: Math.max(T, 1 / 8760) }); }
          lv = H.gexLevels(o, x, raw.R || 1, (raw.R || 1) > 2, false); liveG = true;
        }
        return { cur: 'NDX', liveG, snap: new Date(raw.ts).toLocaleString(), src: raw.src, callWall: r(lv.cw), putWall: r(lv.pw), flip: r(lv.flip), pivots: (lv.piv || []).map(r), regime: lv.regime };
      }
      const ck = window.__claudeGex || (window.__claudeGex = {});
      if (!ck[cur] || NOW - ck[cur].at > 5 * 60000) {
        const [bs, ix] = await Promise.all([
          fetch('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=' + cur + '&kind=option').then(r => r.json()),
          fetch('https://www.deribit.com/api/v2/public/get_index_price?index_name=' + cur.toLowerCase() + '_usd').then(r => r.json())]);
        const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 }, opts = [];
        for (const o of bs.result || []) {
          const m = /^\w+-(\d{1,2})([A-Z]{3})(\d{2})-(\d+)-([CP])$/.exec(o.instrument_name); if (!m || !o.open_interest || !o.mark_iv) continue;
          const T = (Date.UTC(2000 + +m[3], MON[m[2]], +m[1], 8) - NOW) / (365 * 864e5); if (T <= 0 || T > 60 / 365) continue;
          opts.push({ K: +m[4], call: m[5] === 'C', oi: o.open_interest, iv: o.mark_iv / 100, T });
        }
        ck[cur] = { at: NOW, S: ix.result.index_price, opts };
      }
      const { S, opts } = ck[cur], off = last - S;   // Deribit is real time: re-price at the live chart price
      const o = opts.map(q => ({ K: q.K, sc: 1, c: q.call, oi: q.oi, iv: q.iv, T: q.T }));
      const lv = H.gexLevels(o, last - off, 1, false, false), r = q => q == null ? null : q + off;
      return { cur, liveG: true, callWall: r(lv.cw), putWall: r(lv.pw), flip: r(lv.flip), pivots: lv.piv.map(r), regime: lv.regime };
    })().catch(err => ({ err: 'GEX failed: ' + err.message }));
    if (!gex.err) {
      const Lg = (k, p, col, label, w) => p != null && draws.push({ k: 'gex' + k, type: 'line', full: true, t1: b[0].t, p: H.rt(e, p), col, w: w || 2, style: 0, label: (p >= last ? 'S' : 'L') + ' · ' + label, ha: 'right', va: 'middle' });
      Lg('cw', gex.callWall, '#ef5350', 'Call Wall');
      Lg('pw', gex.putWall, '#26a69a', 'Put Wall');
      Lg('flip', gex.flip, '#ffca28', 'Gamma Flip');
      gex.pivots.forEach((p, n) => Lg('pv' + n, p, '#b0bec5', 'GEX Pivot', 1));
    }

    // ---- zones on the chart
    for (const k of L.KO) draws.push({ k: 'ko' + k.n + k.t, type: 'line', t1: k.t, t2: now, p: k.p, col: '#b0bec5', style: 1, label: k.n + ' Open', ha: 'left' });
    let cst = 0; try { const ex = await e.c.exportData({ includeTime: true, includeSeries: true }); cst = ex.data[0][0] * 1000; } catch (x) { }
    const shown = [...L.all].sort((x, y) => y.top - x.top);
    shown.forEach((c, n) => {
      c.label = c.L + ' ' + H.dirName(c.dir) + ' ' + c.n;
      const clash = shown.slice(0, n).some(p => Math.min(p.top, c.top) > Math.max(p.bot, c.bot));
      if (c.t < cst) c.label += ' ◂';
      draws.push({ k: 'z' + c.n + c.L + c.dir + c.t + c.top, type: 'box', t1: Math.max(c.t, cst), t2: now, top: c.top, bot: c.bot, col: c.dir > 0 ? C.bull : C.bear, a: 0.15, label: c.label, va: clash ? 'bottom' : 'top' });
    });
    // nearest CISD on the chart's timeframe
    const cis = [];
    for (const s of H.swings(b, 2)) { const c = H.cisdAt(b, s.i, -s.side, Infinity); if (c) cis.push({ dir: -s.side, c }); }
    cis.slice(-10).sort((x, y) => Math.abs(x.c.lvl - last) - Math.abs(y.c.lvl - last)).slice(0, 1).forEach(({ dir, c }) => draws.push({ k: 'cisd' + c.sT + dir, type: 'line', t1: c.sT, t2: c.t + BM, p: c.lvl, col: dir > 0 ? C.bull : C.bear, style: 2, label: TF + ' ' + H.dirName(dir) + ' CISD' }));
    if (T) {
      const k = 'trade' + T.id, side = T.dir > 0 ? 'Long' : 'Short';
      draws.push({ k: k + 'en', type: 'line', t1: T.created, p: T.entry, col: '#e0e0e0', w: 2, label: 'AMD ' + side + ' Entry' });
      draws.push({ k: k + 'sl' + (T.be ? 'be' : ''), type: 'line', t1: T.created, p: T.be ? T.entry : T.stop, col: '#ef5350', w: 2, label: T.be ? 'AMD SL (BE)' : 'AMD SL' });
      if (!T.tp1hit) draws.push({ k: k + 't1', type: 'line', t1: T.created, p: T.tp1, col: '#00e676', label: 'AMD TP1' });
      draws.push({ k: k + 't2', type: 'line', t1: T.created, p: T.tp2, col: '#00e676', w: 2, label: 'AMD TP2' });
    }

    // ---- panel
    const { S4, S1, S15, B15, bias, why, flips, KO, mo, so, sod } = L;
    const opp = bias > 0 ? [...S15.sw].reverse().find(s => s.side < 0) : [...S15.sw].reverse().find(s => s.side > 0);
    const refNow = mo || so;
    const flipIf = opp ? ('15m close ' + (bias > 0 ? 'below ' : 'above ') + H.fmt(e, opp.p) + ' with displacement' + (refNow ? ', ' + (bias > 0 ? 'under ' : 'over ') + refNow.n + ' open ' + H.fmt(e, refNow.p) : '') + ', then held 1 candle') : '—';
    const day15 = B15.filter(x => x.t >= sod);
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
    let html = H.row('Timeframes', '1m IFVG · 5m · 15m · 1H · 4H · 1D') + H.row('Price', H.fmt(e, last));
    html += H.hdr('Market Structure', '#8a93a6') + `<div style="font-size:15px;font-weight:700;color:${bias > 0 ? '#26a69a' : '#ef5350'}">${bias > 0 ? 'BULLISH' : 'BEARISH'} bias today</div>` + `<div style="color:#8a93a6;font-size:11px">${why}</div>` + spark;
    html += H.row('4H', sname(S4) + slast(S4), scol(S4)) + H.row('1H', sname(S1) + slast(S1), scol(S1)) + H.row('15m', sname(S15) + slast(S15), scol(S15));
    html += H.row('Flips ' + (bias > 0 ? 'bearish' : 'bullish') + ' if', flipIf, '#8a93a6');
    html += H.hdr('Trade Plan', '#8a93a6');
    const closed = done.filter(x => ['TP2 hit', 'breakeven after TP1', 'stopped'].includes(x.st)), w = closed.filter(x => x.st !== 'stopped').length;
    html += H.row('Last 1–2h', closed.length ? w + 'W – ' + (closed.length - w) + 'L' : 'no closed trades', '#8a93a6');
    if (!T) html += '<div style="color:#8a93a6">No A-grade setup near price (needs 5+ score, HTF zone, ' + (bias > 0 ? 'discount' : 'premium') + ', 1H agreeing, 2.5R+). Checked at every 5-min close.</div>';
    else {
      const grade = T.score >= 6 ? 'A+' : 'A';
      html += `<div style="margin-top:3px;font-weight:700;color:${T.dir > 0 ? '#26a69a' : '#ef5350'}">${T.dir > 0 ? 'LONG' : 'SHORT'} · ${T.st === 'active' ? 'IN TRADE' : 'LIMIT – wait for price'} · grade ${grade}</div>`;
      html += H.row('Posted', hhmm(T.created) + ' ET (5-min close) · clears ' + hhmm(T.created + 36e5));
      html += H.row('Entry', H.fmt(e, T.entry), '#e0e0e0') + H.row('Stop' + (T.be ? ' (moved to BE)' : ''), H.fmt(e, T.be ? T.entry : T.stop), '#ef5350');
      html += H.row('TP1 · ' + T.tp1n, H.fmt(e, T.tp1) + (T.tp1hit ? ' ✓' : ''), '#00e676') + H.row('TP2 · ' + T.tp2n, H.fmt(e, T.tp2), '#00e676');
      html += H.row('Risk / R:R', H.fmt(e, T.R) + ' pts · ' + T.rr.toFixed(1) + 'R to TP2');
      html += H.row('Confluence', T.conf.join(' + ') + (T.pd ? (T.dir > 0 ? ' + discount' : ' + premium') : '') + (T.s1 ? ' + 1H trend' : ''));
    }
    if (done.length) html += '<div style="color:#6b7385;font-size:10px;margin-top:3px">Recent: ' + done.slice(-3).reverse().map(x => hhmm(x.created) + ' ' + (x.dir > 0 ? 'L ' : 'S ') + H.fmt(e, x.entry) + ' → ' + x.st).join(' · ') + '</div>';
    html += H.hdr('Options gamma (GEX)', '#8a93a6');
    if (gex.err) html += `<div style="color:#8a93a6">${gex.err}</div>`;
    else {
      const dist = p => (p >= last ? '+' : '') + H.fmt(e, p - last);
      html += H.row('Regime', gex.regime + ' gamma · ' + (gex.regime === 'Positive' ? 'walls hold, fade extremes' : 'moves expand, walls can break'), gex.regime === 'Positive' ? '#26a69a' : '#ef5350');
      if (gex.callWall != null) html += H.row((gex.callWall >= last ? 'S' : 'L') + ' · Call Wall', H.fmt(e, gex.callWall) + ' (' + dist(gex.callWall) + ')', '#ef5350');
      if (gex.flip != null) html += H.row((gex.flip >= last ? 'S' : 'L') + ' · Gamma Flip', H.fmt(e, gex.flip) + ' (' + dist(gex.flip) + ')', '#ffca28');
      if (gex.putWall != null) html += H.row((gex.putWall >= last ? 'S' : 'L') + ' · Put Wall', H.fmt(e, gex.putWall) + ' (' + dist(gex.putWall) + ')', '#26a69a');
      gex.pivots.forEach(p => html += H.row((p >= last ? 'S' : 'L') + ' · GEX Pivot', H.fmt(e, p) + ' (' + dist(p) + ')', '#b0bec5'));
      html += H.row('Source', gex.cur === 'NDX' ? 'CBOE ' + (gex.src || 'NDX') + ' · OI/IV ' + gex.snap + (gex.liveG ? ' · gamma re-priced live at ' + H.fmt(e, last) : '') : 'Deribit ' + gex.cur + ' options (live)');
    }
    html += H.row('Zones', `${L.ifvgs.length} IFVG · ${L.rbs.length} RB · ${L.korb.length} KO RB → ${shown.length} boxes`);
    html += H.hdr('Nearest zones', '#8a93a6');
    [...shown].sort((x, y) => Math.abs((x.top + x.bot) / 2 - last) - Math.abs((y.top + y.bot) / 2 - last)).slice(0, 6).forEach(c => html += H.row(c.label, H.fmt(e, c.bot) + ' – ' + H.fmt(e, c.top), c.dir > 0 ? C.bull : C.bear));
    html += H.hdr('Key opens (NY)', '#8a93a6');
    for (const k of KO) html += H.row(k.n, H.fmt(e, k.p) + (last > k.p ? ' · above' : ' · below'));
    if (cis.length) { const l = cis.at(-1); html += H.row('Last CISD', H.dirName(l.dir) + ' @ ' + hhmm(l.c.t), l.dir > 0 ? C.bull : C.bear); }
    // only draw what is within 120 points of price (NQ); other markets use the same % distance
    const near120 = d => d.k.startsWith('gex') || d.k.startsWith('trade') || (d.type === 'box' ? Math.max(0, d.bot - last, last - d.top) <= TRN : Math.abs(d.p - last) <= TRN);
    html += `<div style="margin-top:4px;color:#6b7385;font-size:10px">Chart shows zones within ${H.fmt(e, TRN)} pts of price (GEX always)</div>`;
    return { html, draws: draws.filter(near120) };
  }
});
