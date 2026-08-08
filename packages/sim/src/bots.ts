import type { BalanceTable } from "./balance.js";
import {
  canResearch,
  effectiveGarrison,
  fleetPower,
  techCost,
  upgradeCost,
} from "./helpers.js";
import type {
  Fleet,
  GameState,
  Intent,
  NodeId,
  NodeRole,
  PlayerId,
  PlayerState,
  ShipType,
  StampedIntent,
  TechId,
} from "./types.js";

/**
 * Heuristic AI. Each brain runs a short pipeline every `cadence` ticks:
 * defend what is threatened, spend the economy, then push the best frontier
 * target it can actually take. Difficulty scales how often it thinks, how much
 * of its income it commits, and whether it bothers with tech at all.
 */
export type BotDifficulty = "easy" | "normal" | "hard";

/** Retained for older call sites; expansion-flavoured play is "normal". */
export type BotPolicy = BotDifficulty;

export interface BotBrain {
  playerId: PlayerId;
  clientId: string;
  policy: BotDifficulty;
  seq: number;
}

interface Tuning {
  /** Ticks between decision cycles. Slower bots react late. */
  cadence: number;
  /** Power multiple required over the defender before committing. */
  attackMargin: number;
  /** Fraction of credits the bot is willing to spend per cycle. */
  spendFraction: number;
  /** Bots below this tier never research. */
  researches: boolean;
  /** Bots below this tier ignore threats to their own systems. */
  defends: boolean;
  /** Max simultaneous offensive pushes. */
  maxPushes: number;
}

const TUNING: Record<BotDifficulty, Tuning> = {
  easy: {
    cadence: 55,
    attackMargin: 2.0,
    spendFraction: 0.45,
    researches: false,
    defends: false,
    maxPushes: 1,
  },
  normal: {
    cadence: 30,
    attackMargin: 1.35,
    spendFraction: 0.65,
    researches: true,
    defends: true,
    maxPushes: 2,
  },
  hard: {
    cadence: 12,
    attackMargin: 1.08,
    spendFraction: 0.9,
    researches: true,
    defends: true,
    maxPushes: 3,
  },
};

/** Cheap tier-1 utility first, then the unlocks that compound. */
const RESEARCH_ORDER: TechId[] = [
  "survey_drones",
  "advanced_propulsion",
  "fortified_colonies",
  "heavy_warships",
  "population_efficiency",
  "rapid_deployment",
  "lane_logistics",
  "orbital_shielding",
  "relic_scanning",
];

/** How much a bot wants to own each kind of system. */
const ROLE_VALUE: Record<NodeRole, number> = {
  relic: 100,
  resource: 70,
  shipyard: 60,
  core_world: 45,
  homeworld: 40,
  relay: 20,
};

function stamp(brain: BotBrain, intent: Intent): StampedIntent {
  const s: StampedIntent = {
    clientId: brain.clientId,
    sequence: brain.seq,
    intent,
  };
  brain.seq += 1;
  return s;
}

function roleOf(state: GameState, nodeId: NodeId): NodeRole {
  return state.map.nodes[nodeId]?.role ?? "relay";
}

function neighborsOf(state: GameState, nodeId: NodeId): NodeId[] {
  return state.map.nodes[nodeId]?.neighbors ?? [];
}

function isHostile(state: GameState, owner: PlayerId | null, me: PlayerId): boolean {
  if (owner === null || owner === me) return false;
  return !(state.players[me]?.allies ?? []).includes(owner);
}

/** Fleets standing on a node, or one hop out and inbound to it. */
function powerAt(
  state: GameState,
  nodeId: NodeId,
  balance: BalanceTable,
  match: (ownerId: PlayerId) => boolean,
  includeInbound = false,
): number {
  let total = 0;
  for (const f of Object.values(state.fleets)) {
    if (!match(f.ownerId)) continue;
    if (f.location.kind === "node") {
      if (f.location.nodeId === nodeId) total += fleetPower(f.composition, balance);
    } else if (includeInbound && f.location.to === nodeId) {
      total += fleetPower(f.composition, balance);
    }
  }
  return total;
}

