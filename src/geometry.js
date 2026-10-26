// Solid modelling for the mold parts. Pattern outlines come from Clipper booleans; every part is
// then built and merged with manifold-3d, so each part exports as one clean, watertight body.
// 3D frame: mm, Z up, y up the design. Runs in the build worker (and in node for tests).
import ClipperLib from "clipper-lib";
import Module from "manifold-3d";
import { SYM, OFFS, xf, trace, isLine, lineWidth, flatten } from "./pattern.js";
import { wallInfo, cornerRadius, flapOutline, FLAP_LEN, plateRadius, grooveHeights, LOCK_TONGUE, hasLock } from "./moldspec.js";

let M = null;
export async function initGeometry(opts) {
  if (!M) { M = await Module(opts); M.setup(); }
  return M;
}

// Manifold objects live in WASM memory; track every one made during a build and free them after.
function arena(fn) {
  const made = [];
  try { return fn(x => (made.push(x), x)); }
  finally { for (const x of made) x.delete(); }
}
function positions(man) {
  const { vertProperties: v, triVerts: t, numProp: np } = man.getMesh(), out = new Float32Array(t.length * 3);
  for (let i = 0; i < t.length; i++) { const k = t[i] * np; out[i * 3] = v[k]; out[i * 3 + 1] = v[k + 1]; out[i * 3 + 2] = v[k + 2]; }
  return out;
}

// ---- pattern outlines (Clipper integer units)
const SC = 1000;
const NZ = () => ClipperLib.PolyFillType.pftNonZero;
function clipPaths(a, b, type) {
  const c = new ClipperLib.Clipper(), sol = [];
  if (a.length) c.AddPaths(a, ClipperLib.PolyType.ptSubject, true);
  if (b && b.length) c.AddPaths(b, ClipperLib.PolyType.ptClip, true);
  c.Execute(type, sol, NZ(), NZ());
  return sol;
}
// every symmetric + wrapped copy of a shape that touches the tile, as positive-wound Clipper paths
function shapeCopies(s, S, seg, sym) {
  const base = flatten(s, seg), out = [], pad = isLine(s) ? lineWidth(s) : 0;
  for (const [ox, oy] of OFFS) for (const m of SYM[sym]) {
    const t = xf(m, ox * S, oy * S, S);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const paths = base.map(c => c.map(([x, y]) => {
      const X = t[0] * x + t[2] * y + t[4], Y = t[1] * x + t[3] * y + t[5];
      x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
      return { X: Math.round(X * SC), Y: Math.round(Y * SC) };
    }));
    if (x1 < -pad || x0 > S + pad || y1 < -pad || y0 > S + pad) continue;
    if (isLine(s)) {
      const co = new ClipperLib.ClipperOffset(2, 0.01 * SC), sol = [];
      co.AddPaths(paths, ClipperLib.JoinType.jtRound, s.outline ? ClipperLib.EndType.etClosedLine : ClipperLib.EndType.etOpenRound);
      co.Execute(sol, lineWidth(s) / 2 * SC); out.push(...sol);
    } else for (const p of paths) if (p.length > 2) out.push(ClipperLib.Clipper.Orientation(p) ? p : p.reverse());
  }
  return out;
}
// region raised to at least each height level, applying raise/cut in drawing order
function levelRegions(list, sym, S, seg) {
  const CT = ClipperLib.ClipType, cache = list.map(s => shapeCopies(s, S, seg, sym));
  const levels = [...new Set(list.filter(s => !s.cut).map(s => s.level || 100))].sort((a, b) => a - b);
  return levels.map(L => {
    let r = [];
    list.forEach((s, i) => {
      if (s.cut) { if (r.length) r = clipPaths(r, cache[i], CT.ctDifference); }
      else if ((s.level || 100) >= L) r = clipPaths(r, cache[i], CT.ctUnion);
    });
    return { L, r };
  });
}

