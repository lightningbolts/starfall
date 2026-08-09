import type { Empire, MacroConfig, MacroState, StarSystem } from "./types.js";
import type { MacroShipType } from "./types.js";
import {
  addShips,
  fleetBuildScale,
  fleetCount,
  fleetPressure,
  fleetSupportCap,
  fleetUpkeep,
  SHIP_STATS,
  syncDefenseMix,
} from "./ships.js";
import {
  applyShipyardPulse,
  creditProductionMult,
  fleetUpkeepMult,
  garrisonGrowthMult,
  popProductionMult,
  shipUnlockOk,
  sprawlUpkeepMult,
} from "./tech.js";

/** Per economy pulse (~1s at 100ms logic ticks). */
const BASE_POP = 2.6;
const BASE_CREDITS = 7.0;
const BASE_GARRISON_SHARE = 0.26;

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
  const terraBonus = empire.researched.has("terraforming_guilds") ? 60 : 0;
  const ceiling = 180 + system.developments.size * 40 + terraBonus;
  if (system.population > ceiling) {
    system.population -= (system.population - ceiling) * 0.08;
  }

  system.credits += creditGain;

  const sprawl = Math.max(1, empire.ownedSystems.size);
  const upkeep =
    (0.08 + sprawl * 0.006 + Math.max(0, system.population - 40) * 0.001) *
    sprawlUpkeepMult(empire);
  system.credits = Math.max(0, system.credits - upkeep);

  const gMult =
    (empire.modifiers.garrisonTicksLeft > 0 ? empire.modifiers.garrisonMult : 1) *
    garrisonGrowthMult(empire, system);
  system.garrison += creditGain * BASE_GARRISON_SHARE * gMult;
  system.garrison = Math.max(
    4,
    system.garrison * (1 - 0.008 - sprawl * 0.00015),
  );
  // Soft ceiling so local defense stays readable.
  const gCap = 220 + system.developments.size * 50;
  if (system.garrison > gCap) {
    system.garrison -= (system.garrison - gCap) * 0.12;
  }
  syncDefenseMix(system);
}

function countShipyards(state: MacroState, empire: Empire): number {
  let n = 0;
  for (const sid of empire.ownedSystems) {
    if (state.systems[sid]!.developments.has("shipyard_ring")) n++;
  }
  return n;
}

export function applyEmpireEconomyPulse(
  state: MacroState,
  empire: Empire,
): void {
  if (!empire.alive) return;
  const yards = countShipyards(state, empire);
  const support = fleetSupportCap(empire.ownedSystems.size, yards, {
    livingMetal: empire.researched.has("living_metal"),
    warMobilization: empire.researched.has("war_mobilization"),
  });
  const pressure = fleetPressure(empire.fleet, support);
  // Overstretched fleets pay rising logistics — soft-caps snowballs without a hard delete.
  const stretch = pressure <= 1 ? 1 : 1 + (pressure - 1) * (pressure - 1) * 2.4;
  const upkeep =
    fleetUpkeep(empire.fleet) * fleetUpkeepMult(empire) * stretch;
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
      const frac = pressure > 1.2 ? 0.06 : 0.035;
      for (const key of Object.keys(empire.fleet) as MacroShipType[]) {
        const n = empire.fleet[key] ?? 0;
        if (n > 0) {
          const scrap = Math.min(n, Math.max(1, Math.floor(n * frac)));
          empire.fleet[key] = Math.max(0, n - scrap);
          if ((empire.fleet[key] ?? 0) <= 0) delete empire.fleet[key];
        }
      }
    } else if (pressure > 1.35 && fleetCount(empire.fleet) > support) {
      // Paid but still over-cap — slow peacetime mothballing.
      for (const key of Object.keys(empire.fleet) as MacroShipType[]) {
        const n = empire.fleet[key] ?? 0;
        if (n > 8) {
          empire.fleet[key] = n - Math.max(1, Math.floor(n * 0.01));
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

/** Buy a batch of ships from capital credits into the strategic fleet. */
export function tryBuildShips(
  state: MacroState,
  empire: Empire,
  rng: () => number,
): void {
  const capital = state.systems[empire.capitalSystemId];
  if (!capital || capital.credits < 20) return;
  // Let young empires colonize before pouring treasury into hulls.
  if (empire.ownedSystems.size < 5 && capital.credits < 55) return;

  const yards = countShipyards(state, empire);
  const support = fleetSupportCap(empire.ownedSystems.size, yards, {
    livingMetal: empire.researched.has("living_metal"),
    warMobilization: empire.researched.has("war_mobilization"),
  });
  const scale = fleetBuildScale(fleetPressure(empire.fleet, support));
  if (scale <= 0.05) return;

  const prefs: MacroShipType[] = [];
  if (empire.archetype === "conqueror" || empire.traits.ambition > 0.7) {
    if (empire.researched.has("supercapital_frame")) {
      prefs.push("dreadnought", "battleship", "cruiser", "corvette");
    } else {
      prefs.push("battleship", "cruiser", "dreadnought", "corvette");
    }
  } else if (
    empire.archetype === "reckless" ||
    empire.archetype === "opportunistic"
  ) {
    prefs.push("raider", "corvette", "destroyer");
  } else if (empire.archetype === "technocrat") {
    prefs.push("carrier", "cruiser", "destroyer");
    if (empire.researched.has("supercapital_frame")) prefs.push("dreadnought");
  } else if (
    empire.archetype === "xenophobe" ||
    empire.archetype === "isolationist"
  ) {
    prefs.push("destroyer", "corvette");
    if (empire.researched.has("supercapital_frame")) prefs.push("dreadnought");
  } else {
    prefs.push("corvette", "cruiser", "destroyer");
    if (
      empire.researched.has("supercapital_frame") &&
      empire.traits.ambition > 0.5
    ) {
      prefs.unshift("dreadnought");
    }
  }

  for (const type of prefs) {
    if (!shipUnlockOk(empire, type)) continue;
    const batchBase =
      type === "dreadnought"
        ? 1
        : type === "battleship" || type === "carrier"
          ? 2
          : type === "cruiser" || type === "destroyer"
            ? 4
            : 10;
    const batch = Math.max(1, Math.round(batchBase * scale));
    const cost = SHIP_STATS[type].creditCost * batch;
    if (capital.credits < cost) continue;
    if (rng() > 0.55 + empire.traits.aggression * 0.2) continue;
    capital.credits -= cost;
    addShips(empire.fleet, type, batch);
    break;
  }
}
