import type { ContestedFront, EmpireId, MacroSnapshot, RegionId } from "./types.js";

export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Interpolate between two logic snapshots.
 * Ownership blends via `ownerBlend` (0 = fully A owner, 1 = fully B owner) when owners differ.
 */
export interface InterpolatedRegion {
  ownerId: EmpireId | null;
  /** Secondary owner when blending across a flip. */
  ownerIdB: EmpireId | null;
  ownerBlend: number;
  population: number;
  credits: number;
  garrison: number;
  contested: ContestedFront | null;
  site: { x: number; y: number };
  polygon: { x: number; y: number }[];
  neighbors: RegionId[];
}

export interface InterpolatedSnapshot {
  tick: number;
  t: number;
  status: MacroSnapshot["status"];
  regions: Record<RegionId, InterpolatedRegion>;
  empires: MacroSnapshot["empires"];
  events: MacroSnapshot["events"];
  regionOrder: RegionId[];
  empireOrder: EmpireId[];
}

export function lerpSnapshot(
  a: MacroSnapshot,
  b: MacroSnapshot,
  rawT: number,
  ease: (t: number) => number = easeInOutCubic,
): InterpolatedSnapshot {
  const t = ease(rawT);
  const regions: Record<RegionId, InterpolatedRegion> = {};
  for (const id of b.regionOrder) {
    const ra = a.regions[id] ?? b.regions[id]!;
    const rb = b.regions[id]!;
    const ownerChanged = ra.ownerId !== rb.ownerId;
    regions[id] = {
      ownerId: ownerChanged ? ra.ownerId : rb.ownerId,
      ownerIdB: ownerChanged ? rb.ownerId : null,
      ownerBlend: ownerChanged ? t : 0,
      population: lerp(ra.population, rb.population, t),
      credits: lerp(ra.credits, rb.credits, t),
      garrison: lerp(ra.garrison, rb.garrison, t),
      contested: lerpContested(ra.contested, rb.contested, t),
      site: rb.site,
      polygon: rb.polygon,
      neighbors: rb.neighbors,
    };
  }

  const empires: MacroSnapshot["empires"] = {};
  for (const id of b.empireOrder) {
    const ea = a.empires[id] ?? b.empires[id]!;
    const eb = b.empires[id]!;
    empires[id] = {
      ...eb,
      territory: lerp(ea.territory, eb.territory, t),
      population: lerp(ea.population, eb.population, t),
      credits: lerp(ea.credits, eb.credits, t),
      garrison: lerp(ea.garrison, eb.garrison, t),
    };
  }

  return {
    tick: b.tick,
    t,
    status: b.status,
    regions,
    empires,
    events: b.events,
    regionOrder: b.regionOrder,
    empireOrder: b.empireOrder,
  };
}

function lerpContested(
  ca: ContestedFront | null,
  cb: ContestedFront | null,
  t: number,
): ContestedFront | null {
  if (!ca && !cb) return null;
  if (!ca && cb) return { vs: cb.vs, pct: lerp(0, cb.pct, t) };
  if (ca && !cb) return { vs: ca.vs, pct: lerp(ca.pct, 0, t) };
  if (ca && cb) {
    if (ca.vs === cb.vs) return { vs: cb.vs, pct: lerp(ca.pct, cb.pct, t) };
    return t < 0.5
      ? { vs: ca.vs, pct: lerp(ca.pct, 0, t * 2) }
      : { vs: cb.vs, pct: lerp(0, cb.pct, (t - 0.5) * 2) };
  }
  return null;
}
