import type { Execution, Game } from "./game.js";
import {
  addComposition,
  cargoTicksPerHop,
  compositionShipCount,
  effectiveGarrison,
  fleetPower,
  isEmptyComposition,
  scaleByLevel,
} from "./helpers.js";
import { resolveMultiSideCombat, type SidePower } from "./combat.js";
import type {
  AnnexationResult,
  CargoShip,
  Fleet,
  FleetComposition,
  FleetId,
  NodeId,
  PlayerId,
} from "./types.js";
import { computeScores, checkWin } from "./score.js";

function shortestPath(
  game: Game,
  from: NodeId,
  to: NodeId,
): NodeId[] | null {
  if (from === to) return [from];
  const q: NodeId[] = [from];
  const prev = new Map<NodeId, NodeId | null>([[from, null]]);
  while (q.length) {
    const cur = q.shift()!;
    const gn = game.state.map.nodes[cur];
    if (!gn) continue;
    for (const n of gn.neighbors) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      if (n === to) {
        const path: NodeId[] = [];
        let x: NodeId | null = to;
        while (x) {
          path.push(x);
          x = prev.get(x) ?? null;
        }
        path.reverse();
        return path;
      }
      q.push(n);
    }
  }
  return null;
}

function cargoSink(game: Game, playerId: PlayerId): NodeId | null {
  const player = game.state.players[playerId];
  if (!player) return null;
  if (player.homeworldId) {
    const hw = game.state.nodes[player.homeworldId];
    if (hw?.ownerId === playerId) return player.homeworldId;
  }
  // Oldest still-owned node
  const owned = Object.values(game.state.nodes)
    .filter((n) => n.ownerId === playerId)
    .sort((a, b) => {
      if (a.ownedSinceTick !== b.ownedSinceTick) {
        return a.ownedSinceTick - b.ownedSinceTick;
      }
      return a.id < b.id ? -1 : 1;
    });
  return owned[0]?.id ?? null;
}

export class EconomyExecution implements Execution {
  readonly id = "economy_ongoing";
  private active = true;
  init(_game: Game, _tick: number): void {}
  tick(game: Game): void {
    // Pulse every 10 ticks (at tick 10, 20, ...). tick is 1-indexed after increment.
    if (game.state.tick % 10 !== 0) {
      this.advanceCargo(game);
      return;
    }
    for (const node of Object.values(game.state.nodes)) {
      if (!node.ownerId) continue;
      const player = game.state.players[node.ownerId];
      const gnode = game.state.map.nodes[node.id];
      if (!player || !gnode) continue;
      const role = gnode.role;
      const rb = game.balance.roles[role];

      // Credits — level factors are exponential growth−1 (soft curve).
      if (rb.incomeMode === "bank" && rb.creditsPerPulse > 0) {
        player.credits += scaleByLevel(
          rb.creditsPerPulse,
          node.level,
          rb.creditLevelFactor,
        );
      } else if (rb.incomeMode === "cargo" && rb.creditsPerPulse > 0) {
        const cargo = scaleByLevel(
          rb.creditsPerPulse,
          node.level,
          rb.cargoLevelFactor,
        );
        node.cargoStockpile += cargo;
        // Launch cargo ships
        while (node.cargoStockpile >= game.balance.cargoLaunchThreshold) {
          node.cargoStockpile -= game.balance.cargoLaunchThreshold;
          this.launchCargo(game, node.ownerId, node.id, game.balance.cargoLaunchThreshold);
        }
      }

      // Population
      if (rb.populationPerPulse > 0) {
        let pop = scaleByLevel(
          rb.populationPerPulse,
          node.level,
          rb.popLevelFactor,
        );
        if (role === "core_world" && player.researched.has("population_efficiency")) {
          pop = Math.max(
            pop,
            Math.round(pop * game.balance.tech.population_efficiency.corePopFactor),
          );
        }
        let cap = rb.populationCap;
        if (cap > 0 && rb.popCapLevelFactor > 0) {
          cap = scaleByLevel(cap, node.level, rb.popCapLevelFactor);
        }
        node.population = Math.min(cap || Infinity, node.population + pop);
      }
    }
    this.advanceCargo(game);
  }

