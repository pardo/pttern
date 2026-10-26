// Cement mix for the cast: how much 1 : 3 cement–sand mortar fills the mold, and two printed scoops
// sized so one tile takes a whole number of level fills of each. Pure numbers, like moldspec.js.
import { cornerRadius } from "./moldspec.js";

export const RATIO = 3;                 // parts sand to 1 part cement, by volume
export const DRY = 1.3;                 // dry cement + sand settle into about 1/1.3 of their loose volume once wet
export const SPARE = 1.1;               // 10% extra for spills and what stays in the bucket
export const RHO_CEMENT = 1.44, RHO_SAND = 1.6;   // loose bulk density, g/ml
export const WATER_CEMENT = 0.5;        // water to cement by weight
export const SCOOP_MAX = 250;           // largest sand scoop, ml
export const SCOOP_WALL = 2.4, SCOOP_FLOOR = 2, SCOOP_GROOVE = 0.6;

// Cast volume of one tile in ml. relief: mean of the 0..1 heightmap, the share of the relief depth
// the pattern fills on average.
export function tileVolume(o, relief) {
  const T = Math.max(o.T, o.D + 1), r = cornerRadius(o), A = o.S * o.S - (4 - Math.PI) * r * r, R = o.S * o.S * o.D * relief;
  // "mold": the plate has pockets, so the tile's pattern stands proud; otherwise it is cut into the tile
  return (o.mode === "mold" ? A * (T - o.D) + R : A * T - R) / 1000;
}

export function mixFor(o, relief, tiles) {
  const wet = tileVolume(o, relief), perTile = wet * DRY * SPARE / (1 + RATIO);   // ml of cement per tile
  const fills = Math.max(1, Math.ceil(perTile * RATIO / SCOOP_MAX)), scoop = perTile / fills;
  const cement = perTile * tiles, sand = cement * RATIO, cementG = cement * RHO_CEMENT;
  return {
    wet, tiles, fills, scoop,
    cement, sand, cementG, sandG: sand * RHO_SAND, water: cementG * WATER_CEMENT,
    line: WATER_CEMENT * RHO_CEMENT,   // one cement scoop of water per scoop of cement, filled to this share of its depth
  };
}

// Scoop cup: a square with rounded corners, 0.8 of its width deep, straight sides and a flat floor,
// so a level fill holds exactly `ml`.
export function scoopDims(ml) {
  const k = 0.8 * (1 - (4 - Math.PI) / 64), w = Math.cbrt(ml * 1000 / k);
  return { w, h: 0.8 * w, r: w / 8 };
}
