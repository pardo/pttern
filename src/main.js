import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SYM, OFFS, xf, trace, isLine, lineWidth } from "./pattern.js";
import { clone, dist, simplify, transformShape, flipShape, mirrored, pointOps, anchorCount, minAnchors, anchorOf, bezShown, toBez, deletePoint, addPoint, smoothPoint, cornerPoint, handlesLinked, snapTargets, snapDelta, magnetPts, centre, snap, angleRound } from "./shapes.js";
import { wallInfo, cornerRadius, FLAP_T, FLAP_LEN, FLARE, LOCK_TONGUE } from "./moldspec.js";
import { mixFor, RATIO, SCOOP, WATER_LINE } from "./mix.js";
import { scoopGuide } from "./scoopGuide.js";
import { zipFiles } from "./files.js";
import { TEMPLATES, FAMILIES, templateShapes, buildTemplate, buildQuarter, quarterable } from "./templates.js";
import { frameForces, frameModel, CORNERS, WALLS } from "./forces.js";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const dpr = () => Math.min(window.devicePixelRatio || 1, 3);

const MOLD_DEF = { mode: "mold-inv", depth: 3, draft: 20, floor: 1.5, height: 20, wall: 5 };
const DEF = { v: 3, innerRadius: 5, size: 200, sym: "d4", turn: false, snap: 0, strokeW: 4, newCut: false, kind: "kit", clear: 0.3, lock: true, mirror: true, seg: 0.2, tiles: 1, ...MOLD_DEF };
let cfg = { ...DEF };
let shapes = [];
let sel = null;          // selected shape id
let tool = "select";
// per-browser preferences kept between visits (the drawing and mold settings live in cfg)
const UI_KEY = "pttern.ui.v1";
const UI_DEF = { tool: "select", view: "edit", angleSnap: true, pointSnap: true, smoothing: 0.35, rectR: 0, sides: 6, inner: 1, square: false, outline: false, panels: {}, inputs: {}, profZ: null };
let ui = { ...UI_DEF };
function saveUI() { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { } }
let view = "edit";
let undoStack = [], redoStack = [];
let nextId = 1;

function setXf(ctx, k, x0, y0, t) { ctx.setTransform(k * t[0], k * t[1], k * t[2], k * t[3], k * t[4] + x0, k * t[5] + y0); }

// ---- shape geometry, traced onto any canvas-like path target
function svgPath(s) {
  let d = "";
  const f = v => +v.toFixed(3);
  trace({
    moveTo: (x, y) => d += `M${f(x)} ${f(y)}`,
    lineTo: (x, y) => d += `L${f(x)} ${f(y)}`,
    quadraticCurveTo: (a, b, x, y) => d += `Q${f(a)} ${f(b)} ${f(x)} ${f(y)}`,
    bezierCurveTo: (a, b, c, e, x, y) => d += `C${f(a)} ${f(b)} ${f(c)} ${f(e)} ${f(x)} ${f(y)}`,
    closePath: () => d += "Z",
    arc: (x, y, r) => d = `M${f(x - r)} ${f(y)}A${f(r)} ${f(r)} 0 1 0 ${f(x + r)} ${f(y)}A${f(r)} ${f(r)} 0 1 0 ${f(x - r)} ${f(y)}`,
  }, s);
  return d;
}

function paintShapes(ctx, k, x0, y0, style, offs, list = shapes, sym = cfg.sym, S = cfg.size) {
  const mats = SYM[sym];
  for (const s of list) {
    const st = style(s);
    ctx.globalCompositeOperation = st.op || "source-over";
    for (const [ox, oy] of offs) for (const m of mats) {
      setXf(ctx, k, x0, y0, xf(m, ox * S, oy * S, S));
      ctx.beginPath(); trace(ctx, s);
      if (isLine(s)) { ctx.lineWidth = lineWidth(s); ctx.lineCap = ctx.lineJoin = "round"; ctx.strokeStyle = st.color; ctx.stroke(); }
      else { ctx.fillStyle = st.color; ctx.fill(); }
    }
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ---- heightmap: 0..1 per pixel, wraps across tile edges
const grayOf = lv => { const v = Math.round(255 * lv / 100); return `rgb(${v},${v},${v})`; };
function renderMask(N) {
  const c = document.createElement("canvas"); c.width = c.height = N;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.fillStyle = "#000"; x.fillRect(0, 0, N, N);
  paintShapes(x, N / cfg.size, 0, 0, s => s.cut ? { color: "#000" } : { color: grayOf(s.level || 100), op: "lighten" }, OFFS);
  const d = x.getImageData(0, 0, N, N).data, m = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) m[i] = d[i * 4] / 255;
  return m;
}
function boxBlur(src, N, r) {
  if (r < 1) return src;
  r = Math.min(r, N >> 2);
  const a = src.slice(), b = new Float32Array(N * N), w = 2 * r + 1, md = i => ((i % N) + N) % N;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < N; y++) {
      const row = y * N; let s = 0;
      for (let i = -r; i <= r; i++) s += a[row + md(i)];
      for (let x = 0; x < N; x++) { b[row + x] = s / w; s += a[row + md(x + r + 1)] - a[row + md(x - r)]; }
    }
    for (let x = 0; x < N; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += b[md(i) * N + x];
      for (let y = 0; y < N; y++) { a[y * N + x] = s / w; s += b[md(y + r + 1) * N + x] - b[md(y - r) * N + x]; }
    }
  }
  return a;
}
function heightMask(N) { return boxBlur(renderMask(N), N, Math.round(cfg.depth * Math.tan(cfg.draft * Math.PI / 180) / (cfg.size / N) / 2)); }


function geomOpts(preview) {
  return { S: cfg.size, D: cfg.depth, B: cfg.floor, W: cfg.wall, T: cfg.height, mode: cfg.mode, kind: cfg.kind, mirror: cfg.mirror, draft: cfg.draft,
    seg: preview ? 0.6 : cfg.seg, step: preview ? 0.5 : 0.2, clear: cfg.clear, lock: cfg.lock, ri: cfg.innerRadius, sym: cfg.sym };
}

// ---- geometry worker: preview meshes and export files are built off the main thread
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
const jobs = new Map();
let jobId = 0;
worker.onmessage = ({ data }) => {
  const j = jobs.get(data.id); if (!j) return;
  jobs.delete(data.id);
  data.error ? j.reject(new Error(data.error)) : j.resolve(data);
};
function runJob(task, extra = {}) {
  const id = ++jobId;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    worker.postMessage({ id, task, shapes, o: geomOpts(task === "preview"), ...extra });
  });
}

// ---- saving files: claude.ai viewer capability when present, plain download otherwise
let dlPromise = null;
function getDownloads() {
  if (!window.claude || !window.claude.use) return Promise.resolve(null);
  return dlPromise || (dlPromise = window.claude.use("downloads").catch(() => null));
}
const inViewer = () => !!(window.claude && window.claude.use);
async function offerFile(filename, data) {
  const dl = await getDownloads();
  if (dl) {
    try { await dl.save({ filename, data }); toast(`Saved ${filename}`); }
    catch (e) { toast(e && e.code === "declined" ? "Save cancelled" : `Couldn't save ${filename} here`); }
    return;
  }
  if (inViewer()) { toast("Saving files isn't available in this view"); return; }
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Saved ${filename}`);
}

// ---- persistence & history
function persist() { try { localStorage.setItem("pttern.v1", JSON.stringify({ cfg, shapes })); } catch (e) { } }
// history entries hold the symmetry and tile turning too, since loading a template changes them
const state = () => JSON.stringify({ sym: cfg.sym, turn: cfg.turn, shapes });
function restore(st) { const d = JSON.parse(st); cfg.sym = d.sym; cfg.turn = !!d.turn; shapes = d.shapes; }
function snapshot() { undoStack.push(state()); if (undoStack.length > 120) undoStack.shift(); redoStack = []; syncHistory(); }
function undo() { if (!undoStack.length) return; redoStack.push(state()); restore(undoStack.pop()); sel = null; selPt = -1; syncPanel(); changed(true); }
function redo() { if (!redoStack.length) return; undoStack.push(state()); restore(redoStack.pop()); sel = null; selPt = -1; syncPanel(); changed(true); }
function syncHistory() { $("#undoBtn").disabled = !undoStack.length; $("#redoBtn").disabled = !redoStack.length; }
function reid() { nextId = 1 + shapes.reduce((m, s) => Math.max(m, s.id || 0), 0); shapes.forEach(s => { if (!s.id) s.id = nextId++; }); }
function changed(rebuildCtx) { persist(); draw(); syncHistory(); if (rebuildCtx) renderCtx(); dirty3D = true; if (view !== "edit") schedulePreview(); }

// ---- sample: the Florentine rosette, the first template
const sample = () => buildTemplate(TEMPLATES[0], cfg.size);

// ---- canvas & view: canvas px = V + design mm × K. At zoom 1 the tile fills the canvas with a margin of its neighbours.
const cv = $("#cv"), ctx = cv.getContext("2d");
const MARGIN = 0.08, ZMAX = 16;
let K = 1, VX = 0, VY = 0, zoom = 1, vc = null;   // vc: design point at the centre of the canvas
const baseK = () => cv.width / (cfg.size * (1 + 2 * MARGIN));
function layout() {
  const S = cfg.size, R = S * (1 + 2 * MARGIN) / 2, lim = R - R / zoom, h = cv.width / 2;
  const cl = v => Math.max(S / 2 - lim, Math.min(S / 2 + lim, v));
  vc = vc ? vc.map(cl) : [S / 2, S / 2];
  K = baseK() * zoom; VX = h - vc[0] * K; VY = h - vc[1] * K;
  $("#zFit").textContent = `${Math.round(zoom * 100)}%`;
  $("#zOut").disabled = zoom <= 1; $("#zIn").disabled = zoom >= ZMAX;
  const a = -VX / K, b = (cv.width - VX) / K;
  $("#rulerStart").textContent = zoom > 1 ? `${f1(a)} mm` : "0";
  $("#rulerMid").textContent = zoom > 1 ? `${f1(b - a)} mm across` : `${S / 2} mm`;
  $("#rulerEnd").textContent = zoom > 1 ? `${f1(b)} mm` : S;
}
// zoom to z, keeping design point d under canvas pixel c
function viewTo(z, d, c) {
  zoom = Math.max(1, Math.min(ZMAX, z));
  const k = baseK() * zoom, h = cv.width / 2;
  vc = [d[0] + (h - c[0]) / k, d[1] + (h - c[1]) / k];
  layout(); draw();
}
const zoomBy = f => { const h = cv.width / 2; viewTo(zoom * f, [(h - VX) / K, (h - VY) / K], [h, h]); };
function fitView() { zoom = 1; vc = null; layout(); draw(); }
$("#zIn").addEventListener("click", () => zoomBy(1.5));
$("#zOut").addEventListener("click", () => zoomBy(1 / 1.5));
$("#zFit").addEventListener("click", fitView);
function sizeCanvases() {
  const w = $("#viewWrap").clientWidth, px = Math.round(w * dpr());
  for (const c of [cv, $("#pv")]) if (c.width !== px) { c.width = c.height = px; }
  layout(); draw(); if (view === "prev") drawPreview(); if (three) three.resize();
}
const canvasPx = e => { const r = cv.getBoundingClientRect(), s = cv.width / r.width; return [(e.clientX - r.left) * s, (e.clientY - r.top) * s]; };
const toDesign = e => { const [x, y] = canvasPx(e); return [(x - VX) / K, (y - VY) / K]; };
const D = p => [VX + p[0] * K, VY + p[1] * K];
const tolMM = () => 12 * dpr() / K;
const tok = () => { const cs = getComputedStyle(document.documentElement); const g = n => cs.getPropertyValue(n).trim(); return { field: g("--field"), raised: g("--raised"), outside: g("--outside"), accent: g("--accent"), ink: g("--ink"), muted: g("--muted"), bg: g("--bg") }; };
function mixHex(a, b, t) {
  const p = h => { h = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const A = p(a), B = p(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`;
}

