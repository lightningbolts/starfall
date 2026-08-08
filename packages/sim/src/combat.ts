import type { BalanceTable } from "./balance.js";
import { fleetPower, scaleCompositionToPower } from "./helpers.js";
import type { FleetComposition, PlayerId, ShipType } from "./types.js";
import { SHIP_TYPES } from "./types.js";

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
  winnerCompositionBefore: FleetComposition;
  loserCompositionBefore: FleetComposition;
  winnerCompositionAfter: FleetComposition;
  loserCompositionAfter: FleetComposition;
  /** true if both destroyed */
  mutualAnnihilation: boolean;
}

/** Soft RPS: each type is weak vs one counter. */
export const WEAK_VS: Record<ShipType, ShipType> = {
  fighter: "cruiser",
  cruiser: "battleship",
  battleship: "fighter",
};

/**
 * Composition-weighted combat power: ships facing their counter type take
 * `matchupPenalty` (default 0.85×) proportional to the opponent's counter share.
 */
export function effectiveCombatPower(
  mine: FleetComposition,
  theirs: FleetComposition,
  balance: BalanceTable,
): number {
  const theirTotal = fleetPower(theirs, balance);
  if (theirTotal <= 0) return fleetPower(mine, balance);

  const penalty = balance.matchupPenalty;
  let power = 0;
  for (const t of SHIP_TYPES) {
    const n = mine[t] ?? 0;
    if (n <= 0) continue;
    const base = n * balance.ships[t].power;
    const weakVs = WEAK_VS[t];
    const counterPower =
      (theirs[weakVs] ?? 0) * balance.ships[weakVs].power;
    const counterShare = counterPower / theirTotal;
    const mult = 1 - (1 - penalty) * counterShare;
    power += base * mult;
  }
  return power;
}

/** Diff ship counts (before − after), floored at 0. */
export function compositionLosses(
  before: FleetComposition,
  after: FleetComposition,
): FleetComposition {
  const out: FleetComposition = {};
  for (const t of SHIP_TYPES) {
    const lost = (before[t] ?? 0) - (after[t] ?? 0);
    if (lost > 0) out[t] = lost;
  }
  return out;
}

/** Lanchester square law on matchup-adjusted power. Tie → both die. */
export function resolveLanchesterPair(
  a: SidePower,
  b: SidePower,
  balance: BalanceTable,
): PairwiseResult {
  const aEff = effectiveCombatPower(a.composition, b.composition, balance);
  const bEff = effectiveCombatPower(b.composition, a.composition, balance);

  if (aEff === bEff) {
    return {
      winnerId: null,
      loserId: null,
      winnerPowerBefore: aEff,
      loserPowerBefore: bEff,
      winnerPowerRemaining: 0,
      winnerCompositionBefore: { ...a.composition },
      loserCompositionBefore: { ...b.composition },
      winnerCompositionAfter: {},
      loserCompositionAfter: {},
      mutualAnnihilation: true,
    };
  }

  const winner = aEff > bEff ? a : b;
  const loser = aEff > bEff ? b : a;
  const wEff = aEff > bEff ? aEff : bEff;
  const lEff = aEff > bEff ? bEff : aEff;
  const remainingEff = Math.sqrt(wEff ** 2 - lEff ** 2);
  const winnerBase = fleetPower(winner.composition, balance);
  const remainingBase = wEff > 0 ? (remainingEff / wEff) * winnerBase : 0;
  const survivors = scaleCompositionToPower(
    winner.composition,
    remainingBase,
    balance,
  );

  return {
    winnerId: winner.playerId,
    loserId: loser.playerId,
    winnerPowerBefore: wEff,
    loserPowerBefore: lEff,
    winnerPowerRemaining: fleetPower(survivors, balance),
    winnerCompositionBefore: { ...winner.composition },
    loserCompositionBefore: { ...loser.composition },
    winnerCompositionAfter: survivors,
    loserCompositionAfter: {},
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
