import type { BalanceTable, SimConfig } from "./balance.js";
import type {
  CargoShip,
  ClientId,
  Fleet,
  FleetId,
  GameState,
  NodeId,
  PlayerId,
  PlayerState,
  TickUpdates,
} from "./types.js";

export interface Execution {
  readonly id: string;
  init(game: Game, tick: number): void;
  tick(game: Game, tick: number): void;
  isActive(): boolean;
}

export class Game {
  readonly state: GameState;
  readonly config: SimConfig;
  executions: Execution[] = [];
  updates: TickUpdates = emptyUpdates();
  /** fleetId → active MoveFleetExecution id (last-write-wins) */
  moveByFleet = new Map<FleetId, string>();

  constructor(state: GameState, config: SimConfig) {
    this.state = state;
    this.config = config;
  }

  get balance(): BalanceTable {
    return this.config.balance;
  }

  playerForClient(clientId: ClientId): PlayerState | undefined {
    const pid = this.state.clientToPlayer[clientId];
    if (!pid) return undefined;
    return this.state.players[pid];
  }

  areAllied(a: PlayerId, b: PlayerId): boolean {
    if (a === b) return true;
    const pa = this.state.players[a];
    if (!pa) return false;
    return pa.allies.includes(b);
  }

  nextFleetId(prefix = "f"): FleetId {
    const id = `${prefix}${this.state.nextFleetSeq}`;
    this.state.nextFleetSeq += 1;
    return id;
  }

  addFleet(fleet: Fleet): void {
    this.state.fleets[fleet.id] = fleet;
  }

  removeFleet(id: FleetId): void {
    delete this.state.fleets[id];
    this.moveByFleet.delete(id);
  }

  addCargo(ship: CargoShip): void {
    this.state.cargoShips[ship.id] = ship;
  }

  removeCargo(id: FleetId): void {
    delete this.state.cargoShips[id];
  }

  ownedNodes(playerId: PlayerId): NodeId[] {
    return Object.values(this.state.nodes)
      .filter((n) => n.ownerId === playerId)
      .map((n) => n.id);
  }

  resetUpdates(): void {
    this.updates = emptyUpdates();
  }
}

function emptyUpdates(): TickUpdates {
  return { combats: [], annexations: [], researches: [] };
}
