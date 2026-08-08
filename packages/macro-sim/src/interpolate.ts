import type {
  ContestedFront,
  EmpireId,
  MacroSnapshot,
  PlanetaryDevId,
  SystemId,
} from "./types.js";
import { snapshotEngagement } from "./ships.js";

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
export interface InterpolatedSystem {
  ownerId: EmpireId | null;
  /** Secondary owner when blending across a flip. */
  ownerIdB: EmpireId | null;
  ownerBlend: number;
  population: number;
  credits: number;
  garrison: number;
  contested: ContestedFront | null;
  developments: PlanetaryDevId[];
  defenseMix: MacroSnapshot["systems"][string]["defenseMix"];
  engagement: MacroSnapshot["systems"][string]["engagement"];
}

export interface InterpolatedSnapshot {
  tick: number;
  t: number;
  status: MacroSnapshot["status"];
  geometry: MacroSnapshot["geometry"];
  systems: Record<SystemId, InterpolatedSystem>;
  empires: MacroSnapshot["empires"];
  events: MacroSnapshot["events"];
  systemOrder: SystemId[];
  empireOrder: EmpireId[];
}

export function lerpSnapshot(
  a: MacroSnapshot,
  b: MacroSnapshot,
  rawT: number,
  ease: (t: number) => number = easeInOutCubic,
): InterpolatedSnapshot {
  const t = ease(rawT);
  const systems: Record<SystemId, InterpolatedSystem> = {};
  for (const id of b.systemOrder) {
    const sa = a.systems[id] ?? b.systems[id]!;
    const sb = b.systems[id]!;
    const ownerChanged = sa.ownerId !== sb.ownerId;
    systems[id] = {
      ownerId: ownerChanged ? sa.ownerId : sb.ownerId,
      ownerIdB: ownerChanged ? sb.ownerId : null,
      ownerBlend: ownerChanged ? t : 0,
      population: lerp(sa.population, sb.population, t),
      credits: lerp(sa.credits, sb.credits, t),
      garrison: lerp(sa.garrison, sb.garrison, t),
      contested: lerpContested(sa.contested, sb.contested, t),
      developments: sb.developments,
      defenseMix: sb.defenseMix,
      engagement: snapshotEngagement(sb.engagement),
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
      fleetPower: lerp(ea.fleetPower, eb.fleetPower, t),
    };
  }

  return {
    tick: b.tick,
    t,
    status: b.status,
    geometry: b.geometry,
    systems,
    empires,
    events: b.events,
    systemOrder: b.systemOrder,
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