// ---- drawing the plate
function draw() {
  const T = tok(), S = cfg.size, W = cv.width, h = S / 2, d = dpr();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = T.field; ctx.fillRect(0, 0, W, W);
  paintShapes(ctx, K, VX, VY, s => ({ color: s.cut ? T.field : mixHex(T.field, T.raised, (s.level || 100) / 100) }), OFFS);
  // dim the neighbouring tiles
  ctx.fillStyle = T.outside; ctx.globalAlpha = 0.62;
  ctx.beginPath(); ctx.rect(0, 0, W, W); ctx.rect(VX, VY, S * K, S * K); ctx.fill("evenodd");
  ctx.globalAlpha = 1;
  // symmetry guides
  ctx.save(); ctx.strokeStyle = T.accent; ctx.globalAlpha = 0.35; ctx.lineWidth = d; ctx.setLineDash([4 * d, 4 * d]);
  const line = (a, b, c, e) => { ctx.beginPath(); ctx.moveTo(...D([a, b])); ctx.lineTo(...D([c, e])); ctx.stroke(); };
  if (cfg.sym === "mirror" || cfg.sym === "d4") { line(h, 0, h, S); line(0, h, S, h); }
  if (cfg.sym === "d4") { line(0, 0, S, S); line(S, 0, 0, S); }
  ctx.restore();
  if (cfg.sym === "d4") { ctx.fillStyle = T.accent; ctx.globalAlpha = 0.08; ctx.beginPath(); ctx.moveTo(...D([h, h])); ctx.lineTo(...D([h, 0])); ctx.lineTo(...D([0, 0])); ctx.fill(); ctx.globalAlpha = 1; }
  if (cfg.sym === "rot4") { ctx.fillStyle = T.accent; ctx.beginPath(); ctx.arc(...D([h, h]), 3 * d, 0, 7); ctx.fill(); }
  // snap grid dots, only where the view shows them
  if (cfg.snap) {
    const st = cfg.snap * Math.max(1, Math.ceil(6 * d / (cfg.snap * K))), lo = v => Math.max(0, Math.ceil(v / st) * st);
    const x1 = Math.min(S, (W - VX) / K), y1 = Math.min(S, (W - VY) / K);
    ctx.fillStyle = T.muted; ctx.globalAlpha = 0.35;
    for (let x = lo(-VX / K); x <= x1 + 1e-6; x += st) for (let y = lo(-VY / K); y <= y1 + 1e-6; y += st) { const [a, b] = D([x, y]); ctx.fillRect(a - d / 2, b - d / 2, d, d); }
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = T.ink; ctx.globalAlpha = 0.5; ctx.lineWidth = d; ctx.strokeRect(VX, VY, S * K, S * K); ctx.globalAlpha = 1;
  if (hoverHit && !drag) outline(hoverHit.s, xf(hoverHit.m, 0, 0, S), T.accent, 0.55, 1.5);
  const s = shapes.find(q => q.id === sel);
  if (s) {
    for (const m of SYM[cfg.sym].slice(1)) outline(s, xf(m, 0, 0, S), T.accent, 0.35, 1);   // its mirrored copies
    outline(s, [1, 0, 0, 1, 0, 0], T.accent, 1, 2);
    drawHandles(s, T);
  }
  if (draft && draft.pts.length) drawDraft(T);
  if (snapMark) drawSnap(T);
}
function outline(s, t, col, alpha, lw) {
  setXf(ctx, K, VX, VY, t); ctx.beginPath(); trace(ctx, s); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = col; ctx.globalAlpha = alpha; ctx.lineWidth = lw * dpr(); ctx.setLineDash([]); ctx.stroke(); ctx.globalAlpha = 1;
}
function dot(p, r, fill, T, square) {
  const [x, y] = D(p), d = dpr();
  ctx.beginPath();
  if (square) ctx.rect(x - r * d, y - r * d, 2 * r * d, 2 * r * d); else ctx.arc(x, y, r * d, 0, 7);
  ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 2 * d; ctx.strokeStyle = T.accent; ctx.stroke();
}
function arm(a, b, T) { ctx.beginPath(); ctx.moveTo(...D(a)); ctx.lineTo(...D(b)); ctx.lineWidth = dpr(); ctx.strokeStyle = T.accent; ctx.globalAlpha = 0.7; ctx.stroke(); ctx.globalAlpha = 1; }
function drawHandles(s, T) {
  if (s.type !== "bez") { handles(s).forEach((p, i) => dot(p, 6, i === selPt ? T.accent : T.bg, T)); return; }
  const P = s.pts;
  for (let i = 1; i < P.length; i += 3) for (const j of [i - 1, i + 1]) if (bezShown(s, j) && dist(P[j], P[i]) > 1e-6) { arm(P[i], P[j], T); dot(P[j], 3.5, T.accent, T); }
  for (let i = 1; i < P.length; i += 3) dot(P[i], 5, i === selPt ? T.accent : T.bg, T, true);
}
function drawDraft(T) {
  const d = dpr(), k = draft.kind, P = draft.pts, live = drag && (drag.kind === "place" || drag.kind === "bezPt"), hov = !live && draft.hover;
  ctx.save();
  setXf(ctx, K, VX, VY, [1, 0, 0, 1, 0, 0]);
  ctx.beginPath();
  if (k === "bez") trace(ctx, { type: "bez", closed: false, pts: hov ? P.concat([hov, hov, hov]) : P });
  else (hov ? P.concat([hov]) : P).forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
  ctx.globalAlpha = 0.28; ctx.fillStyle = ctx.strokeStyle = T.accent;   // what it will look like
  if (k === "poly") ctx.fill(); else { ctx.lineWidth = cfg.strokeW; ctx.lineCap = ctx.lineJoin = "round"; ctx.stroke(); }
  ctx.restore();
  ctx.save(); ctx.strokeStyle = T.accent; ctx.lineWidth = 1.5 * d; ctx.setLineDash([6 * d, 4 * d]); ctx.stroke(); ctx.restore();
  const A = draftAnchors();
  if (k === "bez") { const n = P.length, a = P[n - 2]; for (const j of [n - 3, n - 1]) if (dist(P[j], a) > 1e-6) { arm(a, P[j], T); dot(P[j], 3.5, T.accent, T); } }
  A.forEach((p, i) => dot(p, i ? 4 : 7, i ? T.accent : T.bg, T));
  if (k !== "bez") {   // length and angle of the segment being placed
    const cur = live ? A[A.length - 1] : hov, from = live ? A[A.length - 2] : A[A.length - 1];
    if (cur && from && dist(cur, from) > 0.05) {
      const ang = Math.round(-Math.atan2(cur[1] - from[1], cur[0] - from[0]) * 180 / Math.PI);
      label(T, D(cur), `${dist(cur, from).toFixed(1)} mm · ${(ang + 360) % 360}°`);
    }
  }
}
function label(T, [x, y], text) {
  const d = dpr();
  ctx.font = `500 ${11 * d}px "IBM Plex Mono", ui-monospace, monospace`;
  const w = ctx.measureText(text).width + 12 * d, h = 20 * d;
  let bx = x + 14 * d, by = y - 14 * d - h;
  if (bx + w > cv.width) bx = x - 14 * d - w;
  if (by < 0) by = y + 14 * d;
  ctx.fillStyle = T.ink; ctx.globalAlpha = 0.85; ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, w, h, h / 2); else ctx.rect(bx, by, w, h);
  ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = T.bg; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(text, bx + 6 * d, by + h / 2);
}
function drawSnap(T) {
  const m = snapMark, d = dpr(), [x, y] = D(m.p), R = cv.width * 2;
  ctx.save(); ctx.strokeStyle = T.accent; ctx.lineWidth = 1.5 * d;
  ctx.globalAlpha = 0.6; ctx.setLineDash([4 * d, 4 * d]);
  for (const [a, b] of m.guides) {   // guide lines through the point it lined up with
    const [fx, fy] = D(a), [gx, gy] = D(b || m.p), L = Math.hypot(gx - fx, gy - fy);
    if (L < 1e-6) continue;
    const ux = (gx - fx) / L, uy = (gy - fy) / L;
    ctx.beginPath(); ctx.arc(fx, fy, 2.5 * d, 0, 7); ctx.fillStyle = T.accent; ctx.fill();
    ctx.beginPath(); ctx.moveTo(fx - ux * R, fy - uy * R); ctx.lineTo(fx + ux * R, fy + uy * R); ctx.stroke();
  }
  if (m.ring) { ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.beginPath(); ctx.arc(x, y, 8 * d, 0, 7); ctx.stroke(); }
  ctx.restore();
}
function handles(s) {
  if (s.type === "circle") return [s.pts[0], [s.pts[0][0] + s.r, s.pts[0][1]]];
  if (s.type === "stroke" && !s.straight) return [];
  return s.pts;
}
// the handle under p; on curves the points win over their control handles
function handleAt(s, p, tol) {
  const hs = handles(s), near = f => { let b = -1, bd = tol; hs.forEach((h, i) => { if (f(i) && dist(h, p) < bd) { bd = dist(h, p); b = i; } }); return b; };
  if (s.type !== "bez") return near(() => true);
  const a = near(i => i % 3 === 1);
  return a >= 0 ? a : near(i => i % 3 !== 1 && bezShown(s, i) && dist(hs[i], hs[anchorOf(s, i)]) > 1e-6);
}

// ---- hit testing (any symmetric copy selects its source shape)
const hitCtx = document.createElement("canvas").getContext("2d");
function hitTest(p, tol) {
  const mats = SYM[cfg.sym];
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i], line = isLine(s);
    for (const m of mats) {
      const t = xf(m, 0, 0, cfg.size);
      hitCtx.setTransform(...t); hitCtx.beginPath(); trace(hitCtx, s);
      hitCtx.setTransform(1, 0, 0, 1, 0, 0);
      hitCtx.lineWidth = line ? Math.max(lineWidth(s), tol * 2) : tol;
      if ((!line && hitCtx.isPointInPath(p[0], p[1])) || hitCtx.isPointInStroke(p[0], p[1])) return { s, m };
    }
  }
  return null;
}
const newShape = o => ({ id: nextId++, level: 100, cut: cfg.newCut, smooth: false, ...o });

// ---- snapping: other shapes' points (ring), 15° angles from the last point, lining up with the tile and the
// shape being drawn, then the grid. Alt draws freely; Shift flips angle snapping.
let snapMark = null;
function snapAt(p, o = {}) {
  snapMark = null;
  if (o.ev && o.ev.altKey) return p;
  const tg = ui.pointSnap ? snapTargets(shapes, cfg.size, cfg.sym, o.skip).concat(o.extra || []) : [];
  const r = snap(p, {
    tol: 10 * dpr() / K, grid: cfg.snap, from: o.from, angle: o.angle,
    targets: tg, align: tg,
  });
  if (r.ring || r.guides.length) snapMark = r;
  return r.p;
}
const angleOn = (e, kind) => kind === "bez" ? e.shiftKey : ui.angleSnap !== e.shiftKey;

// ---- shapes placed point by point: Shape (poly), Line and Curve (bez)
const DRAFT_TOOLS = new Set(["poly", "line", "bez"]);
let draft = null;   // { kind, pts, hover }
const draftAnchors = () => !draft ? [] : draft.kind === "bez" ? draft.pts.filter((_, i) => i % 3 === 1) : draft.pts;
function draftDown(e, p, tol) {
  if (!draft || draft.kind !== tool) draft = { kind: tool, pts: [], hover: null };
  const k = draft.kind, A = draftAnchors(), n = A.length, min = k === "poly" ? 3 : 2;
  if (n >= (k === "bez" ? 2 : 3) && dist(A[0], p) < tol * 1.5) { finishDraft(true); return; }
  if (n && dist(A[n - 1], p) < tol) { if (n >= min) finishDraft(false); return; }   // the last point again, or a double-click, ends it
  const q = snapAt(p, { from: n ? A[n - 1] : null, angle: angleOn(e, k), ev: e, extra: A });
  if (k === "bez") { draft.pts.push(q.slice(), q, q.slice()); drag = { kind: "bezPt", start: canvasPx(e) }; }
  else if (!n) { draft.pts.push(q, q.slice()); drag = { kind: "place", first: true }; }   // dragging from the first point draws a segment
  else { draft.pts.push(q); drag = { kind: "place" }; }
  draft.hover = null; renderCtx(); draw();
}
function finishDraft(closed) {
  const d = draft; draft = null; snapMark = null;
  if (!d) return;
  const n = d.kind === "bez" ? d.pts.length / 3 : d.pts.length;
  let s = null;
  if (d.kind === "poly" && n >= 3) s = newShape({ type: "poly", pts: d.pts, ...(ui.outline ? { outline: true, lw: cfg.strokeW } : {}) });
  if (d.kind === "line" && n >= 2) s = newShape({ type: "stroke", straight: true, closed: closed && n >= 3, pts: d.pts, w: cfg.strokeW });
  if (d.kind === "bez" && n >= 2) s = newShape({ type: "bez", closed, pts: d.pts, w: cfg.strokeW });
  if (s) { snapshot(); shapes.push(s); sel = s.id; selPt = -1; changed(true); }
  else { renderCtx(); draw(); }
}
function cancelDraft() { draft = null; snapMark = null; renderCtx(); draw(); }
function popDraft() {
  if (!draft) return;
  draft.pts.splice(draft.kind === "bez" ? -3 : -1);
  if (!draft.pts.length) draft = null;
  renderCtx(); draw();
}

