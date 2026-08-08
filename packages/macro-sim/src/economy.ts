import type { Empire, MacroConfig, MacroState, StarSystem } from "./types.js";
import type { MacroShipType } from "./types.js";
import { addShips, fleetUpkeep, SHIP_STATS, syncDefenseMix } from "./ships.js";
import {
  applyShipyardPulse,
  creditProductionMult,
  garrisonGrowthMult,
  popProductionMult,
  shipUnlockOk,
} from "./tech.js";

/** Per economy pulse (~1s at 100ms logic ticks). */
const BASE_POP = 2.6;
const BASE_CREDITS = 2.35;
const BASE_GARRISON_SHARE = 0.24;

export function systemProductionMult(empire: Empire | undefined): number {
  if (!empire) return 1;
  let m = 1;
  if (empire.modifiers.productionTicksLeft > 0) {
    m *= empire.modifiers.productionMult;
  }
  return m;
}

export function applyEconomyTick(
  system: StarSystem,
  empire: Empire | undefined,
  config: MacroConfig,
  varianceRoll: number,
): void {
  if (!system.ownerId || !empire || !empire.alive) return;
  const band = config.productionVariance;
  const variance = 1 + (varianceRoll * 2 - 1) * band;
  const mult = systemProductionMult(empire) * variance;
  const developed = 1 + Math.min(1.0, system.population / 260);
  const popMult = popProductionMult(empire, system);
  const creditMult = creditProductionMult(empire, system);
  const popGain = BASE_POP * mult * popMult;
  const creditGain = BASE_CREDITS * mult * developed * creditMult;

  if (system.credits < 2 && system.population > 40) {
    system.population = Math.max(12, system.population - popGain * 0.6);
  } else {
    system.population += popGain;
  }
  const ceiling = 180 + system.developments.size * 40;
  if (system.population > ceiling) {
    system.population -= (system.population - ceiling) * 0.08;
  }

  system.credits += creditGain;

  const sprawl = Math.max(1, empire.ownedSystems.size);
  // Light upkeep — heavy enough to matter late, not enough to freeze early sprawl.
  const upkeep =
    0.08 + sprawl * 0.006 + Math.max(0, system.population - 40) * 0.001;
  system.credits = Math.max(0, system.credits - upkeep);

  const gMult =
    (empire.modifiers.garrisonTicksLeft > 0 ? empire.modifiers.garrisonMult : 1) *
    garrisonGrowthMult(empire, system);
  system.garrison += creditGain * BASE_GARRISON_SHARE * gMult;
  system.garrison = Math.max(
    4,
    system.garrison * (1 - 0.008 - sprawl * 0.00015),
  );
  syncDefenseMix(system);
}

export function applyEmpireEconomyPulse(
  state: MacroState,
  empire: Empire,
): void {
  if (!empire.alive) return;
  const upkeep = fleetUpkeep(empire.fleet);
  if (upkeep > 0) {
    let left = upkeep;
    for (const sid of empire.ownedSystems) {
      const s = state.systems[sid]!;
      const pay = Math.min(s.credits, left);
      s.credits -= pay;
      left -= pay;
      if (left <= 0) break;
    }
    if (left > 0) {
      for (const key of Object.keys(empire.fleet) as MacroShipType[]) {
        const n = empire.fleet[key] ?? 0;
        if (n > 0) {
          empire.fleet[key] = Math.max(0, n - 1);
          if ((empire.fleet[key] ?? 0) <= 0) delete empire.fleet[key];
        }
      }
    }
  }
  applyShipyardPulse(state, empire);
}

export function decayEmpireModifiers(empire: Empire): void {
  if (empire.modifiers.productionTicksLeft > 0) {
    empire.modifiers.productionTicksLeft -= 1;
    if (empire.modifiers.productionTicksLeft <= 0) {
      empire.modifiers.productionMult = 1;
    }
  }
  if (empire.modifiers.garrisonTicksLeft > 0) {
    empire.modifiers.garrisonTicksLeft -= 1;
    if (empire.modifiers.garrisonTicksLeft <= 0) {
      empire.modifiers.garrisonMult = 1;
    }
  }
  if (empire.modifiers.attackPressureTicksLeft > 0) {
    empire.modifiers.attackPressureTicksLeft -= 1;
    if (empire.modifiers.attackPressureTicksLeft <= 0) {
      empire.modifiers.attackPressure = 1;
    }
  }
}

/** Buy a few ships from capital credits into the strategic fleet. */
export function tryBuildShips(
  state: MacroState,
  empire: Empire,
  rng: () => number,
): void {
  const capital = state.systems[empire.capitalSystemId];
  if (!capital || capital.credits < 20) return;

  const prefs: MacroShipType[] = [];
  if (empire.archetype === "conqueror" || empire.traits.ambition > 0.7) {
    prefs.push("battleship", "cruiser", "dreadnought", "corvette");
  } else if (
    empire.archetype === "reckless" ||
    empire.archetype === "opportunistic"
  ) {
    prefs.push("raider", "corvette", "destroyer");
  } else if (empire.archetype === "technocrat") {
    prefs.push("carrier", "cruiser", "destroyer");
  } else if (
    empire.archetype === "xenophobe" ||
    empire.archetype === "isolationist"
  ) {
    prefs.push("destroyer", "corvette");
  } else {
    prefs.push("corvette", "cruiser", "destroyer");
  }

  for (const type of prefs) {
    if (!shipUnlockOk(empire, type)) continue;
    const cost = SHIP_STATS[type].creditCost;
    if (capital.credits < cost) continue;
    if (rng() > 0.55 + empire.traits.aggression * 0.2) continue;
    capital.credits -= cost;
    addShips(empire.fleet, type, 1);
    break;
  }
}