function roundedSquare(a, b, r) {
  if (!(r > 0.05)) return [[a, a], [b, a], [b, b], [a, b]];
  const pts = [], n = Math.max(6, Math.ceil(r * Math.PI / 2 / 0.25));
  [[b - r, a + r, -0.5], [b - r, b - r, 0], [a + r, b - r, 0.5], [a + r, a + r, 1]].forEach(([cx, cy, s]) => {
    for (let i = 0; i <= n; i++) { const t = (s + i / n * 0.5) * Math.PI; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
  });
  return pts;
}
// 2D contours extruded between z0 and z1
const prism = (T, contours, z0, z1) => T(T(new M.CrossSection(contours, "EvenOdd")).extrude(z1 - z0)).translate([0, 0, z0]);

// Watertight stack of slabs built directly as one mesh, with no booleans. layers: [{cs, z0, z1}]
// sorted bottom to top, touching, each outline strictly inside the one below. Walls join each
// layer's bottom and top rings; each ledge is the ring between a layer's outline and the next one's.
function stackSolid(layers) {
  const verts = [], tris = [];
  const ring = (polys, z) => polys.map(c => { const s = verts.length / 3; for (const [x, y] of c) verts.push(x, y, z); return s; });
  const cap = (groups, up) => {     // groups: [{polys, starts, flip}] triangulated together
    const pts = [], idx = [];
    for (const { polys, starts, flip } of groups) polys.forEach((c, k) => {
      const ids = c.map((_, i) => starts[k] + i);
      (flip ? [...c].reverse() : c).forEach(p => pts.push(p));
      (flip ? ids.reverse() : ids).forEach(i => idx.push(i));
    });
    const flat = [], counts = [];
    let off = 0;
    for (const { polys, flip } of groups) for (const c of polys) { flat.push(flip ? [...c].reverse() : c); counts.push(off); off += c.length; }
    for (const [a, b, c] of M.triangulate(flat, 1e-7)) up ? tris.push(idx[a], idx[b], idx[c]) : tris.push(idx[a], idx[c], idx[b]);
  };
  let below = null;
  layers.forEach(({ cs, z0, z1 }, li) => {
    const polys = cs.toPolygons(), bot = ring(polys, z0), top = ring(polys, z1);
    polys.forEach((c, k) => {
      for (let i = 0; i < c.length; i++) {
        const j = (i + 1) % c.length, p0 = bot[k] + i, q0 = bot[k] + j, p1 = top[k] + i, q1 = top[k] + j;
        tris.push(p0, q0, q1, p0, q1, p1);
      }
    });
    if (!below) cap([{ polys, starts: bot }], false);
    else cap([{ polys: below.polys, starts: below.top }, { polys, starts: bot, flip: true }], true);
    below = { polys, top };
    if (li === layers.length - 1) cap([{ polys, starts: top }], true);
  });
  const man = new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris) }));
  if (man.status() !== "NoError") { const s = man.status(); man.delete(); throw new Error("stack mesh: " + s); }
  return man;
}

