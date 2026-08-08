import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "./balance.js";
import {
  resolveLanchesterPair,
  type SidePower,
} from "./combat.js";
import {
  fleetPower,
  scaleCompositionToPower,
  techCost,
  upgradeCost,
} from "./helpers.js";

describe("Lanchester combat", () => {
  it("matches balance worked example: 140 vs 120 → ~72 remaining", () => {
    const attacker: SidePower = {
      playerId: "a",
      composition: { fighter: 10, cruiser: 1 },
      power: fleetPower({ fighter: 10, cruiser: 1 }, DEFAULT_BALANCE),
    };
    const defender: SidePower = {
      playerId: "b",
      composition: { cruiser: 3 },
      power: fleetPower({ cruiser: 3 }, DEFAULT_BALANCE),
    };
    expect(attacker.power).toBe(140);
    expect(defender.power).toBe(120);

    const result = resolveLanchesterPair(attacker, defender, DEFAULT_BALANCE);
    expect(result.winnerId).toBe("a");
    expect(result.loserId).toBe("b");
    expect(result.winnerPowerRemaining).toBeCloseTo(Math.sqrt(140 ** 2 - 120 ** 2), 5);

    const survivors = scaleCompositionToPower(
      attacker.composition,
      result.winnerPowerRemaining,
      DEFAULT_BALANCE,
    );
    // Proportional floor: fighter share 100/140, cruiser 40/140
    const rem = result.winnerPowerRemaining;
    const fSurv = Math.floor((rem * (100 / 140)) / 10);
    const cSurv = Math.floor((rem * (40 / 140)) / 40);
    expect(survivors.fighter ?? 0).toBe(fSurv);
    expect(survivors.cruiser ?? 0).toBe(cSurv);
  });

  it("mutual annihilation on equal power", () => {
    const a: SidePower = {
      playerId: "a",
      composition: { fighter: 10 },
      power: 100,
    };
    const b: SidePower = {
      playerId: "b",
      composition: { fighter: 10 },
      power: 100,
    };
    const r = resolveLanchesterPair(a, b, DEFAULT_BALANCE);
    expect(r.mutualAnnihilation).toBe(true);
    expect(r.winnerId).toBeNull();
  });
});

describe("costs", () => {
  it("upgrade soft exponential cost", () => {
    // L1→L2 = base; L2→L3 = round(base * 1.22)
    expect(upgradeCost("shipyard", 1, DEFAULT_BALANCE)).toBe(30);
    expect(upgradeCost("shipyard", 2, DEFAULT_BALANCE)).toBe(37);
    // Softer than the old 1.5 curve: L10 is far cheaper than ~38× base.
    const midGame = upgradeCost("shipyard", 9, DEFAULT_BALANCE);
    expect(midGame).toBeLessThan(30 * 8);
    expect(midGame).toBeGreaterThan(30);
  });

  it("tech tier costs", () => {
    expect(techCost("advanced_propulsion", DEFAULT_BALANCE)).toBe(60);
    expect(techCost("heavy_warships", DEFAULT_BALANCE)).toBe(135);
    expect(techCost("orbital_shielding", DEFAULT_BALANCE)).toBe(304);
  });
});
