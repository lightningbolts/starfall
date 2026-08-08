import type { BalanceTable } from "./balance.js";
import type {
  CargoShip,
  ClientId,
  Fleet,
  FleetId,
  GameState,
  NodeId,
  NodeState,
  PlayerId,
  TechId,
  Tick,
  TurnNumber,
} from "./types.js";
import { computeVisibleNodes, isLocationVisible } from "./vision.js";

/** Last-known silhouette for explored-but-out-of-vision nodes. */
export interface LastKnownNode {
  id: NodeId;
  role: string;
  ownerId: PlayerId | null;
  level: number;
  fogged: true;
}

export interface VisionMemory {
  explored: Set<NodeId>;
  lastKnown: Record<NodeId, LastKnownNode>;
}

export function createVisionMemory(): VisionMemory {
  return { explored: new Set(), lastKnown: {} };
}

export type ViewNode = NodeState | LastKnownNode;

/** JSON-safe player snapshot for wire / client. */
export interface PlayerViewSelf {
  id: PlayerId;
  clientId: ClientId | null;
  displayName: string;
  credits: number;
  researched: TechId[];
  allies: PlayerId[];
  /** Incoming alliance proposals (from player ids). */
  allianceProposals: PlayerId[];
  eliminated: boolean;
  score: number;
  homeworldId: NodeId | null;
}

export interface PlayerView {
  tick: Tick;
  turnNumber: TurnNumber;
  visibleNodes: NodeId[];
  nodes: Record<NodeId, ViewNode>;
  fleets: Record<FleetId, Fleet>;
  cargoShips: Record<FleetId, CargoShip>;
  self: PlayerViewSelf;
  scores: Record<PlayerId, number>;
}

/** Sparse patch for TickUpdate bandwidth. */
export interface PlayerViewDelta {
  tick: Tick;
  turnNumber: TurnNumber;
  visibleNodes?: NodeId[];
  nodesUpsert?: Record<NodeId, ViewNode>;
  nodesRemove?: NodeId[];
  fleetsUpsert?: Record<FleetId, Fleet>;
  fleetsRemove?: FleetId[];
  cargoUpsert?: Record<FleetId, CargoShip>;
  cargoRemove?: FleetId[];
  self?: PlayerViewSelf;
  scores?: Record<PlayerId, number>;
}

function toLastKnown(
  state: GameState,
  nodeId: NodeId,
): LastKnownNode | null {
  const ns = state.nodes[nodeId];
  const gn = state.map.nodes[nodeId];
  if (!ns || !gn) return null;
  return {
    id: nodeId,
    role: gn.role,
    ownerId: ns.ownerId,
    level: ns.level,
    fogged: true,
  };
}

/** Update memory from current visibility, then build fogged player view. */
export function buildPlayerView(
  state: GameState,
  playerId: PlayerId,
  memory: VisionMemory,
  balance: BalanceTable,
): PlayerView {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`unknown player ${playerId}`);
  }

  const visible = computeVisibleNodes(state, playerId, balance);

  for (const id of visible) {
    memory.explored.add(id);
    const lk = toLastKnown(state, id);
    if (lk) memory.lastKnown[id] = lk;
  }

  const nodes: Record<NodeId, ViewNode> = {};
  for (const id of visible) {
    const ns = state.nodes[id];
    if (ns) {
      nodes[id] = {
        ...ns,
        buildQueue: ns.buildQueue.map((b) => ({ ...b })),
      };
    }
  }
  for (const id of memory.explored) {
    if (visible.has(id)) continue;
    const cached = memory.lastKnown[id];
    if (cached) nodes[id] = { ...cached };
  }

  const fleets: Record<FleetId, Fleet> = {};
  for (const f of Object.values(state.fleets)) {
    if (!isLocationVisible(f.location, visible)) continue;
    fleets[f.id] = {
      ...f,
      composition: { ...f.composition },
      location: { ...f.location },
    };
  }

  const cargoShips: Record<FleetId, CargoShip> = {};
  for (const c of Object.values(state.cargoShips)) {
    if (!isLocationVisible(c.location, visible)) continue;
    cargoShips[c.id] = {
      ...c,
      location: { ...c.location },
      path: [...c.path],
    };
  }

  const scores: Record<PlayerId, number> = {};
  for (const p of Object.values(state.players)) {
    scores[p.id] = p.score;
  }

  return {
    tick: state.tick,
    turnNumber: state.turnNumber,
    visibleNodes: [...visible],
    nodes,
    fleets,
    cargoShips,
    self: {
      id: player.id,
      clientId: player.clientId,
      displayName: player.displayName,
      credits: player.credits,
      researched: [...player.researched],
      allies: [...player.allies],
      allianceProposals: [...(state.allianceProposals[playerId] ?? [])],
      eliminated: player.eliminated,
      score: player.score,
      homeworldId: player.homeworldId,
    },
    scores,
  };
}

