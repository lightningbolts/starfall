export type {
  ActiveEngagement,
  ArchetypeId,
  BorderEdge,
  ContestedFront,
  Empire,
  EmpireId,
  EmpireModifiers,
  EmpireTraits,
  EngagementMode,
  GalaxyGeometry,
  LaneEdge,
  MacroConfig,
  MacroEvent,
  MacroEventKind,
  MacroFleetComposition,
  MacroShipType,
  MacroSnapshot,
  MacroState,
  MacroStatus,
  MacroTechId,
  MapSizeTier,
  PlanetaryDevId,
  SnapshotEmpire,
  SnapshotSystem,
  StarClass,
  StarSystem,
  SystemGeometry,
  SystemId,
  Vec2,
} from "./types.js";

export {
  DEFAULT_MACRO_CONFIG,
  MAX_PLANETARY_DEVS,
  SYSTEM_COUNTS,
  empireCountForSystems,
} from "./types.js";

export { createRng, randInt, shuffleInPlace } from "./rng.js";
export {
  ARCHETYPE_IDS,
  archetypeLabel,
  pickArchetype,
  traitsForArchetype,
} from "./archetypes.js";
export { generateEmpireName, generateSystemName } from "./names.js";
export { borderKey, generateGalaxy, taggedVoronoiCell } from "./galaxy.js";
export { createMacroMatch } from "./match.js";
export type { CreateMacroOptions } from "./match.js";
export { buildSnapshot } from "./snapshot.js";
export { stepLogic } from "./tick.js";
export type { StepResult } from "./tick.js";
export { easeInOutCubic, lerpSnapshot } from "./interpolate.js";
export type {
  InterpolatedSnapshot,
  InterpolatedSystem,
} from "./interpolate.js";
export {
  beginEngagement,
  colonizeCost,
  abandonSystem,
  pressureBorder,
  reinforceSystem,
  resolveContestedFronts,
  setSystemOwner,
  tryColonize,
} from "./combat.js";
export {
  MACRO_SHIP_TYPES,
  SHIP_STATS,
  effectiveCombatPower,
  fleetPower,
  formatComposition,
  emptyFleet,
} from "./ships.js";
export {
  MACRO_TECH_IDS,
  PLANETARY_DEV_IDS,
  PLANETARY_LABEL,
  TECH_LABEL,
  TECH_TIER,
  militaryTechScore,
} from "./tech.js";
export { EMPIRE_SWATCH_BANK, swatchForIndex } from "./swatches.js";
export type { EmpireSwatch } from "./swatches.js";