// ---- pointer interaction: one finger or mouse draws; two fingers pinch and pan; wheel zooms; middle button,
// Space-drag or dragging empty space with Select pans
const ptrs = new Map();
let drag = null, pinch = null, hoverHit = null, spaceDown = false, selPt = -1;
function startPinch() {
  const [a, b] = [...ptrs.values()], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  pinch = { d0: dist(a, b) || 1, z0: zoom, at: [(m[0] - VX) / K, (m[1] - VY) / K] };
}
// one finger on the selected shape and a second anywhere: the two fingers rotate, scale and move the shape
const pxToDesign = c => [(c[0] - VX) / K, (c[1] - VY) / K];
function startShapePinch() {
  const s = drag.s, t = xf(drag.m || [1, 0, 0, 1], 0, 0, cfg.size);
  const snapped = !drag.pushed;
  if (snapped) snapshot();
  drag = null;
  // fingers are on one of the symmetric copies, so work in the source shape's own frame
  const local = c => { const [x, y] = pxToDesign(c), dx = x - t[4], dy = y - t[5]; return [t[0] * dx + t[1] * dy, t[2] * dx + t[3] * dy]; };
  const [a, b] = [...ptrs.values()].map(local);
  pinch = { shape: s, orig: clone(s), a, b, local, snapped };
}
function movePinch() {
  const [c1, c2] = [...ptrs.values()];
  if (!pinch.shape) { viewTo(pinch.z0 * dist(c1, c2) / pinch.d0, pinch.at, [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2]); return; }
  const { shape: s, orig, a, b, local } = pinch, a2 = local(c1), b2 = local(c2);
  const u = [b[0] - a[0], b[1] - a[1]], v = [b2[0] - a2[0], b2[1] - a2[1]];
  const sc = Math.max(0.05, Math.hypot(...v) / (Math.hypot(...u) || 1)), r = Math.atan2(v[1], v[0]) - Math.atan2(u[1], u[0]);
  const co = Math.cos(r) * sc, si = Math.sin(r) * sc;
  s.pts = orig.pts.map(([x, y]) => { const dx = x - a[0], dy = y - a[1]; return [a2[0] + dx * co - dy * si, a2[1] + dx * si + dy * co]; });
  if (orig.r) s.r = orig.r * sc;
  if (s.type === "leaf") s.w = orig.w * sc;
  draw();
}
// a quick tap with two fingers undoes, with three redoes
let tapG = null;
function trackTap(e) {
  if (e.pointerType !== "touch") return;
  if (ptrs.size === 2 && !tapG) tapG = { t0: performance.now(), n: 2, moved: false, start: new Map(ptrs), shape: !!(pinch && pinch.shape) };
  else if (tapG && ptrs.size > tapG.n) { tapG.n = ptrs.size; tapG.start.set(e.pointerId, ptrs.get(e.pointerId)); }
}
function abortDrag() {
  const d = drag; drag = null; snapMark = null;
  if (!d) return;
  if (d.kind === "create") { shapes.pop(); undoStack.pop(); sel = null; syncHistory(); }
  else if (d.pushed) { restore(undoStack.pop()); syncHistory(); }
  else if (d.kind === "place") { draft.pts.splice(d.first ? -2 : -1); if (!draft.pts.length) draft = null; }
  else if (d.kind === "bezPt") { draft.pts.splice(-3); if (!draft.pts.length) draft = null; }
  renderCtx(); draw();
}
cv.addEventListener("pointerdown", e => {
  ptrs.set(e.pointerId, canvasPx(e));
  try { cv.setPointerCapture(e.pointerId); } catch (_) { }
  if (ptrs.size === 2) {
    if (drag && (drag.kind === "move" || drag.kind === "handle") && drag.s.id === sel) startShapePinch(); else { abortDrag(); startPinch(); }
    trackTap(e); return;
  }
  if (ptrs.size > 2) { trackTap(e); return; }
  if (pinch || drag || e.button === 2) return;
  const p = toDesign(e), tol = tolMM();
  hoverHit = null;
  if (e.button === 1 || spaceDown) { drag = { kind: "pan", last: canvasPx(e) }; cv.style.cursor = "grabbing"; return; }
  if (tool === "select") return pickDown(e, p, tol);
  if (DRAFT_TOOLS.has(tool)) return draftDown(e, p, tol);
  snapshot();
  let s;
  const q = snapAt(p, { ev: e });
  if (tool === "circle") s = newShape({ type: "circle", pts: [q], r: 0 });
  if (tool === "leaf") s = newShape({ type: "leaf", pts: [q, q.slice()], w: 0 });
  if (tool === "stroke") s = newShape({ type: "stroke", pts: [q], w: cfg.strokeW });
  if (tool === "rect") s = newShape({ type: "rect", pts: [q, q.slice(), q.slice(), q.slice()], r: ui.rectR });
  if (tool === "ellipse") s = newShape({ type: "ellipse", pts: [q, q.slice(), q.slice()] });
  if (tool === "star") s = newShape({ type: "star", pts: [q, q.slice()], n: ui.sides, inner: ui.inner });
  if (s.type !== "stroke" && ui.outline) Object.assign(s, { outline: true, lw: cfg.strokeW });
  shapes.push(s); sel = s.id; selPt = -1;
  drag = { kind: "create", s, start: q };
  renderCtx(); draw();
});
function pickDown(e, p, tol) {
  const s = shapes.find(q => q.id === sel);
  if (s) {
    const hi = handleAt(s, p, tol * 1.2);
    if (hi >= 0) {
      selPt = pointOps(s) ? anchorOf(s, hi) : -1;
      drag = { kind: "handle", s, hi, pushed: false, linked: handlesLinked(s, hi) };
      renderCtx(); draw(); return;
    }
  }
  const hit = hitTest(p, tol), prev = sel;
  sel = hit ? hit.s.id : null;
  if (prev !== sel) selPt = -1;
  drag = hit ? { kind: "move", s: hit.s, m: hit.m, start: p, orig: hit.s.pts.map(q => q.slice()), own: magnetPts(hit.s).concat([centre(hit.s)]),
    targets: snapTargets(shapes, cfg.size, cfg.sym, null, hit.s), pushed: false } : { kind: "pan", last: canvasPx(e) };
  renderCtx(); draw();
}
cv.addEventListener("pointermove", e => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, canvasPx(e));
  if (tapG && !tapG.moved) { const s0 = tapG.start.get(e.pointerId); if (s0 && dist(s0, ptrs.get(e.pointerId)) > 12 * dpr()) tapG.moved = true; }
  if (pinch) { if (ptrs.size >= 2) movePinch(); return; }
  if (!drag) { hoverAt(e); return; }
  const p = toDesign(e), s = drag.s;
  if (drag.kind === "pan") {
    const c = canvasPx(e);
    vc = [vc[0] - (c[0] - drag.last[0]) / K, vc[1] - (c[1] - drag.last[1]) / K]; drag.last = c;
    layout(); draw(); return;
  }
  if (drag.kind === "move") {
    if (!drag.pushed) { snapshot(); drag.pushed = true; }
    const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1], [a, b, c, d] = drag.m;
    let dl = [a * dx + b * dy, c * dx + d * dy];   // inverse of an orthogonal matrix is its transpose
    snapMark = null;
    if (!e.altKey && (ui.pointSnap || cfg.snap)) {
      const r = snapDelta(drag.own, dl, { tol: 10 * dpr() / K, grid: cfg.snap, targets: ui.pointSnap ? drag.targets : [] });
      dl = r.d;
      if (r.ring || r.guides.length) {   // the source shape snapped; show it on the copy under the finger
        const t = xf(drag.m, 0, 0, cfg.size), w = ([x, y]) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
        snapMark = { p: w(r.ring || r.guides[0][1]), ring: !!r.ring, guides: r.guides.map(g => g.map(w)) };
      }
    }
    s.pts = drag.orig.map(q => [q[0] + dl[0], q[1] + dl[1]]);
  } else if (drag.kind === "handle") dragHandle(drag, p, e);
  else if (drag.kind === "create") {
    if (s.type === "circle") { let r = dist(p, s.pts[0]); if (cfg.snap) r = Math.round(r / cfg.snap) * cfg.snap; s.r = r; }
    if (s.type === "leaf") { const q = snapAt(p, { ev: e, skip: { s, i: 1 }, from: s.pts[0], angle: angleOn(e, "line") }); s.pts[1] = q; s.w = dist(q, s.pts[0]) * 0.45; }
    if (s.type === "stroke") { const l = s.pts[s.pts.length - 1]; if (dist(p, l) > Math.min(1.5, 3 * dpr() / K)) s.pts.push(p); }
    if (s.type === "rect" || s.type === "ellipse") {   // corner to corner; 1:1 (or Shift) keeps it square
      const a = drag.start, q = snapAt(p, { ev: e, skip: { s, i: 0 } });
      let dx = q[0] - a[0], dy = q[1] - a[1];
      if (ui.square !== e.shiftKey) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = (dx < 0 ? -m : m); dy = (dy < 0 ? -m : m); }
      const b = [a[0] + dx, a[1] + dy], c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      s.pts = s.type === "rect" ? [a.slice(), [b[0], a[1]], b, [a[0], b[1]]] : [c, [b[0], c[1]], [c[0], b[1]]];
    }
    if (s.type === "star") s.pts[1] = snapAt(p, { ev: e, skip: { s, i: 1 }, from: s.pts[0], angle: angleOn(e, "line") });
  } else if (drag.kind === "place") {
    const A = draft.pts, n = A.length;
    A[n - 1] = snapAt(p, { from: n > 1 ? A[n - 2] : null, angle: angleOn(e, draft.kind), ev: e, extra: A.slice(0, -1) });
  } else if (drag.kind === "bezPt") {   // dragging out from a new curve point pulls out its handles
    const P = draft.pts, n = P.length, a = P[n - 2];
    if (dist(canvasPx(e), drag.start) > 4 * dpr()) {
      const q = e.shiftKey ? angleRound(a, p) : p;
      P[n - 1] = q.slice(); P[n - 3] = [2 * a[0] - q[0], 2 * a[1] - q[1]];
    }
  }
  draw();
});
function dragHandle(d, p, e) {
  if (!d.pushed) { snapshot(); d.pushed = true; }
  const s = d.s, P = s.pts, i = d.hi;
  if (s.type === "circle") {
    if (i === 1) { let r = dist(p, P[0]); if (cfg.snap) r = Math.max(cfg.snap, Math.round(r / cfg.snap) * cfg.snap); s.r = Math.max(0.5, r); }
    else P[0] = snapAt(p, { ev: e, skip: { s, i: 0 } });
    return;
  }
  if ((s.type === "ellipse" || s.type === "star") && i === 0) {   // the centre moves the whole shape
    const q = snapAt(p, { ev: e, skip: { s, i } }), dx = q[0] - P[0][0], dy = q[1] - P[0][1];
    P.forEach(r => { r[0] += dx; r[1] += dy; }); return;
  }
  if (s.type === "star") { P[1] = snapAt(p, { ev: e, skip: { s, i }, from: P[0], angle: angleOn(e, "line") }); return; }
  if (s.type === "ellipse") {   // an axis end; the other axis turns with it and keeps its length
    const c = P[0], q = snapAt(p, { ev: e, skip: { s, i } }), u = [q[0] - c[0], q[1] - c[1]], lu = Math.hypot(...u) || 1;
    const sg = (P[1][0] - c[0]) * (P[2][1] - c[1]) - (P[1][1] - c[1]) * (P[2][0] - c[0]) < 0 ? -1 : 1, o = 3 - i, lo = dist(P[o], c);
    const perp = i === 1 ? [-u[1], u[0]] : [u[1], -u[0]];
    P[i] = q; P[o] = [c[0] + perp[0] / lu * lo * sg, c[1] + perp[1] / lu * lo * sg]; return;
  }
  if (s.type === "rect") {   // a corner; the opposite corner stays and the shape stays a rectangle
    const q = snapAt(p, { ev: e, skip: { s, i } }), o = (i + 2) % 4, unit = (a, b, f) => { const L = dist(a, b); return L > 1e-9 ? [(b[0] - a[0]) / L, (b[1] - a[1]) / L] : f; };
    const e1 = unit(P[0], P[1], [1, 0]), e2 = unit(P[0], P[3], [0, 1]), dq = [q[0] - P[o][0], q[1] - P[o][1]];
    const ka = dq[0] * e1[0] + dq[1] * e1[1], kb = dq[0] * e2[0] + dq[1] * e2[1], O = P[o];
    const A = [O[0] + ka * e1[0], O[1] + ka * e1[1]], B = [O[0] + kb * e2[0], O[1] + kb * e2[1]];
    const alongE1 = n => Math.abs(o - n) === 1 && Math.min(o, n) % 2 === 0;   // edges 0–1 and 2–3 run along e1
    P[i] = [A[0] + B[0] - O[0], A[1] + B[1] - O[1]];
    for (const n of [(i + 1) % 4, (i + 3) % 4]) P[n] = alongE1(n) ? A : B.slice();
    P[(i + 1) % 4] = P[(i + 1) % 4].slice(); return;
  }
  if (s.type === "bez") {
    if (i % 3 === 1) {   // a point carries its handles along
      const q = snapAt(p, { ev: e, skip: { s, i } }), dx = q[0] - P[i][0], dy = q[1] - P[i][1];
      for (const j of [i - 1, i, i + 1]) { P[j][0] += dx; P[j][1] += dy; }
    } else {   // a handle; on a smooth point the opposite one turns with it (Alt breaks them apart)
      const a = anchorOf(s, i), o = 2 * a - i, q = e.shiftKey ? angleRound(P[a], p) : p;
      P[i] = q.slice();
      if (d.linked && !e.altKey) { const L = dist(P[o], P[a]), u = dist(q, P[a]) || 1; P[o] = [P[a][0] - (q[0] - P[a][0]) / u * L, P[a][1] - (q[1] - P[a][1]) / u * L]; }
    }
    return;
  }
  const n = P.length, from = s.type === "leaf" ? P[1 - i] : (s.type === "poly" || s.closed) ? P[(i - 1 + n) % n] : P[i ? i - 1 : 1];
  P[i] = snapAt(p, { ev: e, skip: { s, i }, from, angle: s.type !== "leaf" && angleOn(e, "line") });
}
function hoverAt(e) {
  if (e.pointerType === "touch") return;
  const p = toDesign(e);
  if (spaceDown) { cv.style.cursor = "grab"; return; }
  if (tool === "select") {
    const s = shapes.find(q => q.id === sel), onHandle = s && handleAt(s, p, tolMM() * 1.2) >= 0;
    const hit = onHandle ? null : hitTest(p, tolMM()), h = hit && hit.s.id !== sel ? hit : null;
    cv.style.cursor = onHandle ? "pointer" : hit ? "move" : zoom > 1 ? "grab" : "default";
    if ((h && h.s) !== (hoverHit && hoverHit.s) || (h && h.m !== hoverHit.m)) { hoverHit = h; draw(); }
    return;
  }
  cv.style.cursor = "crosshair";
  if (draft) { const A = draftAnchors(); draft.hover = snapAt(p, { from: A[A.length - 1], angle: angleOn(e, draft.kind), ev: e, extra: A }); }
  else snapAt(p, { ev: e });   // show where a new shape would snap
  draw();
}
function endDrag(e) {
  ptrs.delete(e.pointerId);
  if (!ptrs.size && tapG) {
    const g = tapG; tapG = null;
    if (!g.moved && performance.now() - g.t0 < 350) {
      if (pinch && pinch.shape) { Object.assign(pinch.shape, pinch.orig); if (pinch.snapped) undoStack.pop(); }   // nothing was transformed
      pinch = null;
      g.n >= 3 ? redo() : undo(); return;
    }
  }
  if (pinch) {
    if (!ptrs.size) { const sh = pinch.shape; pinch = null; if (sh) changed(true); }
    return;
  }
  if (!drag) return;
  const d = drag; drag = null; snapMark = null;
  if (d.kind === "pan") { cv.style.cursor = ""; return; }
  if (d.kind === "place") {
    if (d.first && dist(draft.pts[0], draft.pts[1]) < tolMM() * 0.5) draft.pts.pop();   // a tap, not a drag
    renderCtx(); draw(); return;
  }
  if (d.kind === "bezPt") { renderCtx(); draw(); return; }
  if (d.kind === "create") {
    const s = d.s;
    const tiny = (s.type === "circle" && s.r < 1) || (s.type === "leaf" && s.w < 0.5) || (s.type === "stroke" && s.pts.length < 2)
      || ((s.type === "rect" || s.type === "ellipse") && Math.min(dist(s.pts[0], s.pts[1]), dist(s.pts[s.type === "rect" ? 3 : 0], s.pts[2])) < 0.5)
      || (s.type === "star" && dist(s.pts[0], s.pts[1]) < 1);
    if (tiny) { shapes.pop(); undoStack.pop(); sel = null; draw(); renderCtx(); syncHistory(); return; }
    if (s.type === "stroke") s.pts = simplify(s.pts, ui.smoothing);
    changed(true); return;
  }
  if (d.pushed) changed(false); else draw();
}
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);
cv.addEventListener("pointerleave", () => { if (drag) return; hoverHit = snapMark = null; if (draft) draft.hover = null; draw(); });
cv.addEventListener("wheel", e => {
  const c = canvasPx(e), dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
  if (e.shiftKey && !e.ctrlKey) { e.preventDefault(); vc = [vc[0] + (e.deltaX || dy) / K, vc[1]]; layout(); draw(); return; }
  if (zoom <= 1 && dy > 0 && !e.ctrlKey) return;   // let the page scroll
  e.preventDefault();
  viewTo(zoom * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), [(c[0] - VX) / K, (c[1] - VY) / K], c);
}, { passive: false });