/** Colonists needed to flip a system: its garrison plus one. */
function popToTake(
  state: GameState,
  nodeId: NodeId,
  balance: BalanceTable,
): number {
  const node = state.nodes[nodeId];
  if (!node) return Infinity;
  const owner = node.ownerId ? state.players[node.ownerId] : null;
  const garrison = effectiveGarrison(
    node,
    roleOf(state, nodeId),
    owner?.researched ?? null,
    balance,
  );
  return garrison + 1;
}

function idleFleetsAt(
  state: GameState,
  playerId: PlayerId,
  nodeId: NodeId,
): Fleet[] {
  return Object.values(state.fleets).filter(
    (f) =>
      f.ownerId === playerId &&
      f.location.kind === "node" &&
      f.location.nodeId === nodeId,
  );
}

/** Shortest lane route, restricted to systems the bot may traverse. */
function routeTo(
  state: GameState,
  from: NodeId,
  to: NodeId,
  passable: (nodeId: NodeId) => boolean,
): NodeId[] | null {
  if (from === to) return null;
  const prev = new Map<NodeId, NodeId>();
  const seen = new Set<NodeId>([from]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    for (const n of [...neighborsOf(state, cur)].sort()) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      if (n === to) {
        const path = [to];
        let step = to;
        while (step !== from) {
          step = prev.get(step)!;
          path.unshift(step);
        }
        return path;
      }
      if (passable(n)) queue.push(n);
    }
  }
  return null;
}

/** Best warship the player can afford and legally build here. */
function bestAffordableShip(
  player: PlayerState,
  role: NodeRole,
  budget: number,
  balance: BalanceTable,
): ShipType | null {
  const options: ShipType[] =
    role === "shipyard"
      ? ["battleship", "cruiser", "fighter"]
      : ["cruiser", "fighter"];
  for (const type of options) {
    const stats = balance.ships[type];
    if (stats.requiresTech && !player.researched.has(stats.requiresTech)) continue;
    if (stats.creditCost <= budget) return type;
  }
  return null;
}

function economyIntents(
  state: GameState,
  brain: BotBrain,
  balance: BalanceTable,
  tuning: Tuning,
  owned: NodeId[],
): StampedIntent[] {
  const out: StampedIntent[] = [];
  const player = state.players[brain.playerId]!;
  let budget = Math.floor(player.credits * tuning.spendFraction);

  const nextTech = tuning.researches
    ? (RESEARCH_ORDER.find((t) => canResearch(player, t)) ?? null)
    : null;
  const nextTechCost = nextTech ? techCost(nextTech, balance) : 0;

  if (nextTech && nextTechCost <= budget) {
    out.push(stamp(brain, { type: "ResearchTech", techId: nextTech }));
    budget -= nextTechCost;
  } else if (nextTech) {
    // Saving up: throttle everything else so the treasury can actually reach
    // the next unlock instead of leaking into fighters every cycle.
    budget = Math.floor(budget * 0.45);
  }

  // Upgrade the highest-yield system that is still cheap relative to income.
  const upgradable = owned
    .map((id) => ({
      id,
      role: roleOf(state, id),
      level: state.nodes[id]!.level,
    }))
    .filter((n) => n.role !== "relay")
    .map((n) => ({
      ...n,
      cost: upgradeCost(n.role, n.level, balance),
      value: ROLE_VALUE[n.role] / (n.level + 1),
    }))
    .filter((n) => n.cost <= budget)
    .sort((a, b) => b.value - a.value || a.cost - b.cost);
  const pick = upgradable[0];
  if (pick && pick.level < 4) {
    out.push(stamp(brain, { type: "UpgradeNode", nodeId: pick.id }));
    budget -= pick.cost;
  }

  // Production: shipyards first, then the homeworld.
  const yards = owned
    .filter((id) => roleOf(state, id) === "shipyard")
    .sort((a, b) => state.nodes[b]!.level - state.nodes[a]!.level);
  const sites = [...yards, ...(player.homeworldId ? [player.homeworldId] : [])];
  for (const site of sites) {
    if (budget < balance.ships.fighter.creditCost) break;
    if (state.nodes[site]?.ownerId !== brain.playerId) continue;
    if ((state.nodes[site]?.buildQueue.length ?? 0) >= 2) continue;
    const type = bestAffordableShip(player, roleOf(state, site), budget, balance);
    if (!type) continue;
    const unit = balance.ships[type].creditCost;
    const count = Math.max(1, Math.min(5, Math.floor(budget / unit)));
    out.push(
      stamp(brain, { type: "BuildShips", nodeId: site, shipType: type, count }),
    );
    budget -= unit * count;
  }

  return out;
}

