import type { ArchetypeId, EmpireTraits } from "./types.js";
import { createRng } from "./rng.js";

export const ARCHETYPE_IDS: readonly ArchetypeId[] = [
  "aggressive",
  "cautious",
  "opportunistic",
  "loyal",
  "wildcard",
] as const;

const BASE: Record<Exclude<ArchetypeId, "wildcard">, EmpireTraits> = {
  aggressive: { aggression: 0.85, loyalty: 0.25, risk: 0.8, greed: 0.55 },
  cautious: { aggression: 0.25, loyalty: 0.7, risk: 0.2, greed: 0.35 },
  opportunistic: { aggression: 0.55, loyalty: 0.2, risk: 0.65, greed: 0.85 },
  loyal: { aggression: 0.4, loyalty: 0.9, risk: 0.35, greed: 0.4 },
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function traitsForArchetype(
  archetype: ArchetypeId,
  seed: number,
  empireIndex: number,
): EmpireTraits {
  if (archetype !== "wildcard") {
    const b = BASE[archetype];
    const rng = createRng(seed ^ (empireIndex * 0x9e3779b9));
    return {
      aggression: clamp01(b.aggression + (rng() - 0.5) * 0.1),
      loyalty: clamp01(b.loyalty + (rng() - 0.5) * 0.1),
      risk: clamp01(b.risk + (rng() - 0.5) * 0.1),
      greed: clamp01(b.greed + (rng() - 0.5) * 0.1),
    };
  }
  const rng = createRng(seed ^ (empireIndex * 0x85ebca6b) ^ 0xc2b2ae35);
  return {
    aggression: rng(),
    loyalty: rng(),
    risk: rng(),
    greed: rng(),
  };
}

export function pickArchetype(seed: number, empireIndex: number): ArchetypeId {
  const rng = createRng(seed ^ (empireIndex * 0x27d4eb2d));
  return ARCHETYPE_IDS[Math.floor(rng() * ARCHETYPE_IDS.length)]!;
}

export function archetypeLabel(id: ArchetypeId): string {
  switch (id) {
    case "aggressive":
      return "Aggressive expansionist";
    case "cautious":
      return "Cautious turtle";
    case "opportunistic":
      return "Opportunistic backstabber";
    case "loyal":
      return "Loyal builder";
    case "wildcard":
      return "Wildcard";
  }
}