// ---- tools & the bar under the plate
function setTool(t) {
  if (draft && t !== draft.kind) finishDraft(false);
  if (t !== tool && t !== "select") { sel = null; selPt = -1; }   // show the new tool's options, not the last shape's
  tool = t; ui.tool = t; saveUI();
  hoverHit = snapMark = null;
  $$("[data-tool]").forEach(b => b.setAttribute("aria-pressed", b.dataset.tool === t));
  cv.style.cursor = t === "select" ? "default" : "crosshair";
  renderCtx(); draw();
}
$$("[data-tool]").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
$("#modeBtn").addEventListener("click", () => { cfg.newCut = !cfg.newCut; syncMode(); persist(); });
function syncMode() { $("#modeBtn").setAttribute("aria-pressed", cfg.newCut); }
$("#undoBtn").addEventListener("click", undo);
$("#redoBtn").addEventListener("click", redo);

const HINTS = {
  select: "Tap a shape (or any mirrored copy) to select it, drag to move it, drag its dots to reshape it. Hold it with one finger and add a second to turn and resize it. Pinch empty space to zoom; tap two fingers to undo, three to redo.",
  poly: "Tap to place corners, dragging before you let go to fine-tune. Tap the first corner to close the shape.",
  bez: "Tap for a sharp point, drag for a smooth one. Tap the first point to close it into a filled shape, or the last point again to end it as a line.",
  line: "Tap to place points, or drag out a single line. Tap the first point to close a loop, the last one again to finish.",
  stroke: "Draw freehand. Smoothing takes the wobble out when you lift.",
  circle: "Drag from the centre outwards.",
  rect: "Drag from corner to corner. Turn on 1:1 (or hold Shift) for a square.",
  ellipse: "Drag from corner to corner of the box around it. Turn on 1:1 (or hold Shift) for a circle.",
  star: "Drag from the centre to a corner. Set the number of sides, and lower Inner for a star.",
  leaf: "Drag from the base of a petal to its tip.",
};
const ICON = {
  rotL: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  rotR: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  shrink: '<path d="M5 12h14"/>',
  grow: '<path d="M12 5v14M5 12h14"/>',
  flipH: '<path d="M12 3v18"/><path d="M9 7L3 17h6z"/><path d="M15 7l6 10h-6z"/>',
  flipV: '<path d="M3 12h18"/><path d="M7 9L17 3v6z"/><path d="M7 15l10 6v-6z"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  front: '<rect x="9" y="9" width="11" height="11" rx="1" fill="currentColor"/><path d="M4 15V4h11"/>',
  back: '<rect x="4" y="4" width="11" height="11" rx="1" fill="currentColor"/><path d="M20 9v11H9"/>',
  del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};
const ico = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const mini = (id, html, title, o = {}) => `<button class="mini${o.cls ? " " + o.cls : ""}${o.icon ? " ico" : ""}" id="${id}" title="${title}"${o.icon ? ` aria-label="${title}"` : ""}${o.pressed != null ? ` aria-pressed="${!!o.pressed}"` : ""}${o.disabled ? " disabled" : ""}>${html}</button>`;
const slider = (id, text, min, max, step, v, out) => `<div class="grp"><label for="${id}">${text}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"><output id="${id}o">${out}</output></div>`;
const apply = fn => { snapshot(); fn(); changed(true); };
const shapeName = s => ({ poly: "Shape", leaf: "Petal", circle: "Circle", stroke: s.straight ? "Line" : "Freehand line", bez: s.closed ? "Curved shape" : "Curve",
  rect: "Rectangle", ellipse: "Ellipse", star: s.inner < 1 ? "Star" : "Polygon" })[s.type];
const CLOSED = new Set(["poly", "circle", "leaf", "rect", "ellipse", "star"]);
const isClosed = s => CLOSED.has(s.type) || (s.type === "bez" && s.closed);
const fillOutline = (pre, outline) => `<div class="grp">${mini(pre + "-fl", "Fill", "Fill the inside", { pressed: !outline })}${mini(pre + "-ol", "Outline", "Draw just the outline, at the line width", { pressed: !!outline })}</div>`;

function renderCtx() {
  const el = $("#ctx"), s = shapes.find(q => q.id === sel);
  if (draft) return renderDraftCtx(el);
  if (!s) return renderToolCtx(el);
  const bez = s.type === "bez", pt = pointOps(s) && selPt >= 0 && selPt < s.pts.length;
  const simp = (s.type === "stroke" && !s.straight) || (s.type === "poly" && s.pts.length > 4);
  el.innerHTML = [
    `<div class="grp"><b>${shapeName(s)}</b></div>`,
    `<div class="grp">${mini("c-add", "Raise", "Raise it above the background", { pressed: !s.cut })}${mini("c-cut", "Cut", "Cut it into the relief", { pressed: !!s.cut })}</div>`,
    `<div class="grp"><label for="c-lv">Height</label><select id="c-lv" style="width:auto">${[25, 50, 75, 100].map(v => `<option value="${v}" ${v === (s.level || 100) ? "selected" : ""}>${v}%</option>`).join("")}</select></div>`,
    isClosed(s) ? fillOutline("c", s.outline) : "",
    isLine(s) ? slider("c-w", s.outline ? "Line width" : "Width", 0.5, 20, 0.5, lineWidth(s), `${f1(lineWidth(s))} mm`) : "",
    s.type === "leaf" ? slider("c-pw", "Petal width", 0.5, 60, 0.5, s.w, `${f1(s.w)} mm`) : "",
    s.type === "rect" ? slider("c-cr", "Corners", 0, 40, 0.5, s.r || 0, `${f1(s.r || 0)} mm`) : "",
    s.type === "star" ? slider("c-n", "Sides", 3, 24, 1, s.n, s.n) + slider("c-in", "Inner", 0.15, 1, 0.05, s.inner, `${Math.round(s.inner * 100)}%`) : "",
    s.type === "poly" ? `<div class="grp">${mini("c-sm", "Smooth curves", "Round the corners into a smooth outline", { pressed: !!s.smooth })}</div>` : "",
    s.type === "stroke" && s.straight ? `<div class="grp">${mini("c-loop", "Closed loop", "Join the last point back to the first", { pressed: !!s.closed })}</div>` : "",
    bez ? `<div class="grp">${mini("c-fill", "Filled", "Fill the inside, or leave it as a line", { pressed: !!s.closed })}</div>` : "",
    simp ? slider("c-simp", "Simplify", 0, 3, 0.05, 0, `${s.pts.length} pts`) : "",
    s.type === "poly" || s.type === "stroke" ? `<div class="grp">${mini("c-bez", "Edit as curve", "Turn it into a curve with handles you can drag")}</div>` : "",
    pt ? `<div class="grp"><label>Point</label>${bez ? mini("c-psm", "Smooth", "Give this point curve handles") + mini("c-pco", "Corner", "Make this a sharp point") : ""}${mini("c-padd", "Add", "Add a point after this one")}${mini("c-pdel", "Delete", "Delete this point", { disabled: anchorCount(s) <= minAnchors(s) })}</div>` : "",
    `<div class="grp">${mini("c-rl", ico("rotL"), "Rotate left 15°", { icon: 1 })}${mini("c-rr", ico("rotR"), "Rotate right 15°", { icon: 1 })}${mini("c-sd", ico("shrink"), "Shrink 10%", { icon: 1 })}${mini("c-su", ico("grow"), "Grow 10%", { icon: 1 })}</div>`,
    `<div class="grp"><label>Flip</label>${mini("c-fh", ico("flipH"), "Flip left–right (Shift+H)", { icon: 1 })}${mini("c-fv", ico("flipV"), "Flip top–bottom (Shift+V)", { icon: 1 })}</div>`,
    `<div class="grp"><label>Mirror copy</label>${mini("c-mh", ico("flipH") + "Y axis", "Add a copy mirrored across the tile's vertical centre line")}${mini("c-mv", ico("flipV") + "X axis", "Add a copy mirrored across the tile's horizontal centre line")}</div>`,
    `<div class="grp">${mini("c-dup", ico("dup"), "Duplicate (Ctrl+D)", { icon: 1 })}${mini("c-up", ico("front"), "Bring to front", { icon: 1 })}${mini("c-dn", ico("back"), "Send to back", { icon: 1 })}${mini("c-del", ico("del"), "Delete (Del)", { icon: 1, cls: "danger" })}</div>`,
  ].join("");
  const on = (id, fn) => { const b = $("#" + id); if (b) b.onclick = () => apply(fn); };
  on("c-add", () => s.cut = false);
  on("c-cut", () => s.cut = true);
  $("#c-lv").onchange = () => apply(() => s.level = +$("#c-lv").value);
  live("c-w", v => { if (s.outline) s.lw = v; else s.w = v; $("#c-wo").textContent = `${f1(v)} mm`; });
  live("c-pw", v => { s.w = v; $("#c-pwo").textContent = `${f1(v)} mm`; });
  live("c-cr", v => { s.r = v; $("#c-cro").textContent = `${f1(v)} mm`; });
  live("c-n", v => { s.n = v; $("#c-no").textContent = v; });
  live("c-in", v => { s.inner = v; $("#c-ino").textContent = `${Math.round(v * 100)}%`; });
  on("c-fl", () => delete s.outline);
  on("c-ol", () => { s.outline = true; s.lw = s.lw || cfg.strokeW; });
  on("c-sm", () => s.smooth = !s.smooth);
  on("c-loop", () => s.closed = !s.closed);
  on("c-fill", () => { s.closed = !s.closed; if (!s.closed) delete s.outline; });
  if (simp) {
    const raw = s.pts.map(p => p.slice());
    live("c-simp", t => {
      const r = t ? simplify(raw, t) : raw;
      s.pts = (s.type === "poly" && r.length < 3 ? raw : r).map(p => p.slice());
      $("#c-simpo").textContent = `${s.pts.length} pts`;
    });
  }
  on("c-bez", () => { toBez(s, cfg.strokeW); selPt = -1; });
  on("c-psm", () => smoothPoint(s, selPt));
  on("c-pco", () => cornerPoint(s, selPt));
  on("c-padd", () => selPt = addPoint(s, selPt));
  on("c-pdel", () => selPt = deletePoint(s, selPt));
  on("c-rl", () => transformShape(s, -15, 1)); on("c-rr", () => transformShape(s, 15, 1));
  on("c-sd", () => transformShape(s, 0, 0.9)); on("c-su", () => transformShape(s, 0, 1.1));
  on("c-fh", () => flipShape(s, "h")); on("c-fv", () => flipShape(s, "v"));
  on("c-mh", () => mirrorCopy(s, "h")); on("c-mv", () => mirrorCopy(s, "v"));
  on("c-dup", () => addCopy(s, 6));
  on("c-up", () => { shapes = shapes.filter(q => q !== s).concat(s); });
  on("c-dn", () => { shapes = [s].concat(shapes.filter(q => q !== s)); });
  on("c-del", () => { shapes = shapes.filter(q => q !== s); sel = null; });
}
// a slider that edits the selected shape live, with one undo step per drag
function live(id, fn) {
  const el = $("#" + id); if (!el) return;
  let pushed = false;
  el.oninput = () => { if (!pushed) { snapshot(); pushed = true; } fn(+el.value); draw(); };
  el.onchange = () => { pushed = false; changed(false); };
}
function addCopy(s, off) {
  const c = clone(s); c.id = nextId++;
  c.pts.forEach(p => { p[0] += off; p[1] += off; });
  shapes.push(c); sel = c.id; selPt = -1;
  return c;
}
function mirrorCopy(s, dir) {
  const c = mirrored(s, dir, cfg.size); c.id = nextId++;
  shapes.push(c); sel = c.id; selPt = -1;
  if (cfg.sym === "mirror" || cfg.sym === "d4") toast("This symmetry already mirrors every shape, so the copy sits on an existing one");
}
function renderToolCtx(el) {
  const t = tool, parts = [];
  const closedTool = CLOSED.has(t) || t === "bez";
  if (CLOSED.has(t)) parts.push(fillOutline("t", ui.outline));
  if (t === "stroke" || t === "line" || t === "bez" || (closedTool && ui.outline)) parts.push(slider("t-w", ui.outline && t !== "line" && t !== "stroke" ? "Line width" : "Width", 1, 15, 0.5, cfg.strokeW, `${cfg.strokeW} mm`));
  if (t === "rect") parts.push(slider("t-rr", "Corners", 0, 40, 0.5, ui.rectR, `${f1(ui.rectR)} mm`));
  if (t === "star") parts.push(slider("t-n", "Sides", 3, 24, 1, ui.sides, ui.sides), slider("t-in", "Inner", 0.15, 1, 0.05, ui.inner, `${Math.round(ui.inner * 100)}%`));
  if (t === "rect" || t === "ellipse") parts.push(`<div class="grp">${mini("t-sq", "1:1", "Keep it square or round (Shift switches it while you drag)", { pressed: ui.square })}</div>`);
  if (t === "stroke") parts.push(slider("t-sm", "Smoothing", 0, 2, 0.05, ui.smoothing, `${ui.smoothing.toFixed(2)} mm`));
  if (t !== "select") parts.push(`<div class="grp"><label>Snap</label>${mini("t-pt", "Points", "Snap to the corners, ends and centres of shapes and the tile. Hold Alt to place freely.", { pressed: ui.pointSnap })}${t === "poly" || t === "line" || t === "leaf" || t === "star" ? mini("t-ang", "15° angles", "Pull lines onto 15° steps. Shift switches it for one point.", { pressed: ui.angleSnap }) : ""}</div>`);
  parts.push(`<span class="hint">${HINTS[t]}</span>`);
  el.innerHTML = parts.join("");
  if ($("#t-w")) $("#t-w").oninput = () => { cfg.strokeW = +$("#t-w").value; $("#t-wo").textContent = `${cfg.strokeW} mm`; syncPanel(); persist(); };
  if ($("#t-sm")) $("#t-sm").oninput = () => { ui.smoothing = +$("#t-sm").value; $("#t-smo").textContent = `${ui.smoothing.toFixed(2)} mm`; saveUI(); };
  const pref = (id, k, fmtv) => { const el = $("#" + id); if (el) el.oninput = () => { ui[k] = +el.value; $("#" + id + "o").textContent = fmtv(ui[k]); saveUI(); }; };
  pref("t-rr", "rectR", v => `${f1(v)} mm`); pref("t-n", "sides", v => v); pref("t-in", "inner", v => `${Math.round(v * 100)}%`);
  if ($("#t-fl")) $("#t-fl").onclick = () => { ui.outline = false; saveUI(); renderCtx(); };
  if ($("#t-ol")) $("#t-ol").onclick = () => { ui.outline = true; saveUI(); renderCtx(); };
  if ($("#t-sq")) $("#t-sq").onclick = () => { ui.square = !ui.square; saveUI(); renderCtx(); };
  if ($("#t-pt")) $("#t-pt").onclick = () => { ui.pointSnap = !ui.pointSnap; saveUI(); renderCtx(); };
  if ($("#t-ang")) $("#t-ang").onclick = () => { ui.angleSnap = !ui.angleSnap; saveUI(); renderCtx(); };
}
function renderDraftCtx(el) {
  const k = draft.kind, n = draftAnchors().length, unit = k === "poly" ? "corner" : "point";
  const ends = k === "poly" ? mini("d-fin", "Finish shape", "Close the shape (Enter)", { cls: "primary", disabled: n < 3 })
    : mini("d-fin", "Finish line", "End it here (Enter)", { cls: "primary", disabled: n < 2 })
      + (k === "bez" ? mini("d-close", "Close &amp; fill", "Join back to the first point and fill it", { disabled: n < 2 })
        : mini("d-close", "Close loop", "Join back to the first point", { disabled: n < 3 }));
  el.innerHTML = `<span class="hint">${n} ${unit}${n === 1 ? "" : "s"} placed</span>${ends}
    ${mini("d-back", "Undo point", "Remove the last point (Backspace)", { disabled: !n })}${mini("d-cancel", "Cancel", "Throw it away (Esc)")}`;
  $("#d-fin").onclick = () => finishDraft(k === "poly");
  if ($("#d-close")) $("#d-close").onclick = () => finishDraft(true);
  $("#d-back").onclick = popDraft;
  $("#d-cancel").onclick = cancelDraft;
}

