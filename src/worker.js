// Builds mold geometry and export files off the main thread so the page stays responsive.
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { initGeometry, buildAll, mapPos, wallAssembly, wallPrint, clipAssembly, sectionModel, sectionsOf, freeModel } from "./geometry.js";
import { wallInfo, wallDepth } from "./moldspec.js";
import { build3MF, toSTL, zipFiles } from "./files.js";

const ready = initGeometry({ locateFile: () => wasmUrl });

function concat(parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((off, p) => (out.set(p, off), off + p.length), 0);
  return out;
}

// moved so its lowest x, y and z are 0, to sit on the print bed
function toOrigin(pos) {
  const lo = [Infinity, Infinity, Infinity];
  for (let i = 0; i < pos.length; i++) lo[i % 3] = Math.min(lo[i % 3], pos[i]);
  return mapPos(pos, (x, y, z) => [x - lo[0], y - lo[1], z - lo[2]]);
}

// the profile view slices the same model at many heights, so keep the last one
let sectionKey = null, section = null;

self.onmessage = async ({ data: { id, task, shapes, o, names, z } }) => {
  try {
    await ready;
    if (task === "sections") {
      const key = JSON.stringify([shapes, o]);
      if (key !== sectionKey) {
        if (section) freeModel(section);
        section = sectionKey = null;
        section = sectionModel(shapes, o); sectionKey = key;
      }
      self.postMessage({ id, ...sectionsOf(section, o, z) });
      return;
    }
    const res = buildAll(shapes, o);
    if (task === "preview") {
      // the four walls pulled out a little so the joints show, and the clips above the corners they slide down onto
      const walls = res.wall ? concat([0, 1, 2, 3].flatMap(k => [mapPos(res.wall, wallAssembly(o, k, 8)), mapPos(res.clip, clipAssembly(o, k, 8, wallInfo(o).H * 0.6))])) : new Float32Array(0);
      self.postMessage({ id, plate: res.plate, walls }, [res.plate.buffer, walls.buffer]);
    } else if (task === "3mf") {
      const objs = [{ name: o.kind === "one" ? "Mold" : "Pattern plate", pos: res.plate }];
      if (res.wall) {
        const flat = mapPos(res.wall, wallPrint(o));
        for (let k = 0; k < 4; k++) objs.push({ name: `Frame wall ${k + 1}`, pos: flat, ty: o.S + 10 + k * (wallDepth(o) + 6) });
        const clip = toOrigin(res.clip);
        for (let k = 0; k < 4; k++) objs.push({ name: `Corner clip ${k + 1}`, pos: clip, tx: k * 25, ty: o.S + 10 + 4 * (wallDepth(o) + 6) });
      }
      self.postMessage({ id, file: await build3MF(objs) });
    } else if (task === "stl") {
      const files = [{ name: names.plate, data: toSTL(res.plate, names.plate) }];
      if (res.wall) files.push({ name: names.wall, data: toSTL(mapPos(res.wall, wallPrint(o)), names.wall) }, { name: names.clip, data: toSTL(toOrigin(res.clip), names.clip) });
      self.postMessage({ id, file: await zipFiles(files) });
    }
  } catch (e) {
    self.postMessage({ id, error: e.message || String(e) });
  }
};
