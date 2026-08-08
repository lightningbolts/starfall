import type { BalanceTable } from "./balance.js";
import type {
  FleetLocation,
  GameState,
  NodeId,
  PlayerId,
} from "./types.js";

/** Relay upgrade vision: +1 hop at L3 and again at L5 (from that relay only). */
export function relayVisionBonusHops(level: number): number {
  let bonus = 0;
  if (level >= 3) bonus += 1;
  if (level >= 5) bonus += 1;
  return bonus;
}

function empireVisionHops(
  playerId: PlayerId,
  state: GameState,
  balance: BalanceTable,
): number {
  const player = state.players[playerId];
  if (!player) return balance.visionBaseHops;
  let hops = balance.visionBaseHops;
  if (player.researched.has("survey_drones")) {
    hops += balance.surveyDronesBonusHops;
  }
  return hops;
}

/** BFS nodes within `maxHops` of `origins` (inclusive of origins at hop 0). */
export function nodesWithinHops(
  state: GameState,
  origins: Iterable<NodeId>,
  maxHops: number,
): Set<NodeId> {
  const visible = new Set<NodeId>();
  const queue: { id: NodeId; hops: number }[] = [];
  for (const id of origins) {
    if (!state.map.nodes[id]) continue;
    if (!visible.has(id)) {
      visible.add(id);
      queue.push({ id, hops: 0 });
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.hops >= maxHops) continue;
    const node = state.map.nodes[cur.id];
    if (!node) continue;
    for (const n of node.neighbors) {
      if (visible.has(n)) continue;
      visible.add(n);
      queue.push({ id: n, hops: cur.hops + 1 });
    }
  }
  return visible;
}

/** Vision set for a single player (no ally union). */
export function computePlayerVisionSet(
  state: GameState,
  playerId: PlayerId,
  balance: BalanceTable,
): Set<NodeId> {
  const visible = new Set<NodeId>();
  const owned: NodeId[] = [];
  for (const n of Object.values(state.nodes)) {
    if (n.ownerId === playerId) owned.push(n.id);
  }

  const empireHops = empireVisionHops(playerId, state, balance);
  for (const id of nodesWithinHops(state, owned, empireHops)) {
    visible.add(id);
  }

  // Relay L3/L5 bonus: +hops from that relay only (stacks with empire tech for that origin)
  for (const id of owned) {
    const gn = state.map.nodes[id];
    const ns = state.nodes[id];
    if (!gn || !ns || gn.role !== "relay") continue;
    const relayBonus = relayVisionBonusHops(ns.level);
    if (relayBonus <= 0) continue;
    const fromRelay = empireHops + relayBonus;
    for (const v of nodesWithinHops(state, [id], fromRelay)) {
      visible.add(v);
    }
  }

  const player = state.players[playerId];
  if (player?.researched.has("relic_scanning")) {
    for (const gn of Object.values(state.map.nodes)) {
      if (gn.role === "relic") visible.add(gn.id);
    }
  }

  return visible;
}

/** Allied shared vision = union of vision sets. */
export function computeVisibleNodes(
  state: GameState,
  playerId: PlayerId,
  balance: BalanceTable,
): Set<NodeId> {
  const player = state.players[playerId];
  if (!player) return new Set();

  const union = computePlayerVisionSet(state, playerId, balance);
  for (const allyId of player.allies) {
    if (!state.players[allyId]) continue;
    for (const id of computePlayerVisionSet(state, allyId, balance)) {
      union.add(id);
    }
  }
  return union;
}

export function isLocationVisible(
  location: FleetLocation,
  visible: Set<NodeId>,
): boolean {
  if (location.kind === "node") return visible.has(location.nodeId);
  return visible.has(location.from) || visible.has(location.to);
}
