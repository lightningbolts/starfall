import type { Execution, Game } from "../game.js";
import {
  addComposition,
  buildTicksRequired,
  canBuildBattleship,
  canResearch,
  cargoTicksPerHop,
  compositionShipCount,
  effectiveGarrison,
  effectiveTicksPerHop,
  isEmptyComposition,
  subtractComposition,
  techCost,
  upgradeCost,
} from "../helpers.js";
import type {
  Fleet,
  FleetComposition,
  FleetId,
  Intent,
  NodeId,
  PlayerId,
  ShipType,
  StampedIntent,
  TechId,
  Turn,
} from "../types.js";
import { SHIP_TYPES } from "../types.js";

let execSeq = 0;
function nextExecId(kind: string): string {
  execSeq += 1;
  return `${kind}_${execSeq}`;
}

/** BFS outward from `origin` for the closest system owned by `playerId`. */
function nearestOwnedNode(
  game: Game,
  playerId: PlayerId,
  origin: NodeId,
): NodeId | null {
  const nodes = game.state.nodes;
  const map = game.state.map.nodes;
  if (nodes[origin]?.ownerId === playerId) return origin;
  const seen = new Set<NodeId>([origin]);
  const queue: NodeId[] = [origin];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    // Sorted so ties between equidistant systems resolve deterministically.
    const neighbors = [...(map[cur]?.neighbors ?? [])].sort();
    for (const n of neighbors) {
      if (seen.has(n)) continue;
      seen.add(n);
      if (nodes[n]?.ownerId === playerId) return n;
      queue.push(n);
    }
  }
  return null;
}

export class NoOpExecution implements Execution {
  readonly id = nextExecId("noop");
  private active = true;
  init(): void {
    this.active = false;
  }
  tick(): void {}
  isActive(): boolean {
    return this.active;
  }
}

export class UpgradeNodeExecution implements Execution {
  readonly id = nextExecId("upgrade");
  private active = true;
  constructor(
    private readonly playerId: PlayerId,
    private readonly nodeId: NodeId,
  ) {}
  init(game: Game): void {
    const node = game.state.nodes[this.nodeId];
    const player = game.state.players[this.playerId];
    const gnode = game.state.map.nodes[this.nodeId];
    if (!node || !player || !gnode || node.ownerId !== this.playerId) {
      this.active = false;
      return;
    }
    const cost = upgradeCost(gnode.role, node.level, game.balance);
    if (player.credits < cost) {
      this.active = false;
      return;
    }
    player.credits -= cost;
    node.level += 1;
    this.active = false;
  }
  tick(): void {}
  isActive(): boolean {
    return this.active;
  }
}

export class ResearchExecution implements Execution {
  readonly id = nextExecId("research");
  private active = true;
  constructor(
    private readonly playerId: PlayerId,
    private readonly techId: TechId,
  ) {}
  init(game: Game): void {
    const player = game.state.players[this.playerId];
    if (!player || !canResearch(player, this.techId)) {
      this.active = false;
      return;
    }
    const cost = techCost(this.techId, game.balance);
    if (player.credits < cost) {
      this.active = false;
      return;
    }
    player.credits -= cost;
    player.researched.add(this.techId);
    game.updates.researches.push({
      playerId: this.playerId,
      techId: this.techId,
    });
    this.active = false;
  }
  tick(): void {}
  isActive(): boolean {
    return this.active;
  }
}

