// Mold dimensions derived from the settings. Pure numbers, so the page can show them without
// loading the solid-modelling engine.

export function wallInfo(o) {
  // T is the finished tile thickness, relief included; the walls rise from the plate base (at least 1 mm of cement over the relief)
  const I = o.S + 2 * o.clear, L = I + 2 * o.W, H = o.B + Math.max(o.T, o.D + 1);
  return { I, L, H };
}

// Inside corner radius of the cavity.
export const cornerRadius = o => Math.max(0, Math.min(o.ri || 0, o.S / 4));

// Kit corners are 45° miters. Each wall's miter face runs on past the outside corner as a flap, so
// the two flaps at a corner lie face to face and a clamp (a binder clip or small spring clamp)
// squeezes them together: a clamped miter can't hinge, so the frame stays square.
export const FLAP_T = 4, FLAP_LEN = 14;   // flap thickness, and how far it runs past the outside corner
// Flap outline at a wall's left end, in wall coords (x along the wall, y from the outer face in).
// It hangs off the outer face between x = 0 and FLAP_T·√2; its first edge is the miter line x = y.
export function flapOutline() {
  const d = FLAP_LEN / Math.SQRT2, s = FLAP_T / Math.SQRT2;
  return [[0, 0], [-d, -d], [-d + s, -d - s], [FLAP_T * Math.SQRT2, 0]];
}
// How far the wall reaches from the flap tips (outside) to the rounded inside corner, for the print layout.
export const wallDepth = o => o.W + cornerRadius(o) * (1 - Math.SQRT1_2) + (FLAP_LEN + FLAP_T) / Math.SQRT2;

// Plate lock (kit only): the plate's base layer sticks out this far as a tongue, and each wall has a
// matching rebate along the bottom of its inner face, so the walls hold the plate down and cement
// can't get underneath it.
export const LOCK_TONGUE = 2;
export const hasLock = o => o.kind === "kit" && !!o.lock;

export function plateRadius(o) {
  if (o.kind === "one") return cornerRadius(o);
  return o.kind === "kit" && cornerRadius(o) > 0.3 ? Math.max(0, cornerRadius(o) - o.clear) : 0;
}

// Cord notch centre heights, cut across the flap tips. Two sit near the top and bottom edges,
// leaving a 1.5 mm lip and the middle of the flaps free for the clamp.
export function grooveHeights(o) {
  const { H } = wallInfo(o), gd = Math.min(3, H / 6) / 2, edge = gd + 1.5;
  if (o.grooves == 2 && H - 2 * edge >= 2 * gd + 1) return [edge, H - edge];
  if (o.grooves > 0) return [H / 2];
  return [];
}
