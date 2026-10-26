// Static force check for the detachable frame: where do the walls settle, and how hard do the
// miters and corner clips press, under the cement and any extra push you want to try?
// Each wall is a rigid body in plan with three freedoms: slide along (u), move inwards (v) and
// twist (φ, about its centre). Both ends of every miter face (its inside edge and its flap tip),
// the corner clips and the plate edge are stiff one-way contacts; a clip stops its two flaps
// parting or sliding along each other once its play is taken up. The resting pose minimises the
// total energy: each round linearises the contacts about the current pose and solves for the step
// with the touching contacts held (an active set), until nothing moves. Lengths in mm, forces in N.
import { wallInfo, cornerRadius, flapOutline, fromUV, FLAP_LEN, FLARE, FLARE_LEN } from "./moldspec.js";

const K = 2e4;      // contact stiffness, N/mm: stiff enough that stops give way by about a micron
const EPS = 0.05;   // weak spring to home, N/mm: settles the frame floating in the plate gap (0.3 mm costs 0.015 N)

const rot = (a, [x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

function solve(A, b) {   // Gaussian elimination with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

export const CORNERS = ["bottom-left", "bottom-right", "top-right", "top-left"];
export const WALLS = ["bottom", "right", "top", "left"];

// load: { push: { wall, at: 0..1 along, inward, along } (N),
// cement: N of outward pressure on each wall (applied at its middle), error: mm the bottom wall's
// left miter stands proud at its inside edge (a miter cut a little off 45°) }
// frameModel sets the problem up; round() moves all four walls one step together (optionally capped,
// for animation), report() reads off forces and squareness. frameForces runs it to rest from home.
export function frameForces(o, load) {
  const m = frameModel(o, load);
  let q = new Array(12).fill(0);
  for (let i = 0; i < 80; i++) { const r = m.round(q); q = r.q; if (r.step < 1e-8) break; }
  return m.report(q);
}
export function frameModel(o, load) {
  const { I, L } = wallInfo(o), W = o.W, c = o.clear, S = o.S, h = S / 2, C = [L / 2, W / 2];
  // wall k at home: local -> world is a quarter turn k about the tile centre after shifting into place
  const home = k => { const a = k * Math.PI / 2, [tx, ty] = rot(a, [-W - c - h, -W - c - h]); return { a, tx: tx + h, ty: ty + h }; };
  const H = [0, 1, 2, 3].map(home);
  const toWorld = (q, k, [x, y]) => {
    const [u, v, f] = q.slice(3 * k, 3 * k + 3), [rx, ry] = rot(f, [x - C[0], y - C[1]]);
    const [wx, wy] = rot(H[k].a, [C[0] + rx + u, C[1] + ry + v]);
    return [wx + H[k].tx, wy + H[k].ty];
  };
  const toLocal = (q, k, [X, Y]) => {
    const [u, v, f] = q.slice(3 * k, 3 * k + 3), [lx, ly] = rot(-H[k].a, [X - H[k].tx, Y - H[k].ty]);
    const [rx, ry] = rot(-f, [lx - u - C[0], ly - v - C[1]]);
    return [rx + C[0], ry + C[1]];
  };
  // contacts: [label, corner, penetration(q)]. Wall k's left miter (k-local x = y) meets wall j's
  // right miter (j-local x + y = L); checking k's two face ends against j's face carries the twist.
  const e = load.error || 0, contacts = [], [, tip] = flapOutline(), m = W + cornerRadius(o) * (1 - Math.SQRT1_2);
  const open = (q, k, j, p) => { const [x, y] = toLocal(q, j, toWorld(q, k, p)); return (x + y - L) / Math.SQRT2; };   // > 0: apart
  for (let k = 0; k < 4; k++) {
    const j = (k + 3) % 4, inner = [m - (k === 0 ? e : 0) / Math.SQRT2, m + (k === 0 ? e : 0) / Math.SQRT2];   // e pushes it into the neighbour
    contacts.push(["inside edge", k, q => -open(q, k, j, inner)], ["flap tip", k, q => -open(q, k, j, tip)]);
  }
  // corner clips. The walls are rigid top to bottom, so the clip's snug bottom slice sets the play:
  // there the flaps can part by both of its gaps, and slide along each other by the gap behind the
  // tips plus the gap on the hook's flank, stretched by its slope. Checked where the jaws start and
  // at the tips, so the clip also resists the flaps turning inside it.
  const gap = o.clear * 0.5 / 8, across = 2 * gap, along = gap * (1 + Math.hypot(FLARE, FLARE_LEN) / FLARE);
  const jaw = [fromUV([FLAP_LEN - FLARE_LEN - 2, 0]), fromUV([FLAP_LEN, 0])];
  const slide = (q, k, j, p) => { const [x, y] = toLocal(q, j, toWorld(q, k, p)); return (x - y) / Math.SQRT2; };
  for (let k = 0; k < 4; k++) {
    const j = (k + 3) % 4, s0 = slide(new Array(12).fill(0), k, j, jaw[1]);
    for (const p of jaw) contacts.push(["clip across", k, q => open(q, k, j, p) - across]);
    contacts.push(["clip along", k, q => slide(q, k, j, jaw[1]) - s0 - along], ["clip along", k, q => s0 - slide(q, k, j, jaw[1]) - along]);
  }
  // plate edge: the plate's corners must stay outside each wall's inner face
  const plate = [[0, 0], [S, 0], [S, S], [0, S]];
  for (let k = 0; k < 4; k++) for (const p of [plate[k], plate[(k + 1) % 4]]) contacts.push([`plate edge`, -1 - k, q => W - toLocal(q, k, p)[1]]);

  const pushes = [...(load.push ? [load.push] : []), ...(load.cement ? [0, 1, 2, 3].map(wall => ({ wall, at: 0.5, inward: -load.cement, along: 0 })) : [])]
    .filter(p => p.inward || p.along);
  // energy pieces other than the contacts, as functions of the pose
  const outside = q => {
    let E = 0;
    for (const push of pushes) {
      const at = [W + I * push.at, 0], p0 = toWorld(new Array(12).fill(0), push.wall, at), p1 = toWorld(q, push.wall, at);
      const [fx, fy] = rot(H[push.wall].a, [push.along, push.inward]);
      E -= fx * (p1[0] - p0[0]) + fy * (p1[1] - p0[1]);
    }
    return E;
  };
  // total energy for the line search
  const energy = q => {
    let E = outside(q);
    for (const [, , pen] of contacts) { const d = pen(q); if (d > 0) E += 0.5 * K * d * d; }
    return E + 0.5 * EPS * q.reduce((s, v) => s + v * v, 0);
  };
  const jac = (fn, q) => { const f0 = fn(q); return [f0, q.map((_, i) => { const a = [...q]; a[i] += 1e-7; return (fn(a) - f0) / 1e-7; })]; };
  // one step for all four walls together: linearise every contact and the push about the pose,
  // solve with the touching contacts held, then line-search on the energy. maxStep caps the move (mm / rad).
  function round(q, maxStep = Infinity) {
    if (maxStep < Infinity && contacts.every(([, , pen]) => pen(q) <= 0)) {
      // nothing touching yet: overdamped motion, each wall moving the way its net force pushes it
      // (twist mobility scaled by the half length, so a twist moves the wall ends like a slide would)
      const g = jac(energy, q)[1], mob = q.map((_, i) => (i % 3 === 2 ? 4 / (L * L) : 1));
      const v = g.map((x, i) => -x * mob[i]), size = Math.max(...v.map((x, i) => Math.abs(x) * (i % 3 === 2 ? L / 2 : 1))) || 1;
      // stop at the first touch instead of running into the neighbour
      let s = maxStep / size;
      while (s * size > 1e-5 && contacts.some(([, , pen]) => pen(q.map((x, i) => x + v[i] * s)) > 1e-4)) s /= 2;
      return { q: q.map((x, i) => x + v[i] * s), step: s * size };
    }
    const lin = contacts.map(([, , pen]) => jac(pen, q)), f = jac(outside, q)[1];
    // curvature of the push energy (zero for steady pushes, kept so the step stays general)
    const Hc = q.map((_, i) => { const a = [...q]; a[i] += 1e-6; const fa = jac(outside, a)[1]; return fa.map((v, j) => (v - f[j]) / 1e-6); });
    let active = lin.map(([v]) => v > 0), dq = null;
    for (let pass = 0; pass < 40; pass++) {
      const A = q.map((_, i) => q.map((_, j) => (i === j ? EPS : 0) + (Hc[i][j] + Hc[j][i]) / 2)), b = q.map((v, i) => -f[i] - EPS * v);
      lin.forEach(([v, J], c) => {
        if (!active[c]) return;
        for (let i = 0; i < 12; i++) { b[i] -= K * J[i] * v; for (let j = 0; j < 12; j++) A[i][j] += K * J[i] * J[j]; }
      });
      dq = solve(A, b);
      const next = lin.map(([v, J]) => v + J.reduce((s, x, i) => s + x * dq[i], 0) > 0);
      if (next.every((x, c) => x === active[c])) break;
      active = next;
    }
    // take the longest part of the step that lowers the energy (rotations make the linear model overshoot)
    const E0 = energy(q), g = jac(energy, q)[1];
    if (dq.reduce((s, v, i) => s + v * g[i], 0) >= 0) {   // not downhill: fall back to a gradient step
      const gn = Math.hypot(...g) || 1;
      dq = g.map(v => -v / gn * 1e-3);
    }
    const big = Math.max(...dq.map(Math.abs));
    if (big > maxStep) dq = dq.map(v => v * maxStep / big);
    let s = 1;
    while (s > 1e-4 && energy(q.map((v, i) => v + s * dq[i])) > E0) s /= 2;
    return { q: q.map((v, i) => v + s * dq[i]), step: Math.max(...dq.map(Math.abs)) * s };
  }

  // report: stop forces, joint gaps, squareness
  function report(q) {
  const force = {}, gaps = {};
  for (const [label, corner, pen] of contacts) {
    const key = `${corner}|${label}`, d = pen(q);
    force[key] = (force[key] || 0) + K * Math.max(0, d);
    gaps[key] = Math.min(gaps[key] ?? Infinity, Math.max(0, -d));
  }
  const stops = Object.keys(force).map(key => { const [corner, label] = key.split("|"); return { corner: +corner, label, force: force[key], gap: gaps[key] }; });
  const inner = k => toWorld(q, k, [W, W]);   // inside corner at each wall's left end
  const angle = k => {   // angle between wall k-1's and wall k's inner faces at their shared corner
    const j = (k + 3) % 4, a = q[3 * k + 2] - q[3 * j + 2];
    return 90 + a * 180 / Math.PI;
  };
  const corners = [0, 1, 2, 3].map(inner);
  return {
    q, stops,
    toWorld: (k, p) => toWorld(q, k, p), home: (k, p) => toWorld(new Array(12).fill(0), k, p),
    angles: [0, 1, 2, 3].map(angle),
    diagonals: [Math.hypot(corners[0][0] - corners[2][0], corners[0][1] - corners[2][1]), Math.hypot(corners[1][0] - corners[3][0], corners[1][1] - corners[3][1])],
    moves: [0, 1, 2, 3].map(k => ({ along: q[3 * k], inward: q[3 * k + 1], twist: q[3 * k + 2] * 180 / Math.PI })),
  };
  }
  return { round, report };
}