export function isFoggedNode(n: ViewNode): n is LastKnownNode {
  return "fogged" in n && n.fogged === true;
}

function shallowEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sortedIds(ids: string[]): string {
  return [...ids].sort().join("\0");
}

/** Diff two views into a sparse delta (for bandwidth). */
export function diffPlayerView(
  prev: PlayerView,
  next: PlayerView,
): PlayerViewDelta {
  const delta: PlayerViewDelta = {
    tick: next.tick,
    turnNumber: next.turnNumber,
  };

  if (sortedIds(prev.visibleNodes) !== sortedIds(next.visibleNodes)) {
    delta.visibleNodes = next.visibleNodes;
  }

  const nodesUpsert: Record<NodeId, ViewNode> = {};
  const nodesRemove: NodeId[] = [];
  for (const [id, n] of Object.entries(next.nodes)) {
    if (!shallowEqualJson(prev.nodes[id], n)) nodesUpsert[id] = n;
  }
  for (const id of Object.keys(prev.nodes)) {
    if (!(id in next.nodes)) nodesRemove.push(id);
  }
  if (Object.keys(nodesUpsert).length) delta.nodesUpsert = nodesUpsert;
  if (nodesRemove.length) delta.nodesRemove = nodesRemove;

  const fleetsUpsert: Record<FleetId, Fleet> = {};
  const fleetsRemove: FleetId[] = [];
  for (const [id, f] of Object.entries(next.fleets)) {
    if (!shallowEqualJson(prev.fleets[id], f)) fleetsUpsert[id] = f;
  }
  for (const id of Object.keys(prev.fleets)) {
    if (!(id in next.fleets)) fleetsRemove.push(id);
  }
  if (Object.keys(fleetsUpsert).length) delta.fleetsUpsert = fleetsUpsert;
  if (fleetsRemove.length) delta.fleetsRemove = fleetsRemove;

  const cargoUpsert: Record<FleetId, CargoShip> = {};
  const cargoRemove: FleetId[] = [];
  for (const [id, c] of Object.entries(next.cargoShips)) {
    if (!shallowEqualJson(prev.cargoShips[id], c)) cargoUpsert[id] = c;
  }
  for (const id of Object.keys(prev.cargoShips)) {
    if (!(id in next.cargoShips)) cargoRemove.push(id);
  }
  if (Object.keys(cargoUpsert).length) delta.cargoUpsert = cargoUpsert;
  if (cargoRemove.length) delta.cargoRemove = cargoRemove;

  if (!shallowEqualJson(prev.self, next.self)) delta.self = next.self;
  if (!shallowEqualJson(prev.scores, next.scores)) delta.scores = next.scores;

  return delta;
}

/** Apply a delta onto a previous view (mutates a shallow clone). */
export function applyPlayerViewDelta(
  prev: PlayerView,
  delta: PlayerViewDelta,
): PlayerView {
  const next: PlayerView = {
    tick: delta.tick,
    turnNumber: delta.turnNumber,
    visibleNodes: delta.visibleNodes ?? prev.visibleNodes,
    nodes: { ...prev.nodes },
    fleets: { ...prev.fleets },
    cargoShips: { ...prev.cargoShips },
    self: delta.self ?? prev.self,
    scores: delta.scores ?? prev.scores,
  };
  if (delta.nodesRemove) {
    for (const id of delta.nodesRemove) delete next.nodes[id];
  }
  if (delta.nodesUpsert) Object.assign(next.nodes, delta.nodesUpsert);
  if (delta.fleetsRemove) {
    for (const id of delta.fleetsRemove) delete next.fleets[id];
  }
  if (delta.fleetsUpsert) Object.assign(next.fleets, delta.fleetsUpsert);
  if (delta.cargoRemove) {
    for (const id of delta.cargoRemove) delete next.cargoShips[id];
  }
  if (delta.cargoUpsert) Object.assign(next.cargoShips, delta.cargoUpsert);
  return next;
}
