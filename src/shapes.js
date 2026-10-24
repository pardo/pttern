// Pure edits on shapes (no DOM, no app state): simplify, flip, mirror, curve conversion, point editing, snapping.
import { SYM, xf, starPts } from "./pattern.js";

export const clone = s => JSON.parse(JSON.stringify(s));
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export function simplify(pts, eps) {   // Ramer–Douglas–Peucker
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let mi = 0, md = 0;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L;
    if (d > md) { md = d; mi = i; }
  }
  if (md <= eps) return [a, b];
  return simplify(pts.slice(0, mi + 1), eps).slice(0, -1).concat(simplify(pts.slice(mi), eps));
}

// ---- whole-shape transforms
export function centre(s) {
  const xs = s.pts.map(p => p[0]), ys = s.pts.map(p => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
export function transformShape(s, deg, sc) {
  const n = s.pts.length, cx = s.pts.reduce((a, p) => a + p[0], 0) / n, cy = s.pts.reduce((a, p) => a + p[1], 0) / n;
  const t = deg * Math.PI / 180, co = Math.cos(t) * sc, si = Math.sin(t) * sc;
  s.pts = s.pts.map(([x, y]) => [cx + (x - cx) * co - (y - cy) * si, cy + (x - cx) * si + (y - cy) * co]);
  if (s.r) s.r *= sc;
  if (s.w && s.type === "leaf") s.w *= sc;
}
// dir "h" flips left–right, "v" top–bottom, about the shape's own centre
export function flipShape(s, dir) {
  const [cx, cy] = centre(s);
  s.pts = s.pts.map(([x, y]) => dir === "h" ? [2 * cx - x, y] : [x, 2 * cy - y]);
}
// a copy reflected across the tile's vertical (dir "h") or horizontal (dir "v") centre line
export function mirrored(s, dir, S) {
  const c = clone(s);
  c.pts = c.pts.map(([x, y]) => dir === "h" ? [S - x, y] : [x, S - y]);
  return c;
}

// ---- curves: pts run [in, anchor, out] per point
export const pointOps = s => s.type === "poly" || s.type === "bez" || (s.type === "stroke" && !!s.straight);
export const anchorCount = s => s.type === "bez" ? s.pts.length / 3 : s.pts.length;
export const minAnchors = s => s.type === "poly" ? 3 : 2;
// index in pts of the anchor that owns pts[i]
export const anchorOf = (s, i) => s.type !== "bez" ? i : i % 3 === 1 ? i : i % 3 === 0 ? i + 1 : i - 1;
// an open curve's first in-handle and last out-handle shape nothing, so they stay hidden
export const bezShown = (s, i) => s.closed || (i !== 0 && i !== s.pts.length - 1);

// Turn a polygon or line into a curve with the same outline (Catmull–Rom spans are exact cubic Béziers).
export function toBez(s, w) {
  const P = s.pts, n = P.length, closed = s.type === "poly", curved = s.type === "poly" ? !!s.smooth : !s.straight;
  const g = i => closed ? P[(i + n) % n] : P[Math.max(0, Math.min(n - 1, i))];
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = P[i];
    if (!curved) { pts.push(a.slice(), a.slice(), a.slice()); continue; }
    const tx = (g(i + 1)[0] - g(i - 1)[0]) / 6, ty = (g(i + 1)[1] - g(i - 1)[1]) / 6;
    pts.push([a[0] - tx, a[1] - ty], a.slice(), [a[0] + tx, a[1] + ty]);
  }
  if (!closed) { pts[0] = pts[1].slice(); pts[pts.length - 1] = pts[pts.length - 2].slice(); }
  if (s.type === "stroke" && s.closed) pts.push(P[0].slice(), P[0].slice(), P[0].slice());   // a closed loop stays a line
  s.type = "bez"; s.pts = pts; s.closed = closed;
  delete s.smooth; delete s.straight;
  if (!s.w) s.w = w;
}

// Point edits; i is the pts index of the point (the anchor, for curves). Each returns the new point index.
export function deletePoint(s, i) {
  if (anchorCount(s) <= minAnchors(s)) return i;
  if (s.type === "bez") s.pts.splice(i - 1, 3); else s.pts.splice(i, 1);
  return -1;
}
// adds a point halfway along the span after point i (before it, at the end of an open line)
export function addPoint(s, i) {
  const P = s.pts, closed = s.type === "poly" || (s.type === "bez" && s.closed) || (s.type === "stroke" && s.closed);
  if (s.type === "bez") {
    const n = P.length / 3;
    let a = (i - 1) / 3, b = a + 1;
    if (b >= n) { if (closed) b = 0; else { b = a; a--; } }
    const A = P[3 * a + 1], c1 = P[3 * a + 2], c2 = P[3 * b], B = P[3 * b + 1];   // split the span at t = ½ (de Casteljau)
    const q0 = mid(A, c1), q1 = mid(c1, c2), q2 = mid(c2, B), r0 = mid(q0, q1), r1 = mid(q1, q2);
    P[3 * a + 2] = q0; P[3 * b] = q2;
    P.splice(3 * a + 3, 0, r0, mid(r0, r1), r1);
    return 3 * a + 4;
  }
  let a = i, b = a + 1;
  if (b >= P.length) { if (closed) b = 0; else { b = a; a--; } }
  P.splice(a + 1, 0, mid(P[a], P[b]));
  return a + 1;
}
// handles along the line through the neighbouring points, a third of the way to each
export function smoothPoint(s, i) {
  const P = s.pts, n = P.length / 3, k = (i - 1) / 3, A = P[i];
  const prev = k > 0 ? P[i - 3] : s.closed ? P[3 * n - 2] : null, next = k < n - 1 ? P[i + 3] : s.closed ? P[1] : null;
  if (!prev && !next) return;
  const a = prev || A, b = next || A, L = dist(a, b) || 1, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
  const li = prev ? dist(A, prev) / 3 : 0, lo = next ? dist(A, next) / 3 : 0;
  P[i - 1] = [A[0] - ux * li, A[1] - uy * li]; P[i + 1] = [A[0] + ux * lo, A[1] + uy * lo];
}
export function cornerPoint(s, i) { s.pts[i - 1] = s.pts[i].slice(); s.pts[i + 1] = s.pts[i].slice(); }
// true when the control at i and its opposite form a smooth point and should move together
export function handlesLinked(s, i) {
  if (s.type !== "bez" || i % 3 === 1) return false;
  const P = s.pts, a = anchorOf(s, i), o = 2 * a - i;
  if (!P[o]) return false;
  const u = [P[i][0] - P[a][0], P[i][1] - P[a][1]], v = [P[o][0] - P[a][0], P[o][1] - P[a][1]], lu = Math.hypot(...u), lv = Math.hypot(...v);
  return lu > 1e-6 && lv > 1e-6 && (u[0] * v[0] + u[1] * v[1]) / (lu * lv) < -0.996;
}

// ---- snapping
// the tile's corners, edge middles, quarter points and centre
export function keyPoints(S) { const out = []; for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) out.push([S * i / 4, S * j / 4]); return out; }
// The points of a shape worth snapping to: corners, ends, centres, edge midpoints, circle quadrants.
// skip is the pts index being dragged; shapes whose other points follow that drag offer nothing.
export function magnetPts(s, skip = -1) {
  const P = s.pts, mid2 = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (skip >= 0 && (s.type === "circle" || s.type === "rect" || s.type === "ellipse" || s.type === "star")) return [];
  if (s.type === "circle") { const [x, y] = P[0], r = s.r; return [[x, y], [x + r, y], [x - r, y], [x, y + r], [x, y - r]]; }
  if (s.type === "ellipse") { const [c, A, B] = P; return [c, A, B, [2 * c[0] - A[0], 2 * c[1] - A[1]], [2 * c[0] - B[0], 2 * c[1] - B[1]]]; }
  if (s.type === "star") return [P[0], ...starPts(s)];
  if (s.type === "rect") return [...P, centre(s), ...P.map((a, i) => mid2(a, P[(i + 1) % 4]))];
  if (s.type === "stroke" && !s.straight) return [P[0], P[P.length - 1]];
  if (s.type === "bez") return P.filter((_, i) => i % 3 === 1 && i !== skip);
  const out = P.filter((_, i) => i !== skip);
  if (s.type === "poly" || s.type === "stroke") {
    const n = P.length, closed = s.type === "poly" || s.closed;
    for (let i = 0; i < (closed ? n : n - 1); i++) { const j = (i + 1) % n; if (i !== skip && j !== skip) out.push(mid2(P[i], P[j])); }
    if (skip < 0 && closed) out.push(centre(s));
  }
  return out;
}
// every snap target: the tile's key points and all shapes' magnet points with their symmetric copies
export function snapTargets(shapes, S, sym, skip, exclude) {
  const out = keyPoints(S), mats = SYM[sym].map(m => xf(m, 0, 0, S));
  for (const s of shapes) {
    if (s === exclude) continue;
    const own = magnetPts(s, skip && skip.s === s ? skip.i : -1);
    for (const [x, y] of own) for (const t of mats) out.push([t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]]);
  }
  return out;
}
// Moving a shape by d: nudge d so one of its points lands on a target, or so its points line up with
// targets vertically and horizontally, or (failing both) so its first point sits on the grid.
export function snapDelta(own, d, o) {
  let best = null, bd = o.tol;
  for (const a of own) {
    const x = a[0] + d[0], y = a[1] + d[1];
    for (const t of o.targets) { const e = Math.hypot(t[0] - x, t[1] - y); if (e < bd) { bd = e; best = t; } }
    if (best && bd === 0) break;
  }
  if (best) {
    let k = null, kd = Infinity;
    for (const a of own) { const e = Math.hypot(best[0] - a[0] - d[0], best[1] - a[1] - d[1]); if (e < kd) { kd = e; k = a; } }
    return { d: [best[0] - k[0], best[1] - k[1]], ring: best, guides: [] };
  }
  let bx = o.tol, by = o.tol, cx = null, cy = null;
  for (const a of own) {
    const x = a[0] + d[0], y = a[1] + d[1];
    for (const t of o.targets) {
      const ex = t[0] - x, ey = t[1] - y;
      if (Math.abs(ex) < bx) { bx = Math.abs(ex); cx = [ex, t, a]; }
      if (Math.abs(ey) < by) { by = Math.abs(ey); cy = [ey, t, a]; }
    }
  }
  const nd = d.slice();
  if (cx) nd[0] += cx[0];
  if (cy) nd[1] += cy[0];
  if (o.grid && own.length) {
    const a = own[0];
    if (!cx) nd[0] = Math.round((a[0] + d[0]) / o.grid) * o.grid - a[0];
    if (!cy) nd[1] = Math.round((a[1] + d[1]) / o.grid) * o.grid - a[1];
  }
  const at = a => [a[0] + nd[0], a[1] + nd[1]];
  return { d: nd, ring: null, guides: [cx, cy].filter(Boolean).map(([, t, a]) => [t, at(a)]) };
}
// Where p lands. o: { targets, align (points to line up with), from + angle (15° rays from the last point),
// grid (mm step, 0 = off), tol (mm) }. Returns { p, ring, guides } where guides are [a, b] lines to draw.
export function snap(p, o) {
  const { tol } = o;
  let best = null, bd = tol;
  for (const q of o.targets || []) { const d = dist(q, p); if (d < bd) { bd = d; best = q; } }
  if (best) return { p: best.slice(), ring: true, guides: [] };
  if (o.from && o.angle) {
    const dx = p[0] - o.from[0], dy = p[1] - o.from[1], L = Math.hypot(dx, dy), st = Math.PI / 12, a = Math.round(Math.atan2(dy, dx) / st) * st;
    const ux = Math.cos(a), uy = Math.sin(a);
    if (L > tol && Math.abs(dx * uy - dy * ux) < tol) {   // magnetic: only near a 15° ray
      let len = dx * ux + dy * uy;
      if (o.grid) len = Math.round(len / o.grid) * o.grid;
      const q = [o.from[0] + ux * len, o.from[1] + uy * len];
      return { p: q, ring: false, guides: [[o.from, q]] };
    }
  }
  const q = o.grid ? p.map(v => Math.round(v / o.grid) * o.grid) : p.slice(), lined = [];
  let bx = tol, by = tol, sx = null, sy = null;
  for (const c of o.align || []) {
    const ex = Math.abs(c[0] - p[0]), ey = Math.abs(c[1] - p[1]);
    if (ex < bx) { bx = ex; sx = c; }
    if (ey < by) { by = ey; sy = c; }
  }
  if (sx) { q[0] = sx[0]; lined.push(sx); }
  if (sy) { q[1] = sy[1]; lined.push(sy); }
  return { p: q, ring: false, guides: lined.map(c => [c, q]) };
}
// nearest 15° direction from a, at p's distance (Shift-dragging a curve handle)
export function angleRound(a, p) {
  const L = dist(a, p), st = Math.PI / 12, t = Math.round(Math.atan2(p[1] - a[1], p[0] - a[0]) / st) * st;
  return [a[0] + Math.cos(t) * L, a[1] + Math.sin(t) * L];
}
