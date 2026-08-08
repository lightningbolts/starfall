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
