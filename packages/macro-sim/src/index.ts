export type {
  ArchetypeId,
  ContestedFront,
  Empire,
  EmpireId,
  EmpireModifiers,
  EmpireTraits,
  FlavorSystem,
  MacroConfig,
  MacroEvent,
  MacroEventKind,
  MacroSnapshot,
  MacroState,
  MacroStatus,
  MapSizeTier,
  Region,
  RegionId,
  Vec2,
} from "./types.js";

export {
  DEFAULT_MACRO_CONFIG,
  REGION_COUNTS,
  empireCountForRegions,
} from "./types.js";

export { createRng, randInt, shuffleInPlace } from "./rng.js";
export {
  ARCHETYPE_IDS,
  archetypeLabel,
  pickArchetype,
  traitsForArchetype,
} from "./archetypes.js";
export { generateEmpireName, generateSystemName } from "./names.js";
export {
  flavorSystems,
  generateRegionGalaxy,
  voronoiCell,
} from "./galaxy.js";
export { createMacroMatch } from "./match.js";
export type { CreateMacroOptions } from "./match.js";
export { buildSnapshot } from "./snapshot.js";
export { stepLogic } from "./tick.js";
export type { StepResult } from "./tick.js";
export {
  easeInOutCubic,
  lerpSnapshot,
} from "./interpolate.js";
export type { InterpolatedRegion, InterpolatedSnapshot } from "./interpolate.js";
export { resolveContestedFronts, pressureBorder, reinforceRegion } from "./combat.js";