// ---- keyboard
const KEYS = { v: "select", p: "poly", b: "bez", l: "line", d: "stroke", c: "circle", e: "leaf", r: "rect", o: "ellipse", s: "star" };
let clip = null, nudgeAt = 0;
document.addEventListener("keydown", e => {
  const t = e.target, tag = t.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && !/^(range|checkbox|radio|button)$/.test(t.type))) return;
  if (tag === "INPUT" && t.type === "range" && /^(Arrow|Home|End|Page)/.test(e.key)) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), s = shapes.find(q => q.id === sel);
  if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === "y") { e.preventDefault(); redo(); return; }
  if (view !== "edit") return;
  if (mod) {
    if (k === "d" && s) { e.preventDefault(); apply(() => addCopy(s, 6)); }
    else if (k === "c" && s && !getSelection().toString()) { clip = clone(s); toast("Copied"); }
    else if (k === "v" && clip) { e.preventDefault(); apply(() => { clip = addCopy(clip, 6); clip = clone(clip); }); }
    return;
  }
  if (e.key === " ") { if (tag !== "BUTTON") { e.preventDefault(); spaceDown = true; if (!drag) cv.style.cursor = "grab"; } return; }
  if (e.key === "Escape") { if (drag) abortDrag(); else if (draft) cancelDraft(); else { sel = null; selPt = -1; renderCtx(); draw(); } return; }
  if (e.key === "Enter" && draft) { e.preventDefault(); finishDraft(draft.kind === "poly"); return; }
  if (e.key === "Delete" || e.key === "Backspace") {
    if (draft) { e.preventDefault(); popDraft(); }
    else if (s) { e.preventDefault(); apply(() => { shapes = shapes.filter(q => q !== s); sel = null; }); }
    return;
  }
  if (e.key.startsWith("Arrow") && s) {
    e.preventDefault();
    const st = (cfg.snap || 1) * (e.shiftKey ? 10 : 1), dx = { ArrowLeft: -st, ArrowRight: st }[e.key] || 0, dy = { ArrowUp: -st, ArrowDown: st }[e.key] || 0;
    if (performance.now() - nudgeAt > 800) snapshot();   // a run of nudges is one undo step
    nudgeAt = performance.now();
    s.pts.forEach(p => { p[0] += dx; p[1] += dy; }); changed(false);
    return;
  }
  if (e.shiftKey && s && (k === "h" || k === "v")) { apply(() => flipShape(s, k)); return; }
  if (k === "0") return fitView();
  if (k === "=" || k === "+") return zoomBy(1.5);
  if (k === "-") return zoomBy(1 / 1.5);
  if (KEYS[k] && !e.shiftKey && !e.altKey) setTool(KEYS[k]);
});
document.addEventListener("keyup", e => { if (e.key === " ") { spaceDown = false; if (!drag) cv.style.cursor = ""; } });

