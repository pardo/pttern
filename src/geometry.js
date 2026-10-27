// Solid modelling for the mold parts. Pattern outlines come from Clipper booleans; every part is
// then built and merged with manifold-3d, so each part exports as one clean, watertight body.
// 3D frame: mm, Z up, y up the design. Runs in the build worker (and in node for tests).
import ClipperLib from "clipper-lib";
import Module from "manifold-3d";
import { SYM, OFFS, xf, trace, isLine, lineWidth, flatten } from "./pattern.js";
import { wallInfo, cornerRadius, flapOutline, fromUV, clipChannel, clipOutline, FLAP_LEN, plateRadius, LOCK_TONGUE, hasLock } from "./moldspec.js";
import { scoopDims, SCOOP_WALL, SCOOP_FLOOR, SCOOP_GROOVE, SCOOP_HALF_TICK, SCOOP_FILLET, SCOOP_CHAMFER } from "./mix.js";

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

// o: {S, D, B, W, T, mode, kind, mirror, draft, seg, step, clear, lock, ri, sym}
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
// corner as a flap with a flared tip, and the left end also carries the rounded inside corner. Walls
// slide on from outside in any order and a C clip slid down over each pair of flaps locks the corner.
// Everything is a plan outline extruded up, so the wall prints standing on its top edge without supports.
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
  return wall;
}

// Corner clip in flap-pair coords (u along the miter line, v across it), z up as assembled: a C that
// slides down over the two flaps. The channel is cut in slices that open from a snug fit at the
// bottom to the joint clearance at the top. Prints standing up, as assembled.
function clipSolid(T, o) {
  const { CrossSection } = M, H = wallInfo(o).H, n = 8, cuts = [];
  for (let i = 0; i < n; i++) {
    const z0 = i ? i * H / n : -1, z1 = i < n - 1 ? (i + 1) * H / n + 0.01 : H + 1;
    cuts.push(T(T(T(new CrossSection([clipChannel(o.clear * (i + 0.5) / n)])).extrude(z1 - z0)).translate([0, 0, z0])));
  }
  let clip = T(T(new CrossSection([clipOutline()])).extrude(H));
  for (const c of cuts) clip = T(clip.subtract(c));
  return clip;
}
// clip k at corner k (wall k's left end), lifted by `lift`; uv -> wall coords -> around the plate
export const clipAssembly = (o, k, gap, lift) => {
  const f = wallAssembly(o, k, 0), g = wallAssembly(o, (k + 3) % 4, gap), h = wallAssembly(o, k, gap), L = wallInfo(o).L;
  // the two flaps move apart when the walls are pulled out: put the clip between them
  const a = f(0, 0, 0), b = h(0, 0, 0), c = g(L, 0, 0), c0 = wallAssembly(o, (k + 3) % 4, 0)(L, 0, 0);
  const dx = (b[0] - a[0] + c[0] - c0[0]) / 2, dy = (b[1] - a[1] + c[1] - c0[1]) / 2;
  return (u, v, z) => { const p = f(...fromUV([u, v]), z); return [p[0] + dx, p[1] + dy, z + lift]; };
};

