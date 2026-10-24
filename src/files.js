// File writers: binary STL, 3MF (a zip of XML) and a small zip encoder.

export function to3MF(objs) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n<metadata name="Application">pttern</metadata>\n<resources>\n'];
  objs.forEach((o, n) => {
    const idx = new Map(), verts = [], tris = [], p = o.pos, r = v => Math.round(v * 1e4) / 1e4 + 0;
    const vid = (x, y, z) => {
      const k = `${r(x)} ${r(y)} ${r(z)}`;
      let i = idx.get(k);
      if (i === undefined) { i = verts.length; idx.set(k, i); verts.push(k); }
      return i;
    };
    for (let i = 0; i < p.length; i += 9) {
      const a = vid(p[i], p[i + 1], p[i + 2]), b = vid(p[i + 3], p[i + 4], p[i + 5]), c = vid(p[i + 6], p[i + 7], p[i + 8]);
      if (a !== b && b !== c && a !== c) tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`);
    }
    out.push(`<object id="${n + 1}" name="${o.name}" type="model"><mesh><vertices>\n`,
      verts.map(k => { const [x, y, z] = k.split(" "); return `<vertex x="${x}" y="${y}" z="${z}"/>`; }).join("\n"),
      "\n</vertices><triangles>\n", tris.join("\n"), "\n</triangles></mesh></object>\n");
  });
  out.push("</resources>\n<build>\n", objs.map((o, n) => `<item objectid="${n + 1}" transform="1 0 0 0 1 0 0 0 1 ${o.tx || 0} ${o.ty || 0} 0"/>`).join("\n"), "\n</build>\n</model>\n");
  return out.join("");
}
export const MF_TYPES = '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
export const MF_RELS = '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
export async function build3MF(objs) {
  return zipFiles([{ name: "[Content_Types].xml", data: MF_TYPES }, { name: "_rels/.rels", data: MF_RELS }, { name: "3D/3dmodel.model", data: to3MF(objs) }]);
}
export function toSTL(pos, name) {
  const nt = pos.length / 9, buf = new ArrayBuffer(84 + nt * 50), dv = new DataView(buf);
  for (let i = 0; i < Math.min(80, name.length); i++) dv.setUint8(i, name.charCodeAt(i) & 127);
  dv.setUint32(80, nt, true);
  let o = 84;
  for (let t = 0; t < nt; t++) {
    const b = t * 9;
    const ux = pos[b + 3] - pos[b], uy = pos[b + 4] - pos[b + 1], uz = pos[b + 5] - pos[b + 2];
    const vx = pos[b + 6] - pos[b], vy = pos[b + 7] - pos[b + 1], vz = pos[b + 8] - pos[b + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true); o += 12;
    for (let k = 0; k < 9; k++, o += 4) dv.setFloat32(o, pos[b + k], true);
    o += 2;
  }
  return buf;
}
// ---- zip writer (deflate when the browser can, otherwise stored); also the 3MF container
export const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export async function zipFiles(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0, csize = 0;
  for (const f of files) {
    const raw = typeof f.data === "string" ? enc.encode(f.data) : new Uint8Array(f.data instanceof Blob ? await f.data.arrayBuffer() : f.data);
    let c = 0xFFFFFFFF; for (let i = 0; i < raw.length; i++) c = CRC[(c ^ raw[i]) & 255] ^ (c >>> 8); c = (c ^ 0xFFFFFFFF) >>> 0;
    let body = raw, method = 0;
    if (f.deflate !== false && typeof CompressionStream !== "undefined") {
      try { body = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()); method = 8; }
      catch (e) { body = raw; method = 0; }
    }
    const nm = enc.encode(f.name), lh = new DataView(new ArrayBuffer(30)), ch = new DataView(new ArrayBuffer(46)), date = (46 << 9) | (1 << 5) | 1;
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, method, true); lh.setUint16(12, date, true);
    lh.setUint32(14, c, true); lh.setUint32(18, body.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, nm.length, true);
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(10, method, true); ch.setUint16(14, date, true);
    ch.setUint32(16, c, true); ch.setUint32(20, body.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    parts.push(lh, nm, body); central.push(ch, nm);
    off += 30 + nm.length + body.length; csize += 46 + nm.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