// ---- settings panel
const fmt = { strokeW: v => `${v} mm`, depth: v => `${v} mm`, draft: v => v ? `${v}°` : "straight", floor: v => `${v} mm`, wall: v => `${v} mm`, height: v => `${v} mm`, clear: v => `${v} mm`, innerRadius: v => v ? `${v} mm` : "square" };
const KIND_HINT = {
  kit: "A loose pattern plate inside four identical walls with mitered corners. Push the walls on from outside and slide a printed C clip down over the two flaps at each corner; pull the clips up to release the tile.",
  one: "Plate and walls printed as a single piece.",
  plate: "Just the pattern plate. Use it as a stamp, or set it inside your own frame.",
};
function syncPanel() {
  $$("[data-k]").forEach(el => {
    const k = el.dataset.k;
    if (el.type === "checkbox") el.checked = !!cfg[k]; else el.value = cfg[k];
    const o = $("#o-" + k); if (o) o.textContent = fmt[k](cfg[k]);
  });
  $("#in-size").value = cfg.size;
  $$("#symSeg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.sym === cfg.sym));
  $$("#modeSeg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === cfg.mode));
  $$("#kindSeg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.kind === cfg.kind));
  $$(".wallOnly").forEach(el => el.hidden = cfg.kind === "plate");
  $$(".kitOnly").forEach(el => el.hidden = cfg.kind !== "kit");
  $("#kindHint").textContent = KIND_HINT[cfg.kind];
  $("#sizeTag").textContent = `${cfg.size} × ${cfg.size} mm tile`;
  syncMode(); spec();
}
function spec() {
  const S = cfg.size, plateH = cfg.floor + cfg.depth, lines = [];
  if (cfg.kind === "kit") {
    const w = wallInfo(geomOpts(true));
    const plateW = cfg.lock ? S + 2 * LOCK_TONGUE : S;
    lines.push(`Plate ${plateW} × ${plateW} × ${f1(plateH)} mm` + (cfg.lock ? `, ${LOCK_TONGUE} mm locking tongue all round` : ""), `Walls ×4 ${f1(w.L)} × ${f1(w.H)} × ${cfg.wall} mm, printed standing on their top edge, no supports`, `Mitered corners · flaps ${FLAP_LEN} mm long, ${FLAP_T} + ${FLAP_T} mm thick where they meet, flaring to ${FLAP_T + FLARE} + ${FLAP_T + FLARE} mm at the tips · cavity ${f1(w.I)} mm`, `Corner clips ×4, ${f1(w.H)} mm tall, printed standing up; snug at the bottom, ${cfg.clear} mm looser at the top`, `Needs a print bed of ${Math.ceil(Math.max(plateW, w.L + FLAP_LEN * Math.SQRT2))} mm or more`);
  } else if (cfg.kind === "one") {
    lines.push(`Mold ${f1(S + 2 * cfg.wall)} × ${f1(S + 2 * cfg.wall)} × ${f1(wallInfo(geomOpts(true)).H)} mm`);
  } else lines.push(`Plate ${S} × ${S} × ${f1(plateH)} mm`);
  if (cfg.kind !== "plate") {
    const T = Math.max(cfg.height, cfg.depth + 1);
    lines.push(`Tile ${S} × ${S} × ${f1(T)} mm, ${f1(T - cfg.depth)} mm where the pattern is ${cfg.mode === "mold" ? "not raised" : "engraved"}`);
  }
  const step = cfg.draft ? cfg.depth * Math.tan(cfg.draft * Math.PI / 180) : 0;
  if (cfg.kind !== "plate") {
    const cr = cornerRadius(geomOpts(true));
    const outside = cfg.kind === "kit" ? "45° miter with clip flaps outside" : `${f1(cr + cfg.wall)} mm outside`;
    lines.push(`Corners ${f1(cr)} mm inside, ${outside}` + (cr < cfg.innerRadius - 0.01 ? ` (capped at a quarter of the tile)` : ""));
  }
  lines.push(`Relief ${cfg.depth} mm${step ? `, sides taper ${f1(step)} mm` : ", straight sides"}`);
  $("#spec").innerHTML = lines.join("<br>");
  $("#mfNote").textContent = inViewer() ? "All parts, zipped. For Fusion 360 or your slicer" : "All parts, for Fusion 360 or your slicer";
  $("#stlNote").textContent = cfg.kind === "plate" ? "Zipped" : cfg.kind === "one" ? "Zipped" : "Plate, one wall and clip (print 4 of each), zipped";
  mixSpec();
}
// ---- cement mix: amounts for the batch and the scoop fills, from the cast volume
function mix() { return mixFor(geomOpts(true), cfg.tiles); }
function mixSpec() {
  if (cfg.kind === "plate") return;
  const m = mix(), ml = v => v < 1000 ? `${Math.round(v)} ml` : `${f1(v / 1000)} l`, g = v => v < 1000 ? `${Math.round(v)} g` : `${f1(v / 1000)} kg`;
  const n = m.fills, half = n % 1 ? "½" : "", whole = Math.floor(n), t = m.tiles === 1 ? "1 tile" : `${m.tiles} tiles`;
  const sc = `${whole || ""}${half} level scoop${n > 1 ? "s" : ""}`, times = n === 1 ? "once" : `${whole || ""}${half} times`;
  $("#in-tiles").value = cfg.tiles;
  $("#mixSteps").innerHTML = [
    `<b>Cement:</b> ${sc} with the small scoop (1 hole in the handle)`,
    `<b>Sand:</b> ${sc} with the big scoop (3 holes)`,
    `Stir the two together dry until the colour is even`,
    `<b>Water:</b> ${n === 0.5 ? "the small scoop filled about half way to its groove" : `the small scoop filled to its groove, ${times}${half ? " (for the half, fill it about half way to the groove)" : ""}`}. Pour a little at a time and stop when it is a thick paste`,
  ].map(s => `<li>${s}</li>`).join("");
  $("#mix").innerHTML = [
    `Without the scoops, for ${t}:`,
    `Cement ${ml(m.cement)} · ${g(m.cementG)}`,
    `Sand ${ml(m.sand)} · ${g(m.sandG)}`,
    `Water ${ml(m.water)}`,
    `Cast ${ml(m.wet)} a tile`,
  ].join("<br>");
}
$("#scoopGuide").innerHTML = scoopGuide;
$("#in-tiles").addEventListener("change", () => {
  cfg.tiles = Math.max(1, Math.min(200, Math.round(+$("#in-tiles").value) || 1)); persist(); mixSpec();
});
const f1 = v => +v.toFixed(1);
$$("[data-k]").forEach(el => el.addEventListener("input", () => {
  const k = el.dataset.k;
  cfg[k] = el.type === "checkbox" ? el.checked : +el.value;
  syncPanel(); persist(); draw(); dirty3D = true; if (view !== "edit") schedulePreview();
}));
$("#in-size").addEventListener("change", () => {
  const v = Math.max(50, Math.min(400, +$("#in-size").value || 200)), f = v / cfg.size;
  if (f === 1) return;
  snapshot();
  shapes.forEach(s => { s.pts = s.pts.map(p => [p[0] * f, p[1] * f]); if (s.r) s.r *= f; if (s.w) s.w *= f; if (s.lw) s.lw *= f; });
  cfg.size = v; zoom = 1; vc = null; syncPanel(); sizeCanvases(); changed(false);
});
$$("#symSeg button").forEach(b => b.addEventListener("click", () => { if (cfg.sym === b.dataset.sym) return; snapshot(); cfg.sym = b.dataset.sym; syncPanel(); changed(false); }));
const setOpt = (k, v) => { cfg[k] = v; syncPanel(); persist(); dirty3D = true; if (view !== "edit") schedulePreview(); };
$$("#modeSeg button").forEach(b => b.addEventListener("click", () => setOpt("mode", b.dataset.mode)));
$$("#kindSeg button").forEach(b => b.addEventListener("click", () => setOpt("kind", b.dataset.kind)));
// ---- templates: a gallery of pre-made designs, thumbnails drawn as they scroll into view
let tplFam = "All", tplTheme = "";
const tplObs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { paintThumb(e.target); tplObs.unobserve(e.target); } }), { root: $("#tplGrid") });
function paintThumb(c) {
  const t = TEMPLATES[+c.dataset.i], T = tok(), px = c.width = c.height = Math.round(c.clientWidth * dpr()) || 160, x = c.getContext("2d");
  x.fillStyle = T.field; x.fillRect(0, 0, px, px);
  paintShapes(x, px / 200, 0, 0, s => ({ color: s.cut ? T.field : mixHex(T.field, T.raised, (s.level || 100) / 100) }), OFFS, templateShapes(t), t.sym, 200);
}
function renderTemplates() {
  $("#tplFams").innerHTML = ["All", ...FAMILIES].map(f => `<button class="mini" data-fam="${f}" aria-pressed="${f === tplFam}">${f}</button>`).join("");
  $$("#tplFams button").forEach(b => b.onclick = () => { tplFam = b.dataset.fam; renderTemplates(); $("#tplGrid").scrollTop = 0; });
  $("#tplQuarter").setAttribute("aria-pressed", !!ui.tplQuarter);
  const list = TEMPLATES.map((t, i) => [t, i]).filter(([t]) => (tplFam === "All" || t.family === tplFam) && (!ui.tplQuarter || quarterable(t)));
  $("#tplCount").textContent = `${list.length} design${list.length === 1 ? "" : "s"}`;
  $("#tplGrid").innerHTML = list.map(([t, i]) => `<button class="tpl" data-i="${i}" title="${t.name} · ${t.family}${t.four ? " · spans 4 tiles" : ""}"><canvas data-i="${i}" aria-hidden="true"></canvas><span>${t.name}</span></button>`).join("");
  $$("#tplGrid canvas").forEach(c => tplObs.observe(c));
  $$("#tplGrid .tpl").forEach(b => b.onclick = () => loadTemplate(TEMPLATES[+b.dataset.i]));
}
// a quarter load puts a quarter of the design on the tile; four tiles turned about a corner make the whole
function loadTemplate(t) {
  const q = (!!ui.tplQuarter || !!t.four) && quarterable(t);   // four-tile designs always load as a quarter
  snapshot(); cfg.sym = q ? "none" : t.sym; cfg.turn = q; shapes = q ? buildQuarter(t, cfg.size) : buildTemplate(t, cfg.size); reid(); sel = null; selPt = -1;
  $("#tplDlg").close(); syncPanel(); changed(true);
  toast(q ? `A quarter of ${t.name} loaded. Turn four tiles about their shared corner to make the whole. Undo brings your design back.` : `${t.name} loaded. Undo brings your design back.`);
}
$("#tplQuarter").addEventListener("click", () => { ui.tplQuarter = !ui.tplQuarter; saveUI(); renderTemplates(); $("#tplGrid").scrollTop = 0; });
$("#tplBtn").addEventListener("click", () => {
  const theme = JSON.stringify(tok());
  if (theme !== tplTheme || !$("#tplGrid").children.length) { tplTheme = theme; renderTemplates(); }
  $("#tplDlg").showModal();
});
$("#tplClose").addEventListener("click", () => $("#tplDlg").close());
$("#tplDlg").addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
$("#resetBtn").addEventListener("click", () => {
  if (!confirm("Put the mold, tool and view settings back to their defaults? Your drawing stays as it is.")) return;
  cfg = { ...DEF, size: cfg.size, sym: cfg.sym, turn: cfg.turn };
  ui = { ...UI_DEF, panels: ui.panels };
  FORCE_INPUTS.forEach(id => { const el = $("#" + id); el.value = el.tagName === "SELECT" ? ([...el.options].find(o => o.defaultSelected) || el.options[0]).value : el.defaultValue; });
  profZ = null; saveUI(); syncPanel(); setTool(tool); changed(true);
  if (view === "force") showForces();
  toast("Settings are back to their defaults");
});
$("#clearBtn").addEventListener("click", () => { if (!shapes.length) return; snapshot(); shapes = []; sel = null; changed(true); toast("Cleared. Undo brings it back."); });