export class BuildShipsExecution implements Execution {
  readonly id = nextExecId("build");
  private active = true;
  constructor(
    private readonly playerId: PlayerId,
    private readonly nodeId: NodeId,
    private readonly shipType: ShipType,
    private readonly count: number,
  ) {}
  init(game: Game): void {
    const node = game.state.nodes[this.nodeId];
    const player = game.state.players[this.playerId];
    const gnode = game.state.map.nodes[this.nodeId];
    if (
      !node ||
      !player ||
      !gnode ||
      node.ownerId !== this.playerId ||
      this.count <= 0
    ) {
      this.active = false;
      return;
    }
    const role = gnode.role;
    if (role === "homeworld") {
      if (this.shipType !== "fighter") {
        this.active = false;
        return;
      }
    } else if (role === "shipyard") {
      if (this.shipType === "battleship" && !canBuildBattleship(player)) {
        this.active = false;
        return;
      }
    } else {
      this.active = false;
      return;
    }
    const unitCost = game.balance.ships[this.shipType].creditCost;
    const total = unitCost * this.count;
    if (player.credits < total) {
      this.active = false;
      return;
    }
    player.credits -= total;
    const ticksRequired = buildTicksRequired(
      this.shipType,
      role,
      node.level,
      player.researched,
      game.balance,
    );
    node.buildQueue.push({
      shipType: this.shipType,
      count: this.count,
      progressTicks: 0,
      ticksRequired,
    });
    this.active = false;
  }
  tick(): void {}
  isActive(): boolean {
    return this.active;
  }
}

export class MoveFleetExecution implements Execution {
  readonly id: string;
  private active = true;
  private path: NodeId[];
  private hopTicks = 0;
  private hopTotal = 0;

  constructor(
    private readonly playerId: PlayerId,
    private fleetId: FleetId,
    path: NodeId[],
    private readonly splitComposition?: FleetComposition,
  ) {
    this.id = nextExecId("move");
    this.path = [...path];
  }

  init(game: Game): void {
    // Cancel any prior move on this fleet
    const prior = game.moveByFleet.get(this.fleetId);
    if (prior) {
      const old = game.executions.find((e) => e.id === prior);
      if (old && old instanceof MoveFleetExecution) {
        old.forceCancel(game, false);
      }
    }

    let fleet = game.state.fleets[this.fleetId];
    const player = game.state.players[this.playerId];
    if (!fleet || !player || fleet.ownerId !== this.playerId || this.path.length < 2) {
      this.active = false;
      return;
    }
    if (fleet.location.kind !== "node") {
      this.active = false;
      return;
    }

    // Validate path adjacency
    for (let i = 0; i < this.path.length - 1; i++) {
      const a = this.path[i]!;
      const b = this.path[i + 1]!;
      const gn = game.state.map.nodes[a];
      if (!gn || !gn.neighbors.includes(b)) {
        this.active = false;
        return;
      }
    }
    if (fleet.location.nodeId !== this.path[0]) {
      this.active = false;
      return;
    }

    let movingComp = fleet.composition;
    if (this.splitComposition) {
      const rem = subtractComposition(fleet.composition, this.splitComposition);
      if (!rem) {
        this.active = false;
        return;
      }
      if (isEmptyComposition(this.splitComposition)) {
        this.active = false;
        return;
      }
      // Leave remainder at node; moving split gets new fleet id if remainder nonempty
      if (!isEmptyComposition(rem)) {
        const newId = game.nextFleetId();
        const moving: Fleet = {
          id: newId,
          ownerId: fleet.ownerId,
          composition: { ...this.splitComposition },
          location: { kind: "node", nodeId: fleet.location.nodeId },
          invasionPopulation: fleet.invasionPopulation,
        };
        fleet.composition = rem;
        fleet.invasionPopulation = undefined;
        game.addFleet(moving);
        this.fleetId = newId;
        fleet = moving;
        movingComp = moving.composition;
      } else {
        movingComp = this.splitComposition;
        fleet.composition = { ...this.splitComposition };
      }
    }

    if (
      isEmptyComposition(movingComp) &&
      !(fleet.invasionPopulation && fleet.invasionPopulation > 0)
    ) {
      this.active = false;
      return;
    }

    game.moveByFleet.set(this.fleetId, this.id);
    this.startNextHop(game, fleet);
  }

