// Pre-made tile designs, drawn on a 200 mm tile and scaled to the tile size when loaded.
// Each one is ordinary shapes, so a loaded template edits like anything drawn by hand.
// Inspired by encaustic and hydraulic cement tiles, Moorish zellige, Portuguese azulejos,
// Victorian floors, Art Deco, mid-century and op-art patterns.
import { SYM, xf, trace } from "./pattern.js";

const S0 = 200, C = [100, 100], O = [0, 0];
const rad = d => d * Math.PI / 180;
const P = (r, deg, c = C) => [c[0] + r * Math.cos(rad(deg)), c[1] + r * Math.sin(rad(deg))];
const CUT = { cut: true }, L25 = { level: 25 }, L50 = { level: 50 }, L75 = { level: 75 };
const OUT = lw => ({ outline: true, lw });

// ---- shape makers (angles in degrees, canvas convention: -90 points up)
const circle = (c, r, o) => ({ type: "circle", pts: [c], r, ...o });
const ring = (c, r, lw, o) => circle(c, r, { ...OUT(lw), ...o });
const leaf = (b, t, w, o) => ({ type: "leaf", pts: [b, t], w, ...o });
const petal = (c, r0, r1, deg, w, o) => leaf(P(r0, deg, c), P(r1, deg, c), w, o);
const star = (c, R, n, inner = 1, deg = -90, o) => ({ type: "star", pts: [c, P(R, deg, c)], n, inner, ...o });
const ngon = (c, R, n, deg, o) => star(c, R, n, 1, deg, o);
const poly = (pts, o) => ({ type: "poly", pts, ...o });
const blob = (pts, o) => poly(pts, { smooth: true, ...o });
const line = (pts, w, o) => ({ type: "stroke", straight: true, pts, w, ...o });
const curve = (pts, w, o) => ({ type: "stroke", pts, w, ...o });
const box = (x, y, w, h, r = 0, o) => ({ type: "rect", pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], r, ...o });
const rbox = (c, w, h, deg = 0, r = 0, o) => {
  const co = Math.cos(rad(deg)), si = Math.sin(rad(deg));
  return { type: "rect", pts: [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [c[0] + x * co - y * si, c[1] + x * si + y * co]), r, ...o };
};
const oval = (c, rx, ry, deg = 0, o) => ({ type: "ellipse", pts: [c, P(rx, deg, c), P(ry, deg + 90, c)], ...o });
const diamond = (c, rx, ry = rx, o) => poly([[c[0], c[1] - ry], [c[0] + rx, c[1]], [c[0], c[1] + ry], [c[0] - rx, c[1]]], o);
const arcPts = (c, r, a0, a1, step = 10) => {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / step)), out = [];
  for (let i = 0; i <= n; i++) out.push(P(r, a0 + (a1 - a0) * i / n, c));
  return out;
};
const arc = (c, r, a0, a1, w, o) => curve(arcPts(c, r, a0, a1), w, o);
// n copies around a centre, the first pointing up (plus phase)
const around = (n, fn, phase = 0) => Array.from({ length: n }, (_, i) => fn(-90 + phase + i * 360 / n, i)).flat();
// n × n cells across the tile: fn(cell centre x, y, column, row)
const cells = (n, fn) => { const out = [], d = S0 / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push(fn((i + 0.5) * d, (j + 0.5) * d, i, j)); return out.flat(); };
const rng = seed => () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const shift = (list, dx, dy) => list.map(s => ({ ...s, pts: s.pts.map(([x, y]) => [x + dx, y + dy]) }));
const daisy = (c, R, n, o) => [...around(n, a => petal(c, R * 0.28, R, a, R * 0.34, o)), circle(c, R * 0.26), circle(c, R * 0.1, CUT)];
const burst = (c, n, r) => [...around(n, a => [line([P(7, a, c), P(r, a, c)], 3), circle(P(r, a, c), 4.5)]), circle(c, 5)];

export const FAMILIES = ["Encaustic", "Moorish", "Azulejo", "Victorian", "Art Deco", "Cuban", "Mid-century", "Botanical", "Op art", "Minimal"];

const T = (name, family, sym, build) => ({ name, family, sym, build });

