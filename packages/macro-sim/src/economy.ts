import type { Empire, MacroConfig, StarSystem } from "./types.js";

/** Per economy pulse (~1s at 100ms logic ticks). */
const BASE_POP = 3.2;
const BASE_CREDITS = 2.4;
const BASE_GARRISON_SHARE = 0.3;

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
  // Denser systems produce a little more, so old cores outperform new colonies.
  const developed = 1 + Math.min(1.2, system.population / 220);
  const popGain = BASE_POP * mult;
  const creditGain = BASE_CREDITS * mult * developed;
  system.population += popGain;
  system.credits += creditGain;
  const gMult =
    empire.modifiers.garrisonTicksLeft > 0 ? empire.modifiers.garrisonMult : 1;
  system.garrison += creditGain * BASE_GARRISON_SHARE * gMult;
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
