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
// the two flaps at a corner lie face to face. Near the tip both flaps flare out into a dovetail, and
// a printed C clip with a matching channel slides down over the pair: it hooks behind the flare, so
// the flaps can neither part nor slide along each other and the corner can't hinge. The channel
// tapers from the joint clearance at the top to a snug fit at the bottom, so pushing the clip home
// takes up the play.
export const FLAP_T = 4, FLAP_LEN = 14;      // flap thickness, and how far it runs past the outside corner
export const FLARE = 2, FLARE_LEN = 3;        // how much each flap thickens towards its tip, over this length (a 34° hook)
export const CLIP_T = 4.5;                   // clip jaw and back thickness
// Flap-pair coords: u runs along the miter line out from the outside corner, v across it, positive
// towards the wall that owns the flap. Wall coords at its left end: x along the wall, y in from the outer face.
export const fromUV = ([u, v]) => [(-u + v) / Math.SQRT2, (-u - v) / Math.SQRT2];
// Flap outline at a wall's left end, in wall coords: the miter line, the flared tip, the outer face
// back to where it leaves the wall's outer face (FLAP_T·√2 along it).
export const flapOutline = () => [[0, 0], [FLAP_LEN, 0], [FLAP_LEN, FLAP_T + FLARE], [FLAP_LEN - FLARE_LEN, FLAP_T], [-FLAP_T, FLAP_T]].map(fromUV);
// The clip's channel in flap-pair coords, widened by `gap` all round: the jaws reach 2 mm past the
// start of the flare, and the back sits `gap` beyond the tips.
export function clipChannel(gap) {
  const u0 = FLAP_LEN - FLARE_LEN - 2, u1 = FLAP_LEN + gap, t = FLAP_T + gap, f = FLAP_T + FLARE + gap;
  return [[u0, -t], [FLAP_LEN - FLARE_LEN, -t], [u1, -f], [u1, f], [FLAP_LEN - FLARE_LEN, t], [u0, t]];
}
export function clipOutline() {
  const u0 = FLAP_LEN - FLARE_LEN - 2, u1 = FLAP_LEN + CLIP_T, w = FLAP_T + FLARE + CLIP_T, c = 1.5;
  return [[u0, -w + c], [u0 + c, -w], [u1 - c, -w], [u1, -w + c], [u1, w - c], [u1 - c, w], [u0 + c, w], [u0, w - c]];
}
// How far the wall reaches from the flap tips (outside) to the rounded inside corner, for the print layout.
export const wallDepth = o => o.W + cornerRadius(o) * (1 - Math.SQRT1_2) + (FLAP_LEN + FLAP_T + FLARE) / Math.SQRT2;

// Plate lock (kit only): the plate's base layer sticks out this far as a tongue, and each wall has a
// matching rebate along the bottom of its inner face, so the walls hold the plate down and cement
// can't get underneath it.
export const LOCK_TONGUE = 2;
export const hasLock = o => o.kind === "kit" && !!o.lock;

export function plateRadius(o) {
  if (o.kind === "one") return cornerRadius(o);
  return o.kind === "kit" && cornerRadius(o) > 0.3 ? Math.max(0, cornerRadius(o) - o.clear) : 0;
}
