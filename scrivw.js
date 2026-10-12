// claude_scrivw — Scriv Model (live). Shows only setups takeable right now.
window.__claudeCore({
  key: 'claude_scrivw', title: 'Scriv Model', color: '#ab47bc', pos: { top: 70, right: 640 },
  run: async function (e, H) {
    const { etp, etMs, addDays, hhmm, C } = H;
    const today = H.tday(Date.now());
    const m1 = await H.bars(e, '1', etMs(addDays(today, -1), 18, 0));
    if (m1.length < 30) return { html: 'Not enough 1m data yet.', draws: [] };
    const m15 = await H.bars(e, '15', Date.now() - 4 * 864e5);
    const now = m1.at(-1).t + 60000, day = H.tday(m1.at(-1).t), prev = addDays(day, -1);
    const T = (h, m, d = day) => etMs(d, h, m);
    const m5 = H.agg(m1, 5);
    const allB = m15.filter(x => x.t < m1[0].t).concat(m1);

    const kzs = [
      { name: 'London', start: T(2, 0), end: T(5, 0) },
      { name: 'NY AM', start: T(8, 30), end: T(11, 0) },
      { name: 'NY PM', start: T(13, 30), end: T(16, 0) }];
    const sess = { Asia: H.range(m1, T(20, 0, prev), T(0, 0)), London: H.range(m1, T(2, 0), T(5, 0)), 'NY AM': H.range(m1, T(8, 30), T(11, 0)) };
    const pd = H.range(m15, T(0, 0, prev), T(0, 0));
    const swings15 = H.swings(m15, 2);
    const rb5 = H.rbs(m5, 5), fv5 = H.fvgs(m5, 5);

    // 15m order flow at time t: direction of the last close through a confirmed swing
    function flow(t) {
      let hi = null, lo = null, d = 0;
      for (let i = 0; i < m15.length && m15[i].t + 15 * 60000 <= t; i++) {
        for (const s of swings15) if (s.i === i - 2) { if (s.side > 0) hi = s.p; else lo = s.p; }
        if (hi != null && m15[i].c > hi) { d = 1; hi = null; }
        if (lo != null && m15[i].c < lo) { d = -1; lo = null; }
      }
      return d;
    }

    function evalKz(z) {
      if (now <= z.start) return { z, st: 'upcoming' };
      const pools = [];
      const add = (n, r, endT) => { if (r && endT <= z.start) { pools.push({ name: n + ' High', side: 1, p: r.h, t: r.hT }); pools.push({ name: n + ' Low', side: -1, p: r.l, t: r.lT }); } };
      add('Asia', sess.Asia, T(0, 0)); add('London', sess.London, T(5, 0)); add('NY AM', sess['NY AM'], T(11, 0));
      if (pd) { pools.push({ name: 'PDH', side: 1, p: pd.h, t: pd.hT }); pools.push({ name: 'PDL', side: -1, p: pd.l, t: pd.lT }); }
      for (const s of swings15) if (s.t + 3 * 15 * 60000 <= z.start) pools.push({ name: '15m Swing ' + (s.side > 0 ? 'High' : 'Low'), side: s.side, p: s.p, t: s.t });
      const live = pools.filter(p => { const tk = H.takenAt(allB, p.p, p.side, p.t + 1); return !tk || tk >= z.start; });
      const si = m5.findIndex(x => x.t >= z.start); if (si < 0) return { z, st: 'upcoming' };
      const setups = [];
      for (const dir of [1, -1]) {
        // first raid of opposing liquidity inside the killzone
        let r = -1, raided = null;
        for (let j = si; j < m5.length && m5[j].t < z.end && r < 0; j++) {
          const hit = live.filter(p => p.side === -dir && (dir > 0 ? m5[j].l < p.p : m5[j].h > p.p));
          if (hit.length) { r = j; raided = hit.map(p => p.name); }
        }
        if (r < 0) continue;
        const of = flow(m5[r].t);
        if (of === -dir) { setups.push({ dir, st: 'against 15m flow', raided }); continue; }
        // extreme + CISD on 5m
        let k = r, cs = null;
        for (let j = r; j < m5.length && m5[j].t < z.end; j++) {
          if (dir > 0 ? m5[j].l < m5[k].l : m5[j].h > m5[k].h) k = j;
          const c = H.cisdAt(m5.slice(0, j + 1), k, dir, z.end);
          if (c && c.idx === j) { cs = c; break; }
        }
        if (!cs) { setups.push({ dir, st: now < z.end ? 'raid – waiting CISD' : 'no CISD', raided }); continue; }
        setups.push({ dir, k, cs, raided, of });
      }
      const s = setups.filter(x => x.cs).sort((a, b) => a.cs.idx - b.cs.idx)[0];
      if (!s) return { z, st: setups[0] ? setups[0].st : (now < z.end ? 'waiting for raid' : 'no raid'), setups };
      const dir = s.dir, ext = dir > 0 ? m5[s.k].l : m5[s.k].h, L1 = s.cs.lvl, rm = Math.abs(L1 - ext);
      const stop = H.rt(e, dir > 0 ? ext * (1 - 0.0003) : ext * (1 + 0.0003));
      const zones = rb5.concat(fv5).filter(q => q.dir === dir && q.t >= m5[Math.max(0, s.k - 1)].t);
      for (const q of zones) if (q.tap === undefined) q.tap = H.tapAt(m1, q);
      let legX = dir > 0 ? Math.max(...m5.slice(s.k, s.cs.idx + 1).map(x => x.h)) : Math.min(...m5.slice(s.k, s.cs.idx + 1).map(x => x.l));
      const startT = s.cs.t + 5 * 60000;
      let st = 'pending', entry = null, conf = null, ote = null, fillT = null, tps = null, hit = 0, be = false;
      const plan = (t) => {
        const r = Math.abs(legX - ext), at = f => legX - dir * f * r;
        ote = { a: at(0.62), b: at(0.79), m: at(0.705) };
        const lo = Math.min(ote.a, ote.b), hi = Math.max(ote.a, ote.b);
        const c = zones.filter(q => q.ready <= t && (!q.tap || q.tap >= t))
          .map(q => ({ q, edge: dir > 0 ? q.top : q.bot })).filter(o => o.edge >= lo && o.edge <= hi)
          .sort((a, b) => Math.abs(a.edge - ote.m) - Math.abs(b.edge - ote.m))[0];
        conf = c ? c.q : null; entry = H.rt(e, c ? c.edge : ote.m);
      };
      for (const x of m1) {
        if (x.t < startT) continue;
        if (st === 'pending') {
          if (x.t >= z.end) { st = 'expired'; break; }
          plan(x.t);
          if (dir > 0 ? x.l <= stop : x.h >= stop) { st = 'invalid'; break; }
          if (dir > 0 ? x.l <= entry : x.h >= entry) {
            st = 'active'; fillT = x.t;
            tps = [1, 2, 2.5].map(f => L1 + dir * f * rm).filter(p => dir > 0 ? p > entry : p < entry);
            if (tps.length < 2) { const R = Math.abs(entry - stop); while (tps.length < 3) tps.push(entry + dir * R * (tps.length + 1)); }
            if (dir > 0 ? x.l <= stop : x.h >= stop) { st = 'stopped'; break; }
            continue;
          }
          legX = dir > 0 ? Math.max(legX, x.h) : Math.min(legX, x.l);
        } else {
          const sl = be ? entry : stop;
          if (dir > 0 ? x.l <= sl : x.h >= sl) { st = be ? 'BE stop' : 'stopped'; break; }
          while (hit < tps.length && (dir > 0 ? x.h >= tps[hit] : x.l <= tps[hit])) { hit++; be = true; }
          if (hit >= tps.length) { st = 'done'; break; }
        }
      }
      if ((st === 'pending' || st === 'active') && now - startT > 3600e3) st = 'cleared (1h old)';   // wipe trades an hour after they were posted
      if (st === 'pending') plan(now);
      if (!tps) { tps = [1, 2, 2.5].map(f => L1 + dir * f * rm).filter(p => dir > 0 ? p > entry : p < entry); if (tps.length < 2) { const R = Math.abs(entry - stop); while (tps.length < 3) tps.push(entry + dir * R * (tps.length + 1)); } }
      const exh = L1 + dir * 4 * rm;
      return { z, st, dir, s, ext, L1, stop, entry, conf, ote, tps, hit, be, fillT, exh, legX, zones };
    }

    const res = kzs.map(evalKz);
    const draws = [], live = res.filter(r => r.st === 'pending' || r.st === 'active');
    for (const r of live) {
      const d = r.dir, col = d > 0 ? C.bull : C.bear, k = r.z.name, dn = H.dirName(d), t0 = m5[r.s.k].t;
      draws.push({ k: k + 'ote', type: 'box', t1: r.s.cs.t, t2: now + 30 * 60000, top: Math.max(r.ote.a, r.ote.b), bot: Math.min(r.ote.a, r.ote.b), col: '#ab47bc', a: 0.1, label: '5m ' + dn + ' OTE' });
      draws.push({ k: k + 'cisd', type: 'line', t1: r.s.cs.sT, t2: r.s.cs.t + 5 * 60000, p: r.L1, col, style: 2, label: '5m ' + dn + ' CISD' });
      const shown = r.zones.filter(q => !q.tap || (r.st === 'active' && q === r.conf));
      for (const q of shown) draws.push({ k: k + q.kind + q.t + q.top, type: 'box', t1: q.t, t2: now, top: q.top, bot: q.bot, col, ext: true, label: '5m ' + dn + ' ' + q.kind });
      draws.push({ k: k + 'en', type: 'line', t1: t0, p: r.entry, col: C.entry, w: 2, label: k + ' Scriv Entry' });
      draws.push({ k: k + 'sl', type: 'line', t1: t0, p: r.be ? r.entry : r.stop, col: C.sl, w: 2, label: k + (r.be ? ' Scriv SL (BE)' : ' Scriv SL') });
      ['−1', '−2', '−2.5'].forEach((n, i) => { if (r.tps[i] != null && i >= r.hit) draws.push({ k: k + 'tp' + i, type: 'line', t1: t0, p: r.tps[i], col: C.tp, w: i === 1 ? 2 : 1, label: k + ' Scriv TP' + (i + 1) + ' (STDV ' + n + ')' }); });
    }

    const stCol = { pending: '#f5a623', active: '#00e676', upcoming: '#6b7385' };
    let html = '';
    if (!live.length) html += `<div style="color:#8a93a6;margin-bottom:4px">No Scriv trade takeable right now.</div>`;
    for (const r of live) {
      html += H.hdr(`${r.z.name} — ${r.dir > 0 ? 'LONG' : 'SHORT'} ${r.st === 'active' ? '(in trade)' : '(waiting for OTE fill)'}`, r.dir > 0 ? C.bull : C.bear);
      html += H.row('Raided', r.s.raided.join(', '));
      html += H.row('15m order flow', r.s.of > 0 ? 'Bullish' : r.s.of < 0 ? 'Bearish' : 'Neutral');
      html += H.row('Raid extreme', H.fmt(e, r.ext) + ' @ ' + hhmm(m5[r.s.k].t));
      html += H.row('CISD', H.fmt(e, r.L1) + ' @ ' + hhmm(r.s.cs.t));
      html += H.row('OTE 62–79%', H.fmt(e, Math.min(r.ote.a, r.ote.b)) + ' – ' + H.fmt(e, Math.max(r.ote.a, r.ote.b)));
      html += H.row('Entry · ' + (r.conf ? '5m ' + r.conf.kind : '70.5%'), H.fmt(e, r.entry), C.entry);
      html += H.row('Stop' + (r.be ? ' (moved to BE)' : ''), H.fmt(e, r.be ? r.entry : r.stop), C.sl);
      r.tps.forEach((p, i) => html += H.row('TP' + (i + 1) + ' STDV ' + ['−1', '−2', '−2.5'][i], H.fmt(e, p) + (i < r.hit ? ' ✓' : ''), C.tp));
      html += H.row('Exhaustion −4', H.fmt(e, r.exh));
    }
    html += H.hdr('Killzones today (ET)', '#8a93a6');
    for (const r of res) html += H.row(r.z.name, r.st, stCol[r.st] || '#6b7385');
    return { html, draws };
  }
});
