// claude_ictkz — ICT Killzones scanner. Shows everything today: tapped and untapped.
window.__claudeCore({
  key: 'claude_ictkz', title: 'ICT Killzones', color: '#42a5f5', pos: { top: 70, right: 20 },
  run: async function (e, H) {
    const { etp, etMs, addDays, hhmm, C } = H;
    const today = H.tday(Date.now());
    const dayStartGuess = etMs(addDays(today, -1), 18, 0);
    const m1 = await H.bars(e, '1', dayStartGuess);
    if (m1.length < 30) return { html: 'Not enough 1m data yet.', draws: [] };
    const h1 = await H.bars(e, '60', Date.now() - 4 * 864e5);
    const now = m1.at(-1).t + 60000, day = H.tday(m1.at(-1).t), prev = addDays(day, -1);
    const T = (h, m, d = day) => etMs(d, h, m);
    const m5 = H.agg(m1, 5), m15 = H.agg(m1, 15);
    const p = m1.at(-1).c, draws = [];
    const allB = h1.filter(x => x.t < m1[0].t).concat(m1);

    // killzones
    const kz = [['Asia', T(20, 0, prev), T(0, 0), '#9575cd'], ['London', T(2, 0), T(5, 0), '#4fc3f7'], ['NY AM', T(8, 30), T(11, 0), '#ffb74d'], ['NY PM', T(13, 30), T(16, 0), '#81c784']];
    let html = '', cur = null, next = null;
    const liq = [];
    for (const [n, s, en, col] of kz) {
      if (now > s && now < en) cur = n; if (!next && now <= s) next = [n, s];
      const r = H.range(m1, s, Math.min(en, now)); if (!r) continue;
      draws.push({ k: 'kz' + n, type: 'box', t1: s, t2: en, top: r.h, bot: r.l, col, a: 0.05, label: n + ' Killzone' });
      if (now >= en) { liq.push({ name: n + ' High', side: 1, p: r.h, t: r.hT }); liq.push({ name: n + ' Low', side: -1, p: r.l, t: r.lT }); }
    }
    const pd = H.range(h1, T(0, 0, prev), T(0, 0));
    if (pd) { liq.push({ name: 'PDH', side: 1, p: pd.h, t: pd.hT }); liq.push({ name: 'PDL', side: -1, p: pd.l, t: pd.lT }); }
    const sw = H.swings(m15, 2).filter(s => s.i < m15.length - 2);
    for (const s of sw) liq.push({ name: '15m', side: s.side, p: s.p, t: s.t, sw: true });
    // equal highs / lows (15m swings within 0.03%)
    for (let i = 0; i < sw.length; i++) for (let j = i + 1; j < sw.length; j++) if (sw[i].side === sw[j].side && Math.abs(sw[i].p - sw[j].p) <= sw[i].p * 0.0003) { const a = sw[i].side > 0 ? Math.max(sw[i].p, sw[j].p) : Math.min(sw[i].p, sw[j].p); liq.push({ name: '15m Equal ' + (sw[i].side > 0 ? 'Highs' : 'Lows'), side: sw[i].side, p: a, t: sw[j].t }); }

    let lrows = '';
    for (const L of liq) {
      const tk = H.takenAt(allB, L.p, L.side, L.t + (L.sw ? 3 * 15 * 60000 : 60000));
      const side = L.side > 0 ? 'Buyside' : 'Sellside';
      const lbl = (L.sw ? '15m ' : L.name + ' ') + side + ' Liquidity' + (L.sw ? '' : '');
      if (L.sw && tk) continue; // taken 15m swings: skip to keep chart clean
      draws.push({ k: 'liq' + L.name + L.t + L.p, type: 'line', t1: L.t, t2: tk || now + 60 * 60000, p: L.p, col: tk ? C.dim : (L.side > 0 ? C.bsl : C.ssl), style: tk ? 2 : 0, label: lbl + (tk ? ' (Taken)' : '') });
      if (!L.sw) lrows += H.row(L.name, H.fmt(e, L.p) + (tk ? ' · taken ' + hhmm(tk) : ' · open'), tk ? C.dim : (L.side > 0 ? C.bsl : C.ssl));
    }

    // FVGs + RBs on 15m and 5m since the session open (18:00 ET)
    const sod = m1[0].t, zonesOut = [];
    for (const [tf, b, mins] of [['15m', m15, 15], ['5m', m5, 5]]) {
      const avg = b.reduce((a, x) => a + x.h - x.l, 0) / b.length;
      const zs = H.fvgs(b, mins).filter(z => z.top - z.bot >= avg * 0.25).concat(H.rbs(b, mins)).filter(z => z.t >= sod);
      const withTap = zs.map(z => ({ z, tap: H.tapAt(m1, z) }));
      const untapped = withTap.filter(o => !o.tap), tapped = withTap.filter(o => o.tap).slice(-6);
      for (const { z, tap } of untapped.slice(-10).concat(tapped)) {
        const col = tap ? C.dim : (z.dir > 0 ? C.bull : C.bear);
        const lbl = tf + ' ' + H.dirName(z.dir) + ' ' + z.kind + (tap ? ' (Tapped)' : '');
        draws.push({ k: tf + z.kind + z.t + z.dir, type: 'box', t1: z.t, t2: tap || now, top: z.top, bot: z.bot, col, a: tap ? 0.07 : 0.16, ext: !tap, label: lbl });
        if (!tap) zonesOut.push({ lbl, z });
      }
    }
    // recent 5m CISDs
    const cis = [];
    for (const s of H.swings(m5, 2)) { if (s.t < sod) continue; const c = H.cisdAt(m5, s.i, -s.side, now + 1); if (c) cis.push({ dir: -s.side, c }); }
    for (const { dir, c } of cis.slice(-4)) draws.push({ k: 'cisd' + c.sT + dir, type: 'line', t1: c.sT, t2: c.t + 5 * 60000, p: c.lvl, col: dir > 0 ? C.bull : C.bear, style: 2, label: '5m ' + H.dirName(dir) + ' CISD' });

    html += H.row('Killzone now', cur || 'none', cur ? '#00e676' : '#8a93a6');
    if (!cur && next) html += H.row('Next', next[0] + ' @ ' + hhmm(next[1]));
    html += H.row('Price', H.fmt(e, p));
    html += H.hdr('Liquidity', '#8a93a6') + lrows;
    html += H.hdr('Nearest untapped zones', '#8a93a6');
    zonesOut.sort((a, b) => Math.abs((a.z.top + a.z.bot) / 2 - p) - Math.abs((b.z.top + b.z.bot) / 2 - p)).slice(0, 6)
      .forEach(o => html += H.row(o.lbl, H.fmt(e, o.z.bot) + ' – ' + H.fmt(e, o.z.top), o.z.dir > 0 ? C.bull : C.bear));
    if (!zonesOut.length) html += '<div style="color:#8a93a6">none</div>';
    if (cis.length) { const l = cis.at(-1); html += H.row('Last 5m CISD', H.dirName(l.dir) + ' @ ' + hhmm(l.c.t), l.dir > 0 ? C.bull : C.bear); }
    return { html, draws };
  }
});
