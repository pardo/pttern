// Mold dimensions derived from the settings. Pure numbers, so the page can show them without
// loading the solid-modelling engine.

export function wallInfo(o) {
  // T is the finished tile thickness, relief included; the walls rise from the plate base (at least 1 mm of cement over the relief)
  const I = o.S + 2 * o.clear, L = I + 2 * o.W, H = o.B + Math.max(o.T, o.D + 1);
  return { I, L, H, F: Math.max(3, 2 * Math.round((H / 7 - 1) / 2) + 1) };
}

// Inside corner radius of the cavity. In the kit the outside corner is a 45° chamfer that cuts across
// the finger joints; capping the radius at the wall thickness keeps about a third of each finger.
export const cornerRadius = o => Math.max(0, Math.min(o.ri || 0, o.S / 4, o.kind === "kit" ? o.W : Infinity));

// Where the kit's outer 45° chamfer meets the outer face, measured from the wall end. The chamfer
// touches the circle of radius ri + W around the inside corner's centre, so the wall is never thinner than W.
export const chamferStart = o => (o.W + cornerRadius(o)) * (2 - Math.SQRT2);

// Plate lock (kit only): the plate's base layer sticks out this far as a tongue, and each wall has a
// matching rebate along the bottom of its inner face, so the walls hold the plate down and cement
// can't get underneath it.
export const LOCK_TONGUE = 2;
export const hasLock = o => o.kind === "kit" && !!o.lock;

export function plateRadius(o) {
  if (o.kind === "one") return cornerRadius(o);
  return o.kind === "kit" && cornerRadius(o) > 0.3 ? Math.max(0, cornerRadius(o) - o.clear) : 0;
}

// Thinnest material allowed between a cord groove's 45° flank and the corner of the plate rebate.
export const GROOVE_NECK = 3;

// Cord groove centre heights. Two grooves sit near the top and bottom edges, leaving a 1.5 mm lip,
// so most of each finger joint stays whole; all grooves stay clear of the gaps between finger slots.
// With the plate lock, the bottom groove also rises until GROOVE_NECK of wall separates its lower
// flank from the rebate's inside corner, where the cord pushes hardest.
export function grooveHeights(o) {
  const { H, F } = wallInfo(o), gw = Math.min(3, H / 6), gd = gw / 2, keep = gd + 0.6, edge = gd + 1.5;
  const slots = Array.from({ length: F - 1 }, (_, j) => (j + 1) * H / F);
  // distance from the flank line (z - depth = zc - gd) to the rebate corner (depth W - tongue, height B + clear)
  const lowest = hasLock(o) ? (o.B + o.clear) - (o.W - LOCK_TONGUE) + gd + GROOVE_NECK * Math.SQRT2 : 0;
  const place = (z, up) => {
    for (const s of slots) if (Math.abs(z - s) < keep) z = up ? s + keep : s - keep;
    return Math.min(H - keep, Math.max(keep, z));
  };
  if (o.grooves == 2) {
    const zs = [place(Math.max(edge, lowest), true), place(H - edge, false)];
    if (zs[1] - zs[0] >= gw + 1) return zs;   // too short a wall for two: fall back to one groove
  }
  if (o.grooves > 0) return [place(Math.max(H / 2, lowest), true)];
  return [];
}
// Thinnest wall between the bottom groove and the plate rebate, for the info box (null without both).
export function grooveNeck(o) {
  const zs = grooveHeights(o);
  if (!hasLock(o) || !zs.length) return null;
  const gd = Math.min(3, wallInfo(o).H / 6) / 2;
  return (zs[0] - gd + (o.W - LOCK_TONGUE) - (o.B + o.clear)) / Math.SQRT2;
}
