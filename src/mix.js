// Cement mix for the cast: how much 1 : 3 cement–sand mortar fills the mold, and how many level fills
// of the two printed scoops that takes. The scoops are a fixed size, so one pair works for any tile.
// Pure numbers, like moldspec.js.
export const RATIO = 3;                 // parts sand to 1 part cement, by volume
export const DRY = 1.3;                 // dry cement + sand settle into about 1/1.3 of their loose volume once wet
export const SPARE = 1.1;               // 10% extra for spills and what stays in the bucket
export const RHO_CEMENT = 1.44, RHO_SAND = 1.6;   // loose bulk density, g/ml
export const WATER_CEMENT = 0.5;        // water to cement by weight
export const SCOOP = 50;                // cement scoop, ml; the sand scoop holds RATIO times as much
export const WATER_LINE = WATER_CEMENT * RHO_CEMENT;   // a scoop of cement takes the cement scoop filled to this share of its depth with water
export const SCOOP_WALL = 2.4, SCOOP_FLOOR = 2, SCOOP_GROOVE = 0.6;
export const SCOOP_HALF_TICK = 8, SCOOP_FILLET = 4, SCOOP_CHAMFER = 0.5;   // half-fill tick length, handle fillet radius, bottom chamfer, mm

// Cast volume of one tile in ml: the full tile box. The pattern and rounded corners take a little
// off that, which just adds to the spare.
export const tileVolume = o => o.S * o.S * Math.max(o.T, o.D + 1) / 1000;

export function mixFor(o, tiles) {
  const wet = tileVolume(o), perTile = wet * DRY * SPARE / (1 + RATIO);   // ml of cement per tile
  const cement = perTile * tiles, fills = Math.max(0.5, Math.ceil(cement / SCOOP * 2 - 0.1) / 2), sand = cement * RATIO, cementG = cement * RHO_CEMENT;
  return {
    wet, tiles, fills,   // level fills of each scoop for the batch, rounded up to a half (the tick marks)
    cement, sand, cementG, sandG: sand * RHO_SAND, water: cementG * WATER_CEMENT,
  };
}

// Scoop cup: a square with rounded corners, 0.8 of its width deep, straight sides and a flat floor,
// so a level fill holds exactly `ml`.
export function scoopDims(ml) {
  const k = 0.8 * (1 - (4 - Math.PI) / 64), w = Math.cbrt(ml * 1000 / k);
  return { w, h: 0.8 * w, r: w / 8 };
}