  private startNextHop(game: Game, fleet: Fleet): void {
    if (this.path.length < 2) {
      this.active = false;
      game.moveByFleet.delete(this.fleetId);
      return;
    }
    const from = this.path[0]!;
    const to = this.path[1]!;
    const player = game.state.players[fleet.ownerId];
    const hops = effectiveTicksPerHop(
      fleet.composition,
      player?.researched ?? new Set(),
      game.balance,
    );
    // Empty pop-only fleets move at fighter speed
    const ticks =
      isEmptyComposition(fleet.composition)
        ? game.balance.ships.fighter.ticksPerHop
        : hops;
    this.hopTotal = ticks;
    this.hopTicks = ticks;
    fleet.location = {
      kind: "transit",
      from,
      to,
      ticksRemaining: ticks,
      hopTotalTicks: ticks,
    };
  }

  tick(game: Game): void {
    if (!this.active) return;
    const fleet = game.state.fleets[this.fleetId];
    if (!fleet || fleet.location.kind !== "transit") {
      this.active = false;
      game.moveByFleet.delete(this.fleetId);
      return;
    }
    fleet.location.ticksRemaining -= 1;
    this.hopTicks = fleet.location.ticksRemaining;
    if (fleet.location.ticksRemaining > 0) return;

    // Arrive at destination hop
    const arrived = fleet.location.to;
    fleet.location = { kind: "node", nodeId: arrived };
    this.path.shift();
    if (this.path.length < 2) {
      this.path = [arrived];
      this.active = false;
      game.moveByFleet.delete(this.fleetId);
      return;
    }
    this.path[0] = arrived;
    this.startNextHop(game, fleet);
  }

  /** Cancel mid-transit: nearer endpoint rule; arrive next tick. */
  forceCancel(game: Game, _placeNow: boolean): void {
    if (!this.active) return;
    const fleet = game.state.fleets[this.fleetId];
    if (fleet && fleet.location.kind === "transit") {
      const half = fleet.location.hopTotalTicks / 2;
      const dest =
        fleet.location.ticksRemaining <= half
          ? fleet.location.to
          : fleet.location.from;
      // Redirect remaining path to single hop finishing next tick
      this.path = [dest === fleet.location.to ? fleet.location.from : fleet.location.to, dest];
      if (dest === fleet.location.to) {
        fleet.location.ticksRemaining = 1;
      } else {
        fleet.location = {
          kind: "transit",
          from: fleet.location.to,
          to: fleet.location.from,
          ticksRemaining: 1,
          hopTotalTicks: fleet.location.hopTotalTicks,
        };
      }
      this.hopTicks = 1;
      // Stay active one more tick so arrival resolves
      return;
    }
    this.active = false;
    game.moveByFleet.delete(this.fleetId);
  }

  isActive(): boolean {
    return this.active;
  }
}

export class CancelMoveExecution implements Execution {
  readonly id = nextExecId("cancelMove");
  private active = true;
  constructor(
    private readonly playerId: PlayerId,
    private readonly fleetId: FleetId,
  ) {}
  init(game: Game): void {
    const fleet = game.state.fleets[this.fleetId];
    if (!fleet || fleet.ownerId !== this.playerId) {
      this.active = false;
      return;
    }
    const moveId = game.moveByFleet.get(this.fleetId);
    if (moveId) {
      const ex = game.executions.find((e) => e.id === moveId);
      if (ex instanceof MoveFleetExecution) {
        ex.forceCancel(game, false);
      }
    }
    this.active = false;
  }
  tick(): void {}
  isActive(): boolean {
    return this.active;
  }
}

