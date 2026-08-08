import { createSimConfig, DEFAULT_BALANCE, type SimConfig } from "./balance.js";
import { Game } from "./game.js";
import { generateGalaxy } from "./galaxy.js";
import { attachOngoingExecutions } from "./tick.js";
import type {
  ClientId,
  GameState,
  NodeState,
  PlayerId,
  PlayerState,
} from "./types.js";

export interface CreateMatchOptions {
  seed: number;
  playerCount: number;
  nodeCount?: number;
  config?: SimConfig;
  playerNames?: string[];
}

export function createMatch(opts: CreateMatchOptions): {
  state: GameState;
  game: Game;
  config: SimConfig;
} {
  const config = opts.config ?? createSimConfig(DEFAULT_BALANCE);
  const galaxy = generateGalaxy({
    seed: opts.seed,
    playerCount: opts.playerCount,
    nodeCount: opts.nodeCount,
  });

  const nodes: Record<string, NodeState> = {};
  for (const gn of Object.values(galaxy.map.nodes)) {
    nodes[gn.id] = {
      id: gn.id,
      ownerId: null,
      level: 1,
      population: 0,
      cargoStockpile: 0,
      buildQueue: [],
      ownedSinceTick: 0,
    };
  }

  const players: Record<PlayerId, PlayerState> = {};
  const clientToPlayer: Record<ClientId, PlayerId> = {};
  const bal = config.balance;

  for (let i = 0; i < opts.playerCount; i++) {
    const playerId = `p${i}`;
    const clientId = `c${i}`;
    const homeId = galaxy.homeworldIds[i]!;
    players[playerId] = {
      id: playerId,
      clientId,
      displayName: opts.playerNames?.[i] ?? `Player ${i}`,
      credits: bal.start.credits,
      researched: new Set(),
      allies: [],
      eliminated: false,
      score: 0,
      homeworldId: homeId,
    };
    clientToPlayer[clientId] = playerId;

    const home = nodes[homeId]!;
    home.ownerId = playerId;
    home.population = bal.start.population;
    home.ownedSinceTick = 0;
  }

  const state: GameState = {
    tick: 0,
    turnNumber: 0,
    map: galaxy.map,
    nodes,
    fleets: {},
    cargoShips: {},
    players,
    clientToPlayer,
    allianceProposals: {},
    status: "running",
    winnerId: null,
    nextFleetSeq: 1,
    seed: opts.seed,
  };

  // Starting fleets
  for (let i = 0; i < opts.playerCount; i++) {
    const playerId = `p${i}`;
    const homeId = galaxy.homeworldIds[i]!;
    const fid = `f${state.nextFleetSeq++}`;
    state.fleets[fid] = {
      id: fid,
      ownerId: playerId,
      composition: { fighter: bal.start.fighters },
      location: { kind: "node", nodeId: homeId },
    };
  }

  const game = new Game(state, config);
  attachOngoingExecutions(game);
  return { state, game, config };
}