export const TEMPLATES = [
  // ---- Encaustic rosettes: the classic Spanish and Italian cement tile medallions
  T("Florentine", "Encaustic", "d4", () => [
    leaf([100, 94], [100, 38], 28), leaf([96, 96], [68, 68], 18), circle(C, 10), circle(C, 4, CUT),
    poly([[100, 3], [111, 13], [107, 26], [100, 21], [93, 26], [89, 13]], { smooth: true }),
    leaf(O, [36, 36], 26), circle(O, 7, CUT),
    curve(Array.from({ length: 13 }, (_, i) => P(58, 8 + 6 * i, O)), 4.5),
    poly([[60, 10], [67, 18], [60, 26], [53, 18]]), leaf([100, 38], [100, 50], 5, CUT),
  ]),
  T("Sevilla", "Encaustic", "d4", () => [
    ...around(8, a => petal(C, 18, 72, a, 18)), ...around(8, a => petal(C, 14, 44, a, 10, L50), 22.5),
    circle(C, 14), circle(C, 6, CUT),
    ring(O, 32, 4), circle(O, 12), ...around(8, a => petal(O, 40, 58, a, 10), 22.5),
    diamond([100, 0], 10, 14),
  ]),
  T("Barcelona", "Encaustic", "d4", () => [
    ...around(4, a => petal(C, 10, 88, a, 30)), ...around(4, a => petal(C, 12, 60, a, 16, L50), 45),
    ring(C, 74, 3, CUT), circle(C, 12), circle(C, 5, CUT),
    star(O, 30, 8, 0.5, 0),
  ]),
  T("Granada", "Encaustic", "d4", () => [
    star(C, 44, 8, 0.55), circle(C, 10, CUT), ring(C, 54, 4), ring(C, 64, 2.5),
    ...around(16, a => circle(P(74, a), 4)),
    petal(O, 8, 42, 45, 14), circle(O, 8),
  ]),
  T("Lisbon Quatrefoil", "Encaustic", "d4", () => [
    ...around(4, a => circle(P(26, a), 26)), circle(C, 12, CUT),
    diamond(C, 90, 90, OUT(4)), circle(O, 14), circle(O, 6, CUT),
  ]),
  T("Cádiz Carnation", "Encaustic", "d4", () => [
    ...around(16, a => petal(C, 20, 62, a, 9)), ...around(8, a => petal(C, 52, 92, a, 16, L50), 22.5),
    circle(C, 18), ring(C, 10, 3, CUT),
    circle(O, 20, L75), circle(O, 8, CUT),
  ]),
  T("Palma Fan", "Encaustic", "d4", () => [
    ...around(12, a => petal(O, 14, 84, a, 14)), ring(O, 96, 4), circle(O, 10),
    star(C, 24, 8, 0.45), ring(C, 32, 3),
  ]),
  T("Valencia Wheel", "Encaustic", "d4", () => [
    ...around(16, a => line([P(24, a), P(68, a)], 3.5)), ring(C, 72, 5), ring(C, 20, 5), circle(C, 9),
    ring(O, 26, 5), circle(O, 12, L50), circle([100, 0], 10),
  ]),
  T("Mallorca Lace", "Encaustic", "d4", () => [
    ...around(8, a => oval(P(48, a), 20, 9, a, OUT(3))), star(C, 26, 8, 0.4),
    ...around(8, a => circle(P(76, a), 5), 22.5),
    star(O, 44, 4, 0.3, 45), circle(O, 6, CUT),
  ]),
  T("Toledo Knot", "Encaustic", "d4", () => [
    ...around(4, a => ring(P(30, a), 34, 4), 45), circle(C, 10),
    ring(O, 36, 4), circle(O, 14), ring([100, 0], 16, 4),
  ]),

  // ---- Moorish and zellige: eight-point stars, octagons and interlace
  T("Star and Cross", "Moorish", "d4", () => [
    star(C, 68, 8, 0.7654), star(O, 68, 8, 0.7654),
    star(C, 50, 8, 0.7654, -90, { ...OUT(2.5), ...CUT }), star(O, 50, 8, 0.7654, -90, { ...OUT(2.5), ...CUT }),
    circle(C, 8, CUT), circle([100, 0], 6),
  ]),
  T("Khatam", "Moorish", "d4", () => [
    rbox(C, 100, 100, 0, 0, OUT(5)), rbox(C, 100, 100, 45, 0, OUT(5)), circle(C, 14), circle(C, 6, CUT),
    rbox(O, 70, 70, 0, 0, OUT(4)), rbox(O, 70, 70, 45, 0, OUT(4)), circle(O, 8),
    star([100, 0], 18, 4, 0.4),
  ]),
  T("Zellige Octagon", "Moorish", "d4", () => [
    ngon(C, 105, 8, -67.5), diamond(O, 54.3),
    star(C, 70, 8, 0.7654, -90, { ...OUT(3), ...CUT }), circle(C, 10, CUT), circle(O, 12, CUT),
  ]),
  T("Fez Sixteen", "Moorish", "d4", () => [
    star(C, 64, 16, 0.8), star(C, 42, 8, 0.7654, -90, CUT), circle(C, 14), circle(C, 6, CUT),
    star(O, 48, 16, 0.8), circle(O, 14, CUT), ...around(8, a => circle(P(80, a), 5), 22.5),
  ]),
  T("Nasrid Pinwheel", "Moorish", "rot4", () => [
    blob([[100, 96], [134, 40], [170, 30], [196, 4], [160, 60], [130, 74]]),
    circle(C, 12), circle(O, 10), circle([60, 40], 6, L50),
  ]),
  T("Lacería", "Moorish", "d4", () => [
    star(C, 64, 8, 0.7654, -90, OUT(5)), star(O, 64, 8, 0.7654, -90, OUT(5)),
    line([[45.3, 45.3], [54.7, 54.7]], 5), line([[100, 36], [100, 0]], 5),
    circle(C, 10), circle(O, 10), ngon([100, 0], 12, 8, -67.5, L50),
  ]),
  T("Arabesque", "Moorish", "d4", () => {
    const q = [[100, 0], [88, 20], [68, 26], [50, 50], [26, 68], [20, 88], [0, 100]];
    return [curve(q, 5), curve(q.map(([x, y]) => [100 + (x - 100) * 0.74, 100 + (y - 100) * 0.74]), 3),
      star(C, 22, 8, 0.5), circle(O, 18, L50), circle(O, 7), circle([100, 0], 5)];
  }),
  T("Rub el Hizb", "Moorish", "d4", () => [
    star(C, 58, 8, 0.7654), star(C, 46, 8, 0.7654, -90, { ...OUT(2.5), ...CUT }), circle(C, 22, CUT), circle(C, 14),
    ring(O, 40, 5), ring(O, 28, 3), circle(O, 10), circle([100, 0], 8),
  ]),
  T("Fez Twelve", "Moorish", "d4", () => [
    star(C, 72, 12, 0.62), circle(C, 26, CUT), ...around(12, a => petal(C, 6, 24, a, 7)),
    ...around(12, a => circle(P(84, a), 4), 15), star(O, 30, 4, 0.35, 45),
  ]),
  T("Tetouan", "Moorish", "d4", () => [
    ...cells(4, (x, y) => star([x, y], 21, 8, 0.7654)), ...[0, 50, 100].flatMap(x => [0, 50, 100].map(y => diamond([x, y], 6))),
    ...cells(4, (x, y) => circle([x, y], 5, CUT)),
  ]),

  // ---- Azulejo: Portuguese blue-and-white wall tiles
  T("Lisboa", "Azulejo", "d4", () => [
    ...around(4, a => petal(C, 8, 54, a, 26)), ...around(4, a => petal(C, 10, 36, a, 10, L50), 45), circle(C, 9, CUT),
    ring(O, 42, 4), circle(O, 20, L50), ...around(8, a => petal(O, 48, 64, a, 10), 22.5),
  ]),
  T("Pombaline", "Azulejo", "d4", () => [
    line([[0, 0], [200, 200]], 4), diamond(C, 34, 34, OUT(4)), diamond(C, 16), circle([50, 50], 9),
    circle([100, 0], 14), circle([100, 0], 6, CUT), petal([100, 0], 18, 42, 90, 10),
  ]),
  T("Sintra", "Azulejo", "d4", () => [
    ring(O, 100, 4), ring([100, 0], 100, 4), circle(C, 10), circle(O, 10), circle([100, 0], 10),
  ]),
  T("Porto Tendril", "Azulejo", "d4", () => {
    const sp = Array.from({ length: 13 }, (_, i) => P(18 - i, -30 * i, [56, 48]));
    return [curve([[100, 62], [86, 52], ...sp], 4), leaf([86, 52], [80, 30], 10),
      ...around(4, a => petal(C, 6, 34, a, 12), 45), circle(C, 8), ring(O, 24, 4), circle(O, 12)];
  }),
  T("Coimbra", "Azulejo", "d4", () => [
    ...around(4, a => circle(P(30, a), 30)), ...around(4, a => circle(P(20, a, O), 20, L75)),
    ...around(4, a => circle(P(30, a), 22, CUT)), circle(C, 8), circle(O, 7, CUT),
  ]),
  T("Évora", "Azulejo", "d4", () => [
    ...around(8, a => petal([50, 50], 4, 24, a, 9)), circle([50, 50], 5, CUT),
    diamond(C, 20), diamond(C, 9, 9, CUT), diamond([100, 0], 14, 14, L50), circle(O, 10),
  ]),
  T("Faro Scallop", "Azulejo", "d4", () => [
    ring([100, 0], 30, 4), ring([100, 0], 44, 3), circle([100, 0], 14),
    star(C, 52, 4, 0.3, -45), star(C, 30, 4, 0.3, -90, L50), circle(C, 8, CUT),
    circle(O, 18), ring(O, 26, 3),
  ]),
  T("Algarve Star", "Azulejo", "d4", () => [
    star(C, 96, 4, 0.38, -45, L50), star(C, 64, 4, 0.38, -90), circle(C, 12, CUT), circle(C, 5),
    circle(O, 24), ring(O, 34, 3),
  ]),
  T("Aveiro Grid", "Azulejo", "d4", () => [
    line([[0, 0], [200, 0]], 5), ring(C, 44, 4), ring(O, 44, 4), circle(C, 24), star(C, 16, 8, 0.5, -90, CUT),
    diamond([100, 0], 12, 18), circle([50, 50], 8),
  ]),
  T("Madeira", "Azulejo", "rot4", () => [
    ...around(8, a => leaf(P(14, a), P(72, a + 28), 18)), ...around(8, a => circle(P(82, a + 40), 5)),
    circle(C, 10), circle(C, 4, CUT), ...around(4, a => leaf(P(6, a, O), P(40, a + 30, O), 12)),
  ]),

  // ---- Victorian and Minton geometric floors
  T("Minton Star", "Victorian", "d4", () => [
    star(C, 70, 4, 0.4), star(C, 40, 4, 0.4, -45, L50), circle(C, 8, CUT),
    box(8, 8, 184, 184, 0, OUT(4)), diamond(O, 22), diamond(O, 10, 10, CUT),
  ]),
  T("Victorian Hall", "Victorian", "d4", () => [
    diamond(O, 92, 92, L25), circle(O, 14),
    diamond(C, 78), diamond(C, 64, 64, { ...OUT(3), ...CUT }), diamond(C, 40, 40, CUT), diamond(C, 34, 34, L50), circle(C, 10),
  ]),
  T("Kensington", "Victorian", "d4", () => [
    ngon(C, 93, 8, -67.5), ngon(C, 76, 8, -67.5, { ...OUT(3), ...CUT }), circle(C, 46, CUT),
    star(C, 44, 4, 0.3, -90, L75), circle(C, 8), box(-22, -22, 44, 44, 3, L50),
  ]),
  T("Meander", "Victorian", "rot4", () => [
    line([[10, 90], [10, 10], [90, 10], [90, 74], [26, 74], [26, 26], [74, 26], [74, 58], [42, 58], [42, 42], [58, 42]], 6),
    circle(C, 6),
  ]),
  T("Fleur-de-lis", "Victorian", "d4", () => [
    leaf([100, 58], [100, 10], 20), curve([[100, 60], [86, 52], [74, 40], [76, 28], [84, 30]], 6),
    box(84, 58, 32, 7, 3), circle(C, 12), ring(C, 22, 3), circle(O, 16), petal(O, 20, 44, 45, 12),
  ]),
  T("Tudor Rose", "Victorian", "none", () => [
    ...around(5, a => circle(P(34, a), 26, L50)), ...around(5, a => circle(P(18, a), 16), 36),
    circle(C, 10, CUT), circle(C, 5), ...around(5, a => petal(C, 52, 74, a, 12, L75), 36),
    ...around(4, a => petal(O, 6, 26, a, 10), 45), circle(O, 5),
  ]),
  T("Border Frame", "Victorian", "d4", () => [
    box(6, 6, 188, 188, 0, OUT(3)), box(16, 16, 168, 168, 4, OUT(3)), box(-12, -12, 24, 24),
    diamond(C, 50, 50, L75), diamond(C, 34, 34, CUT), star(C, 26, 4, 0.3), circle(C, 4, CUT),
  ]),
  T("Pugin Cross", "Victorian", "d4", () => [
    box(88, 18, 24, 164, 12), ring(C, 44, 6), circle(C, 8, CUT), ring(O, 44, 6), circle(O, 14),
  ]),
  T("Harlequin", "Victorian", "mirror", () => [
    poly([[100, 4], [147, 100], [100, 196], [53, 100]]), poly([[0, 4], [47, 100], [0, 196], [-47, 100]], L50),
    diamond(C, 14, 28, CUT), diamond([0, 100], 10, 20),
  ]),
  T("Basketweave", "Victorian", "rot4", () => [0, 1, 2].map(k => box(6, 6 + k * 31.3, 88, 25.3, 3))),

  // ---- Art Deco: fans, sunbursts, chevrons and steps
  T("Sunrise", "Art Deco", "mirror", () => {
    const b = [100, 200];
    return [circle(b, 28), ring(b, 42, 4), ...[-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map(k => line([P(52, -90 + k * 16, b), P(84, -90 + k * 16, b)], 4)),
      star(C, 14, 4, 0.4)];
  }),
  T("Deco Chevron", "Art Deco", "none", () => [
    ...[0, 1, 2, 3, 4].map(k => line([[0, 20 + k * 20], [100, 120 + k * 20], [200, 20 + k * 20]], 5)),
    circle([100, 50], 18), ...around(8, a => line([P(24, a, [100, 50]), P(36, a, [100, 50])], 3)),
    circle([0, 150], 18), ...around(8, a => line([P(24, a, [0, 150]), P(36, a, [0, 150])], 3)),
  ]),
  T("Fan Scales", "Art Deco", "none", () => {
    const cs = [[0, 50], [100, 50], [200, 50], [0, 150], [100, 150], [200, 150], [50, 0], [150, 0], [50, 100], [150, 100], [50, 200], [150, 200]];
    return cs.flatMap(c => [arc(c, 46, 180, 360, 4), arc(c, 32, 180, 360, 3), arc(c, 18, 180, 360, 3), circle([c[0], c[1] - 6], 4)]);
  }),
  T("Deco Diamond", "Art Deco", "d4", () => [
    diamond(C, 90, 90, OUT(4)), diamond(C, 70, 70, OUT(4)), diamond(C, 50, 50, OUT(4)), diamond(C, 26),
    diamond(O, 70, 70, OUT(4)), diamond(O, 50, 50, { ...OUT(4), ...L50 }), diamond(O, 26, 26, L50),
  ]),
  T("Ziggurat", "Art Deco", "d4", () => [
    box(40, 40, 120, 120, 0, OUT(5)), box(55, 55, 90, 90, 0, OUT(4)), box(70, 70, 60, 60), box(85, 85, 30, 30, 0, CUT),
    line([[40, 40], [14, 14]], 5), circle(O, 14), box(80, -12, 40, 24), box(90, -22, 20, 44, 0, L50),
  ]),
  T("Miami", "Art Deco", "d4", () => [
    circle([100, 0], 28), ring([100, 0], 40, 3), ring([100, 0], 50, 3),
    star(C, 74, 4, 0.16, -45), circle(C, 16), circle(C, 8, CUT),
    ...around(8, a => line([P(26, a), P(46, a)], 3), 22.5), circle(O, 10),
  ]),
  T("Deco Lotus", "Art Deco", "mirror", () => [
    ...[-3, -2, -1, 0, 1, 2, 3].map(k => petal([100, 196], 8, 86 - Math.abs(k) * 10, -90 + k * 18, 14 - Math.abs(k))),
    circle([100, 200], 10), circle(C, 6), diamond([0, 100], 12, 30, L50),
  ]),
  T("Rays and Rings", "Art Deco", "d4", () => [
    circle(C, 20), ring(C, 32, 3), ring(C, 44, 3), ...around(16, a => line([P(54, a), P(96, a)], 3)),
    ...around(16, a => circle(P(100, a), 4)), star(O, 30, 8, 0.4),
  ]),
  T("Deco Pillars", "Art Deco", "mirror", () => [
    box(92, 14, 16, 172, 2), box(88, 10, 24, 8, 2), box(52, 34, 16, 132, 2), box(48, 30, 24, 8, 2),
    box(12, 54, 16, 92, 2), box(8, 50, 24, 8, 2), line([[0, 0], [200, 0]], 4),
    circle([60, 18], 6, L50), circle([20, 38], 6, L50),
  ]),
  T("Peacock", "Art Deco", "d4", () => [
    ...around(16, a => petal(O, 14, 104, a, 16)), ring(O, 116, 4), ...around(16, a => circle(P(92, a, O), 5, CUT)),
    circle(O, 12), diamond(C, 14),
  ]),

  // ---- Cuban and hydraulic: Havana and Mediterranean cement floors
  T("Havana", "Cuban", "d4", () => [
    petal(C, 14, 92, -135, 30), petal(C, 16, 58, -90, 12, L50), circle(C, 14), circle(C, 6, CUT),
    circle(O, 22), ring(O, 34, 3),
  ]),
  T("Trinidad", "Cuban", "d4", () => [
    star(C, 52, 4, 0.3), star(C, 74, 4, 0.22, -45, L50), circle(C, 8, CUT),
    ring([100, 0], 20, 4), circle([100, 0], 8), circle(O, 16), circle(O, 7, CUT),
  ]),
  T("Cienfuegos", "Cuban", "d4", () => [
    ring(O, 100, 6), circle([100, 0], 18), circle([100, 0], 8, CUT), ring(C, 30, 6), circle(C, 12),
    ...around(8, a => circle(P(52, a), 6), 22.5),
  ]),
  T("Habana Vieja", "Cuban", "d4", () => [
    line([[0, 100], [100, 0]], 5), star(C, 40, 8, 0.5), circle(C, 10, CUT),
    ...around(4, a => petal(O, 6, 34, a, 14)), circle([100, 0], 9),
  ]),
  T("Mediterráneo", "Cuban", "d4", () => [
    ...around(12, a => petal(C, 28, 62, a, 15)), ring(C, 22, 4), circle(C, 10), ring(C, 70, 3),
    ...around(8, a => petal(O, 6, 32, a, 10)), circle([100, 0], 10),
  ]),
  T("Tropical Palm", "Cuban", "d4", () => [
    ...around(24, a => petal(O, 12, 92, a, 11)), circle(O, 14),
    ...around(8, a => petal(C, 6, 22, a, 9)), circle(C, 5, CUT),
  ]),
  T("Baldosa Clásica", "Cuban", "d4", () => [
    star(C, 40, 8, 0.5), circle(C, 10, CUT), ...around(8, a => circle(P(54, a), 6), 22.5),
    circle([100, 0], 26), circle([100, 0], 18, CUT), circle([100, 0], 8), star(O, 34, 8, 0.5), circle(O, 8, CUT),
  ]),
  T("Orange Peel", "Cuban", "d4", () => [
    leaf(O, [100, 0], 36), leaf([0, 100], C, 36), circle([50, 50], 10, L50),
    circle(O, 6, CUT), circle(C, 6, CUT), circle([100, 0], 6, CUT),
  ]),
  T("Cuban Medallion", "Cuban", "d4", () => [
    ...around(8, a => petal(C, 36, 84, a, 24, L50)), ...around(8, a => petal(C, 10, 46, a, 14), 22.5),
    circle(C, 10, CUT), circle(C, 5), ring(O, 28, 4), ring(O, 16, 3),
  ]),
  T("Matanzas", "Cuban", "d4", () => [
    circle([50, 50], 24), ring([50, 50], 32, 3), circle([50, 50], 10, CUT),
    diamond(C, 18), diamond(C, 8, 8, CUT), diamond([100, 0], 18), diamond(O, 18),
  ]),

  // ---- Mid-century modern
  T("Atomic", "Mid-century", "none", () => [
    ...burst([56, 60], 8, 34), ...burst([150, 146], 8, 26),
    star([150, 40], 14, 4, 0.25), star([40, 160], 10, 4, 0.25), star([120, 96], 8, 4, 0.25),
    circle([180, 90], 4), circle([90, 180], 4), circle([10, 110], 3),
  ]),
  T("Boomerang", "Mid-century", "rot4", () => [
    blob([[88, 30], [62, 36], [46, 48], [36, 76], [26, 58], [28, 32], [56, 18]]),
    circle([70, 70], 5), circle([10, 100], 4, L50), circle(C, 10),
  ]),
  T("Polka Grid", "Mid-century", "none", () => [
    ...cells(4, (x, y, i, j) => circle([x, y], (i + j) % 2 ? 9 : 16)),
    ...[0, 1, 2, 3].flatMap(i => [0, 1, 2, 3].map(j => circle([i * 50, j * 50], 3, L50))),
  ]),
  T("Truchet Arcs", "Mid-century", "none", () => {
    const r = rng(7);
    return cells(4, (x, y) => {
      const x0 = x - 25, y0 = y - 25;
      return r() < 0.5 ? [arc([x0, y0], 25, 0, 90, 6), arc([x0 + 50, y0 + 50], 25, 180, 270, 6)]
        : [arc([x0 + 50, y0], 25, 90, 180, 6), arc([x0, y0 + 50], 25, 270, 360, 6)];
    });
  }),
  T("Scandi Tulip", "Mid-century", "mirror", () => [
    line([[100, 96], [100, 60]], 4), leaf([100, 62], [100, 24], 18), leaf([100, 64], [84, 30], 16),
    leaf([100, 90], [76, 70], 12), circle(C, 6), diamond([0, 100], 14, 22, L50), circle(O, 8),
  ]),
  T("Diamond Rows", "Mid-century", "none", () => [0, 1, 2, 3].flatMap(r => [0, 1, 2, 3].flatMap(c => {
    const p = [25 + 50 * c + (r % 2) * 25, 25 + 50 * r];
    return [diamond(p, 20, 22, OUT(4)), ...((r + c) % 2 ? [circle(p, 5)] : [])];
  }))),
  T("Breeze Block", "Mid-century", "d4", () => [
    box(6, 6, 88, 88, 10, OUT(6)), ring([50, 50], 26, 6), circle([50, 50], 8), star(C, 10, 4, 0.3),
  ]),
  T("Starburst", "Mid-century", "none", () => [
    [40, 40, 30], [140, 60, 22], [90, 140, 36], [170, 170, 14], [20, 120, 12], [130, 10, 10], [176, 110, 9],
  ].map(([x, y, R]) => star([x, y], R, 8, 0.18, -90)).concat([circle([70, 90], 4), circle([150, 120], 3), circle([30, 190], 3)])),
  T("Pebbles", "Mid-century", "none", () => {
    const r = rng(42);
    return cells(4, (x, y, i, j) => oval([x + (r() - 0.5) * 8, y + (r() - 0.5) * 8], 13 + r() * 5, 8 + r() * 5, r() * 180, (i + j) % 2 ? L75 : {}));
  }),
  T("Rainbow Arches", "Mid-century", "none", () => [50, 100, 150, 200].flatMap((y, k) => [0, 100].flatMap(x0 => {
    const c = [x0 + (k % 2) * 50 + 25, y];
    return [arc(c, 14, 180, 360, 6), arc(c, 24, 180, 360, 6), arc(c, 34, 180, 360, 6), circle([c[0], c[1] - 2], 4)];
  }))),

  // ---- Botanical
  T("Olive Branch", "Botanical", "none", () => {
    const at = t => { const b = [200 * t, 200 - 200 * t], o = 8 * Math.sin(4 * Math.PI * t); return [b[0] + o * 0.707, b[1] + o * 0.707]; };
    const one = [curve(Array.from({ length: 21 }, (_, i) => at(i / 20)), 3)];
    for (let k = 0; k < 8; k++) {
      const t = 0.06 + k * 0.125, b = at(t), side = k % 2 ? 1 : -1, a = -45 + side * 50;
      one.push(leaf(b, P(30, a, b), 11));
      if (k % 3 === 1) one.push(oval(P(14, a + side * 70, b), 6, 4.5, a, L75));
    }
    return [...one, ...shift(one, 100, 0)];
  }),
  T("Fern", "Botanical", "none", () => {
    const frond = (x, dy, o) => [line([[x, -2 + dy], [x, 202 + dy]], 3, o), ...Array.from({ length: 10 }, (_, k) => {
      const y = 10 + 20 * k + dy, L = 14 + 30 * Math.sin(Math.PI * (k + 0.5) / 10);
      return [leaf([x, y], [x - L, y - L * 0.45], 9, o), leaf([x, y], [x + L, y - L * 0.45], 9, o)];
    }).flat()];
    return [...frond(100, 0), ...frond(0, 100, L50)];
  }),
  T("Daisy Field", "Botanical", "none", () => [
    ...daisy([52, 56], 34, 14), ...daisy([150, 140], 28, 12), ...daisy([152, 36], 16, 10, L75),
    ...daisy([40, 156], 20, 10, L75), ...daisy([104, 96], 10, 8, L50), ...daisy([196, 88], 10, 8, L50),
  ]),
  T("Tulip Corners", "Botanical", "d4", () => [
    leaf(P(30, -135), P(80, -135), 22), leaf(P(32, -135), P(74, -147), 16), leaf(P(32, -135), P(74, -123), 16),
    line([P(12, -135), P(30, -135)], 4), circle(C, 12), ring(O, 30, 4), circle(O, 12),
  ]),
  T("Leaf Wreath", "Botanical", "rot4", () => [
    ...around(16, a => leaf(P(56, a), P(70, a + 18), 12)), ...around(16, a => circle(P(46, a + 11), 3)),
    star(C, 24, 8, 0.5), ...around(8, a => leaf(P(28, a, O), P(36, a + 30, O), 9)),
  ]),
  T("Lotus Pond", "Botanical", "d4", () => [
    ...around(8, a => petal(C, 10, 62, a, 26, L50)), ...around(8, a => petal(C, 8, 46, a, 20, L75), 22.5),
    ...around(8, a => petal(C, 6, 30, a, 12)), circle(C, 6, CUT), ring(O, 30, 4), circle(O, 14, L75),
  ]),
  T("Vine Scroll", "Botanical", "rot4", () => {
    const sp = Array.from({ length: 13 }, (_, i) => P(22 - i * 1.4, -60 - 30 * i, [56, 48]));
    return [curve([[100, 8], [80, 20], ...sp], 4), leaf([78, 22], [70, 4], 10), leaf([46, 30], [30, 16], 10),
      circle(C, 10), circle([86, 86], 4)];
  }),
  T("Seed Pods", "Botanical", "d4", () => [
    ...around(8, a => oval(P(52, a), 22, 10, a)), ...around(8, a => oval(P(52, a), 14, 3, a, CUT)),
    ring(C, 82, 3), circle(C, 18), ...around(8, a => circle(P(9, a), 2.5, CUT)),
    circle(O, 26), ring(O, 36, 3),
  ]),
  T("Wildflower Vine", "Botanical", "none", () => {
    const f1 = [60, 60], f2 = [150, 140];
    return [
      ...around(6, a => petal(f1, 4, 22, a, 14)), circle(f1, 6, CUT),
      curve([[60, 82], [70, 130], [54, 180], [60, 238]], 3), leaf([66, 120], [86, 108], 9), leaf([58, 170], [36, 160], 9),
      ...daisy(f2, 20, 9), curve([[150, 160], [140, 210], [158, 270], [150, 320]], 3),
      leaf([144, 200], [124, 190], 9), leaf([156, 250], [176, 240], 9),
      circle([110, 30], 5, L75), circle([10, 120], 5, L75),
    ];
  }),
  T("Ginkgo", "Botanical", "rot4", () => {
    const gk = (b, a, o) => [poly([b, ...arcPts(b, 34, a - 35, a + 35, 10)], o), line([b, P(14, a + 180, b)], 3, o), leaf(P(18, a, b), P(36, a, b), 4, CUT)];
    return [...gk(P(10, -70), -70), ...gk(P(14, 30, O), 30, L75)];
  }),

  // ---- Op art and waves
  T("Waves", "Op art", "none", () => Array.from({ length: 8 }, (_, k) =>
    curve(Array.from({ length: 23 }, (_, i) => { const x = -10 + 10 * i; return [x, 12.5 + 25 * k + 7 * Math.sin(2 * Math.PI * x / 100)]; }), 6))),
  T("Zigzag", "Op art", "none", () => Array.from({ length: 8 }, (_, k) =>
    line(Array.from({ length: 11 }, (_, i) => [-25 + 25 * i, 12.5 + 25 * k + (i % 2 ? 8 : -8)]), 5))),
  T("Concentric Squares", "Op art", "d4", () => [90, 70, 50, 30].map(s => rbox(C, 2 * s, 2 * s, 0, 0, OUT(6))).concat([rbox(C, 20, 20)])),
  T("Concentric Circles", "Op art", "d4", () => [
    ...[20, 40, 60, 80].map(r => ring(C, r, 7)), circle(C, 6), ring(O, 20, 7), ring(O, 40, 7),
  ]),
  T("Moiré", "Op art", "d4", () => [1, 2, 3, 4, 5, 6, 7, 8].flatMap(k => [ring(C, 12 * k, 2.5), ring(O, 12 * k, 2.5)])),
  T("Checkerboard", "Op art", "none", () => cells(4, (x, y, i, j) => (i + j) % 2
    ? [box(x - 23, y - 23, 46, 46, 3), circle([x, y], 6, CUT)] : [circle([x, y], 6)])),
  T("Halftone", "Op art", "d4", () => cells(8, (x, y) => circle([x, y], 2.5 + 8 * (Math.cos(Math.hypot(x - 100, y - 100) / 141.4 * Math.PI) + 1) / 2))),
  T("Fish Scales", "Op art", "none", () => Array.from({ length: 9 }, (_, r) => [0, 1, 2, 3, 4].flatMap(c => {
    const p = [c * 50 + (r % 2) * 25, r * 25];
    return [arc(p, 25, 180, 360, 3), arc(p, 13, 180, 360, 2.5)];
  })).flat()),
  T("Herringbone", "Op art", "none", () => {
    const out = [];
    for (let j = 0; j < 8; j++) { const d = j % 2 ? 1 : -1; for (let y = -40; y <= 240; y += 20) out.push(line([[j * 25 + 2, y], [j * 25 + 23, y + d * 21]], 5)); }
    return out;
  }),
  T("Op Twist", "Op art", "rot4", () => [184, 152, 120, 88, 56, 24].map((s, i) => rbox(C, s, s, 9 * i, 0, OUT(3))).concat([circle(O, 6)])),

  // ---- Minimal and modern
  T("Pinstripe", "Minimal", "none", () => Array.from({ length: 10 }, (_, i) => line([[10 + 20 * i, -2], [10 + 20 * i, 202]], i % 2 ? 6 : 3))),
  T("Grid", "Minimal", "d4", () => [line([[0, 0], [200, 0]], 4), line([[0, 50], [200, 50]], 3), line([[0, 100], [200, 100]], 3), circle([25, 25], 4), circle([75, 25], 4), circle([75, 75], 4)]),
  T("Terrazzo", "Minimal", "none", () => {
    const r = rng(2024), out = [], at = [];
    for (let tries = 0; out.length < 44 && tries < 2000; tries++) {
      const c = [r() * 200, r() * 200], R = 4 + r() * 7;
      const far = at.every(([q, Q]) => { const dx = Math.abs(q[0] - c[0]), dy = Math.abs(q[1] - c[1]); return Math.hypot(Math.min(dx, 200 - dx), Math.min(dy, 200 - dy)) > R + Q + 3; });
      if (!far) continue;
      at.push([c, R]);
      const n = 3 + Math.floor(r() * 4), a0 = r() * 360;
      out.push(poly(Array.from({ length: n }, (_, i) => P(R * (0.6 + r() * 0.4), a0 + i * 360 / n + r() * 30, c)), { level: [50, 75, 100][Math.floor(r() * 3)] }));
    }
    return out;
  }),
  T("Plus", "Minimal", "d4", () => [
    ...cells(4, (x, y) => [box(x - 12, y - 3, 24, 6, 1.5), box(x - 3, y - 12, 6, 24, 1.5)]),
    ...[0, 50, 100].flatMap(x => [0, 50, 100].map(y => circle([x, y], 2.5, L50))),
  ]),
  T("Cross-hatch", "Minimal", "d4", () => [
    ...[-150, -100, -50, 0, 50, 100, 150].map(c => line([[c, 0], [c + 200, 200]], 3)),
    circle([25, 0], 4), circle([50, 25], 4), circle([75, 50], 4), circle([100, 75], 4),
  ]),
  T("Bauhaus", "Minimal", "none", () => [
    box(104, 4, 92, 92, 0, L50), circle([150, 50], 30, CUT), circle([150, 50], 18),
    circle([50, 150], 44), circle([50, 150], 16, CUT),
    box(8, 8, 84, 20, 0, L75), box(8, 36, 20, 56, 0, L75),
    box(108, 108, 84, 84, 0, OUT(5)), line([[112, 188], [188, 112]], 5),
  ]),
  T("Capsules", "Minimal", "none", () => cells(4, (x, y, i, j) => (i + j) % 2 ? box(x - 20, y - 8, 40, 16, 8) : box(x - 8, y - 20, 16, 40, 8, L75))),
  T("Morse", "Minimal", "none", () => {
    const r = rng(9), out = [];
    for (let k = 0; k < 8; k++) {
      const y = 12.5 + 25 * k;
      let x = (k % 2) * 13;
      while (x < 200) { const L = r() < 0.4 ? 0 : 8 + r() * 18, end = Math.min(x + L, 200); out.push(L ? line([[x + 3, y], [end - 3 > x + 3 ? end - 3 : x + 4, y]], 5) : circle([x + 4, y], 3)); x = (L ? end : x + 8) + 9; }
    }
    return out;
  }),
  T("Honeycomb", "Minimal", "none", () => {
    const out = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const x = 25 + 50 * c + (r % 2) * 25, y = 25 + 50 * r;
      out.push(poly([[x, y - 33.3], [x + 25, y - 16.7], [x + 25, y + 16.7], [x, y + 33.3], [x - 25, y + 16.7], [x - 25, y - 16.7]], OUT(4)));
      if ((r + c) % 2) out.push(circle([x, y], 6, L50));
    }
    return out;
  }),
  T("Ribbon Weave", "Minimal", "none", () => {
    const out = [], ps = [25, 75, 125, 175];
    for (const p of ps) out.push(box(-2, p - 15, 204, 30), box(p - 15, -2, 30, 204));
    ps.forEach((x, i) => ps.forEach((y, j) => {
      if ((i + j) % 2) out.push(box(x - 18, y - 15, 3, 30, 0, CUT), box(x + 15, y - 15, 3, 30, 0, CUT));
      else out.push(box(x - 15, y - 18, 30, 3, 0, CUT), box(x - 15, y + 15, 30, 3, 0, CUT));
    }));
    return out;
  }),
];

