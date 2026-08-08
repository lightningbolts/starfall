import type { SimConfig } from "./balance.js";
import {
  BuildProgressExecution,
  createExecsFromTurn,
} from "./executions/intents.js";
import { Game, type Execution } from "./game.js";
import {
  EconomyExecution,
  runContactAndAnnexation,
  WinCheckExecution,
} from "./systems.js";
import type { GameState, TickUpdates, Turn } from "./types.js";

export function attachOngoingExecutions(game: Game): void {
  const has = (id: string) => game.executions.some((e) => e.id === id);
  if (!has("economy_ongoing")) {
    const e = new EconomyExecution();
    e.init(game, game.state.tick);
    game.executions.push(e);
  }
  if (!has("win_ongoing")) {
    const e = new WinCheckExecution();
    e.init(game, game.state.tick);
    game.executions.push(e);
  }
  if (!has("buildProgress_ongoing")) {
    const e = new BuildProgressExecution();
    e.init(game, game.state.tick);
    game.executions.push(e);
  }
}

/**
 * Pure-ish step: apply one turn's intents + advance one tick.
 * Mutates and returns the same state object for performance; callers may clone if needed.
 */
export function executeNextTick(
  state: GameState,
  turn: Turn,
  config: SimConfig,
  gameRef?: Game,
): { state: GameState; updates: TickUpdates; game: Game } {
  const game = gameRef ?? new Game(state, config);
  if (gameRef === undefined) {
    // Rehydrate move map from active move execs if any
  }
  game.resetUpdates();
  attachOngoingExecutions(game);

  if (state.status === "finished") {
    return { state, updates: game.updates, game };
  }

  state.turnNumber = turn.turnNumber;

  // 1. Attach new executions from this turn
  const news = createExecsFromTurn(turn, game);
  for (const ex of news) {
    ex.init(game, state.tick);
    if (ex.isActive()) game.executions.push(ex);
  }

  // 2. Tick multi-tick movement / build / cargo (ongoing included)
  // Deterministic order: stable by id
  game.executions.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const ex of game.executions) {
    if (!ex.isActive()) continue;
    // Defer economy/win until after combat/annexation
    if (ex.id === "economy_ongoing" || ex.id === "win_ongoing") continue;
    ex.tick(game, state.tick);
  }

  // 3–4. Contact combat + annexation
  runContactAndAnnexation(game);

  // 5. Advance tick counter, then economy / score / win
  state.tick += 1;

  const economy = game.executions.find((e) => e.id === "economy_ongoing");
  economy?.tick(game, state.tick);
  const win = game.executions.find((e) => e.id === "win_ongoing");
  win?.tick(game, state.tick);

  // Prune inactive
  game.executions = game.executions.filter((e) => e.isActive());

  return { state, updates: game.updates, game };
}

/** Fold a recorded turn stream from an initial state. */
export function replayTurns(
  initial: GameState,
  turns: Turn[],
  config: SimConfig,
): GameState {
  const game = new Game(initial, config);
  attachOngoingExecutions(game);
  initial.status = "running";
  for (const turn of turns) {
    if (initial.status !== "running") break;
    executeNextTick(initial, turn, config, game);
  }
  return initial;
}

export function emptyTurn(turnNumber: number): Turn {
  return { turnNumber, intents: [] };
}

export type { Execution };
