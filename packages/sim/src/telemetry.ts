import type { GameState, TickUpdates } from "./types.js";

/** Running match telemetry (combat sizes, captures, snowball proxy). */
export interface MatchTelemetry {
  ticks: number;
  combats: number;
  combatPowerSum: number;
  annexAttempts: number;
  annexSuccess: number;
  annexFail: number;
  eliminations: number;
  researches: number;
  /** Last observed alive (non-eliminated with ≥1 node) count. */
  alivePlayers: number;
  /** top score / median score (1 = even). */
  snowballRatio: number;
  lastTickMs: number;
  maxTickMs: number;
  totalTickMs: number;
}

export function createMatchTelemetry(): MatchTelemetry {
  return {
    ticks: 0,
    combats: 0,
    combatPowerSum: 0,
    annexAttempts: 0,
    annexSuccess: 0,
    annexFail: 0,
    eliminations: 0,
    researches: 0,
    alivePlayers: 0,
    snowballRatio: 1,
    lastTickMs: 0,
    maxTickMs: 0,
    totalTickMs: 0,
  };
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/** Fold one tick's updates + state into telemetry. */
export function accumulateTelemetry(
  tel: MatchTelemetry,
  state: GameState,
  updates: TickUpdates,
  tickMs: number,
  prevEliminated: number,
): void {
  tel.ticks += 1;
  tel.combats += updates.combats.length;
  for (const c of updates.combats) {
    tel.combatPowerSum += c.winnerPowerBefore + c.loserPowerBefore;
  }
  tel.annexAttempts += updates.annexations.length;
  for (const a of updates.annexations) {
    if (a.success) tel.annexSuccess += 1;
    else tel.annexFail += 1;
  }
  tel.researches += updates.researches.length;

  const eliminated = Object.values(state.players).filter((p) => p.eliminated)
    .length;
  if (eliminated > prevEliminated) {
    tel.eliminations += eliminated - prevEliminated;
  }

  const alive = Object.values(state.players).filter((p) => {
    if (p.eliminated) return false;
    return Object.values(state.nodes).some((n) => n.ownerId === p.id);
  });
  tel.alivePlayers = alive.length;

  const scores = Object.values(state.players)
    .map((p) => p.score)
    .sort((a, b) => a - b);
  const top = scores.length ? scores[scores.length - 1]! : 0;
  const med = median(scores);
  tel.snowballRatio = med > 0 ? top / med : top > 0 ? Infinity : 1;

  tel.lastTickMs = tickMs;
  tel.maxTickMs = Math.max(tel.maxTickMs, tickMs);
  tel.totalTickMs += tickMs;
}

export function formatTelemetrySummary(tel: MatchTelemetry): string {
  const avgTick = tel.ticks ? tel.totalTickMs / tel.ticks : 0;
  return [
    `ticks=${tel.ticks}`,
    `combats=${tel.combats} powerSum=${tel.combatPowerSum}`,
    `annex=${tel.annexSuccess}/${tel.annexAttempts}`,
    `elims=${tel.eliminations}`,
    `alive=${tel.alivePlayers}`,
    `snowball=${Number.isFinite(tel.snowballRatio) ? tel.snowballRatio.toFixed(2) : "inf"}`,
    `tickMs avg=${avgTick.toFixed(2)} max=${tel.maxTickMs.toFixed(2)}`,
  ].join(" ");
}
