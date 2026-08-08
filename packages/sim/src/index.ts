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
  nodeProduction,
  empireProduction,
  upgradeBoostLabel,
  levelScale,
  scaleByLevel,
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
export {
  createMatch,
  type CreateMatchOptions,
  type SeatRosterEntry,
} from "./match.js";
export {
  generateGalaxy,
  validateGalaxy,
  ensureMapLayout,
  recommendedNodeCount,
  roleBudget,
  homeSpacingTarget,
  type GalaxyGenOptions,
  type GeneratedGalaxy,
  type GalaxyValidation,
  type RoleBudget,
} from "./galaxy.js";
export { computeScores, checkWin } from "./score.js";
export {
  computeVisibleNodes,
  computePlayerVisionSet,
  nodesWithinHops,
  relayVisionBonusHops,
  isLocationVisible,
} from "./vision.js";
export {
  buildPlayerView,
  createVisionMemory,
  isFoggedNode,
  diffPlayerView,
  applyPlayerViewDelta,
  type VisionMemory,
  type PlayerView,
  type PlayerViewSelf,
  type PlayerViewDelta,
  type ViewNode,
  type LastKnownNode,
} from "./view.js";
export type {
  ClientMessage,
  ServerMessage,
  HelloMessage,
  WelcomeMessage,
  SetReadyMessage,
  StartMatchMessage,
  LobbyUpdateMessage,
  LobbySeat,
  MatchStartMessage,
  ClientIntentMessage,
  TurnMessage,
  TickUpdateMessage,
  MatchOverMessage,
  ErrorMessage,
  ScoreRank,
  WirePhase,
} from "./protocol.js";
export {
  createMatchTelemetry,
  accumulateTelemetry,
  formatTelemetrySummary,
  type MatchTelemetry,
} from "./telemetry.js";
export {
  botIntents,
  policyForBotIndex,
  type BotBrain,
  type BotPolicy,
  type BotDifficulty,
} from "./bots.js";
