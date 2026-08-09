export type SystemId = string;
export type EmpireId = string;

export type ArchetypeId =
  | "conqueror"
  | "aggressive"
  | "reckless"
  | "cautious"
  | "strategist"
  | "opportunistic"
  | "diplomat"
  | "loyal"
  | "xenophobe"
  | "technocrat"
  | "isolationist"
  | "wildcard";

export interface EmpireTraits {
  aggression: number;
  loyalty: number;
  risk: number;
  greed: number;
  ambition: number;
  xenophobia: number;
  curiosity: number;
}

export type MacroShipType =
  | "corvette"
  | "destroyer"
  | "cruiser"
  | "battleship"
  | "carrier"
  | "raider"
  | "dreadnought"
  | "defense_platform";

export type MacroFleetComposition = Partial<Record<MacroShipType, number>>;

export type EngagementMode = "skirmish" | "fleet_battle" | "siege" | "raid";

export interface ActiveEngagement {
  mode: EngagementMode;
  attackerId: EmpireId;
  defenderId: EmpireId;
  committedA: MacroFleetComposition;
  committedB: MacroFleetComposition;
  ticksElapsed: number;
  ticksRemaining: number;
  /** 0–1 log-scaled from committed power + local resources. */
  intensity: number;
  tacticsSeed: number;
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

/** Visual weight of a star, used for sprite size and brightness. */
export type StarClass = "core" | "main" | "dim";

/**
 * Static per-system geometry. Generated once and never mutated, so state and
 * every snapshot share the same objects by reference.
 */
export interface SystemGeometry {
  id: SystemId;
  index: number;
  name: string;
  starClass: StarClass;
  /** Star position in layout space. */
  site: Vec2;
  /**
   * Voronoi cell around the star. Used only to rasterize empire territory into
   * a coverage field — never stroked, so players never see a tile grid.
   */
  cell: Vec2[];
  hyperlanes: SystemId[];
}

/** The exact segment two adjacent cells share, for border and front rendering. */
export interface BorderEdge {
  a: SystemId;
  b: SystemId;
  p0: Vec2;
  p1: Vec2;
}

export interface LaneEdge {
  a: SystemId;
  b: SystemId;
}

export interface GalaxyGeometry {
  seed: number;
  systems: SystemGeometry[];
  byId: Record<SystemId, SystemGeometry>;
  ids: SystemId[];
  lanes: LaneEdge[];
  borderEdges: BorderEdge[];
  /** Keyed by `borderKey(a, b)` for front rendering lookups. */
  borderEdgeByKey: Record<string, BorderEdge>;
  /** Distance from origin to the outermost star. */
  radius: number;
}

export type MacroTechId =
  | "industrial_foundries"
  | "colony_administration"
  | "militia_doctrine"
  | "archive_networks"
  | "megafarms"
  | "fortress_worlds"
  | "diplomatic_corps"
  | "deep_scanners"
  | "escort_doctrine"
  | "war_mobilization"
  | "planetary_shields"
  | "capital_shipyards"
  | "xenology_bureau"
  | "singularity_labs"
  | "tactical_ai"
  | "galactic_hegemony"
  | "eternal_archives"
  | "iron_curtain"
  | "pax_federation"
  | "supercapital_frame";

export type PlanetaryDevId =
  | "agro_domes"
  | "mining_spires"
  | "orbital_batteries"
  | "shipyard_ring"
  | "research_campus"
  | "fortress_complex"
  | "trade_hub"
  | "plague_hospitals"
  | "hidden_arsenals";

export interface StarSystem {
  id: SystemId;
  name: string;
  starClass: StarClass;
  /** Shared reference into geometry — never mutated. */
  site: Vec2;
  /** Shared reference into geometry — never mutated. */
  hyperlanes: SystemId[];
  ownerId: EmpireId | null;
  population: number;
  credits: number;
  garrison: number;
  contested: ContestedFront | null;
  developments: Set<PlanetaryDevId>;
  defenseMix: MacroFleetComposition;
  engagement: ActiveEngagement | null;
}

export interface Empire {
  id: EmpireId;
  name: string;
  colorHue: number;
  colorSat: number;
  colorLight: number;
  archetype: ArchetypeId;
  traits: EmpireTraits;
  capitalSystemId: SystemId;
  allies: EmpireId[];
  alive: boolean;
  /** Maintained incrementally by `setSystemOwner` — avoids full-galaxy scans. */
  ownedSystems: Set<SystemId>;
  /** Temporary modifiers from events (decay each logic tick). */
  modifiers: EmpireModifiers;
  researched: Set<MacroTechId>;
  fleet: MacroFleetComposition;
}

export interface EmpireModifiers {
  productionMult: number;
  productionTicksLeft: number;
  garrisonMult: number;
  garrisonTicksLeft: number;
  attackPressure: number;
  attackPressureTicksLeft: number;
}

export type MacroEventKind =
  | "production_surge"
  | "rebellion"
  | "relic_discovery"
  | "pirate_raid"
  | "disaster"
  | "offensive_blitz"
  | "defensive_stronghold"
  | "plague"
  | "robbery"
  | "tech_breakthrough"
  | "coup"
  | "regime_change"
  | "alliance_formed"
  | "alliance_broken"
  | "front_collapse"
  | "capital_fallen"
  | "empire_eliminated"
  | "match_won"
  | "fleet_battle"
  | "border_clash"
  | "tech_researched"
  | "planetary_built"
  | "territory_abandoned";

export interface MacroEvent {
  /** Monotonic id so the client can append only what it has not shown yet. */
  seq: number;
  tick: number;
  kind: MacroEventKind;
  empireIds: EmpireId[];
  systemId: SystemId | null;
  text: string;
}

export type MacroStatus = "running" | "ended";

export interface MacroState {
  tick: number;
  seed: number;
  geometry: GalaxyGeometry;
  systems: Record<SystemId, StarSystem>;
  empires: Record<EmpireId, Empire>;
  events: MacroEvent[];
  eventSeq: number;
  status: MacroStatus;
  systemOrder: SystemId[];
  empireOrder: EmpireId[];
}

/** Dynamic per-system fields; geometry lives on the shared `geometry`. */
export interface SnapshotSystem {
  ownerId: EmpireId | null;
  population: number;
  credits: number;
  garrison: number;
  contested: ContestedFront | null;
  developments: PlanetaryDevId[];
  defenseMix: MacroFleetComposition;
  engagement: ActiveEngagement | null;
}

export interface SnapshotEmpire {
  name: string;
  colorHue: number;
  colorSat: number;
  colorLight: number;
  archetype: ArchetypeId;
  traits: EmpireTraits;
  capitalSystemId: SystemId;
  allies: EmpireId[];
  alive: boolean;
  territory: number;
  population: number;
  credits: number;
  garrison: number;
  researched: MacroTechId[];
  fleet: MacroFleetComposition;
  fleetPower: number;
  modifiers: EmpireModifiers;
}

/** Immutable client-facing snapshot after a logic tick. */
export interface MacroSnapshot {
  tick: number;
  status: MacroStatus;
  /** Shared reference — static for the whole match. */
  geometry: GalaxyGeometry;
  systems: Record<SystemId, SnapshotSystem>;
  empires: Record<EmpireId, SnapshotEmpire>;
  events: MacroEvent[];
  systemOrder: SystemId[];
  empireOrder: EmpireId[];
}

export interface MacroConfig {
  /** Wall-clock ms between logic ticks at 1× (default matches competitive 100ms). */
  logicIntervalMs: number;
  productionVariance: number;
  systemCount: number;
  empireCount: number;
  /** Chance of a world event each logic tick. */
  eventChancePerTick: number;
  contestedFlipThreshold: number;
  contestedDriftScale: number;
  /** Economy applies every N logic ticks (10 → 1s at 100ms ticks). */
  economyPulseTicks: number;
  /** Bots decide every N logic ticks. */
  botCadenceTicks: number;
  /** Diplomacy is far slower than military decisions, or the feed drowns in pacts. */
  diplomacyCadenceTicks: number;
  /** Colonization claims a bot may attempt per decision pulse. */
  maxClaimsPerPulse: number;
}

export type MapSizeTier = "small" | "medium" | "large";

export const SYSTEM_COUNTS: Record<MapSizeTier, number> = {
  small: 600,
  medium: 1200,
  large: 2400,
};

/**
 * Roughly 25–50 systems per empire at maturity. Clamped so small maps still
 * feel crowded and large maps stay color-readable.
 */
export function empireCountForSystems(systemCount: number): number {
  return Math.min(48, Math.max(12, Math.round(systemCount / 50)));
}

export const DEFAULT_MACRO_CONFIG: MacroConfig = {
  logicIntervalMs: 100,
  productionVariance: 0.14,
  systemCount: SYSTEM_COUNTS.medium,
  empireCount: empireCountForSystems(SYSTEM_COUNTS.medium),
  eventChancePerTick: 0.045,
  contestedFlipThreshold: 0.72,
  contestedDriftScale: 0.01,
  economyPulseTicks: 10,
  botCadenceTicks: 5,
  diplomacyCadenceTicks: 60,
  maxClaimsPerPulse: 2,
};

export const MAX_PLANETARY_DEVS = 4;
