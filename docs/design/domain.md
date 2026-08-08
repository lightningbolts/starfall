# Starfall — Domain Model (TypeScript Contracts)

**Status:** design contracts for future `packages/sim`  
**Not a buildable package yet** — copy these shapes when scaffolding code.

Normative behavior: [mechanics.md](./mechanics.md). Numbers: [balance.md](./balance.md).  
Tech tree: [tech-tree.md](./tech-tree.md).  
Rulings: [rulings.md](./rulings.md).  
Clock / loop: [adr/001-tick-engine.md](../adr/001-tick-engine.md) (OpenFront-style).

---

## Identifiers

```ts
type NodeId = string;
type PlayerId = string;
type ClientId = string; // connection / seat; stamped on intents by server
type FleetId = string;
type LaneId = string; // `${min}:${max}`
type Tick = number;   // 100ms units; 10 ticks = 1s
type TurnNumber = number;

type TechId =
  | "advanced_propulsion"
  | "fortified_colonies"
  | "survey_drones"
  | "heavy_warships"
  | "lane_logistics"
  | "population_efficiency"
  | "orbital_shielding"
  | "rapid_deployment"
  | "relic_scanning";
```

---

## Config

```ts
interface SimConfig {
  msPerTick(): number;       // 100
  turnIntervalMs(): number;  // 100
  roundTicks(): number;      // e.g. 12_000
  balance: BalanceTable;
}
```

---

## Static map

```ts
type NodeRole =
  | "homeworld"
  | "core_world"
  | "resource"
  | "shipyard"
  | "relay"
  | "relic";

interface GalaxyNode {
  id: NodeId;
  role: NodeRole;
  neighbors: NodeId[];
}

interface GalaxyMap {
  nodes: Record<NodeId, GalaxyNode>;
  layout?: Record<NodeId, { x: number; y: number }>;
}
```

---

## Ships and fleets

```ts
type ShipType = "fighter" | "cruiser" | "battleship";
type FleetComposition = Partial<Record<ShipType, number>>;

type FleetLocation =
  | { kind: "node"; nodeId: NodeId }
  | {
      kind: "transit";
      from: NodeId;
      to: NodeId;
      ticksRemaining: number;
    };

interface Fleet {
  id: FleetId;
  ownerId: PlayerId;
  composition: FleetComposition;
  location: FleetLocation;
  /** Pop committed for annexation on arrival / at node. */
  invasionPopulation?: number;
}
```

```ts
function fleetPower(c: FleetComposition, stats: ShipStatsTable): number;
function scaleCompositionToPower(
  c: FleetComposition,
  remainingPower: number,
  stats: ShipStatsTable,
): FleetComposition;
function canBuildBattleship(player: PlayerState): boolean; // researched.has("heavy_warships")
function effectiveTicksPerHop(base: number, researched: Set<TechId>): number;
function effectiveGarrison(
  node: NodeState,
  role: NodeRole,
  researched: Set<TechId>,
  balance: BalanceTable,
): number;
```

---

## Node / player state

```ts
interface NodeState {
  id: NodeId;
  ownerId: PlayerId | null;
  level: number; // >= 1, uncapped
  population: number;
  /** Resource/relic: credits awaiting cargo launch. */
  cargoStockpile: number;
  buildQueue: BuildOrder[];
}

interface CargoShip {
  id: FleetId; // or CargoId
  ownerId: PlayerId;
  cargoCredits: number;
  location: FleetLocation;
  /** Shortest-path remaining toward cargo sink (homeworld or fallback). */
  path: NodeId[];
}

interface BuildOrder {
  shipType: ShipType;
  count: number;
  progressTicks: number;
}

interface PlayerState {
  id: PlayerId;
  clientId: ClientId | null;
  displayName: string;
  credits: number;
  researched: Set<TechId>; // or TechId[]
  allies: PlayerId[];
  eliminated: boolean;
  score: number;
}
```

