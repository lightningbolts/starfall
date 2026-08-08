import type {
  Fleet,
  GameState,
  Intent,
  NodeId,
  PlayerId,
  StampedIntent,
} from "./types.js";
import type { BalanceTable } from "./balance.js";
import { fleetPower } from "./helpers.js";

export type BotPolicy = "expand" | "garrison" | "attack";

export interface BotBrain {
  playerId: PlayerId;
  clientId: string;
  policy: BotPolicy;
  seq: number;
}

function ownedFleets(state: GameState, playerId: PlayerId): Fleet[] {
  return Object.values(state.fleets).filter((f) => f.ownerId === playerId);
}

function nodeFleet(
  state: GameState,
  playerId: PlayerId,
  nodeId: NodeId,
): Fleet | undefined {
  return ownedFleets(state, playerId).find(
    (f) => f.location.kind === "node" && f.location.nodeId === nodeId,
  );
}

function neighborsOf(state: GameState, nodeId: NodeId): NodeId[] {
  return state.map.nodes[nodeId]?.neighbors ?? [];
}

function isNeutral(state: GameState, nodeId: NodeId): boolean {
  return state.nodes[nodeId]?.ownerId === null;
}

function isEnemy(state: GameState, nodeId: NodeId, me: PlayerId): boolean {
  const o = state.nodes[nodeId]?.ownerId;
  return o !== null && o !== undefined && o !== me;
}

function degree(state: GameState, nodeId: NodeId): number {
  return state.map.nodes[nodeId]?.neighbors.length ?? 0;
}

function stamp(brain: BotBrain, intent: Intent): StampedIntent {
  const s: StampedIntent = {
    clientId: brain.clientId,
    sequence: brain.seq,
    intent,
  };
  brain.seq += 1;
  return s;
}

/** Expand: claim adjacent neutrals with invasion pop + escort. */
function expandIntents(
  state: GameState,
  brain: BotBrain,
  balance: BalanceTable,
): StampedIntent[] {
  const out: StampedIntent[] = [];
  const player = state.players[brain.playerId];
  if (!player) return out;

  for (const fleet of ownedFleets(state, brain.playerId)) {
    if (fleet.location.kind !== "node") continue;
    const here = fleet.location.nodeId;
    const neut = neighborsOf(state, here).find((n) => isNeutral(state, n));
    if (!neut) continue;

    const fromNode = state.nodes[here]!;
    const popNeeded = 16;
    if (
      (fleet.composition.fighter ?? 0) < 1 &&
      fromNode.population < popNeeded
    ) {
      continue;
    }

    if (!fleet.invasionPopulation || fleet.invasionPopulation < popNeeded) {
      if (fromNode.population >= popNeeded) {
        out.push(
          stamp(brain, {
            type: "CommitInvasion",
            fleetId: fleet.id,
            population: Math.min(popNeeded, fromNode.population),
            fromNodeId: here,
          }),
        );
      }
    }
    out.push(
      stamp(brain, {
        type: "MoveFleet",
        fleetId: fleet.id,
        path: [here, neut],
      }),
    );
    break;
  }

  if (player.credits >= 30 && player.homeworldId) {
    out.push(
      stamp(brain, {
        type: "BuildShips",
        nodeId: player.homeworldId,
        shipType: "fighter",
        count: 1,
      }),
    );
  }
  void balance;
  return out;
}

/** Garrison: park fleets on high-degree owned nodes; build. */
function garrisonIntents(state: GameState, brain: BotBrain): StampedIntent[] {
  const out: StampedIntent[] = [];
  const player = state.players[brain.playerId];
  if (!player) return out;

  const owned = Object.values(state.nodes).filter(
    (n) => n.ownerId === brain.playerId,
  );
  const chokepoint = [...owned].sort(
    (a, b) => degree(state, b.id) - degree(state, a.id),
  )[0];

  for (const fleet of ownedFleets(state, brain.playerId)) {
    if (fleet.location.kind !== "node" || !chokepoint) continue;
    if (fleet.location.nodeId === chokepoint.id) continue;
    const here = fleet.location.nodeId;
    const next = neighborsOf(state, here).find((n) => {
      return state.nodes[n]?.ownerId === brain.playerId || n === chokepoint.id;
    });
    if (next) {
      out.push(
        stamp(brain, {
          type: "MoveFleet",
          fleetId: fleet.id,
          path: [here, next],
        }),
      );
      break;
    }
  }

  if (player.credits >= 20 && player.homeworldId) {
    out.push(
      stamp(brain, {
        type: "BuildShips",
        nodeId: player.homeworldId,
        shipType: "fighter",
        count: 1,
      }),
    );
  }
  return out;
}

/** Attack: mass move toward weakest adjacent enemy. */
function attackIntents(
  state: GameState,
  brain: BotBrain,
  balance: BalanceTable,
): StampedIntent[] {
  const out: StampedIntent[] = [];
  const player = state.players[brain.playerId];
  if (!player) return out;

  let bestTarget: NodeId | null = null;
  let bestScore = Infinity;
  for (const node of Object.values(state.nodes)) {
    if (!isEnemy(state, node.id, brain.playerId)) continue;
    const adj = neighborsOf(state, node.id).some(
      (n) => state.nodes[n]?.ownerId === brain.playerId,
    );
    if (!adj) continue;
    const defPower = Object.values(state.fleets)
      .filter(
        (f) =>
          f.ownerId === node.ownerId &&
          f.location.kind === "node" &&
          f.location.nodeId === node.id,
      )
      .reduce((s, f) => s + fleetPower(f.composition, balance), 0);
    if (defPower < bestScore) {
      bestScore = defPower;
      bestTarget = node.id;
    }
  }

  if (bestTarget) {
    const staging = neighborsOf(state, bestTarget).find(
      (n) => state.nodes[n]?.ownerId === brain.playerId,
    );
    if (staging) {
      const fleet = nodeFleet(state, brain.playerId, staging);
      if (fleet) {
        const pop = Math.min(30, state.nodes[staging]!.population);
        if (pop > 15) {
          out.push(
            stamp(brain, {
              type: "CommitInvasion",
              fleetId: fleet.id,
              population: pop,
              fromNodeId: staging,
            }),
          );
        }
        out.push(
          stamp(brain, {
            type: "MoveFleet",
            fleetId: fleet.id,
            path: [staging, bestTarget],
          }),
        );
      }
    }
  }

  if (out.length === 0) return expandIntents(state, brain, balance);

  if (player.credits >= 40 && player.homeworldId) {
    out.push(
      stamp(brain, {
        type: "BuildShips",
        nodeId: player.homeworldId,
        shipType: "fighter",
        count: 2,
      }),
    );
  }
  return out;
}

export function botIntents(
  state: GameState,
  brain: BotBrain,
  balance: BalanceTable,
): StampedIntent[] {
  if (state.players[brain.playerId]?.eliminated) return [];
  switch (brain.policy) {
    case "expand":
      return expandIntents(state, brain, balance);
    case "garrison":
      return garrisonIntents(state, brain);
    case "attack":
      return attackIntents(state, brain, balance);
  }
}

const POLICIES: BotPolicy[] = ["expand", "garrison", "attack"];

export function policyForBotIndex(i: number): BotPolicy {
  return POLICIES[i % POLICIES.length]!;
}