export class CommitInvasionExecution implements Execution {
  readonly id = nextExecId("invade");
  private active = true;
  constructor(
    private readonly playerId: PlayerId,
    private readonly fleetId: FleetId,
    private readonly population: number,
    private readonly fromNodeId: NodeId,
  ) {}
  init(game: Game): void {
    const fleet = game.state.fleets[this.fleetId];
    const node = game.state.nodes[this.fromNodeId];
    if (
      !fleet ||
      !node ||
      fleet.ownerId !== this.playerId ||
      node.ownerId !== this.playerId ||
      this.population <= 0 ||
      node.population < this.population
    ) {
      this.active = false;
      return;
    }
    if (fleet.location.kind !== "node" || fleet.location.nodeId !== this.fromNodeId) {
      this.active = false;
      return;
    }
    node.population -= this.population;
    fleet.invasionPopulation = (fleet.invasionPopulation ?? 0) + this.population;
    this.active = false;
  }
  tick(): void {}
  isActive(): boolean {
    return this.active;
  }
}

export class CancelInvasionExecution implements Execution {
  readonly id = nextExecId("cancelInvade");
  private active = true;
  constructor(
    private readonly playerId: PlayerId,
    private readonly fleetId: FleetId,
  ) {}
  init(game: Game): void {
    const fleet = game.state.fleets[this.fleetId];
    if (!fleet || fleet.ownerId !== this.playerId || !fleet.invasionPopulation) {
      this.active = false;
      return;
    }
    const pop = fleet.invasionPopulation;
    fleet.invasionPopulation = undefined;
    // rulings.md §3: colonists return to the nearest owned system, measured in
    // hops from where the fleet actually is (for transit, from the origin end).
    const origin =
      fleet.location.kind === "node"
        ? fleet.location.nodeId
        : fleet.location.from;
    const deposit = nearestOwnedNode(game, this.playerId, origin);
    if (deposit) game.state.nodes[deposit]!.population += pop;
    // No reachable owned system: the colonists are lost.
    this.active = false;
  }
  tick(): void {}
  isActive(): boolean {
    return this.active;
  }
}

export class ProposeAllianceExecution implements Execution {
  readonly id = nextExecId("proposeAlly");
  private active = true;
  constructor(
    private readonly playerId: PlayerId,
    private readonly toPlayerId: PlayerId,
  ) {}
  init(game: Game): void {
    if (
      this.playerId === this.toPlayerId ||
      !game.state.players[this.playerId] ||
      !game.state.players[this.toPlayerId]
    ) {
      this.active = false;
      return;
    }
    const list = game.state.allianceProposals[this.toPlayerId] ?? [];
    if (!list.includes(this.playerId)) {
      list.push(this.playerId);
      game.state.allianceProposals[this.toPlayerId] = list;
    }
    this.active = false;
  }
  tick(): void {}
  isActive(): boolean {
    return this.active;
  }
}

export class AcceptAllianceExecution implements Execution {
  readonly id = nextExecId("acceptAlly");
  private active = true;
  constructor(
    private readonly playerId: PlayerId,
    private readonly fromPlayerId: PlayerId,
  ) {}
  init(game: Game): void {
    const proposals = game.state.allianceProposals[this.playerId] ?? [];
    if (!proposals.includes(this.fromPlayerId)) {
      this.active = false;
      return;
    }
    const a = game.state.players[this.playerId];
    const b = game.state.players[this.fromPlayerId];
    if (!a || !b) {
      this.active = false;
      return;
    }
    if (!a.allies.includes(this.fromPlayerId)) a.allies.push(this.fromPlayerId);
    if (!b.allies.includes(this.playerId)) b.allies.push(this.playerId);
    game.state.allianceProposals[this.playerId] = proposals.filter(
      (p) => p !== this.fromPlayerId,
    );
    this.active = false;
  }
  tick(): void {}
  isActive(): boolean {
    return this.active;
  }
}

export class BreakAllianceExecution implements Execution {
  readonly id = nextExecId("breakAlly");
  private active = true;
  constructor(
    private readonly playerId: PlayerId,
    private readonly withPlayerId: PlayerId,
  ) {}
  init(game: Game): void {
    const a = game.state.players[this.playerId];
    const b = game.state.players[this.withPlayerId];
    if (a) a.allies = a.allies.filter((x) => x !== this.withPlayerId);
    if (b) b.allies = b.allies.filter((x) => x !== this.playerId);
    this.active = false;
  }
  tick(): void {}
  isActive(): boolean {
    return this.active;
  }
}