  private launchCargo(
    game: Game,
    ownerId: PlayerId,
    fromNodeId: NodeId,
    credits: number,
  ): void {
    const sink = cargoSink(game, ownerId);
    const player = game.state.players[ownerId];
    if (!sink || !player) {
      // No nodes — become derelict at node (owner kept for loot attribution; still lootable)
      const id = game.nextFleetId("c");
      game.addCargo({
        id,
        ownerId,
        cargoCredits: credits,
        location: { kind: "node", nodeId: fromNodeId },
        path: [],
      });
      return;
    }
    if (sink === fromNodeId) {
      player.credits += credits;
      return;
    }
    const path = shortestPath(game, fromNodeId, sink);
    if (!path || path.length < 2) {
      player.credits += credits;
      return;
    }
    const ticks = cargoTicksPerHop(player.researched, game.balance);
    const id = game.nextFleetId("c");
    const ship: CargoShip = {
      id,
      ownerId,
      cargoCredits: credits,
      location: {
        kind: "transit",
        from: path[0]!,
        to: path[1]!,
        ticksRemaining: ticks,
        hopTotalTicks: ticks,
      },
      path: path.slice(1),
    };
    game.addCargo(ship);
  }

  private advanceCargo(game: Game): void {
    for (const ship of Object.values(game.state.cargoShips)) {
      if (ship.location.kind === "node") {
        // Derelict or waiting — try repath if owner has sink
        const sink = cargoSink(game, ship.ownerId);
        if (!sink) continue;
        if (ship.location.nodeId === sink) {
          const p = game.state.players[ship.ownerId];
          if (p) p.credits += ship.cargoCredits;
          game.removeCargo(ship.id);
          continue;
        }
        const path = shortestPath(game, ship.location.nodeId, sink);
        if (!path || path.length < 2) continue;
        const player = game.state.players[ship.ownerId];
        const ticks = cargoTicksPerHop(
          player?.researched ?? new Set(),
          game.balance,
        );
        ship.path = path.slice(1);
        ship.location = {
          kind: "transit",
          from: path[0]!,
          to: path[1]!,
          ticksRemaining: ticks,
          hopTotalTicks: ticks,
        };
        continue;
      }

      ship.location.ticksRemaining -= 1;
      if (ship.location.ticksRemaining > 0) continue;

      const arrived = ship.location.to;
      if (ship.path[0] === arrived) ship.path.shift();
      else {
        const idx = ship.path.indexOf(arrived);
        if (idx >= 0) ship.path = ship.path.slice(idx + 1);
      }

      const sink = cargoSink(game, ship.ownerId);
      if (sink && arrived === sink) {
        const p = game.state.players[ship.ownerId];
        if (p) p.credits += ship.cargoCredits;
        game.removeCargo(ship.id);
        continue;
      }

      // Continue toward sink
      const player = game.state.players[ship.ownerId];
      if (ship.path.length === 0 && sink && arrived !== sink) {
        const path = shortestPath(game, arrived, sink);
        if (path && path.length >= 2) ship.path = path.slice(1);
      }

      if (ship.path.length === 0) {
        ship.location = { kind: "node", nodeId: arrived };
        if (sink && arrived === sink) {
          const p = game.state.players[ship.ownerId];
          if (p) p.credits += ship.cargoCredits;
          game.removeCargo(ship.id);
        }
        continue;
      }

      const next = ship.path[0]!;
      const ticks = cargoTicksPerHop(
        player?.researched ?? new Set(),
        game.balance,
      );
      ship.location = {
        kind: "transit",
        from: arrived,
        to: next,
        ticksRemaining: ticks,
        hopTotalTicks: ticks,
      };
    }
  }

  isActive(): boolean {
    return this.active;
  }
}

export class WinCheckExecution implements Execution {
  readonly id = "win_ongoing";
  private active = true;
  init(_game: Game, _tick: number): void {}
  tick(game: Game): void {
    computeScores(game);
    checkWin(game);
  }
  isActive(): boolean {
    return this.active;
  }
}