Garrison is derived from role + level + balance + researched techs.

---

## Intents (client → server)

Immutable, schema-validated. Server stamps `clientId` (never trust client-supplied identity).

```ts
type Intent =
  | { type: "BuildShips"; nodeId: NodeId; shipType: ShipType; count: number }
  | { type: "UpgradeNode"; nodeId: NodeId }
  | { type: "ResearchTech"; techId: TechId }
  | {
      type: "MoveFleet";
      fleetId: FleetId;
      path: NodeId[];
      composition?: FleetComposition; // split; default = all
    }
  | { type: "CancelMove"; fleetId: FleetId }
  | {
      type: "CommitInvasion";
      fleetId: FleetId;
      population: number;
      fromNodeId: NodeId; // owned; pop deducted here and embarked on fleet
    }
  | { type: "CancelInvasion"; fleetId: FleetId }
  | { type: "ProposeAlliance"; toPlayerId: PlayerId }
  | { type: "AcceptAlliance"; fromPlayerId: PlayerId }
  | { type: "BreakAlliance"; withPlayerId: PlayerId };

interface StampedIntent {
  clientId: ClientId;
  sequence: number;
  intent: Intent;
}

interface Turn {
  turnNumber: TurnNumber;
  intents: StampedIntent[];
}
```

---

## Executions (sim-internal)

```ts
interface Execution {
  init(game: Game, tick: Tick): void;
  tick(game: Game, tick: Tick): void;
  isActive(): boolean;
}

/** Converts turn intents → executions; unknown player → NoOpExecution. */
interface Executor {
  createExecs(turn: Turn): Execution[];
}
```

Typical executions: `MoveFleetExecution`, `CargoShipExecution` (auto homeworld path), `BuildQueueExecution` / shipyard progress, `UpgradeNodeExecution`, `ResearchExecution` (instant pay + unlock), `CombatExecution` (instant), `AnnexationExecution`, `EconomyExecution` (pulse every 10 ticks; stockpile vs bank), `WinCheckExecution`, `Alliance*Execution`, `NoOpExecution`.

---

## Game / tick API

```ts
interface GameState {
  tick: Tick;
  map: GalaxyMap;
  nodes: Record<NodeId, NodeState>;
  fleets: Record<FleetId, Fleet>;
  cargoShips: Record<FleetId, CargoShip>;
  players: Record<PlayerId, PlayerState>;
  allianceProposals: Record<PlayerId, PlayerId[]>;
  executions: Execution[]; // active
  status: "lobby" | "running" | "finished";
  winnerId: PlayerId | null;
}

interface TickUpdates {
  combats: CombatResult[];
  annexations: AnnexationResult[];
  researches: { playerId: PlayerId; techId: TechId }[];
  // …packed deltas for net
}

/** Pure: apply one turn’s new execs + advance one tick. */
function executeNextTick(
  state: GameState,
  turn: Turn,
  config: SimConfig,
): { state: GameState; updates: TickUpdates };
```

Replay = fold `executeNextTick` over archived `Turn[]` from turn 0.

---

## Combat / annexation results

```ts
interface CombatResult {
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

interface AnnexationResult {
  nodeId: NodeId;
  attackerId: PlayerId;
  previousOwnerId: PlayerId | null;
  success: boolean;
  garrison: number;
  populationCommitted: number;
  levelRetained: number;
}
```

---

## Player view (server filter)

```ts
interface PlayerView {
  tick: Tick;
  turnNumber: TurnNumber;
  visibleNodes: NodeId[];
  nodes: Record<NodeId, NodeState | { id: NodeId; fogged: true }>;
  fleets: Record<FleetId, Fleet>;
  self: PlayerState;
  scores: Record<PlayerId, number>;
}
```

Allied shared vision = union of vision sets when filtering.  
`relic_scanning`: all `relic` nodes are treated as visible (role + owner) for that player regardless of hop distance.
