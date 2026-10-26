// Pattern math shared by the page and the build worker: symmetry, transforms and shape outlines.

// ---- symmetry: 2x2 matrices [a,b,c,d] about the tile centre (canvas convention x'=ax+cy, y'=bx+dy)
export const SYM = {
  none: [[1, 0, 0, 1]],
  mirror: [[1, 0, 0, 1], [-1, 0, 0, 1], [1, 0, 0, -1], [-1, 0, 0, -1]],
  rot4: [[1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1], [0, -1, 1, 0]],
  d4: [[1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1], [0, -1, 1, 0], [-1, 0, 0, 1], [1, 0, 0, -1], [0, 1, 1, 0], [0, -1, -1, 0]],
};
export const OFFS = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
export function xf(m, ox, oy, S) {
  const h = S / 2, [a, b, c, d] = m;
  return [a, b, c, d, h - a * h - c * h + ox, h - b * h - d * h + oy];
}
export function spline(p, P, closed) {
  const n = P.length;
  p.moveTo(P[0][0], P[0][1]);
  if (n < 3) { for (let i = 1; i < n; i++) p.lineTo(P[i][0], P[i][1]); return; }
  const g = i => closed ? P[(i + n) % n] : P[Math.max(0, Math.min(n - 1, i))];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
  }
}
// shapes drawn as a line rather than filled: freehand and straight lines, open curves, and outlined closed shapes
export const isLine = s => s.type === "stroke" || (s.type === "bez" && !s.closed) || !!s.outline;
// an outline keeps its own width in lw, because a petal's w is its width
export const lineWidth = s => s.outline ? (s.lw || 1) : s.w;
// corners of a regular polygon or star: pts are [centre, first corner]; inner < 1 adds the star's inner points
export function starPts(s) {
  const [c, v] = s.pts, n = Math.max(3, Math.round(s.n || 5)), k = s.inner == null ? 1 : s.inner;
  const R = Math.hypot(v[0] - c[0], v[1] - c[1]), a0 = Math.atan2(v[1] - c[1], v[0] - c[0]), m = k < 1 ? 2 * n : n, out = [];
  for (let j = 0; j < m; j++) { const a = a0 + j * 2 * Math.PI / m, r = k < 1 && j % 2 ? R * k : R; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); }
  return out;
}
const KAPPA = 0.5523;   // cubic Bézier quarter circle
export function trace(p, s) {
  const P = s.pts;
  if (s.type === "circle") { const [x, y] = P[0]; p.moveTo(x + s.r, y); p.arc(x, y, s.r, 0, Math.PI * 2); p.closePath(); return; }
  if (s.type === "leaf") {
    const [b, t] = P, mx = (b[0] + t[0]) / 2, my = (b[1] + t[1]) / 2;
    const L = Math.hypot(t[0] - b[0], t[1] - b[1]) || 1, nx = -(t[1] - b[1]) / L * s.w, ny = (t[0] - b[0]) / L * s.w;
    p.moveTo(b[0], b[1]); p.quadraticCurveTo(mx + nx, my + ny, t[0], t[1]); p.quadraticCurveTo(mx - nx, my - ny, b[0], b[1]); p.closePath(); return;
  }
  if (s.type === "rect") {   // pts: four corners in order; r rounds them
    const r0 = s.r || 0;
    if (!(r0 > 0)) { p.moveTo(P[0][0], P[0][1]); for (let i = 1; i < 4; i++) p.lineTo(P[i][0], P[i][1]); p.closePath(); return; }
    for (let i = 0; i < 4; i++) {
      const C = P[i], a = P[(i + 3) % 4], b = P[(i + 1) % 4], la = Math.hypot(a[0] - C[0], a[1] - C[1]) || 1, lb = Math.hypot(b[0] - C[0], b[1] - C[1]) || 1;
      const r = Math.min(r0, la / 2, lb / 2), t1 = [C[0] + (a[0] - C[0]) / la * r, C[1] + (a[1] - C[1]) / la * r], t2 = [C[0] + (b[0] - C[0]) / lb * r, C[1] + (b[1] - C[1]) / lb * r];
      i ? p.lineTo(t1[0], t1[1]) : p.moveTo(t1[0], t1[1]);
      p.bezierCurveTo(t1[0] + (C[0] - t1[0]) * KAPPA, t1[1] + (C[1] - t1[1]) * KAPPA, t2[0] + (C[0] - t2[0]) * KAPPA, t2[1] + (C[1] - t2[1]) * KAPPA, t2[0], t2[1]);
    }
    p.closePath(); return;
  }
  if (s.type === "ellipse") {   // pts: [centre, end of one axis, end of the other]
    const [c, A, B] = P, u = [A[0] - c[0], A[1] - c[1]], v = [B[0] - c[0], B[1] - c[1]];
    const q = [u, v, [-u[0], -u[1]], [-v[0], -v[1]]];
    p.moveTo(c[0] + u[0], c[1] + u[1]);
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      p.bezierCurveTo(c[0] + a[0] + KAPPA * b[0], c[1] + a[1] + KAPPA * b[1], c[0] + b[0] + KAPPA * a[0], c[1] + b[1] + KAPPA * a[1], c[0] + b[0], c[1] + b[1]);
    }
    p.closePath(); return;
  }
  if (s.type === "star") { starPts(s).forEach(([x, y], i) => i ? p.lineTo(x, y) : p.moveTo(x, y)); p.closePath(); return; }
  if (s.type === "bez") {   // pts run [in, anchor, out] per point
    const n = P.length / 3, c = (a, b) => p.bezierCurveTo(P[3 * a + 2][0], P[3 * a + 2][1], P[3 * b][0], P[3 * b][1], P[3 * b + 1][0], P[3 * b + 1][1]);
    p.moveTo(P[1][0], P[1][1]);
    for (let i = 0; i < n - 1; i++) c(i, i + 1);
    if (s.closed) { if (n > 1) c(n - 1, 0); p.closePath(); }
    return;
  }
  if (s.type === "stroke") {
    if (!s.straight) { spline(p, P, false); return; }
    p.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) p.lineTo(P[i][0], P[i][1]);
    if (s.closed) p.lineTo(P[0][0], P[0][1]);
    return;
  }
  if (s.smooth) spline(p, P, true);
  else { p.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) p.lineTo(P[i][0], P[i][1]); }
  p.closePath();
}

