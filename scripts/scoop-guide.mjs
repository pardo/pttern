// Renders the two mix scoops for the how-to picture in the Cement mix panel: src/scoop-guide.png
// (both scoops, transparent background) and src/scoopGuide.js (numbered callouts over it, as SVG;
// the list under the picture in index.html explains the numbers).
// Run with `node scripts/scoop-guide.mjs` after changing the scoop geometry.
import fs from "fs";
import zlib from "zlib";
import { initGeometry, buildScoops } from "../src/geometry.js";
import { SCOOP, RATIO, WATER_LINE, scoopDims, SCOOP_WALL, SCOOP_FLOOR, SCOOP_GROOVE } from "../src/mix.js";

await initGeometry();
const [cement, sand] = buildScoops({ cement: SCOOP, ratio: RATIO, line: WATER_LINE });
const AZ = 25 * Math.PI / 180, TILT = 42 * Math.PI / 180, LIGHT = [0.45, 0.35, 0.82];
// world (mm, z up) -> screen (x right, y down, z towards the eye) at k px per mm
const view = (k, x, y, z) => {
  const X = x * Math.cos(AZ) - y * Math.sin(AZ), Y = x * Math.sin(AZ) + y * Math.cos(AZ);
  return [X * k, -(Y * Math.sin(TILT) + z * Math.cos(TILT)) * k, -(Y * Math.cos(TILT) - z * Math.sin(TILT)) * k];
};
const boxOf = P => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < P.length; i += 3) { const [x, y] = view(1, P[i], P[i + 1], P[i + 2]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, x1, y0, y1 };
};

// layout: the two scoops stacked, each drawn the same width, with room round them for the callouts
const W = 600, SW = 500, X0 = 30, TOP = 64, GAP = 90, BOTTOM = 70;
const cb = boxOf(cement), sb = boxOf(sand), kC = SW / (cb.x1 - cb.x0), kS = SW / (sb.x1 - sb.x0);
const C0 = { k: kC, off: [X0 - cb.x0 * kC, TOP - cb.y0 * kC] }, yS = TOP + (cb.y1 - cb.y0) * kC + GAP;
const S0 = { k: kS, off: [X0 - sb.x0 * kS, yS - sb.y0 * kS] }, H = Math.ceil(yS + (sb.y1 - sb.y0) * kS + BOTTOM);
const at = (v, x, y, z) => { const p = view(v.k, x, y, z); return [Math.round(p[0] + v.off[0]), Math.round(p[1] + v.off[1])]; };

