// NDX + NDXP + QQQ options from CBOE (free, ~15 min delayed quotes, open interest updates daily).
// Returns the snapshot levels plus the compact option chain, so the AMD Range Model can re-price gamma live with the live futures price.
async function gexCalc() {
  const get = s => fetch('https://cdn-api.cboe.com/api/global/delayed_quotes/options/' + s + '.json').then(r => r.json());
  const [jn, jq] = await Promise.all([get('_NDX'), get('QQQ').catch(() => null)]);
  const SN = jn.data.current_price, now = Date.now(), o = [], R = jq ? SN / jq.data.current_price : 1;
  const add = (j, re, sc) => {
    const S = j.data.current_price;
    for (const x of j.data.options) {
      const m = re.exec(x.option); if (!m || !x.open_interest || !x.iv) continue;
      const X = Date.UTC(2000 + +m[1], m[2] - 1, +m[3], 20), T = (X - now) / 31536e6; if (T <= 0 || T > 60 / 365) continue;
      o.push({ K: m[5] / 1e3, c: m[4] == 'C', oi: x.open_interest, iv: x.iv, gm: x.gamma, T: Math.max(T, 1 / 8760), X, S, sc });
    }
  };
  add(jn, /^NDXP?(\d\d)(\d\d)(\d\d)([CP])(\d{8})$/, 1); if (jq) add(jq, /^QQQ(\d\d)(\d\d)(\d\d)([CP])(\d{8})$/, R);
  const lv = gexLevels(o, SN, R, !!jq, true);
  // compact chain: [strike (own units), scale to NDX, +1 call / -1 put, OI, IV, expiry ms]
  const chain = o.filter(q => q.K * q.sc > SN * 0.85 && q.K * q.sc < SN * 1.15).map(q => [q.K, +q.sc.toFixed(5), q.c ? 1 : -1, q.oi, +q.iv.toFixed(4), q.X]);
  return { type: 'claude_gex', S: SN, ts: Date.parse(jn.timestamp.replace(' ', 'T') + 'Z'), ...lv, R, chain, src: jq ? 'NDX + NDXP + QQQ' : 'NDX + NDXP', at: Date.now() };
}
// gamma levels at NDX spot SN. o: [{K, sc, c, oi, iv, T, gm?, S?}]. useGm: use CBOE's own gamma at the snapshot spot.
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