// o: {S, D, B, W, T, mode, kind, mirror, draft, seg, step, clear, grooves, ri, sym}
// The relief is a stack of thin slabs, each offset inwards a little more (the draft). Slab outlines
// come from manifold's built-in Clipper2. Regions run past the tile edge (the pattern wraps), so the
// stack is built oversize and trimmed to the plate outline with a single boolean at the end.
function plateSolid(T, list, o) {
  const { CrossSection, Manifold } = M, S = o.S, m = 5, eps = 0.01;
  const regs = levelRegions(list, o.sym, S, o.seg), tan = Math.tan(o.draft * Math.PI / 180);
  const map = p => [o.mirror ? S - p.X / SC : p.X / SC, S - p.Y / SC];
  const raised = o.mode !== "mold";   // "mold": pattern is a pocket, so the cast tile is raised
  const lmax = regs.length ? regs[regs.length - 1].L : 0;
  // squares that shrink a hair per layer keep every layer strictly inside the one below
  const square = k => T(new CrossSection([[[-m + k * eps, -m + k * eps], [S + m - k * eps, -m + k * eps], [S + m - k * eps, S + m - k * eps], [-m + k * eps, S + m - k * eps]]]));
  const slabs = [];
  let prev = 0;
  for (const { L, r } of regs) {
    const lo = prev / 100, hi = L / 100; prev = L;
    const zb = raised ? o.B + o.D * lo : o.B + o.D * (1 - hi), zt = raised ? o.B + o.D * hi : o.B + o.D * (1 - lo);
    const n = tan > 0 ? Math.max(1, Math.ceil((zt - zb) / o.step - 1e-6)) : 1;
    const region = T(T(new CrossSection(r.map(p => p.map(map)), "NonZero")).simplify(0.005));
    for (let i = 0; i < n; i++) {
      const z0 = zb + (zt - zb) * i / n, z1 = zb + (zt - zb) * (i + 1) / n;
      // the cast face keeps the drawn outline; the relief narrows away from it
      const d = raised ? (z0 - o.B) * tan : (o.B + o.D - z1) * tan;
      slabs.push({ z0, z1, reg: d > 1e-4 ? T(region.offset(-d, "Round")) : region });
    }
  }
  slabs.sort((a, b) => a.z0 - b.z0);
  const baseTop = raised ? o.B : o.B + o.D * (1 - lmax / 100);
  const layers = [{ cs: square(-100), z0: 0, z1: baseTop }];
  slabs.forEach((s, k) => {
    const sq = square(k + 1), cs = T(raised ? s.reg.intersect(sq) : sq.subtract(s.reg));
    if (!cs.isEmpty()) layers.push({ cs, z0: s.z0, z1: s.z1 });
  });
  for (let i = 1; i < layers.length; i++) if (layers[i].z0 !== layers[i - 1].z1) layers.length = i;   // stack must stay continuous
  let stack;
  if (tan > 0 || regs.length < 2) stack = T(stackSolid(layers));
  else stack = T(Manifold.union(layers.map(l => T(T(l.cs.extrude(l.z1 - l.z0)).translate([0, 0, l.z0])))));   // straight sides, several heights: nesting isn't strict
  let trim = T(T(T(new CrossSection([roundedSquare(0, S, plateRadius(o))])).extrude(o.B + o.D + 2)).translate([0, 0, -1]));
  if (hasLock(o)) {   // square tongue on the base layer, reaching under the walls' rebate
    const t = LOCK_TONGUE;
    trim = T(trim.add(T(T(T(new CrossSection([[[-t, -t], [S + t, -t], [S + t, S + t], [-t, S + t]]])).extrude(o.B + 1)).translate([0, 0, -1]))));
  }
  return T(stack.intersect(trim));
}
// One-piece mold: the plate plus a ring wall whose outside corners share the inside corners' centres.
function fusedWalls(T, o) {
  const S = o.S, W = o.W, H = wallInfo(o).H, E = 0.02, ri = cornerRadius(o);
  return prism(T, [roundedSquare(-W, S + W, ri + W), roundedSquare(E, S - E, Math.max(0, ri - E)).reverse()], 0, H);
}

// One frame wall in local coords: x along its length, y from the outer face (0) to the inner face (W),
// z up. All four walls are identical: both ends are 45° miters, each running on past the outside
// corner as a clamp flap, and the left end also carries the rounded inside corner. Walls slide on
// from outside in any order; clamps on the flaps (and optionally a cord in the flap-tip notches)
// hold them. Everything is a plan outline extruded up, so the wall prints standing on its top edge
// without supports.
function wallSolid(T, o) {
  const { Manifold, CrossSection } = M;
  const { L, H } = wallInfo(o), W = o.W, g = o.clear, ri = cornerRadius(o);
  const box = (xa, xb, ya, yb, za, zb) => T(T(Manifold.cube([xb - xa, yb - ya, zb - za])).translate([xa, ya, za]));
  const both = ps => [ps, ps.map(([x, y]) => [L - x, y]).reverse()];   // left end, and its mirror at the right end
  const outline = [[[0, 0], [L, 0], [L - W, W], [W, W]], ...both(flapOutline())];
  if (ri > 0.3) {
    // Rounded inside corner: the square between the two inner faces minus a circle of radius ri, split
    // along the miter line so each wall carries the half against its own inner face and the split
    // continues the miter face.
    const c = W + ri, n = Math.max(12, Math.ceil(ri * Math.PI / 2 / 0.2)), pts = [[W, W - 0.02], [c, W - 0.02]];
    for (let i = 0; i <= n; i++) { const a = 1.5 * Math.PI - i / n * Math.PI / 2; pts.push([c + ri * Math.cos(a), c + ri * Math.sin(a)]); }
    const half = [[W - 1, W - 1], [c + 2, W - 1], [c + 2, c + 2]];
    for (const flip of [false, true]) {
      const f = ps => flip ? ps.map(([x, y]) => [L - x, y]) : ps;
      outline.push(...T(T(new CrossSection([f(pts)], "EvenOdd")).intersect(T(new CrossSection([f(half)], "EvenOdd")))).toPolygons());
    }
  }
  let wall = T(T(T(new CrossSection(outline, "Positive")).simplify(1e-4)).extrude(H));
  // rebate along the bottom of the inner face (fillet included) for the plate's tongue
  if (hasLock(o)) wall = T(wall.subtract(box(-1, L + 1, W - LOCK_TONGUE, W + ri + 1, -1, o.B + g)));
  // cord notches: a 45° V across each flap tip, so a cord round the frame can't slide off
  const zs = grooveHeights(o);
  if (zs.length) {
    const gd = Math.min(3, H / 6) / 2, [, P, Q] = flapOutline(), cutters = [];
    for (const zc of zs) for (const [A, B] of both([P, Q])) {
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]), d = [(B[0] - A[0]) / len, (B[1] - A[1]) / len];
      const nrm = A[0] < L / 2 ? [Math.SQRT1_2, Math.SQRT1_2] : [-Math.SQRT1_2, Math.SQRT1_2];   // into the flap
      const pts = [];
      for (const [E, s] of [[A, -1], [B, 1]]) {
        const b = [E[0] + d[0] * s, E[1] + d[1] * s];
        pts.push([b[0] - nrm[0] * 0.6, b[1] - nrm[1] * 0.6, zc - gd - 0.6], [b[0] - nrm[0] * 0.6, b[1] - nrm[1] * 0.6, zc + gd + 0.6], [b[0] + nrm[0] * gd, b[1] + nrm[1] * gd, zc]);
      }
      cutters.push(T(Manifold.hull(pts)));
    }
    wall = T(wall.subtract(T(Manifold.union(cutters))));
  }
  return wall;
}

