/** Domain identifiers and contracts — see docs/design/domain.md */

export type NodeId = string;
export type PlayerId = string;
export type ClientId = string;
export type FleetId = string;
export type LaneId = string;
export type Tick = number;
export type TurnNumber = number;

export type TechId =
  | "advanced_propulsion"
  | "fortified_colonies"
  | "survey_drones"
  | "heavy_warships"
  | "lane_logistics"
  | "population_efficiency"
  | "orbital_shielding"
  | "rapid_deployment"
  | "relic_scanning";

export type NodeRole =
  | "homeworld"
  | "core_world"
  | "resource"
  | "shipyard"
  | "relay"
  | "relic";

export type ShipType = "fighter" | "cruiser" | "battleship";
export type FleetComposition = Partial<Record<ShipType, number>>;

export type FleetLocation =
  | { kind: "node"; nodeId: NodeId }
  | {
      kind: "transit";
      from: NodeId;
      to: NodeId;
      ticksRemaining: number;
      hopTotalTicks: number;
    };

export interface GalaxyNode {
  id: NodeId;
  role: NodeRole;
  neighbors: NodeId[];
}

export interface GalaxyMap {
  nodes: Record<NodeId, GalaxyNode>;
  layout?: Record<NodeId, { x: number; y: number }>;
}

export interface Fleet {
  id: FleetId;
  ownerId: PlayerId;
  composition: FleetComposition;
  location: FleetLocation;
  invasionPopulation?: number;
}

export interface CargoShip {
  id: FleetId;
  ownerId: PlayerId;
  cargoCredits: number;
  location: FleetLocation;
  path: NodeId[];
}

export interface BuildOrder {
  shipType: ShipType;
  count: number;
  progressTicks: number;
  ticksRequired: number;
}

export interface NodeState {
  id: NodeId;
  ownerId: PlayerId | null;
  level: number;
  population: number;
  cargoStockpile: number;
  buildQueue: BuildOrder[];
  /** Tick when this owner captured/started owning (for cargo sink fallback). */
  ownedSinceTick: number;
}

export interface PlayerState {
  id: PlayerId;
  clientId: ClientId | null;
  displayName: string;
  credits: number;
  researched: Set<TechId>;
  allies: PlayerId[];
  eliminated: boolean;
  score: number;
  /** Accumulated bonuses (e.g. elimination) folded into score each tick. */
  bonusScore: number;
  homeworldId: NodeId | null;
}

export type Intent =
  | { type: "BuildShips"; nodeId: NodeId; shipType: ShipType; count: number }
  | { type: "UpgradeNode"; nodeId: NodeId }
  | { type: "ResearchTech"; techId: TechId }
  | {
      type: "MoveFleet";
      fleetId: FleetId;
      path: NodeId[];
      composition?: FleetComposition;
      /** When true, do not auto-embark population (ships-only raid). */
      raidOnly?: boolean;
    }
  | { type: "CancelMove"; fleetId: FleetId }
  | {
      type: "CommitInvasion";
      fleetId: FleetId;
      population: number;
      fromNodeId: NodeId;
    }
  | { type: "CancelInvasion"; fleetId: FleetId }
  | { type: "ProposeAlliance"; toPlayerId: PlayerId }
  | { type: "AcceptAlliance"; fromPlayerId: PlayerId }
  | { type: "BreakAlliance"; withPlayerId: PlayerId };

export interface StampedIntent {
  clientId: ClientId;
  sequence: number;
  intent: Intent;
}

export interface Turn {
  turnNumber: TurnNumber;
  intents: StampedIntent[];
}

export interface CombatResult {
  location:
    | { kind: "node"; nodeId: NodeId }
    | { kind: "lane"; from: NodeId; to: NodeId };
  winnerId: PlayerId | null;
  loserId: PlayerId | null;
  winnerPowerBefore: number;
  loserPowerBefore: number;
  winnerPowerRemaining: number;
  winnerCompositionAfter: FleetComposition;
}

export interface AnnexationResult {
  nodeId: NodeId;
  attackerId: PlayerId;
  previousOwnerId: PlayerId | null;
  success: boolean;
  garrison: number;
  populationCommitted: number;
  levelRetained: number;
}

export interface TickUpdates {
  combats: CombatResult[];
  annexations: AnnexationResult[];
  researches: { playerId: PlayerId; techId: TechId }[];
}

export type MatchStatus = "lobby" | "running" | "finished";

export interface GameState {
  tick: Tick;
  turnNumber: TurnNumber;
  map: GalaxyMap;
  nodes: Record<NodeId, NodeState>;
  fleets: Record<FleetId, Fleet>;
  cargoShips: Record<FleetId, CargoShip>;
  players: Record<PlayerId, PlayerState>;
  /** clientId → playerId */
  clientToPlayer: Record<ClientId, PlayerId>;
  allianceProposals: Record<PlayerId, PlayerId[]>;
  status: MatchStatus;
  winnerId: PlayerId | null;
  nextFleetSeq: number;
  seed: number;
}

export const SHIP_TYPES: ShipType[] = ["fighter", "cruiser", "battleship"];

export const TECH_IDS: TechId[] = [
  "advanced_propulsion",
  "fortified_colonies",
  "survey_drones",
  "heavy_warships",
  "lane_logistics",
  "population_efficiency",
  "orbital_shielding",
  "rapid_deployment",
  "relic_scanning",
];

export const TECH_TIER: Record<TechId, 1 | 2 | 3> = {
  advanced_propulsion: 1,
  fortified_colonies: 1,
  survey_drones: 1,
  heavy_warships: 2,
  lane_logistics: 2,
  population_efficiency: 2,
  orbital_shielding: 3,
  rapid_deployment: 3,
  relic_scanning: 3,
};