// ---- building: drop shapes that the symmetry already draws, then scale to the tile
function signature(s, S) {
  const pts = [], add = (x, y) => { const w = v => { v = Math.round((((v % S) + S) % S) * 10) / 10; return v >= S - 0.05 ? 0 : v; }; pts.push(`${w(x)},${w(y)}`); };
  trace({
    moveTo: add, lineTo: add, closePath() { },
    quadraticCurveTo: (a, b, x, y) => { add(a, b); add(x, y); },
    bezierCurveTo: (a, b, c, d, x, y) => { add(a, b); add(c, d); add(x, y); },
    arc: (x, y, r) => { pts.length = 0; add(x, y); pts.push(`r${r.toFixed(2)}`); },   // a circle is its centre and radius
  }, s);
  return [s.type, !!s.cut, s.level || 100, s.w || 0, s.lw || 0, !!s.outline, !!s.closed, !!s.straight, !!s.smooth, pts.sort().join(";")].join("|");
}
function dedupe(list, sym) {
  const mats = SYM[sym].map(m => xf(m, 0, 0, S0)), out = [];
  let seen = new Set(), cut = null;
  for (const s of list) {
    if (!!s.cut !== cut) { seen = new Set(); cut = !!s.cut; }   // a shape after a cut paints over it, so keep it
    const sigs = mats.map(t => signature({ ...s, pts: s.pts.map(([x, y]) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]]) }, S0));
    if (sigs.some(g => seen.has(g))) continue;
    seen.add(sigs[0]); out.push(s);
  }
  return out;
}
const built = new Map();
// the template's shapes on a 200 mm tile (cached)
export function templateShapes(t) {
  if (!built.has(t)) built.set(t, dedupe(t.build().map(s => ({ level: 100, cut: false, smooth: false, ...s })), t.sym));
  return built.get(t);
}
// fresh shapes for a tile of size S
export function buildTemplate(t, S) {
  const k = S / S0;
  return templateShapes(t).map(s => {
    const c = JSON.parse(JSON.stringify(s));
    c.pts = c.pts.map(([x, y]) => [x * k, y * k]);
    for (const p of ["r", "w", "lw"]) if (c[p]) c[p] *= k;
    return c;
  });
}