// ---- views
$$(".tabs button").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
function setView(v) {
  view = v; ui.view = v; saveUI();
  $$(".tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.view === v));
  $("#cv").hidden = v !== "edit"; $("#pv").hidden = v !== "prev"; $("#tv").hidden = v !== "3d";
  $("#tools").hidden = $("#ctx").hidden = $("#zoomBar").hidden = v !== "edit";
  $("#viewWrap").hidden = v === "prof" || v === "force"; $("#prof").hidden = v !== "prof"; $("#force").hidden = v !== "force";
  $("#ruler").hidden = v === "3d" || v === "prof" || v === "force";
  if (v === "edit") draw(); else schedulePreview(0);
}
let prevTimer = null;
function schedulePreview(ms = 150) {
  clearTimeout(prevTimer);
  prevTimer = setTimeout(() => { if (view === "prev") drawPreview(); if (view === "3d") show3D(); if (view === "prof") showProfiles(); if (view === "force") showForces(); }, ms);
}

// ---- wall profiles: true cross-sections cut from the solids in the worker
let profZ = null, profSeq = 0, profData = null, profTimer = null;
function profNote(o, z) {
  if (o.kind !== "kit") return "";
  const notes = [`The clip's channel is ${f1(o.clear * z / wallInfo(o).H * 100) / 100} mm looser than the flaps each side here.`];
  if (o.lock && z < o.B + o.clear) notes.push("This height is in the plate rebate.");
  return notes.join(" ");
}
async function showProfiles() {
  const o = geomOpts(true), noWalls = cfg.kind === "plate";
  $("#profMsg").hidden = !noWalls;
  $(".profGrid").hidden = $("#profZ").parentElement.hidden = noWalls;
  if (noWalls) { $("#profMsg").textContent = "Plate only has no walls. Choose Detachable or One piece to see the wall profiles."; return; }
  const H = wallInfo(o).H;
  if (profZ === null || profZ > H) profZ = +(H / 2).toFixed(1);
  const sl = $("#profZ"); sl.max = H.toFixed(1); sl.value = profZ;
  $("#profZo").textContent = `${profZ.toFixed(1)} mm`;
  $("#profNote").textContent = profNote(o, profZ);
  const seq = ++profSeq;
  let res;
  try { res = await runJob("sections", { z: profZ }); } catch (e) { toast("Couldn't cut the profiles: " + e.message); return; }
  if (seq !== profSeq) return;
  profData = { res, o, z: profZ };
  drawProfiles();
}
$("#profZ").addEventListener("input", () => {
  profZ = ui.profZ = +$("#profZ").value; saveUI();
  clearTimeout(profTimer); profTimer = setTimeout(showProfiles, 40);
});
function drawSection(cv, layers, { u0, v0, span }, map, hLine) {
  const T = tok(), px = Math.round(cv.clientWidth * dpr());
  if (!px) return;
  if (cv.width !== px) cv.width = cv.height = px;
  const x = cv.getContext("2d"), k = px / span, U = u => (u - u0) * k, V = v => px - (v - v0) * k;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.fillStyle = T.bg; x.fillRect(0, 0, px, px);
  x.lineWidth = dpr(); x.strokeStyle = T.ink;
  for (let g = Math.ceil(u0); g <= u0 + span; g++) { x.globalAlpha = g % 5 ? 0.06 : 0.18; x.beginPath(); x.moveTo(U(g), 0); x.lineTo(U(g), px); x.stroke(); }
  for (let g = Math.ceil(v0); g <= v0 + span; g++) { x.globalAlpha = g % 5 ? 0.06 : 0.18; x.beginPath(); x.moveTo(0, V(g)); x.lineTo(px, V(g)); x.stroke(); }
  x.globalAlpha = 1;
  for (const [polys, col] of layers) {
    x.beginPath();
    for (const p of polys) { p.forEach((q, i) => { const [u, v] = map(q); i ? x.lineTo(U(u), V(v)) : x.moveTo(U(u), V(v)); }); x.closePath(); }
    x.fillStyle = col; x.fill("evenodd");
    x.globalAlpha = 0.55; x.strokeStyle = T.ink; x.stroke(); x.globalAlpha = 1;
  }
  if (hLine != null) {
    x.strokeStyle = T.accent; x.setLineDash([5 * dpr(), 4 * dpr()]); x.lineWidth = 1.5 * dpr();
    x.beginPath(); x.moveTo(0, V(hLine)); x.lineTo(px, V(hLine)); x.stroke(); x.setLineDash([]);
  }
  x.fillStyle = T.muted; x.font = `${10 * dpr()}px "IBM Plex Mono", ui-monospace, monospace`;
  for (let g = Math.ceil(u0 / 5) * 5; g <= u0 + span; g += 5) x.fillText(String(g), U(g) + 2 * dpr(), px - 4 * dpr());
  for (let g = Math.ceil(v0 / 5) * 5; g <= v0 + span; g += 5) if (g) x.fillText(String(g), 3 * dpr(), V(g) - 3 * dpr());
}
function drawProfiles() {
  if (!profData || view !== "prof") return;
  const { res, o, z } = profData, T = tok(), W = o.W, c = o.clear, H = wallInfo(o).H;
  const wallA = T.accent, wallB = mixHex(T.accent, T.bg, 0.5), plate = T.field;
  // edge: tile coords, 0 = plate edge, outside to the left; points arrive as [z, y]
  drawSection($("#profSide"), [[res.side.plate, plate], [res.side.walls[0] || [], wallA]],
    { u0: -W - c - 2, v0: -1, span: Math.max(H + 2.5, W + c + 14) }, p => [p[1], p[0]], z);
  const r = cornerRadius(o), out = W + c + 2 + (o.kind === "kit" ? (FLAP_LEN + 2 * (FLAP_T + FLARE)) / Math.SQRT2 : 0);   // room for the flaps and clip
  drawSection($("#profPlan"), [[res.plan.plate, plate], [res.plan.walls[0] || [], wallA], [res.plan.walls[1] || [], wallB], [res.plan.clip || [], T.bg]],
    { u0: -out, v0: -out, span: out + r + 10 }, p => p, null);
}
window.addEventListener("resize", () => { drawProfiles(); if (view === "force") showForces(); });

// ---- forces: static plan model of the clipped frame under load (src/forces.js)
let forceTimer = null;
const FORCE_INPUTS = ["fCem", "fErr", "fWall", "fIn", "fAlong", "fAt", "fX", "fView", "fZ"];
FORCE_INPUTS.forEach(id => $("#" + id).addEventListener("input", () => {
  ui.inputs[id] = $("#" + id).value; saveUI();
  if (id === "fView" || id === "fX") { if (forceAnim) return drawForces(); }
  clearTimeout(forceTimer); forceTimer = setTimeout(showForces, 30);
}));
// the loads currently set in the panel
function forceLoad(o) {
  const err = +$("#fErr").value, wall = +$("#fWall").value;
  const push = wall >= 0 ? { wall, at: +$("#fAt").value, inward: +$("#fIn").value, along: +$("#fAlong").value } : null;
  // wet cement: hydrostatic push on one wall = ½ ρ g d² × length (2400 kg/m³, d = tile thickness)
  const depth = Math.max(o.T, o.D + 1) / 1000, still = 0.5 * 2400 * 9.81 * depth * depth * (o.S / 1000), cem = still * +$("#fCem").value;
  return { err, push, cem, load: { error: err, push, cement: cem } };
}
// Run: start all four walls loose and a little skewed inside the clips' play and let the load push
// them out until the clips catch, one solver step a frame
let forceAnim = null;
$("#fRun").addEventListener("click", () => {
  if (cfg.kind !== "kit") return;
  const o = geomOpts(true), { push, load } = forceLoad(o), m = frameModel(o, load), rnd = () => Math.random() * 2 - 1;
  cancelAnimationFrame(forceAnim?.id);
  if (!load.cement && !push) { forceAnim = null; $("#fStatus").textContent = "Nothing pushes the walls: add some cement or an extra push."; return; }
  let q = [0, 1, 2, 3].flatMap(() => [rnd() * 0.01, rnd() * 0.01, rnd() * 0.002 * Math.PI / 180]);
  let frame = 0, still = 0;
  forceAnim = { id: 0 };
  const tick = () => {
    const s = m.round(q, 0.0005); q = s.q; still = s.step < 1e-5 ? still + 1 : 0;
    const r = m.report(q), held = r.stops.filter(s => s.corner >= 0 && s.force > 0.5).length;
    lastForce = { o, r, X: +$("#fX").value, push };
    drawForces();
    frame++;
    $("#fStatus").textContent = held ? `${held} corner contacts carrying load · worst corner ${Math.max(...r.angles.map(a => Math.abs(a - 90))).toFixed(3)}° off square` : "Walls moving out…";
    if (still > 10 || frame > 900) { forceAnim = null; writeForceText(r, forceLoad(o)); $("#fStatus").textContent = `Settled after ${frame} steps`; return; }
    forceAnim.id = requestAnimationFrame(tick);
  };
  tick();
});
function showForces() {
  if (forceAnim) { cancelAnimationFrame(forceAnim.id); forceAnim = null; $("#fStatus").textContent = ""; }
  const o = geomOpts(true), cv = $("#forceCv"), out = $("#fOut");
  if (cfg.kind !== "kit") { out.textContent = "The force check is for the detachable mold. Choose Detachable under Mold."; cv.hidden = true; return; }
  cv.hidden = false;
  const X = +$("#fX").value, L = forceLoad(o), { err, push, cem } = L;
  $("#fErro").textContent = `${err.toFixed(2)} mm`; $("#fXo").textContent = `×${X}`;
  $("#fIno").textContent = `${push ? push.inward : 0} N`; $("#fAlongo").textContent = `${push ? push.along : 0} N`; $("#fAto").textContent = `${Math.round(+$("#fAt").value * 100)}%`;
  $("#fCemo").textContent = `×${$("#fCem").value} = ${cem.toFixed(1)} N a wall`;
  const r = frameForces(o, L.load);
  lastForce = { o, r, X, push };
  drawForces();
  // the real wall outline at the cut height comes from the worker (cached there, so this is quick)
  const H = wallInfo(o).H, z = Math.min(+$("#fZ").value, H);
  $("#fZ").max = H.toFixed(1); $("#fZo").textContent = `${z.toFixed(1)} mm`;
  const key = JSON.stringify([o, z]);
  if (key !== wallPlan.key) runJob("sections", { z }).then(res => {
    wallPlan = { key, polys: res.wallPlan, plate: res.plan.plate };
    if (view === "force") drawForces();
  }).catch(() => { });
  writeForceText(r, L);
}
function writeForceText(r, { cem }) {
  const out = $("#fOut");
  const dev = r.angles.map(a => a - 90), worst = Math.max(...dev.map(Math.abs));
  const plate = r.stops.filter(s => s.corner < 0 && s.force > 0.5);
  const byCorner = CORNERS.map((name, k) => `${name}: ${r.stops.filter(s => s.corner === k).map(s => `${s.label} ${s.force.toFixed(1)} N${s.gap > 0.005 ? ` (open ${s.gap.toFixed(2)} mm)` : ""}`).join(", ")}`);
  const clips = r.stops.filter(s => s.corner >= 0 && /clip/.test(s.label)).reduce((a, s) => Math.max(a, s.force), 0);
  out.innerHTML = [
    worst < 0.05 ? `<b>Corners hold square</b>` + (clips > 0.5 ? `: the clips take up to ${clips.toFixed(0)} N` + (cem > 0 ? ` against ${cem.toFixed(1)} N of cement a wall` : "") : "")
      : `<b>Out of square by ${worst.toFixed(2)}°</b>: the corners are giving under this load`,
    `Corner angles ${r.angles.map(a => a.toFixed(3) + "°").join(" · ")}`,
    `Out of square by ${worst.toFixed(3)}° at worst · diagonals differ by ${Math.abs(r.diagonals[0] - r.diagonals[1]).toFixed(3)} mm`,
    ...byCorner,
    plate.length ? `Plate edge takes ${plate.map(s => `${s.force.toFixed(1)} N from the ${WALLS[-1 - s.corner]} wall`).join(", ")}` : "Plate edge: no load, the walls clear it",
  ].join("<br>");
}
let lastForce = null, wallPlan = { key: null, polys: null, plate: null };
function drawForces() {
  if (!lastForce) return;
  const { o, r, X, push } = lastForce, cv = $("#forceCv"), T = tok(), px = Math.round(cv.clientWidth * dpr());
  if (!px) return;
  if (cv.width !== px) cv.width = cv.height = px;
  const x = cv.getContext("2d"), { L } = wallInfo(o), W = o.W, S = o.S, c = o.clear, ft = FLAP_LEN / Math.SQRT2;
  const shape = wallPlan.polys && wallPlan.polys.length ? wallPlan.polys : [[[-ft, -ft], [0, 0], [L, 0], [L + ft, -ft], [L - W, W], [W, W]]];
  const plate = wallPlan.plate && wallPlan.plate.length ? wallPlan.plate : [[[0, 0], [S, 0], [S, S], [0, S]]];
  const scaled = (j, p) => { const h = r.home(j, p), s = r.toWorld(j, p); return [h[0] + (s[0] - h[0]) * X, h[1] + (s[1] - h[1]) * X]; };
  x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = T.bg; x.fillRect(0, 0, px, px);

  // one view of the single simulation: the whole frame (zoom -1), the whole frame with its long sides
  // shortened so all four corners show at full scale (zoom 4), or a close-up of corner `zoom`
  function view(zoom, ox, oy, size) {
    const fl = (FLAP_LEN + 2 * (FLAP_T + FLARE)) / Math.SQRT2, far = S + W + c + 2 + fl, near = -W - c - 2 - fl, Z = W + c + cornerRadius(o) + 14 + fl;
    let u0, v0, span, warp = a => a;
    if (zoom < 0) { span = S + 2 * (W + 26); u0 = v0 = -(W + 26); }
    else if (zoom === 4) {
      // full scale within Z of each edge, the middle squeezed into a short break
      const mid = far - near - 2 * Z, sq = 0.16 * 2 * Z / mid;
      warp = a => a < near + Z ? a : a > far - Z ? a - mid + mid * sq : near + Z + (a - near - Z) * sq;
      u0 = v0 = near; span = 2 * Z + mid * sq;
    } else {
      span = W + c + cornerRadius(o) + 12 + fl;
      u0 = zoom === 1 || zoom === 2 ? far - span : near;
      v0 = zoom >= 2 ? far - span : near;
    }
    const k = size / span, P = ([a, b]) => [ox + (warp(a) - u0) * k, oy + size - (warp(b) - v0) * k], d = dpr();
    const fullScale = g => zoom !== 4 || g <= near + Z || g >= far - Z;
    x.save(); x.beginPath(); x.rect(ox, oy, size, size); x.clip();
    if (zoom >= 0) {   // mm grid, as in the profiles (only where the drawing is at full scale)
      x.lineWidth = d; x.strokeStyle = T.ink;
      const lo = zoom === 4 ? Math.ceil(near) : Math.ceil(u0), hi = zoom === 4 ? far : u0 + span, lov = zoom === 4 ? lo : Math.ceil(v0), hiv = zoom === 4 ? far : v0 + span;
      for (let g = lo; g <= hi; g++) if (fullScale(g)) { x.globalAlpha = g % 5 ? 0.06 : 0.18; const gx = P([g, 0])[0]; x.beginPath(); x.moveTo(gx, oy); x.lineTo(gx, oy + size); x.stroke(); }
      for (let g = lov; g <= hiv; g++) if (fullScale(g)) { x.globalAlpha = g % 5 ? 0.06 : 0.18; const gy = P([0, g])[1]; x.beginPath(); x.moveTo(ox, gy); x.lineTo(ox + size, gy); x.stroke(); }
      x.globalAlpha = 1;
    }
    const path = polys => {
      x.beginPath();
      for (const pts of polys) {
        pts.forEach((p, i) => {
          if (!i) return x.moveTo(...P(p));
          const a = pts[i - 1], n = zoom === 4 ? Math.ceil(Math.hypot(p[0] - a[0], p[1] - a[1]) / 4) : 1;   // bend long edges with the warp
          for (let s = 1; s <= n; s++) x.lineTo(...P([a[0] + (p[0] - a[0]) * s / n, a[1] + (p[1] - a[1]) * s / n]));
        });
        x.closePath();
      }
    };
    path(plate); x.fillStyle = T.field; x.fill("evenodd");
    // Screen position of a point of wall j where it settles. To scale, that is just the (exaggerated)
    // solved position. With the sides shortened, squeezing a slightly twisted wall would kink it, so
    // the wall is drawn straight instead: its two ends go exactly where the solver puts them and the
    // rest follows linearly along the drawn wall.
    const Pw = ([a, b]) => [ox + (a - u0) * k, oy + size - (b - v0) * k], wp = q => [warp(q[0]), warp(q[1])];
    const ends = [0, 1, 2, 3].map(j => [[0, W / 2], [L, W / 2]].map(e => { const h = r.home(j, e), s = r.toWorld(j, e); return { at: wp(h), move: [(s[0] - h[0]) * X, (s[1] - h[1]) * X] }; }));
    const place = (j, p) => {
      if (zoom !== 4) return P(scaled(j, p));
      const q = wp(r.home(j, p)), [A, B] = ends[j], ab = [B.at[0] - A.at[0], B.at[1] - A.at[1]];
      const f = Math.max(0, Math.min(1, ((q[0] - A.at[0]) * ab[0] + (q[1] - A.at[1]) * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1])));
      return Pw([q[0] + A.move[0] + (B.move[0] - A.move[0]) * f, q[1] + A.move[1] + (B.move[1] - A.move[1]) * f]);
    };
    const screenPath = polys => { x.beginPath(); for (const pts of polys) { pts.forEach((p, i) => i ? x.lineTo(...p) : x.moveTo(...p)); x.closePath(); } };
    for (let j = 0; j < 4; j++) {   // where each wall settles: the true cut outline
      screenPath(shape.map(pts => pts.map(p => place(j, p))));
      x.fillStyle = j % 2 ? mixHex(T.accent, T.bg, 0.45) : T.accent; x.fill("evenodd");
      x.strokeStyle = T.ink; x.globalAlpha = 0.5; x.lineWidth = d; x.stroke(); x.globalAlpha = 1;
    }
    x.setLineDash([3 * d, 3 * d]);   // where it sits by design
    for (let j = 0; j < 4; j++) { path(shape.map(pts => pts.map(p => r.home(j, p)))); x.strokeStyle = T.ink; x.globalAlpha = 0.45; x.stroke(); }
    x.globalAlpha = 1;
    if (zoom === 4) {   // break marks across the shortened middle of each side
      x.strokeStyle = T.bg; x.lineWidth = 3 * d;
      const m0 = (near + far) / 2;
      for (const [a, b, h] of [[m0, -W - c - 4, 1], [m0, far - 2, 1], [-W - c - 4, m0, 0], [far - 2, m0, 0]]) {
        const [cx, cy] = P([a, b]), L2 = (W + 6) * k;
        x.beginPath();
        if (h) { x.moveTo(cx - 4 * d, cy + L2 / 2); x.lineTo(cx + 4 * d, cy - L2 / 2); } else { x.moveTo(cx - L2 / 2, cy - 4 * d); x.lineTo(cx + L2 / 2, cy + 4 * d); }
        x.stroke();
      }
    }
    const fs = Math.max(9, Math.min(11, size / d / 30));
    x.font = `600 ${fs * d}px "IBM Plex Sans", system-ui, sans-serif`; x.textBaseline = "middle";
    const block = (cn, bx, by, right, below) => {   // a corner's angle and stop forces
      // the corner's own position says which corner it is, so the frame view keeps the lines short
      const title = zoom === 4 ? `${r.angles[cn].toFixed(3)}°` : `${CORNERS[cn]} · ${r.angles[cn].toFixed(3)}°`;
      const lines = [title, ...r.stops.filter(s => s.corner === cn).map(s => `${s.label} ${s.force.toFixed(zoom === 4 ? 0 : 1)} N${s.gap > 0.005 ? ` · open ${s.gap.toFixed(2)}` : ""}`)];
      const lh = (fs + 4) * d;
      x.textAlign = right ? "right" : "left";
      lines.forEach((l, i) => {
        x.fillStyle = i ? (/open/.test(l) ? T.accent : T.ink) : T.muted;
        x.fillText(l, bx, below ? by - (lines.length - 1 - i) * lh : by + i * lh);
      });
    };
    if (zoom === 4) {   // each corner's numbers just inside it, on the plate
      const inset = cornerRadius(o) + 2, lo = P([inset, inset]), hi = P([S - inset, S - inset]);   // inside each corner, at full scale
      block(0, lo[0], lo[1], false, true); block(1, hi[0], lo[1], true, true);
      block(2, hi[0], hi[1], true, false); block(3, lo[0], hi[1], false, false);
    } else if (zoom >= 0) {   // angle and stop forces, in the open part of the close-up
      const right = zoom === 0 || zoom === 3;
      block(zoom, right ? ox + size - 8 * d : ox + 8 * d, zoom >= 2 ? oy + size - 3 * (fs + 4) * d : oy + (fs + 2) * d, right, false);
    } else {
      x.textAlign = "center";
      const cornersAt = [[-W, -W], [S + W, -W], [S + W, S + W], [-W, S + W]];
      CORNERS.forEach((_, cn) => {
        const f = r.stops.filter(s => s.corner === cn), [cx, cy] = P(cornersAt[cn]), dx = cn === 1 || cn === 2 ? 1 : -1, dy = cn >= 2 ? -1 : 1;
        f.forEach((s, i) => { x.fillStyle = s.gap > 0.005 ? T.muted : T.ink; x.fillText(`${s.force.toFixed(0)} N`, cx + dx * 24 * d, cy + dy * (12 + i * 14) * d); });
      });
      if (push && (push.inward || push.along)) {   // the extra push, as an arrow
        const base = scaled(push.wall, [W + (L - 2 * W) * push.at, -6]), a = push.wall * Math.PI / 2;
        const [fx, fy] = [push.along * Math.cos(a) - push.inward * Math.sin(a), push.along * Math.sin(a) + push.inward * Math.cos(a)];
        const len = Math.hypot(fx, fy), tip = [base[0] + fx / len * 18, base[1] + fy / len * 18];
        x.strokeStyle = T.ink; x.lineWidth = 2 * d;
        x.beginPath(); x.moveTo(...P([base[0] - fx / len * 4, base[1] - fy / len * 4])); x.lineTo(...P(tip)); x.stroke();
        x.fillStyle = T.ink; x.fillText(`${len.toFixed(0)} N`, ...P([base[0] - fx / len * 12, base[1] - fy / len * 12]));
      }
    }
    x.restore();
  }

  const which = +$("#fView").value;
  view(which, 0, 0, px);
}

