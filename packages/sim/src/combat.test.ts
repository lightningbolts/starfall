import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "./balance.js";
import {
  effectiveCombatPower,
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
  it("resolves equal-composition fight with new ship powers", () => {
    // 10F (120) + 1C (40) = 160 base vs 3C = 120
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
    expect(attacker.power).toBe(160);
    expect(defender.power).toBe(120);

    // Fighters are weak vs cruisers → attacker effective < base
    const aEff = effectiveCombatPower(
      attacker.composition,
      defender.composition,
      DEFAULT_BALANCE,
    );
    expect(aEff).toBeLessThan(attacker.power);

    const result = resolveLanchesterPair(attacker, defender, DEFAULT_BALANCE);
    expect(result.winnerId).toBe("a");
    expect(result.loserId).toBe("b");
    expect(result.winnerPowerRemaining).toBeGreaterThan(0);
    expect(result.loserCompositionAfter).toEqual({});
  });

  it("mutual annihilation on equal effective power", () => {
    const a: SidePower = {
      playerId: "a",
      composition: { fighter: 10 },
      power: fleetPower({ fighter: 10 }, DEFAULT_BALANCE),
    };
    const b: SidePower = {
      playerId: "b",
      composition: { fighter: 10 },
      power: fleetPower({ fighter: 10 }, DEFAULT_BALANCE),
    };
    const r = resolveLanchesterPair(a, b, DEFAULT_BALANCE);
    expect(r.mutualAnnihilation).toBe(true);
    expect(r.winnerId).toBeNull();
  });

  it("applies soft RPS: fighters weak vs cruisers", () => {
    const fighters = { fighter: 10 };
    const cruisers = { cruiser: 3 };
    const fVsC = effectiveCombatPower(fighters, cruisers, DEFAULT_BALANCE);
    const fBase = fleetPower(fighters, DEFAULT_BALANCE);
    expect(fVsC).toBeCloseTo(fBase * DEFAULT_BALANCE.matchupPenalty, 5);
  });

  it("scales survivors from base power fraction", () => {
    const comp = { fighter: 10, cruiser: 1 };
    const rem = 72;
    const survivors = scaleCompositionToPower(comp, rem, DEFAULT_BALANCE);
    const before = fleetPower(comp, DEFAULT_BALANCE);
    expect(fleetPower(survivors, DEFAULT_BALANCE)).toBeLessThanOrEqual(rem);
    expect(before).toBe(160);
  });
});

describe("costs", () => {
  it("upgrade exponential then flat after growth levels", () => {
    expect(upgradeCost("shipyard", 1, DEFAULT_BALANCE)).toBe(30);
    expect(upgradeCost("shipyard", 2, DEFAULT_BALANCE)).toBe(37);
    const atCap = upgradeCost("shipyard", 5, DEFAULT_BALANCE); // L5→L6
    const afterCap = upgradeCost("shipyard", 9, DEFAULT_BALANCE); // L9→L10
    expect(afterCap).toBe(atCap);
    expect(atCap).toBe(
      Math.round(30 * Math.pow(1.22, DEFAULT_BALANCE.upgradeGrowthLevels - 1)),
    );
  });

  it("tech tier costs", () => {
    expect(techCost("advanced_propulsion", DEFAULT_BALANCE)).toBe(60);
    expect(techCost("heavy_warships", DEFAULT_BALANCE)).toBe(135);
    expect(techCost("orbital_shielding", DEFAULT_BALANCE)).toBe(304);
  });
});