// Measuring scoop: an open cup holding `ml` when filled level, with a flat blade handle along +x that
// is flush with the rim, so a stick drawn across both strikes the fill off level. `holes` small teardrop
// holes through the blade tell the scoops apart (1 part cement, 3 parts sand); `line` > 0 cuts a groove
// round the inside with its lower edge at that share of the depth, the water mark. A short tick in the
// middle of each inside wall marks a half fill. Prints as it stands, with the bottom edge chamfered.
function scoopSolid(T, ml, holes, line) {
  const { CrossSection } = M, { w, h, r } = scoopDims(ml), t = SCOOP_WALL, H = h + SCOOP_FLOOR, g = SCOOP_GROOVE;
  let cup = T(prism(T, [roundedSquare(-t, w + t, r + t)], 0, H).subtract(prism(T, [roundedSquare(0, w, r)], SCOOP_FLOOR, H + 1)));
  if (line > 0) {
    const z = SCOOP_FLOOR + h * line;
    cup = T(cup.subtract(prism(T, [roundedSquare(-g, w + g, r + g)], z, z + 0.8)));
  }
  const zh = SCOOP_FLOOR + h / 2, m = w / 2, k = SCOOP_HALF_TICK / 2, box = (xa, xb, ya, yb) => [[xa, ya], [xb, ya], [xb, yb], [xa, yb]];
  cup = T(cup.subtract(prism(T, [box(-g, 0.1, m - k, m + k), box(w - 0.1, w + g, m - k, m + k), box(m - k, m + k, -g, 0.1), box(m - k, m + k, w - 0.1, w + g)], zh, zh + 0.8)));
  // blade side profile in (x, z): full height at the cup, tapering to a rounded end of height e
  const x0 = w + t - 1, x1 = w + t + Math.max(50, w), e = Math.min(H, 16), cx = x1 - e / 2, n = 16;
  const prof = [[x0, 0], [cx, 0]];
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + i / n * Math.PI; prof.push([cx + e / 2 * Math.cos(a), e / 2 + e / 2 * Math.sin(a)]); }
  prof.push([x0, H]);
  const contours = [prof];
  for (let i = 0; i < holes; i++) {
    // teardrop, point up: the 45° roof bridges without support when the blade prints standing
    const hx = cx - i * 8, rh = 2.5, pts = [[hx, e / 2 + rh * Math.SQRT2]];
    for (let j = 0; j <= 18; j++) { const a = Math.PI / 4 - j / 18 * 1.5 * Math.PI; pts.push([hx + rh * Math.cos(a), e / 2 + rh * Math.sin(a)]); }
    contours.push(pts);
  }
  // blade plan in (x, y): 5 mm wide, filleted into the cup wall and rounded at the tip
  const b = 2.5, R = SCOOP_FILLET, rb = 2, xw = w + t, plan = [[x0, m - b - R]], arc = (ax, ay, rr, a0, a1) => {
    for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; plan.push([ax + rr * Math.cos(a), ay + rr * Math.sin(a)]); }
  };
  arc(xw + R, m - b - R, R, 180, 90); arc(x1 - rb, m - b + rb, rb, -90, 0); arc(x1 - rb, m + b - rb, rb, 0, 90); arc(xw + R, m + b + R, R, 270, 180);
  plan.push([x0, m + b + R]);
  const side = T(T(T(T(new CrossSection(contours, "EvenOdd")).extrude(2 * (b + R) + 2)).rotate([90, 0, 0])).translate([0, m + b + R + 1, 0]));
  const blade = T(side.intersect(prism(T, [plan], -1, H + 1)));
  let solid = T(cup.add(T(blade.subtract(prism(T, [roundedSquare(0, w, r)], SCOOP_FLOOR, H + 1)))));
  // chamfer the bottom edge: thin slabs, each trimmed to the footprint inset by the chamfer left above it
  const foot = T(solid.slice(0.01)), c = SCOOP_CHAMFER, steps = 8, far = T(new CrossSection([box(-500, 500, -500, 500)]));
  for (let i = 0; i < steps; i++) {
    const z0 = i ? i * c / steps : -1, z1 = (i + 1) * c / steps + 0.001, inset = c * (1 - (i + 0.5) / steps);
    solid = T(solid.subtract(T(T(T(far.subtract(T(foot.offset(-inset, "Round")))).extrude(z1 - z0)).translate([0, 0, z0]))));
  }
  return solid;
}
// the cement scoop (with the water mark) and the sand scoop, `ratio` times its volume
export function buildScoops({ cement, ratio, line }) {
  return arena(T => [positions(scoopSolid(T, cement, 1, line)), positions(scoopSolid(T, cement * ratio, ratio, 0))]);
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
    const kit = o.kind === "kit";
    return { plate: positions(plate), wall: kit ? positions(wallSolid(T, o)) : null, clip: kit ? positions(clipSolid(T, o)) : null };
  });
}

// ---- cross-sections for the profile view. The model is kept (not freed) so slicing at new
// heights is cheap; call freeModel when replacing it.
export function sectionModel(list, o) {
  return arena(T => {
    const keep = m => m.translate([0, 0, 0]);   // an untracked copy survives the arena
    let plate = plateSolid(T, list, o);
    if (o.kind === "one") plate = T(plate.add(fusedWalls(T, o)));
    const out = { plate: keep(plate), walls: [], local: null, clip: null };
    if (o.kind === "kit") {
      const w = wallSolid(T, o), h = o.S / 2;
      out.local = keep(w);   // one wall in its own coordinates, for the force view
      // wall 0 runs along the bottom edge, wall 3 up the left: they meet at the bottom-left corner
      const c = clipSolid(T, o), f = clipAssembly(o, 0, 0, 0);
      out.clip = keep(T(c.warp(p => { const q = f(p[0], p[1], p[2]); p[0] = q[0]; p[1] = q[1]; })));
      for (const k of [0, 3]) out.walls.push(T(T(T(w.translate([-o.W - o.clear, -o.W - o.clear, 0])).translate([-h, -h, 0])).rotate([0, 0, 90 * k])).translate([h, h, 0]));
    }
    return out;
  });
}
export const freeModel = m => { m.plate.delete(); m.walls.forEach(w => w.delete()); if (m.local) m.local.delete(); if (m.clip) m.clip.delete(); };
export function sectionsOf(model, o, z) {
  // edge: plane x = S/2 seen along +x, points as [z, y]; plan: horizontal slice at height z, points as [x, y]
  const side = man => arena(T => T(T(man.rotate([0, 90, 0])).slice(-o.S / 2)).toPolygons());
  const plan = man => arena(T => T(man.slice(z)).toPolygons());
  return {
    side: { plate: side(model.plate), walls: model.walls.map(side) },
    plan: { plate: plan(model.plate), walls: model.walls.map(plan), clip: model.clip ? plan(model.clip) : [] },
    wallPlan: model.local ? plan(model.local) : [],
  };
}
