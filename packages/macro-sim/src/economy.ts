import type { Empire, MacroConfig, Region } from "./types.js";

/** Per economy pulse (~1s): similar throughput to the old 3s full tick. */
const BASE_POP = 4;
const BASE_CREDITS = 2.7;
const BASE_GARRISON_SHARE = 0.35;

export function regionProductionMult(empire: Empire | undefined): number {
  if (!empire) return 1;
  let m = 1;
  if (empire.modifiers.productionTicksLeft > 0) {
    m *= empire.modifiers.productionMult;
  }
  return m;
}

export function applyEconomyTick(
  region: Region,
  empire: Empire | undefined,
  config: MacroConfig,
  varianceRoll: number,
): void {
  if (!region.ownerId || !empire || !empire.alive) return;
  const band = config.productionVariance;
  const variance = 1 + (varianceRoll * 2 - 1) * band;
  const mult = regionProductionMult(empire) * variance;
  const popGain = BASE_POP * mult;
  const creditGain = BASE_CREDITS * mult;
  region.population += popGain;
  region.credits += creditGain;
  const gMult =
    empire.modifiers.garrisonTicksLeft > 0 ? empire.modifiers.garrisonMult : 1;
  region.garrison += creditGain * BASE_GARRISON_SHARE * gMult;
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
}