function defenseIntents(
  state: GameState,
  brain: BotBrain,
  balance: BalanceTable,
  owned: NodeId[],
  committed: Set<string>,
): StampedIntent[] {
  const out: StampedIntent[] = [];
  const me = brain.playerId;
  const hostile = (o: PlayerId) => isHostile(state, o, me);

  const threatened = owned
    .map((id) => ({
      id,
      threat: powerAt(state, id, balance, hostile, true),
      defense: powerAt(state, id, balance, (o) => o === me),
    }))
    .filter((n) => n.threat > n.defense)
    .sort((a, b) => b.threat - b.defense - (a.threat - a.defense));

  const target = threatened[0];
  if (!target) return out;

  // Pull the closest spare fleet from a system that is not itself under threat.
  const donors = owned
    .filter((id) => id !== target.id)
    .filter((id) => powerAt(state, id, balance, hostile, true) === 0);
  let best: { fleet: Fleet; path: NodeId[] } | null = null;
  for (const donor of donors) {
    for (const fleet of idleFleetsAt(state, me, donor)) {
      if (committed.has(fleet.id)) continue;
      if (fleet.invasionPopulation) continue;
      const path = routeTo(
        state,
        donor,
        target.id,
        (n) => state.nodes[n]?.ownerId === me,
      );
      if (!path) continue;
      if (!best || path.length < best.path.length) best = { fleet, path };
    }
  }
  if (best) {
    committed.add(best.fleet.id);
    out.push(
      stamp(brain, {
        type: "MoveFleet",
        fleetId: best.fleet.id,
        path: best.path,
      }),
    );
  }
  return out;
}

interface Target {
  id: NodeId;
  staging: NodeId;
  score: number;
  defense: number;
  popNeeded: number;
}