/** Merge same-owner fleets at nodes, resolve combat, loot cargo, annexation. */
export function runContactAndAnnexation(game: Game): void {
  mergeFleetsAtNodes(game);
  resolveNodeCombats(game);
  resolveLaneCombats(game);
  lootCargo(game);
  runAnnexations(game);
}

function mergeFleetsAtNodes(game: Game): void {
  const byKey = new Map<string, Fleet[]>();
  for (const f of Object.values(game.state.fleets)) {
    if (f.location.kind !== "node") continue;
    const key = `${f.ownerId}|${f.location.nodeId}`;
    const list = byKey.get(key) ?? [];
    list.push(f);
    byKey.set(key, list);
  }
  for (const fleets of byKey.values()) {
    if (fleets.length < 2) continue;
    // Keep lowest id as survivor
    fleets.sort((a, b) => (a.id < b.id ? -1 : 1));
    const primary = fleets[0]!;
    for (let i = 1; i < fleets.length; i++) {
      const other = fleets[i]!;
      primary.composition = addComposition(
        primary.composition,
        other.composition,
      );
      primary.invasionPopulation =
        (primary.invasionPopulation ?? 0) + (other.invasionPopulation ?? 0);
      if (primary.invasionPopulation === 0) {
        primary.invasionPopulation = undefined;
      }
      // Cancel moves on absorbed fleets
      game.removeFleet(other.id);
    }
  }
}

function fleetsAtNode(game: Game, nodeId: NodeId): Fleet[] {
  return Object.values(game.state.fleets).filter(
    (f) => f.location.kind === "node" && f.location.nodeId === nodeId,
  );
}

type CombatLocation =
  | { kind: "node"; nodeId: NodeId }
  | { kind: "lane"; from: NodeId; to: NodeId };

/**
 * Armed fleets fight. Colonist-only fleets carry no guns but are still present
 * and interdictable — excluding them made colonist runs untouchable in transit.
 */
function combatCandidates(fleets: Fleet[]): Fleet[] {
  return fleets.filter(
    (f) => !isEmptyComposition(f.composition) || (f.invasionPopulation ?? 0) > 0,
  );
}

function resolveEngagement(
  game: Game,
  fleets: Fleet[],
  location: CombatLocation,
): void {
  const engaged = combatCandidates(fleets);
  if (engaged.length < 2) return;
  const sides = groupSides(game, engaged);
  // With fewer than two armed sides there is no Lanchester exchange, but any
  // unescorted colonists facing a hostile survivor are still run down.
  let survivors = sides;
  if (sides.length >= 2) {
    const res = resolveMultiSideCombat(sides, game.balance, (a, b) =>
      game.areAllied(a, b),
    );
    survivors = res.survivors;
    for (const r of res.results) {
      game.updates.combats.push({
        location,
        winnerId: r.winnerId,
        loserId: r.loserId,
        winnerPowerBefore: r.winnerPowerBefore,
        loserPowerBefore: r.loserPowerBefore,
        winnerPowerRemaining: r.winnerPowerRemaining,
        winnerCompositionBefore: r.winnerCompositionBefore,
        loserCompositionBefore: r.loserCompositionBefore,
        winnerCompositionAfter: r.winnerCompositionAfter,
        loserCompositionAfter: r.loserCompositionAfter,
      });
    }
  }
  applyCombatSurvivors(game, engaged, survivors);
}

function resolveNodeCombats(game: Game): void {
  const nodeIds = new Set<NodeId>();
  for (const f of Object.values(game.state.fleets)) {
    if (f.location.kind === "node") nodeIds.add(f.location.nodeId);
  }
  for (const nodeId of [...nodeIds].sort()) {
    resolveEngagement(game, fleetsAtNode(game, nodeId), {
      kind: "node",
      nodeId,
    });
  }
}

function resolveLaneCombats(game: Game): void {
  // Group by undirected lane
  const byLane = new Map<string, Fleet[]>();
  for (const f of Object.values(game.state.fleets)) {
    if (f.location.kind !== "transit") continue;
    const a = f.location.from;
    const b = f.location.to;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const list = byLane.get(key) ?? [];
    list.push(f);
    byLane.set(key, list);
  }
  for (const [key, fleets] of [...byLane.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  )) {
    const [from, to] = key.split(":") as [string, string];
    resolveEngagement(game, fleets, { kind: "lane", from, to });
  }
}