// a shape's outline as polylines, curves cut into pieces about seg long
export function flatten(s, seg) {
  const out = []; let cur = null, last = [0, 0];
  const push = (x, y) => { cur.push([x, y]); last = [x, y]; };
  const n = L => Math.max(2, Math.ceil(L / seg));
  trace({
    moveTo(x, y) { cur = []; out.push(cur); push(x, y); },
    lineTo(x, y) { push(x, y); },
    quadraticCurveTo(cx, cy, x, y) {
      const [x0, y0] = last, k = n(Math.hypot(cx - x0, cy - y0) + Math.hypot(x - cx, y - cy));
      for (let i = 1; i <= k; i++) { const t = i / k, u = 1 - t; push(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y); }
    },
    bezierCurveTo(ax, ay, bx, by, x, y) {
      const [x0, y0] = last, k = n(Math.hypot(ax - x0, ay - y0) + Math.hypot(bx - ax, by - ay) + Math.hypot(x - bx, y - by));
      for (let i = 1; i <= k; i++) {
        const t = i / k, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        push(a * x0 + b * ax + c * bx + d * x, a * y0 + b * ay + c * by + d * y);
      }
    },
    arc(x, y, r) {
      cur.length = 0;
      const k = Math.max(32, Math.ceil(2 * Math.PI * r / seg));
      for (let i = 0; i < k; i++) { const t = i / k * 2 * Math.PI; push(x + r * Math.cos(t), y + r * Math.sin(t)); }
    },
    closePath() { },
  }, s);
  return out.filter(c => c.length > 1);
}
