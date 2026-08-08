export type RegionId = string;
export type EmpireId = string;

export type ArchetypeId =
  | "aggressive"
  | "cautious"
  | "opportunistic"
  | "loyal"
  | "wildcard";

export interface EmpireTraits {
  aggression: number;
  loyalty: number;
  risk: number;
  greed: number;
}

export interface ContestedFront {
  /** Opponent empire across this border. */
  vs: EmpireId;
  /** 0 = firmly owned, 1 = about to flip to `vs`. */
  pct: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Region {
  id: RegionId;
  neighbors: RegionId[];
  ownerId: EmpireId | null;
  population: number;
  credits: number;
  garrison: number;
  contested: ContestedFront | null;
  /** Site centroid for layout. */
  site: Vec2;
  /** Convex polygon vertices in layout space (for rendering). */
  polygon: Vec2[];
}

export interface Empire {
  id: EmpireId;
  name: string;
  colorHue: number;
  archetype: ArchetypeId;
  traits: EmpireTraits;
  capitalRegionId: RegionId;
  allies: EmpireId[];
  alive: boolean;
  /** Temporary modifiers from events (decay each logic tick). */
  modifiers: EmpireModifiers;
}

export interface EmpireModifiers {
  productionMult: number;
  productionTicksLeft: number;
  garrisonMult: number;
  garrisonTicksLeft: number;
}

export type MacroEventKind =
  | "production_surge"
  | "rebellion"
  | "relic_discovery"
  | "pirate_raid"
  | "disaster"
  | "alliance_formed"
  | "alliance_broken"
  | "front_collapse"
  | "capital_fallen"
  | "empire_eliminated";

export interface MacroEvent {
  tick: number;
  kind: MacroEventKind;
  empireIds: EmpireId[];
  regionId: RegionId | null;
  text: string;
}

export type MacroStatus = "running" | "ended";

export interface MacroState {
  tick: number;
  seed: number;
  regions: Record<RegionId, Region>;
  empires: Record<EmpireId, Empire>;
  events: MacroEvent[];
  status: MacroStatus;
  regionOrder: RegionId[];
  empireOrder: EmpireId[];
}

/** Immutable client-facing snapshot after a logic tick. */
export interface MacroSnapshot {
  tick: number;
  status: MacroStatus;
  regions: Record<
    RegionId,
    {
      ownerId: EmpireId | null;
      population: number;
      credits: number;
      garrison: number;
      contested: ContestedFront | null;
      site: Vec2;
      polygon: Vec2[];
      neighbors: RegionId[];
    }
  >;
  empires: Record<
    EmpireId,
    {
      name: string;
      colorHue: number;
      archetype: ArchetypeId;
      capitalRegionId: RegionId;
      allies: EmpireId[];
      alive: boolean;
      territory: number;
      population: number;
      credits: number;
      garrison: number;
    }
  >;
  events: MacroEvent[];
  regionOrder: RegionId[];
  empireOrder: EmpireId[];
}

export interface MacroConfig {
  /** Wall-clock ms between logic ticks at 1× (default matches competitive 100ms). */
  logicIntervalMs: number;
  productionVariance: number;
  regionCount: number;
  empireCount: number;
  /** Chance of a world event each logic tick. */
  eventChancePerTick: number;
  contestedFlipThreshold: number;
  contestedDriftScale: number;
  /** Economy applies every N logic ticks (10 → 1s at 100ms ticks). */
  economyPulseTicks: number;
  /** Bots decide every N logic ticks. */
  botCadenceTicks: number;
}

export type MapSizeTier = "small" | "medium" | "large";

export const REGION_COUNTS: Record<MapSizeTier, number> = {
  small: 400,
  medium: 1000,
  large: 2500,
};

export function empireCountForRegions(regionCount: number): number {
  return Math.min(150, Math.max(20, Math.round(regionCount / 25)));
}

export const DEFAULT_MACRO_CONFIG: MacroConfig = {
  logicIntervalMs: 100,
  productionVariance: 0.1,
  regionCount: REGION_COUNTS.medium,
  empireCount: empireCountForRegions(REGION_COUNTS.medium),
  eventChancePerTick: 0.012,
  contestedFlipThreshold: 0.92,
  contestedDriftScale: 0.003,
  economyPulseTicks: 10,
  botCadenceTicks: 5,
};

export interface FlavorSystem {
  name: string;
  x: number;
  y: number;
}

