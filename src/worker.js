// Builds mold geometry and export files off the main thread so the page stays responsive.
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { initGeometry, buildAll, mapPos, wallAssembly, wallPrint, sectionModel, sectionsOf, freeModel } from "./geometry.js";
import { wallInfo } from "./moldspec.js";
import { build3MF, toSTL, zipFiles } from "./files.js";

const ready = initGeometry({ locateFile: () => wasmUrl });

function concat(parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((off, p) => (out.set(p, off), off + p.length), 0);
  return out;
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
      // the four walls, pulled out a little so the joints show
      const walls = res.wall ? concat([0, 1, 2, 3].map(k => mapPos(res.wall, wallAssembly(o, k, 8)))) : new Float32Array(0);
      self.postMessage({ id, plate: res.plate, walls }, [res.plate.buffer, walls.buffer]);
    } else if (task === "3mf") {
      const objs = [{ name: o.kind === "one" ? "Mold" : "Pattern plate", pos: res.plate }];
      if (res.wall) {
        const w = wallInfo(o), flat = mapPos(res.wall, wallPrint(o));
        for (let k = 0; k < 4; k++) objs.push({ name: `Frame wall ${k + 1}`, pos: flat, ty: o.S + 10 + k * (w.H + 6) });
      }
      self.postMessage({ id, file: await build3MF(objs) });
    } else if (task === "stl") {
      const files = [{ name: names.plate, data: toSTL(res.plate, names.plate) }];
      if (res.wall) files.push({ name: names.wall, data: toSTL(mapPos(res.wall, wallPrint(o)), names.wall) });
      self.postMessage({ id, file: await zipFiles(files) });
    }
  } catch (e) {
    self.postMessage({ id, error: e.message || String(e) });
  }
};
