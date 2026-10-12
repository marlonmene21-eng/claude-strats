// claude_po3w — PO3 Watch (live). Runs on every 1H and 4H candle all session plus NY AM; shows only setups takeable right now.
window.__claudeCore({
  key: 'claude_po3w', title: 'PO3 Watch', color: '#f5a623', pos: { top: 70, right: 330 },
  run: async function (e, H) {
    const { etp, etMs, addDays, hhmm, C } = H;
    const today = H.tday(Date.now());
    // ~2 sessions of 1m (4 after a weekend) so it works right from the 18:00 open
    let m1 = await H.bars(e, '1', etMs(addDays(today, -2), 18, 0));
    if (m1.length < 1500) m1 = await H.bars(e, '1', etMs(addDays(today, -4), 18, 0));
    if (m1.length < 30) return { html: 'Not enough 1m data yet.', draws: [] };
    const h1 = await H.bars(e, '60', Date.now() - 6 * 864e5);
    const now = m1.at(-1).t + 60000, day = H.tday(m1.at(-1).t), prev = addDays(day, -1);
    const T = (h, m, d = day) => etMs(d, h, m);
    const m5 = H.agg(m1, 5);
    const allB = h1.filter(x => x.t < m1[0].t).concat(m1);

    // liquidity pools
    const pools = [];
    const addR = (name, r) => { if (r) { pools.push({ name: name + ' High', side: 1, p: r.h, t: r.hT }); pools.push({ name: name + ' Low', side: -1, p: r.l, t: r.lT }); } };
    addR('Asia', H.range(m1, T(20, 0, prev), T(0, 0)));
    addR('London', H.range(m1, T(2, 0), T(5, 0)));
    const pd = H.range(h1, T(0, 0, prev), T(0, 0)); if (pd) { pools.push({ name: 'PDH', side: 1, p: pd.h, t: pd.hT }); pools.push({ name: 'PDL', side: -1, p: pd.l, t: pd.lT }); }
    for (const s of H.swings(h1, 2)) pools.push({ name: '1H Swing ' + (s.side > 0 ? 'High' : 'Low'), side: s.side, p: s.p, t: s.t });
    for (const s of H.swings(m5, 2)) pools.push({ name: '5m Swing ' + (s.side > 0 ? 'High' : 'Low'), side: s.side, p: s.p, t: s.t });
    const o830 = m1.find(x => x.t >= T(8, 30) && x.t < T(8, 31));

    // frames: NY AM (9:30), every 1H candle and every 4H candle of the session (18:00 ET → now). Macro hours 7–11 ET are starred.
    const frames = [{ name: 'NY AM ★', short: 'NY AM', tf: 'NY', start: T(9, 30), sweepEnd: T(10, 10), cisdBy: T(10, 30), end: T(12, 0), prevStart: T(8, 30) }];
    const s0 = T(18, 0, prev), HR = 3600e3, lab = t => { const p = etp(t); return String(Math.floor(p.mins / 60)).padStart(2, '0') + ':00'; };
    for (let t = s0 - 8 * HR; t <= now; t += HR) { const h = Math.floor(etp(t).mins / 60), star = h >= 7 && h <= 11 ? ' ★' : ''; frames.push({ name: lab(t) + ' 1H' + star, short: lab(t), tf: '1H', start: t, sweepEnd: t + 20 * 60000, cisdBy: t + 30 * 60000, end: t + HR, prevStart: t - HR }); }
    for (let t = s0 - 8 * HR; t <= now; t += 4 * HR) frames.push({ name: lab(t) + ' 4H', short: '4H ' + lab(t), tf: '4H', start: t, sweepEnd: t + 80 * 60000, cisdBy: t + 2 * HR, end: t + 4 * HR, prevStart: t - 4 * HR });

    function evalFrame(f) {
      if (now <= f.start) return { f, st: 'upcoming' };
      const si = m1.findIndex(x => x.t >= f.start); if (si < 0) return { f, st: 'upcoming' };
      const O = m1[si].o, prevC = H.range(m1, f.prevStart, f.start);
      const lv = pools.filter(p => p.t < f.start).concat(prevC ? [{ name: 'Prior candle High', side: 1, p: prevC.h }, { name: 'Prior candle Low', side: -1, p: prevC.l }] : []);
      const cands = [];
      for (const dir of [1, -1]) {
        let k = -1;
        for (let j = si; j < m1.length && m1[j].t < f.sweepEnd; j++) if (k < 0 || (dir > 0 ? m1[j].l < m1[k].l : m1[j].h > m1[k].h)) k = j;
        if (k < 0) continue;
        const ext = dir > 0 ? m1[k].l : m1[k].h;
        if (dir > 0 ? ext >= O : ext <= O) continue;
        const swept = lv.filter(p => { if (p.side !== -dir || !(dir > 0 ? ext < p.p && p.p < O : ext > p.p && p.p > O)) return false; const tk = H.takenAt(allB, p.p, -dir, (p.t || 0) + 1); return !tk || tk >= f.start; }).map(p => p.name);
        const cs = H.cisdAt(m1, k, dir, f.cisdBy);
        cands.push({ dir, k, ext, cs, swept: [...new Set(swept)] });
      }
      const ok = cands.filter(c => c.cs).sort((a, b) => a.cs.idx - b.cs.idx)[0];
      if (!ok) return { f, st: now < f.cisdBy ? 'watching' : 'no setup', O, cands };
      const { dir, k, ext, cs } = ok;
      // first FVG after the CISD candle
      let fv = null;
      for (let i = Math.max(2, cs.idx); i < m1.length && m1[i].t < f.end; i++) {
        if (dir > 0 && m1[i - 2].h < m1[i].l) { fv = { top: m1[i].l, bot: m1[i - 2].h, i, t: m1[i - 2].t }; break; }
        if (dir < 0 && m1[i - 2].l > m1[i].h) { fv = { top: m1[i - 2].l, bot: m1[i].h, i, t: m1[i - 2].t }; break; }
      }
      if (!fv) return { f, st: now < f.end ? 'CISD – waiting for FVG' : 'no setup', O, ok };
      const entry = dir > 0 ? fv.top : fv.bot;
      const stop = H.rt(e, dir > 0 ? ext * (1 - 0.0003) : ext * (1 + 0.0003));
      const R = Math.abs(entry - stop);
      const tl = [{ name: f.tf === 'NY' ? '9:30 Open' : f.short + ' Open', p: O }];
      if (o830 && o830.t < f.start) tl.push({ name: '8:30 Open', p: o830.o });
      for (const p of lv) { if (p.side !== dir) continue; const tk = H.takenAt(allB, p.p, dir, (p.t || 0) + 1); if (!tk || tk > cs.t) tl.push(p); }
      const beyond = n => tl.filter(p => dir > 0 ? p.p >= entry + n * R : p.p <= entry - n * R).sort((a, b) => dir * (a.p - b.p))[0];
      const t1 = beyond(1) || { name: '1R', p: entry + dir * R }, t2 = beyond(2) || { name: '2R', p: entry + dir * 2 * R };
      let st = 'pending', fillT = null, tp1 = false;
      for (let j = fv.i + 1; j < m1.length; j++) {
        const x = m1[j];
        if (st === 'pending') {
          if (x.t >= f.end) { st = 'expired'; break; }
          if (dir > 0 ? x.c < ext : x.c > ext) { st = 'invalid'; break; }
          if (dir > 0 ? x.l <= entry : x.h >= entry) { st = 'active'; fillT = x.t; if (dir > 0 ? x.l <= stop : x.h >= stop) { st = 'stopped'; break; } }
        } else {
          if (dir > 0 ? x.l <= stop : x.h >= stop) { st = 'stopped'; break; }
          if (dir > 0 ? x.h >= t1.p : x.l <= t1.p) tp1 = true;
          if (dir > 0 ? x.h >= t2.p : x.l <= t2.p) { st = 'done'; break; }
        }
      }
      if (st === 'pending' && now >= f.end) st = 'expired';
      if ((st === 'pending' || st === 'active') && now - m1[fv.i].t > 3600e3) st = 'cleared (1h old)';   // wipe trades an hour after they were posted
      return { f, st, O, ok, fv, entry, stop, R, t1, t2, tp1, fillT };
    }

    const res = frames.map(evalFrame);
    const draws = [], live = [];
    // same trade found by two frames (e.g. 18:00 1H and 18:00 4H) → show it once
    for (const r of res.filter(r => r.st === 'pending' || r.st === 'active')) { const d = live.find(x => x.ok.dir === r.ok.dir && x.entry === r.entry && x.stop === r.stop); if (d) d.f = { ...d.f, name: d.f.name + ' + ' + r.f.name }; else live.push(r); }
    for (const r of live) {
      const d = r.ok.dir, col = d > 0 ? C.bull : C.bear, k = r.f.short, id = k + r.f.start;
      draws.push({ k: id + 'fvg', type: 'box', t1: r.fv.t, t2: now, top: r.fv.top, bot: r.fv.bot, col, ext: true, label: '1m ' + H.dirName(d) + ' FVG' });
      draws.push({ k: id + 'cisd', type: 'line', t1: r.ok.cs.sT, t2: r.ok.cs.t + 60000, p: r.ok.cs.lvl, col, style: 2, label: '1m ' + H.dirName(d) + ' CISD' });
      draws.push({ k: id + 'en', type: 'line', t1: r.fv.t, p: r.entry, col: C.entry, w: 2, label: k + ' PO3 Entry' });
      draws.push({ k: id + 'sl', type: 'line', t1: r.fv.t, p: r.stop, col: C.sl, w: 2, label: k + ' PO3 SL' });
      draws.push({ k: id + 't1', type: 'line', t1: r.fv.t, p: r.t1.p, col: C.tp, label: k + ' PO3 TP1' });
      draws.push({ k: id + 't2', type: 'line', t1: r.fv.t, p: r.t2.p, col: C.tp, w: 2, label: k + ' PO3 TP2' });
    }

    const stCol = { pending: '#f5a623', active: '#00e676', watching: '#42a5f5', upcoming: '#6b7385' };
    let html = '';
    if (!live.length) html += `<div style="color:#8a93a6;margin-bottom:4px">No PO3 trade takeable right now.</div>`;
    for (const r of live) {
      const d = r.ok.dir;
      html += H.hdr(`${r.f.name} — ${d > 0 ? 'LONG' : 'SHORT'} ${r.st === 'active' ? '(in trade)' : '(waiting for fill)'}`, d > 0 ? C.bull : C.bear);
      if (r.ok.swept.length) html += H.row('Swept', r.ok.swept.join(', '));
      html += H.row('Manipulation', H.fmt(e, r.ok.ext) + ' @ ' + hhmm(m1[r.ok.k].t));
      html += H.row('CISD', H.fmt(e, r.ok.cs.lvl) + ' @ ' + hhmm(r.ok.cs.t));
      html += H.row('Entry (FVG edge)', H.fmt(e, r.entry), C.entry);
      html += H.row('Stop', H.fmt(e, r.stop), C.sl);
      html += H.row('TP1 · ' + r.t1.name, H.fmt(e, r.t1.p) + (r.tp1 ? ' ✓' : ''), C.tp);
      html += H.row('TP2 · ' + r.t2.name, H.fmt(e, r.t2.p), C.tp);
      html += H.row('R:R to TP2', (Math.abs(r.t2.p - r.entry) / r.R).toFixed(1) + 'R');
    }
    html += H.hdr('Frames — every 1H & 4H candle, all session (ET)', '#8a93a6');
    // recent frames only (started in the last 4h, plus anything live), newest first
    for (const r of res.filter(r => r.st === 'pending' || r.st === 'active' || (r.f.start <= now && now - r.f.start < 4 * 3600e3) || r.f.tf === 'NY').sort((a, b) => b.f.start - a.f.start)) html += H.row(r.f.name, r.st, stCol[r.st] || '#6b7385');
    return { html, draws };
  }
});
