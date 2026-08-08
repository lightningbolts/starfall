import type { ArchetypeId, EmpireTraits } from "./types.js";
import { createRng } from "./rng.js";

export const ARCHETYPE_IDS: readonly ArchetypeId[] = [
  "conqueror",
  "aggressive",
  "reckless",
  "cautious",
  "strategist",
  "opportunistic",
  "diplomat",
  "loyal",
  "xenophobe",
  "technocrat",
  "isolationist",
  "wildcard",
] as const;

const BASE: Record<Exclude<ArchetypeId, "wildcard">, EmpireTraits> = {
  conqueror: {
    aggression: 0.9,
    loyalty: 0.25,
    risk: 0.7,
    greed: 0.55,
    ambition: 0.95,
    xenophobia: 0.45,
    curiosity: 0.3,
  },
  aggressive: {
    aggression: 0.88,
    loyalty: 0.22,
    risk: 0.82,
    greed: 0.55,
    ambition: 0.7,
    xenophobia: 0.4,
    curiosity: 0.25,
  },
  reckless: {
    aggression: 0.8,
    loyalty: 0.2,
    risk: 0.95,
    greed: 0.6,
    ambition: 0.65,
    xenophobia: 0.35,
    curiosity: 0.2,
  },
  cautious: {
    aggression: 0.22,
    loyalty: 0.72,
    risk: 0.18,
    greed: 0.32,
    ambition: 0.25,
    xenophobia: 0.35,
    curiosity: 0.4,
  },
  strategist: {
    aggression: 0.55,
    loyalty: 0.4,
    risk: 0.35,
    greed: 0.5,
    ambition: 0.7,
    xenophobia: 0.3,
    curiosity: 0.55,
  },
  opportunistic: {
    aggression: 0.58,
    loyalty: 0.18,
    risk: 0.68,
    greed: 0.9,
    ambition: 0.6,
    xenophobia: 0.25,
    curiosity: 0.35,
  },
  diplomat: {
    aggression: 0.28,
    loyalty: 0.88,
    risk: 0.3,
    greed: 0.35,
    ambition: 0.4,
    xenophobia: 0.1,
    curiosity: 0.45,
  },
  loyal: {
    aggression: 0.38,
    loyalty: 0.92,
    risk: 0.32,
    greed: 0.38,
    ambition: 0.4,
    xenophobia: 0.2,
    curiosity: 0.4,
  },
  xenophobe: {
    aggression: 0.7,
    loyalty: 0.35,
    risk: 0.55,
    greed: 0.4,
    ambition: 0.55,
    xenophobia: 0.95,
    curiosity: 0.25,
  },
  technocrat: {
    aggression: 0.35,
    loyalty: 0.5,
    risk: 0.35,
    greed: 0.4,
    ambition: 0.45,
    xenophobia: 0.2,
    curiosity: 0.95,
  },
  isolationist: {
    aggression: 0.18,
    loyalty: 0.45,
    risk: 0.2,
    greed: 0.3,
    ambition: 0.15,
    xenophobia: 0.75,
    curiosity: 0.5,
  },
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function jitter(base: number, rng: () => number, spread = 0.1): number {
  return clamp01(base + (rng() - 0.5) * spread);
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
      aggression: jitter(b.aggression, rng),
      loyalty: jitter(b.loyalty, rng),
      risk: jitter(b.risk, rng),
      greed: jitter(b.greed, rng),
      ambition: jitter(b.ambition, rng),
      xenophobia: jitter(b.xenophobia, rng),
      curiosity: jitter(b.curiosity, rng),
    };
  }
  const rng = createRng(seed ^ (empireIndex * 0x85ebca6b) ^ 0xc2b2ae35);
  return {
    aggression: rng(),
    loyalty: rng(),
    risk: rng(),
    greed: rng(),
    ambition: rng(),
    xenophobia: rng(),
    curiosity: rng(),
  };
}

export function pickArchetype(seed: number, empireIndex: number): ArchetypeId {
  const rng = createRng(seed ^ (empireIndex * 0x27d4eb2d));
  return ARCHETYPE_IDS[Math.floor(rng() * ARCHETYPE_IDS.length)]!;
}

export function archetypeLabel(id: ArchetypeId): string {
  switch (id) {
    case "conqueror":
      return "Galactic conqueror";
    case "aggressive":
      return "Brazen expansionist";
    case "reckless":
      return "Reckless warmonger";
    case "cautious":
      return "Cautious turtle";
    case "strategist":
      return "Cold strategist";
    case "opportunistic":
      return "Opportunistic backstabber";
    case "diplomat":
      return "Federation builder";
    case "loyal":
      return "Loyal builder";
    case "xenophobe":
      return "Xenophobic hardliner";
    case "technocrat":
      return "Technocratic visionary";
    case "isolationist":
      return "Isolationist recluse";
    case "wildcard":
      return "Wildcard";
  }
}