// shaded 2×2 render of the finished tile face
const GROUT = 3;   // mm between laid tiles
function drawPreview() {
  const c = $("#pv"), x = c.getContext("2d"), W = c.width, T = tok();
  const tw = Math.floor(W / (2 + 3 * GROUT / cfg.size)), gap = (W - 2 * tw) / 3;   // tiles laid with a GROUT mm joint
  const N = Math.min(tw, 720), S = cfg.size, px = S / N;
  const m = heightMask(N), sign = cfg.mode === "mold" ? 1 : -1, D = cfg.depth;
  const img = new ImageData(N, N), L = [-0.45, -0.6, 0.66], ll = Math.hypot(...L);
  const lx = L[0] / ll, ly = L[1] / ll, lz = L[2] / ll;
  const md = i => (i + N) % N;
  for (let y = 0; y < N; y++) for (let xx = 0; xx < N; xx++) {
    const gx = sign * D * (m[y * N + md(xx + 1)] - m[y * N + md(xx - 1)]) / (2 * px);
    const gy = sign * D * (m[md(y + 1) * N + xx] - m[md(y - 1) * N + xx]) / (2 * px);
    const nl = Math.hypot(gx, gy, 1);
    const dot = Math.max(0, (-gx * lx - gy * ly + lz) / nl);
    const hgt = sign * m[y * N + xx];
    const it = Math.min(1.06, 0.3 + 0.62 * dot / lz + 0.05 * hgt);
    const i = (y * N + xx) * 4;
    img.data[i] = 242 * it; img.data[i + 1] = 239 * it; img.data[i + 2] = 230 * it; img.data[i + 3] = 255;
  }
  const off = document.createElement("canvas"); off.width = off.height = N; off.getContext("2d").putImageData(img, 0, 0);
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.fillStyle = "#8d8a82"; x.fillRect(0, 0, W, W);   // grout
  x.imageSmoothingQuality = "high";
  const rr = cfg.kind === "plate" ? 0 : cornerRadius(geomOpts(true)) * tw / S;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const px = gap + i * (tw + gap), py = gap + j * (tw + gap);
    x.save(); x.beginPath();
    if (x.roundRect) x.roundRect(px, py, tw, tw, rr); else x.rect(px, py, tw, tw);
    x.clip();
    if (cfg.turn) {   // a quarter design: each tile turned so its bottom-right corner meets the middle
      x.translate(px + tw / 2, py + tw / 2); x.rotate([[0, -1], [1, 2]][i][j] * Math.PI / 2); x.drawImage(off, -tw / 2, -tw / 2, tw, tw);
    } else x.drawImage(off, px, py, tw, tw);
    x.restore();
  }
}

// ---- 3D preview (three.js), built from the same vector geometry as the export, at preview detail
let three = null, dirty3D = true;
let previewSeq = 0;
async function show3D() {
  const msg = $("#tvmsg");
  if (!three) {
    const el = $("#tv"), r = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(dpr()); el.appendChild(r.domElement);
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f88, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-1, 2, 1.2); scene.add(sun);
    const controls = new OrbitControls(cam, r.domElement);
    const group = new THREE.Group(); group.rotation.x = -Math.PI / 2; scene.add(group);
    const plate = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.85 }));
    const walls = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: 0x9fb4c2, roughness: 0.7 }));
    group.add(plate, walls);
    const render = () => r.render(scene, cam);
    if (controls) { controls.enableDamping = false; controls.addEventListener("change", render); }
    r.domElement.addEventListener("webglcontextrestored", () => render());
    three = {
      r, scene, cam, controls, plate, walls, render, framed: 0,
      resize() { const w = el.clientWidth; r.setSize(w, w); r.setClearColor(tok().outside); cam.aspect = 1; cam.updateProjectionMatrix(); render(); },
    };
    three.resize();
  }
  msg.hidden = true;
  if (dirty3D) {
    dirty3D = false;
    const seq = ++previewSeq, S = cfg.size;
    let res;
    try { res = await runJob("preview"); } catch (e) { toast("Couldn't build the 3D preview: " + e.message); return; }
    if (seq !== previewSeq) return;   // a newer build is on its way
    const geo = pos => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.computeVertexNormals(); g.translate(-S / 2, -S / 2, 0); return g;
    };
    const wallPos = res.walls;
    three.plate.geometry.dispose(); three.plate.geometry = geo(res.plate);
    three.walls.geometry.dispose(); three.walls.geometry = geo(wallPos);
    if (three.framed !== S) {
      three.framed = S;
      three.cam.position.set(S * 0.55, S * 1.15, S * 1.05);
      if (three.controls) { three.controls.target.set(0, 0, 0); three.controls.update(); } else three.cam.lookAt(0, 0, 0);
    }
  }
  three.resize();
}

// ---- exports
const base = () => `pttern-${cfg.size}mm`;
$("#svgBtn").addEventListener("click", () => {
  const S = cfg.size, mats = SYM[cfg.sym];
  let body = "";
  for (const s of shapes) {
    const d = svgPath(s), col = s.cut ? "#000" : grayOf(s.level || 100);
    const paint = isLine(s) ? `fill="none" stroke="${col}" stroke-width="${+lineWidth(s).toFixed(3)}" stroke-linecap="round" stroke-linejoin="round"` : `fill="${col}"`;
    for (const [ox, oy] of OFFS) for (const m of mats) body += `<path transform="matrix(${xf(m, ox * S, oy * S, S).map(v => +v.toFixed(4)).join(" ")})" d="${d}" ${paint}/>\n`;
  }
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${S}mm" height="${S}mm" viewBox="0 0 ${S} ${S}">
<!-- pttern tile: white = raised, black = background. Symmetry: ${cfg.sym}. Repeats seamlessly. -->
<defs><clipPath id="tile"><rect width="${S}" height="${S}"/></clipPath></defs>
<rect width="${S}" height="${S}" fill="#000"/>
<g clip-path="url(#tile)">
${body}</g>
</svg>`;
  offerFile(`${base()}.svg`, svg);
});
$("#pngBtn").addEventListener("click", () => {
  const N = 2048, m = heightMask(N), c = document.createElement("canvas"); c.width = c.height = N;
  const x = c.getContext("2d"), img = x.createImageData(N, N);
  for (let i = 0; i < N * N; i++) { const v = m[i] * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  x.putImageData(img, 0, 0);
  c.toBlob(b => offerFile(`${base()}-heightmap.png`, b), "image/png");
});
// Build the full-detail parts in the worker, then hand over a 3MF or a zip of STLs.
async function exportModel(btn, note, task, extra) {
  const old = note.textContent;
  btn.disabled = true; note.textContent = "Building model… this can take a few seconds";
  try { return (await runJob(task, extra)).file; }
  catch (e) { toast("Couldn't build the model: " + e.message); return null; }
  finally { btn.disabled = false; note.textContent = old; spec(); }
}
const partName = () => cfg.kind === "one" ? "mold" : "pattern-plate";
$("#mfBtn").addEventListener("click", async () => {
  const mf = await exportModel($("#mfBtn"), $("#mfNote"), "3mf");
  if (!mf) return;
  const name = `${base()}-${cfg.kind}.3mf`;
  if (inViewer()) await offerFile(name.replace(/\.3mf$/, "-3mf.zip"), await zipFiles([{ name, data: mf, deflate: false }]));
  else await offerFile(name, mf);
});
$("#stlBtn").addEventListener("click", async () => {
  const names = { plate: `${base()}-${partName()}.stl`, wall: `${base()}-frame-wall-print-4x.stl`, clip: `${base()}-corner-clip-print-4x.stl` };
  const zip = await exportModel($("#stlBtn"), $("#stlNote"), "stl", { names });
  if (zip) await offerFile(`${base()}-${cfg.kind}-stl.zip`, zip);
});
$("#scoopBtn").addEventListener("click", async () => {
  // the same pair for every design: a fixed cement scoop with its water mark, and the sand scoop
  const names = [`pttern-scoop-cement-${SCOOP}ml.stl`, `pttern-scoop-sand-${SCOOP * RATIO}ml.stl`];
  const zip = await exportModel($("#scoopBtn"), $("#scoopNote"), "scoops", { names, scoop: { cement: SCOOP, ratio: RATIO, line: WATER_LINE } });
  if (zip) await offerFile("pttern-scoops-stl.zip", zip);
});
$("#saveBtn").addEventListener("click", () => offerFile(`${base()}.json`, JSON.stringify({ app: "pttern", version: 1, cfg, shapes }, null, 1)));
$("#openBtn").addEventListener("click", () => $("#fileIn").click());
$("#fileIn").addEventListener("change", e => {
  const f = e.target.files[0]; if (!f) return;
  f.text().then(t => {
    const d = JSON.parse(t);
    if (!Array.isArray(d.shapes)) throw new Error("no shapes");
    snapshot(); cfg = { ...DEF, ...(d.cfg || {}) }; shapes = d.shapes; reid(); sel = null;
    zoom = 1; vc = null; syncPanel(); sizeCanvases(); changed(true); toast(`Opened ${f.name}`);
  }).catch(() => toast("That file isn't a pttern project"));
  e.target.value = "";
});

let toastT;
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("on"), 2600); }

// ---- boot
(function boot() {
  try { const u = JSON.parse(localStorage.getItem(UI_KEY) || "null"); if (u) ui = { ...UI_DEF, ...u, panels: { ...u.panels }, inputs: { ...u.inputs } }; } catch (e) { }
  FORCE_INPUTS.forEach(id => { if (ui.inputs[id] != null) $("#" + id).value = ui.inputs[id]; });
  if (ui.profZ != null) profZ = ui.profZ;
  $$(".panel > details").forEach((d, i) => {
    if (ui.panels[i] != null) d.open = ui.panels[i];
    d.addEventListener("toggle", () => { ui.panels[i] = d.open; saveUI(); });
  });
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("pttern.v1") || "null"); } catch (e) { }
  if (saved && Array.isArray(saved.shapes)) {
    cfg = { ...DEF, ...saved.cfg }; shapes = saved.shapes;
    // older saves: tile thickness used to exclude the relief, so take the current mold defaults
    if (!saved.cfg.v || saved.cfg.v < 2) cfg = { ...cfg, ...MOLD_DEF, kind: saved.cfg.kind || (saved.cfg.mode === "stamp" ? "plate" : "kit") };
    cfg.v = DEF.v;
  }
  else shapes = sample();
  reid(); syncPanel(); syncHistory();
  setTool(HINTS[ui.tool] ? ui.tool : "select");
  new ResizeObserver(sizeCanvases).observe($("#viewWrap"));
  sizeCanvases();
  if (ui.view !== "edit" && $(`.tabs [data-view="${ui.view}"]`)) setView(ui.view);
  const redraw = () => { draw(); if (view === "prev") drawPreview(); drawProfiles(); if (view === "force") showForces(); };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  getDownloads().then(spec);
})();