export type {
  AnnexationResult,
  BuildOrder,
  CargoShip,
  ClientId,
  CombatResult,
  Fleet,
  FleetComposition,
  FleetId,
  FleetLocation,
  GalaxyMap,
  GalaxyNode,
  GameState,
  Intent,
  LaneId,
  MatchStatus,
  NodeId,
  NodeRole,
  NodeState,
  PlayerId,
  PlayerState,
  ShipType,
  StampedIntent,
  TechId,
  Tick,
  TickUpdates,
  Turn,
  TurnNumber,
} from "./types.js";

export {
  SHIP_TYPES,
  TECH_IDS,
  TECH_TIER,
} from "./types.js";

export {
  DEFAULT_BALANCE,
  createSimConfig,
  type BalanceTable,
  type SimConfig,
} from "./balance.js";

export {
  fleetPower,
  scaleCompositionToPower,
  effectiveGarrison,
  effectiveTicksPerHop,
  canBuildBattleship,
  upgradeCost,
  techCost,
  canResearch,
} from "./helpers.js";

export {
  resolveLanchesterPair,
  resolveMultiSideCombat,
} from "./combat.js";

export { Game, type Execution } from "./game.js";
export {
  executeNextTick,
  replayTurns,
  emptyTurn,
  attachOngoingExecutions,
} from "./tick.js";
export { createMatch, type CreateMatchOptions } from "./match.js";
export {
  generateGalaxy,
  validateGalaxy,
  type GalaxyGenOptions,
  type GeneratedGalaxy,
} from "./galaxy.js";
export { computeScores, checkWin } from "./score.js";