function groupSides(game: Game, fleets: Fleet[]): SidePower[] {
  const byOwner = new Map<PlayerId, FleetComposition>();
  for (const f of fleets) {
    byOwner.set(
      f.ownerId,
      addComposition(byOwner.get(f.ownerId) ?? {}, f.composition),
    );
  }
  const sides: SidePower[] = [];
  for (const [playerId, composition] of byOwner) {
    const power = fleetPower(composition, game.balance);
    if (power <= 0) continue;
    sides.push({ playerId, composition, power });
  }
  return sides;
}

function applyCombatSurvivors(
  game: Game,
  fleets: Fleet[],
  survivors: SidePower[],
): void {
  const survMap = new Map(survivors.map((s) => [s.playerId, s]));
  const byOwner = new Map<PlayerId, Fleet[]>();
  for (const f of fleets) {
    const list = byOwner.get(f.ownerId) ?? [];
    list.push(f);
    byOwner.set(f.ownerId, list);
  }
  for (const [ownerId, ownerFleets] of byOwner) {
    const surv = survMap.get(ownerId);
    ownerFleets.sort((a, b) => (a.id < b.id ? -1 : 1));
    if (!surv || surv.power <= 0 || isEmptyComposition(surv.composition)) {
      // No guns left here. Colonists only survive if no hostile did either —
      // otherwise the escort dying takes the transports with it.
      const hostileSurvivor = [...survMap.values()].some(
        (s) =>
          s.power > 0 &&
          s.playerId !== ownerId &&
          !game.areAllied(s.playerId, ownerId),
      );
      for (const f of ownerFleets) {
        if (!hostileSurvivor && (f.invasionPopulation ?? 0) > 0) {
          f.composition = {};
        } else {
          game.removeFleet(f.id);
        }
      }
      continue;
    }
    // Put all survivors on primary fleet; remove others (merge invasion pop)
    const primary = ownerFleets[0]!;
    primary.composition = surv.composition;
    for (let i = 1; i < ownerFleets.length; i++) {
      const o = ownerFleets[i]!;
      primary.invasionPopulation =
        (primary.invasionPopulation ?? 0) + (o.invasionPopulation ?? 0);
      game.removeFleet(o.id);
    }
    if (!primary.invasionPopulation) primary.invasionPopulation = undefined;
  }
}

function lootCargo(game: Game): void {
  // After combat: if cargo shares location with hostile power and no friendly power → loot
  for (const cargo of Object.values(game.state.cargoShips)) {
    const combatFleets = Object.values(game.state.fleets).filter((f) => {
      if (isEmptyComposition(f.composition)) return false;
      return sameLocation(f, cargo);
    });
    const friendly = combatFleets.some(
      (f) =>
        f.ownerId === cargo.ownerId || game.areAllied(f.ownerId, cargo.ownerId),
    );
    const hostile = combatFleets.filter(
      (f) =>
        f.ownerId !== cargo.ownerId && !game.areAllied(f.ownerId, cargo.ownerId),
    );
    if (hostile.length === 0) continue;
    if (friendly) continue;
    // Loot to strongest hostile (or first by id)
    hostile.sort((a, b) => {
      const pa = fleetPower(a.composition, game.balance);
      const pb = fleetPower(b.composition, game.balance);
      if (pb !== pa) return pb - pa;
      return a.ownerId < b.ownerId ? -1 : 1;
    });
    const looter = game.state.players[hostile[0]!.ownerId];
    if (looter) {
      looter.credits += Math.floor(
        cargo.cargoCredits * game.balance.cargoLootFraction,
      );
    }
    game.removeCargo(cargo.id);
  }

  // Mutual annihilation: combat with no winner and no combat fleets left → cargo lost
  for (const c of game.updates.combats) {
    if (c.winnerId !== null) continue;
    const cargos = Object.values(game.state.cargoShips).filter((ship) => {
      if (c.location.kind === "node") {
        return (
          ship.location.kind === "node" &&
          ship.location.nodeId === c.location.nodeId
        );
      }
      return (
        ship.location.kind === "transit" &&
        ((ship.location.from === c.location.from &&
          ship.location.to === c.location.to) ||
          (ship.location.from === c.location.to &&
            ship.location.to === c.location.from))
      );
    });
    for (const ship of cargos) {
      const anyCombat = Object.values(game.state.fleets).some(
        (f) => !isEmptyComposition(f.composition) && sameLocation(f, ship),
      );
      if (!anyCombat) game.removeCargo(ship.id);
    }
  }
}