// z-buffered flat shading into RGBA
const img = Buffer.alloc(W * H * 4), zb = new Float32Array(W * H).fill(-Infinity);
// the faces of the half marks and the water groove are tinted so they show at this size
const MARK = [214, 120, 60];
const marksOf = (ml, line) => {
  const { w, h } = scoopDims(ml), zs = [SCOOP_FLOOR + h / 2, ...(line > 0 ? [SCOOP_FLOOR + h * line] : [])], g = SCOOP_GROOVE + 0.01;
  return tri => tri.every(([x, y, z]) => x > -g && x < w + g && y > -g && y < w + g) && zs.some(z0 => tri.every(p => p[2] > z0 - 0.01 && p[2] < z0 + 0.81));
};
function draw(P, { k: px, off }, isMark) {
  for (let i = 0; i < P.length; i += 9) {
    const w = [0, 1, 2].map(k => [P[i + k * 3], P[i + k * 3 + 1], P[i + k * 3 + 2]]);
    const u = w[1].map((v, k) => v - w[0][k]), v = w[2].map((v, k) => v - w[0][k]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], m = Math.hypot(...n) || 1;
    const sh = 0.2 + 0.8 * Math.abs(n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / m;
    const c = (isMark(w) ? MARK.map(v => v * (0.7 + 0.3 * sh)) : [90 + 150 * sh, 95 + 150 * sh, Math.min(255, 110 + 150 * sh)]).map(Math.round);
    const p = w.map(a => { const q = view(px, ...a); return [q[0] + off[0], q[1] + off[1], q[2]]; });
    const d = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    if (Math.abs(d) < 1e-9) continue;
    const xa = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0]))), xb = Math.min(W - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
    const ya = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1]))), yb = Math.min(H - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const px = x + 0.5, py = y + 0.5;
      const b1 = ((p[2][0] - px) * (p[0][1] - py) - (p[0][0] - px) * (p[2][1] - py)) / d;
      const b2 = ((p[0][0] - px) * (p[1][1] - py) - (p[1][0] - px) * (p[0][1] - py)) / d, b0 = 1 - b1 - b2;
      if (b0 < 0 || b1 < 0 || b2 < 0) continue;
      const z = b0 * p[0][2] + b1 * p[1][2] + b2 * p[2][2], k = y * W + x;
      if (z > zb[k]) { zb[k] = z; img[k * 4] = c[0]; img[k * 4 + 1] = c[1]; img[k * 4 + 2] = c[2]; img[k * 4 + 3] = 255; }
    }
  }
}
draw(cement, C0, marksOf(SCOOP, WATER_LINE)); draw(sand, S0, marksOf(SCOOP * RATIO, 0));

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const td = Buffer.concat([Buffer.from(t), d]), l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(d.length); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(h, 4); hd[8] = 8; hd[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", hd), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
fs.writeFileSync(new URL("../src/scoop-guide.png", import.meta.url), png(W, H, img));

// feature points, matching scoopSolid in geometry.js
const feat = (ml, v) => {
  const { w, h } = scoopDims(ml), t = SCOOP_WALL, Hc = h + SCOOP_FLOOR, x1 = w + t + Math.max(50, w), e = Math.min(Hc, 16), cx = x1 - e / 2;
  return {
    hole: i => at(v, cx - i * 8, w / 2 - 2.5, e / 2),
    tick: at(v, w / 2, w, SCOOP_FLOOR + h / 2 + 0.4),
    groove: at(v, w * 0.22, w, SCOOP_FLOOR + h * WATER_LINE + 0.4),
    handle: at(v, w + t + 12, w / 2, Hc),
  };
};
const C = feat(SCOOP, C0), S = feat(SCOOP * RATIO, S0);
// numbered callout at `pt` moved by (dx, dy), with an arrow to the point; the list under the picture explains each number
const R = 17;
const callout = (n, pt, dx, dy) => {
  const c = [pt[0] + dx, pt[1] + dy], d = Math.hypot(dx, dy), s = [c[0] - dx / d * (R + 3), c[1] - dy / d * (R + 3)], e = [pt[0] + dx / d * 3, pt[1] + dy / d * 3];
  return `<path class="arw" d="M${s[0].toFixed(1)} ${s[1].toFixed(1)} L${e[0].toFixed(1)} ${e[1].toFixed(1)}" marker-end="url(#sgArrow)"/>` +
    `<circle class="num" cx="${c[0]}" cy="${c[1]}" r="${R}"/><text x="${c[0]}" y="${c[1] + 7}">${n}</text>`;
};
const parts = [
  callout(1, C.hole(0), 0, 62),
  callout(2, S.hole(1), 0, 62),
  callout(3, C.handle, 46, -44),
  callout(4, C.tick, 50, -(C.tick[1] - 26)),
  callout(5, C.groove, -40, -(C.groove[1] - 26)),
];
const svg = `<svg class="scoopGuide" viewBox="0 0 ${W} ${H}" role="img" aria-label="The two mix scoops with numbered markings: 1 the cement scoop's single handle hole, 2 the sand scoop's three holes, 3 the rim and handle to level against, 4 the half marks and 5 the water groove inside the cement scoop">` +
  `<defs><marker id="sgArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker></defs>` +
  `<image href="\${src}" x="0" y="0" width="${W}" height="${H}"/>` + parts.join("") + `</svg>`;
fs.writeFileSync(new URL("../src/scoopGuide.js", import.meta.url),
  `// Generated by scripts/scoop-guide.mjs: the scoop how-to picture with its numbered callouts.\nimport src from "./scoop-guide.png";\nexport const scoopGuide = \`${svg}\`;\n`);
console.log(W, H);