/** Ongoing: advance build queues each tick. */
export class BuildProgressExecution implements Execution {
  readonly id = "buildProgress_ongoing";
  private active = true;
  init(_game: Game, _tick: number): void {}
  tick(game: Game): void {
    for (const node of Object.values(game.state.nodes)) {
      if (!node.ownerId || node.buildQueue.length === 0) continue;
      const order = node.buildQueue[0]!;
      order.progressTicks += 1;
      if (order.progressTicks < order.ticksRequired) continue;

      // Complete one ship at a time from the order
      order.progressTicks = 0;
      order.count -= 1;
      const player = game.state.players[node.ownerId];
      if (!player) continue;

      // Find or create fleet at node
      let fleet = Object.values(game.state.fleets).find(
        (f) =>
          f.ownerId === node.ownerId &&
          f.location.kind === "node" &&
          f.location.nodeId === node.id,
      );
      if (!fleet) {
        fleet = {
          id: game.nextFleetId(),
          ownerId: node.ownerId,
          composition: {},
          location: { kind: "node", nodeId: node.id },
        };
        game.addFleet(fleet);
      }
      fleet.composition = addComposition(fleet.composition, {
        [order.shipType]: 1,
      });

      if (order.count <= 0) {
        node.buildQueue.shift();
      } else {
        // Recalc ticks for next ship (tech/level may have changed)
        const gnode = game.state.map.nodes[node.id]!;
        order.ticksRequired = buildTicksRequired(
          order.shipType,
          gnode.role,
          node.level,
          player.researched,
          game.balance,
        );
      }
    }
  }
  isActive(): boolean {
    return this.active;
  }
}

export function intentToExecution(
  stamped: StampedIntent,
  game: Game,
): Execution {
  const player = game.playerForClient(stamped.clientId);
  if (!player || player.eliminated) return new NoOpExecution();
  const intent: Intent = stamped.intent;
  switch (intent.type) {
    case "UpgradeNode":
      return new UpgradeNodeExecution(player.id, intent.nodeId);
    case "ResearchTech":
      return new ResearchExecution(player.id, intent.techId);
    case "BuildShips":
      return new BuildShipsExecution(
        player.id,
        intent.nodeId,
        intent.shipType,
        intent.count,
      );
    case "MoveFleet":
      return new MoveFleetExecution(
        player.id,
        intent.fleetId,
        intent.path,
        intent.composition,
      );
    case "CancelMove":
      return new CancelMoveExecution(player.id, intent.fleetId);
    case "CommitInvasion":
      return new CommitInvasionExecution(
        player.id,
        intent.fleetId,
        intent.population,
        intent.fromNodeId,
      );
    case "CancelInvasion":
      return new CancelInvasionExecution(player.id, intent.fleetId);
    case "ProposeAlliance":
      return new ProposeAllianceExecution(player.id, intent.toPlayerId);
    case "AcceptAlliance":
      return new AcceptAllianceExecution(player.id, intent.fromPlayerId);
    case "BreakAlliance":
      return new BreakAllianceExecution(player.id, intent.withPlayerId);
    default:
      return new NoOpExecution();
  }
}

export function createExecsFromTurn(turn: Turn, game: Game): Execution[] {
  // Process in sequence order within turn
  const sorted = [...turn.intents].sort((a, b) => {
    if (a.clientId !== b.clientId) return a.clientId < b.clientId ? -1 : 1;
    return a.sequence - b.sequence;
  });
  return sorted.map((s) => intentToExecution(s, game));
}

export function compositionTotalShips(c: FleetComposition): number {
  return compositionShipCount(c);
}

export { SHIP_TYPES };