export function mapPos(a, f) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 3) { const p = f(a[i], a[i + 1], a[i + 2]); out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2]; }
  return out;
}
// standing on its top edge (turned over about x), moved onto the positive quadrant: y runs from the inside corner (0) to the flap tips (wallDepth)
export const wallPrint = o => { const H = wallInfo(o).H, d = FLAP_LEN / Math.SQRT2, top = o.W + cornerRadius(o) * (1 - Math.SQRT1_2); return (x, y, z) => [x + d, top - y, H - z]; };
export const wallAssembly = (o, k, gap) => (x, y, z) => {             // wall k around the plate, turned 90° per k
  const h = o.S / 2;
  let px = x - o.W - o.clear, py = y - o.W - o.clear - gap;
  for (let i = 0; i < k; i++) [px, py] = [h - (py - h), h + (px - h)];
  return [px, py, z];
};

export function buildAll(list, o) {
  return arena(T => {
    let plate = plateSolid(T, list, o);
    if (o.kind === "one") plate = T(plate.add(fusedWalls(T, o)));
    return { plate: positions(plate), wall: o.kind === "kit" ? positions(wallSolid(T, o)) : null };
  });
}

// ---- cross-sections for the profile view. The model is kept (not freed) so slicing at new
// heights is cheap; call freeModel when replacing it.
export function sectionModel(list, o) {
  return arena(T => {
    const keep = m => m.translate([0, 0, 0]);   // an untracked copy survives the arena
    let plate = plateSolid(T, list, o);
    if (o.kind === "one") plate = T(plate.add(fusedWalls(T, o)));
    const out = { plate: keep(plate), walls: [], local: null };
    if (o.kind === "kit") {
      const w = wallSolid(T, o), h = o.S / 2;
      out.local = keep(w);   // one wall in its own coordinates, for the force view
      // wall 0 runs along the bottom edge, wall 3 up the left: they meet at the bottom-left corner
      for (const k of [0, 3]) out.walls.push(T(T(T(w.translate([-o.W - o.clear, -o.W - o.clear, 0])).translate([-h, -h, 0])).rotate([0, 0, 90 * k])).translate([h, h, 0]));
    }
    return out;
  });
}
export const freeModel = m => { m.plate.delete(); m.walls.forEach(w => w.delete()); if (m.local) m.local.delete(); };
export function sectionsOf(model, o, z) {
  // edge: plane x = S/2 seen along +x, points as [z, y]; plan: horizontal slice at height z, points as [x, y]
  const side = man => arena(T => T(T(man.rotate([0, 90, 0])).slice(-o.S / 2)).toPolygons());
  const plan = man => arena(T => T(man.slice(z)).toPolygons());
  return {
    side: { plate: side(model.plate), walls: model.walls.map(side) },
    plan: { plate: plan(model.plate), walls: model.walls.map(plan) },
    wallPlan: model.local ? plan(model.local) : [],
  };
}