function sameLocation(
  f: Fleet,
  cargo: CargoShip,
): boolean {
  if (f.location.kind === "node" && cargo.location.kind === "node") {
    return f.location.nodeId === cargo.location.nodeId;
  }
  if (f.location.kind === "transit" && cargo.location.kind === "transit") {
    const a1 = f.location.from;
    const a2 = f.location.to;
    const b1 = cargo.location.from;
    const b2 = cargo.location.to;
    return (a1 === b1 && a2 === b2) || (a1 === b2 && a2 === b1);
  }
  return false;
}

function runAnnexations(game: Game): void {
  // Fleets with invasion pop at a node, after combat
  const candidates = Object.values(game.state.fleets).filter(
    (f) =>
      f.location.kind === "node" &&
      f.invasionPopulation !== undefined &&
      f.invasionPopulation > 0,
  );
  // Stable order by fleet id
  candidates.sort((a, b) => (a.id < b.id ? -1 : 1));

  for (const fleet of candidates) {
    if (fleet.location.kind !== "node") continue;
    const nodeId = fleet.location.nodeId;
    const node = game.state.nodes[nodeId];
    const gnode = game.state.map.nodes[nodeId];
    if (!node || !gnode) continue;

    // Only attempt if no defending enemy fleet remains
    const hostiles = fleetsAtNode(game, nodeId).filter(
      (f) =>
        f.id !== fleet.id &&
        f.ownerId !== fleet.ownerId &&
        !game.areAllied(f.ownerId, fleet.ownerId) &&
        !isEmptyComposition(f.composition),
    );
    if (hostiles.length > 0) continue;

    // rulings.md §3: colonists ride along until the fleet reaches a system it
    // does not own. Sitting on friendly ground must not disembark them, or
    // loading and then moving on a later tick is impossible.
    if (node.ownerId === fleet.ownerId) continue;

    const pop = fleet.invasionPopulation ?? 0;
    const ownerResearched =
      node.ownerId && game.state.players[node.ownerId]
        ? game.state.players[node.ownerId]!.researched
        : null;
    const garrison = effectiveGarrison(
      node,
      gnode.role,
      ownerResearched,
      game.balance,
    );

    const enemyOwned = node.ownerId !== null;
    const escortShips = compositionShipCount(fleet.composition);
    const escortOk = !enemyOwned || escortShips >= 1;

    const result: AnnexationResult = {
      nodeId,
      attackerId: fleet.ownerId,
      previousOwnerId: node.ownerId,
      success: false,
      garrison,
      populationCommitted: pop,
      levelRetained: node.level,
    };

    if (escortOk && pop > garrison) {
      const prev = node.ownerId;
      node.ownerId = fleet.ownerId;
      node.ownedSinceTick = game.state.tick;
      node.population = 0;
      node.buildQueue = [];
      // Level retained
      result.success = true;

      if (prev) {
        const prevPlayer = game.state.players[prev];
        if (prevPlayer?.homeworldId === nodeId) {
          // homeworld lost — keep id for sink fallback logic
        }
        // Check elimination
        const stillOwns = Object.values(game.state.nodes).some(
          (n) => n.ownerId === prev,
        );
        if (!stillOwns && prevPlayer && !prevPlayer.eliminated) {
          prevPlayer.eliminated = true;
          const attacker = game.state.players[fleet.ownerId];
          if (attacker) {
            attacker.bonusScore += game.balance.score.eliminationBonus;
          }
        }
      }
    }
    // Pop always consumed on check
    fleet.invasionPopulation = undefined;
    game.updates.annexations.push(result);
  }
}