function scoreTargets(
  state: GameState,
  brain: BotBrain,
  balance: BalanceTable,
  owned: NodeId[],
): Target[] {
  const me = brain.playerId;
  const ownedSet = new Set(owned);
  const seen = new Map<NodeId, Target>();

  for (const staging of owned) {
    for (const id of neighborsOf(state, staging)) {
      if (ownedSet.has(id)) continue;
      const node = state.nodes[id];
      if (!node) continue;
      if (node.ownerId !== null && !isHostile(state, node.ownerId, me)) continue;

      const role = roleOf(state, id);
      const defense = powerAt(state, id, balance, (o) => isHostile(state, o, me));
      const popNeeded = popToTake(state, id, balance);
      // Prefer valuable, weakly held systems that also open up more lanes.
      const reach = neighborsOf(state, id).length;
      const score =
        (ROLE_VALUE[role] + reach * 4) /
        (1 + popNeeded / 10 + defense / 40) *
        (node.ownerId === null ? 1.25 : 1);

      const prior = seen.get(id);
      if (!prior || score > prior.score) {
        seen.set(id, { id, staging, score, defense, popNeeded });
      }
    }
  }
  return [...seen.values()].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

/**
 * Only homeworlds and core worlds grow population, so conquest is a logistics
 * problem: concentrate guns on the frontier, clear defenders (raid if needed),
 * ferry colonists, flip. Earlier versions only launched from pop depots with a
 * *single* fleet — armies parked on the border never attacked and the map
 * froze into symmetric mega-stacks.
 */
function offenseIntents(
  state: GameState,
  brain: BotBrain,
  balance: BalanceTable,
  tuning: Tuning,
  owned: NodeId[],
  committed: Set<string>,
): StampedIntent[] {
  const out: StampedIntent[] = [];
  const me = brain.playerId;
  const mine = (n: NodeId) => state.nodes[n]?.ownerId === me;
  const targets = scoreTargets(state, brain, balance, owned);
  if (targets.length === 0) return out;
  let pushes = 0;

  const marginFor = (defense: number): number => {
    // Late game: slightly greedier so hard bots break stalemates.
    let m = tuning.attackMargin;
    if (brain.policy === "hard" && state.tick > 2500) m = Math.min(m, 1.02);
    if (defense <= 0) return 0;
    return m;
  };

  const canBeatPower = (power: number, target: Target): boolean => {
    if (target.defense <= 0) return true;
    return power >= target.defense * marginFor(target.defense);
  };

  // 1. Fleets already carrying colonists head for the best system they can flip.
  for (const fleet of Object.values(state.fleets)) {
    if (pushes >= tuning.maxPushes) break;
    if (fleet.ownerId !== me || committed.has(fleet.id)) continue;
    if (fleet.location.kind !== "node") continue;
    const carried = fleet.invasionPopulation ?? 0;
    if (carried <= 0) continue;
    const here = fleet.location.nodeId;
    // Count sibling idle fleets at the same node — they leave together.
    const local =
      fleetPower(fleet.composition, balance) +
      idleFleetsAt(state, me, here)
        .filter((f) => f.id !== fleet.id && !committed.has(f.id))
        .reduce((s, f) => s + fleetPower(f.composition, balance), 0);
    const reachable = targets
      .filter((t) => t.popNeeded <= carried && canBeatPower(local, t))
      .map((t) => ({ t, path: routeTo(state, here, t.id, mine) }))
      .filter((x): x is { t: Target; path: NodeId[] } => x.path !== null)
      .sort((a, b) => a.path.length - b.path.length || b.t.score - a.t.score);
    const go = reachable[0];
    if (!go) continue;
    // Send the colonist fleet and every other idle stack here.
    for (const f of idleFleetsAt(state, me, here)) {
      if (committed.has(f.id)) continue;
      if (fleetPower(f.composition, balance) <= 0 && !f.invasionPopulation)
        continue;
      committed.add(f.id);
      out.push(
        stamp(brain, {
          type: "MoveFleet",
          fleetId: f.id,
          path: go.path,
          ...(f.id !== fleet.id && !f.invasionPopulation
            ? { raidOnly: true }
            : {}),
        }),
      );
    }
    pushes += 1;
  }

  // 2. Frontier staging pushes — use the army already on the border.
  for (const target of targets) {
    if (pushes >= tuning.maxPushes) break;
    const staging = target.staging;
    const fleetsHere = idleFleetsAt(state, me, staging)
      .filter((f) => !committed.has(f.id))
      .sort(
        (a, b) =>
          fleetPower(b.composition, balance) -
          fleetPower(a.composition, balance),
      );
    const localPower = fleetsHere.reduce(
      (s, f) => s + fleetPower(f.composition, balance),
      0,
    );
    if (!canBeatPower(localPower, target)) continue;

    const path = routeTo(state, staging, target.id, mine);
    if (!path) continue;

    const stock = state.nodes[staging]!.population;
    const loaded = fleetsHere.find(
      (f) => (f.invasionPopulation ?? 0) >= target.popNeeded,
    );
    const canClaim =
      Boolean(loaded) ||
      (stock >= target.popNeeded && fleetsHere.length > 0);

    if (canClaim) {
      const carrier =
        loaded ??
        fleetsHere.find((f) => fleetPower(f.composition, balance) > 0) ??
        fleetsHere[0]!;
      if (!loaded && stock >= target.popNeeded) {
        out.push(
          stamp(brain, {
            type: "CommitInvasion",
            fleetId: carrier.id,
            population: target.popNeeded,
            fromNodeId: staging,
          }),
        );
      }
      for (const f of fleetsHere) {
        if (committed.has(f.id)) continue;
        committed.add(f.id);
        out.push(
          stamp(brain, {
            type: "MoveFleet",
            fleetId: f.id,
            path,
            ...(f.id !== carrier.id ? { raidOnly: true } : {}),
          }),
        );
      }
      pushes += 1;
      continue;
    }

    // Guns are ready but colonists aren't here — raid to break the deadlock,
    // and start a colonist ferry from a rear depot.
    if (target.defense > 0 && localPower > 0) {
      for (const f of fleetsHere) {
        if (committed.has(f.id)) continue;
        if (fleetPower(f.composition, balance) <= 0) continue;
        committed.add(f.id);
        out.push(
          stamp(brain, {
            type: "MoveFleet",
            fleetId: f.id,
            path,
            raidOnly: true,
          }),
        );
      }
      pushes += 1;
    }

    const depot = owned
      .filter(
        (id) =>
          id !== staging &&
          (state.nodes[id]!.population ?? 0) >= target.popNeeded,
      )
      .sort(
        (a, b) => state.nodes[b]!.population - state.nodes[a]!.population,
      )[0];
    if (depot) {
      const ferry =
        idleFleetsAt(state, me, depot).find(
          (f) => !committed.has(f.id) && !f.invasionPopulation,
        ) ?? null;
      if (ferry) {
        const ferryPath = routeTo(state, depot, target.id, mine);
        if (ferryPath) {
          committed.add(ferry.id);
          out.push(
            stamp(brain, {
              type: "CommitInvasion",
              fleetId: ferry.id,
              population: target.popNeeded,
              fromNodeId: depot,
            }),
          );
          out.push(
            stamp(brain, {
              type: "MoveFleet",
              fleetId: ferry.id,
              path: ferryPath,
            }),
          );
        }
      }
    }
  }

  // 3. Reinforce under-powered staging nodes (don't yank armies back to home).
  if (pushes === 0) {
    const focus = targets[0]!;
    const staging = focus.staging;
    const local = powerAt(state, staging, balance, (o) => o === me);
    if (!canBeatPower(local, focus)) {
      for (const id of owned) {
        if (id === staging) continue;
        const fleet = idleFleetsAt(state, me, id).find(
          (f) =>
            !committed.has(f.id) &&
            !f.invasionPopulation &&
            fleetPower(f.composition, balance) > 0,
        );
        if (!fleet) continue;
        const path = routeTo(state, id, staging, mine);
        if (!path) continue;
        committed.add(fleet.id);
        out.push(
          stamp(brain, { type: "MoveFleet", fleetId: fleet.id, path }),
        );
        break;
      }
    } else {
      // Staging is strong enough — ferry colonists from the richest depot.
      const depot = owned
        .filter((id) => (state.nodes[id]!.population ?? 0) > 0)
        .sort(
          (a, b) => state.nodes[b]!.population - state.nodes[a]!.population,
        )[0];
      if (depot && depot !== staging) {
        const ferry = idleFleetsAt(state, me, depot).find(
          (f) => !committed.has(f.id) && !f.invasionPopulation,
        );
        if (ferry && state.nodes[depot]!.population >= focus.popNeeded) {
          const path = routeTo(state, depot, focus.id, mine);
          if (path) {
            committed.add(ferry.id);
            out.push(
              stamp(brain, {
                type: "CommitInvasion",
                fleetId: ferry.id,
                population: focus.popNeeded,
                fromNodeId: depot,
              }),
            );
            out.push(
              stamp(brain, { type: "MoveFleet", fleetId: ferry.id, path }),
            );
          }
        } else {
          // No ferry on the depot — send the weakest rear fleet there to load.
          let weakest: { fleet: Fleet; path: NodeId[]; power: number } | null =
            null;
          for (const id of owned) {
            if (id === depot || id === staging) continue;
            for (const fleet of idleFleetsAt(state, me, id)) {
              if (committed.has(fleet.id) || fleet.invasionPopulation) continue;
              const p = fleetPower(fleet.composition, balance);
              if (p <= 0) continue;
              const path = routeTo(state, id, depot, mine);
              if (!path) continue;
              if (!weakest || p < weakest.power) {
                weakest = { fleet, path, power: p };
              }
            }
          }
          if (weakest) {
            committed.add(weakest.fleet.id);
            out.push(
              stamp(brain, {
                type: "MoveFleet",
                fleetId: weakest.fleet.id,
                path: weakest.path,
              }),
            );
          }
        }
      }
    }
  }

  return out;
}

/** Consolidate stragglers so power does not sit uselessly in the rear. */
function regroupIntents(
  state: GameState,
  brain: BotBrain,
  balance: BalanceTable,
  owned: NodeId[],
  committed: Set<string>,
): StampedIntent[] {
  const me = brain.playerId;
  const ownedSet = new Set(owned);
  const frontier = owned.filter((id) =>
    neighborsOf(state, id).some((n) => !ownedSet.has(n)),
  );
  if (frontier.length === 0) return [];

  // Prefer the frontier node facing the highest enemy power — that's where
  // the next fight will be.
  let bestFrontier = frontier[0]!;
  let bestThreat = -1;
  for (const id of frontier) {
    const threat = powerAt(
      state,
      // Look at hostile neighbours' power on adjacent enemy nodes.
      id,
      balance,
      (o) => isHostile(state, o, me),
      true,
    );
    // Also peek at neighbouring hostile systems.
    let border = threat;
    for (const n of neighborsOf(state, id)) {
      if (ownedSet.has(n)) continue;
      border += powerAt(state, n, balance, (o) => isHostile(state, o, me));
    }
    if (border > bestThreat) {
      bestThreat = border;
      bestFrontier = id;
    }
  }

  for (const id of owned) {
    if (frontier.includes(id)) continue;
    // Leave at least a token fleet on pop depots so offense can ferry colonists.
    const pop = state.nodes[id]!.population;
    const here = idleFleetsAt(state, me, id).filter(
      (f) => !committed.has(f.id) && fleetPower(f.composition, balance) > 0,
    );
    if (pop > 0 && here.length <= 1) continue;

    for (const fleet of here) {
      if (committed.has(fleet.id)) continue;
      if (fleet.invasionPopulation) continue;
      const path = routeTo(state, id, bestFrontier, (n) => ownedSet.has(n));
      if (path) {
        committed.add(fleet.id);
        return [stamp(brain, { type: "MoveFleet", fleetId: fleet.id, path })];
      }
    }
  }
  return [];
}

export function botIntents(
  state: GameState,
  brain: BotBrain,
  balance: BalanceTable,
): StampedIntent[] {
  const player = state.players[brain.playerId];
  if (!player || player.eliminated) return [];

  const tuning = TUNING[brain.policy] ?? TUNING.normal;
  // Stagger brains so they do not all act on the same tick.
  const phase = hashPhase(brain.playerId, tuning.cadence);
  if (state.tick % tuning.cadence !== phase) return [];

  const owned = Object.values(state.nodes)
    .filter((n) => n.ownerId === brain.playerId)
    .map((n) => n.id)
    .sort();
  if (owned.length === 0) return [];

  const committed = new Set<string>();
  const out: StampedIntent[] = [];
  out.push(...economyIntents(state, brain, balance, tuning, owned));
  if (tuning.defends) {
    out.push(...defenseIntents(state, brain, balance, owned, committed));
  }
  out.push(...offenseIntents(state, brain, balance, tuning, owned, committed));
  if (out.length === 0 || committed.size === 0) {
    out.push(...regroupIntents(state, brain, balance, owned, committed));
  }
  return out;
}

function hashPhase(playerId: PlayerId, cadence: number): number {
  let h = 0;
  for (let i = 0; i < playerId.length; i++) {
    h = (h * 31 + playerId.charCodeAt(i)) % 1_000_003;
  }
  return h % cadence;
}

/** Solo lobbies default soft — mostly easy with a rare normal. */
const DIFFICULTIES: BotDifficulty[] = [
  "easy",
  "easy",
  "easy",
  "normal",
  "easy",
  "easy",
  "easy",
];

/** Soft ladder for human-vs-AI; hard bots are opt-in via explicit policy. */
export function policyForBotIndex(i: number): BotDifficulty {
  return DIFFICULTIES[i % DIFFICULTIES.length]!;
}

export function resolveBotPolicy(
  i: number,
  override?: BotDifficulty | null,
): BotDifficulty {
  return override ?? policyForBotIndex(i);
}
