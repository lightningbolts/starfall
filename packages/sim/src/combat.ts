import type { BalanceTable } from "./balance.js";
import { fleetPower, scaleCompositionToPower } from "./helpers.js";
import type { FleetComposition, PlayerId } from "./types.js";

export interface SidePower {
  playerId: PlayerId;
  composition: FleetComposition;
  power: number;
}

export interface PairwiseResult {
  winnerId: PlayerId | null;
  loserId: PlayerId | null;
  winnerPowerBefore: number;
  loserPowerBefore: number;
  winnerPowerRemaining: number;
  winnerCompositionAfter: FleetComposition;
  /** true if both destroyed */
  mutualAnnihilation: boolean;
}

/** Lanchester square law: P_remaining = sqrt(Pw² − Pl²). Tie → both die. */
export function resolveLanchesterPair(
  a: SidePower,
  b: SidePower,
  balance: BalanceTable,
): PairwiseResult {
  if (a.power === b.power) {
    return {
      winnerId: null,
      loserId: null,
      winnerPowerBefore: a.power,
      loserPowerBefore: b.power,
      winnerPowerRemaining: 0,
      winnerCompositionAfter: {},
      mutualAnnihilation: true,
    };
  }
  const winner = a.power > b.power ? a : b;
  const loser = a.power > b.power ? b : a;
  const remaining = Math.sqrt(winner.power ** 2 - loser.power ** 2);
  const survivors = scaleCompositionToPower(
    winner.composition,
    remaining,
    balance,
  );
  return {
    winnerId: winner.playerId,
    loserId: loser.playerId,
    winnerPowerBefore: winner.power,
    loserPowerBefore: loser.power,
    winnerPowerRemaining: remaining,
    winnerCompositionAfter: survivors,
    mutualAnnihilation: false,
  };
}

/**
 * Multi-side combat: merge already done; sides sorted by power desc, PlayerId asc.
 * Pairwise chain: strongest vs next until one remains.
 * Allies should be filtered out before calling (do not fight each other).
 */
export function resolveMultiSideCombat(
  sides: SidePower[],
  balance: BalanceTable,
  areAllied: (a: PlayerId, b: PlayerId) => boolean,
): { survivors: SidePower[]; results: PairwiseResult[] } {
  const results: PairwiseResult[] = [];
  let remaining = sides
    .filter((s) => s.power > 0)
    .map((s) => ({ ...s }));

  const sortSides = (arr: SidePower[]) =>
    arr.sort((x, y) => {
      if (y.power !== x.power) return y.power - x.power;
      return x.playerId < y.playerId ? -1 : x.playerId > y.playerId ? 1 : 0;
    });

  sortSides(remaining);

  while (remaining.length >= 2) {
    // Find strongest vs next non-allied
    sortSides(remaining);
    const strongest = remaining[0]!;
    let opponentIdx = -1;
    for (let i = 1; i < remaining.length; i++) {
      const cand = remaining[i]!;
      if (!areAllied(strongest.playerId, cand.playerId)) {
        opponentIdx = i;
        break;
      }
    }
    if (opponentIdx < 0) break; // only allies left

    const opponent = remaining[opponentIdx]!;
    const fight = resolveLanchesterPair(strongest, opponent, balance);
    results.push(fight);

    // Remove both fighters
    remaining = remaining.filter(
      (s) =>
        s.playerId !== strongest.playerId && s.playerId !== opponent.playerId,
    );

    if (!fight.mutualAnnihilation && fight.winnerId) {
      remaining.push({
        playerId: fight.winnerId,
        composition: fight.winnerCompositionAfter,
        power: fleetPower(fight.winnerCompositionAfter, balance),
      });
    }
  }

  return { survivors: remaining, results };
}
