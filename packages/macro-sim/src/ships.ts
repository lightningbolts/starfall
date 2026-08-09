import type {
  ActiveEngagement,
  EngagementMode,
  Empire,
  MacroFleetComposition,
  MacroShipType,
  StarSystem,
} from "./types.js";

export const MACRO_SHIP_TYPES: readonly MacroShipType[] = [
  "corvette",
  "destroyer",
  "cruiser",
  "battleship",
  "carrier",
  "raider",
  "dreadnought",
  "defense_platform",
] as const;

export interface ShipStats {
  creditCost: number;
  power: number;
  upkeep: number;
}

export const SHIP_STATS: Record<MacroShipType, ShipStats> = {
  corvette: { creditCost: 2, power: 10, upkeep: 0.022 },
  destroyer: { creditCost: 4, power: 24, upkeep: 0.03 },
  cruiser: { creditCost: 8, power: 42, upkeep: 0.045 },
  battleship: { creditCost: 18, power: 95, upkeep: 0.07 },
  carrier: { creditCost: 20, power: 88, upkeep: 0.075 },
  raider: { creditCost: 3, power: 16, upkeep: 0.028 },
  dreadnought: { creditCost: 36, power: 280, upkeep: 0.09 },
  defense_platform: { creditCost: 6, power: 50, upkeep: 0.04 },
};

/** Soft rock-paper-scissors counters. */
const WEAK_VS: Partial<Record<MacroShipType, MacroShipType>> = {
  corvette: "destroyer",
  destroyer: "cruiser",
  cruiser: "battleship",
  battleship: "carrier",
  carrier: "raider",
  raider: "destroyer",
  dreadnought: "carrier",
  defense_platform: "battleship",
};

const MATCHUP_PENALTY = 0.85;

export function emptyFleet(): MacroFleetComposition {
  return {};
}

export function cloneFleet(f: MacroFleetComposition): MacroFleetComposition {
  const out: MacroFleetComposition = {};
  for (const t of MACRO_SHIP_TYPES) {
    const n = f[t];
    if (n && n > 0) out[t] = n;
  }
  return out;
}

export function fleetCount(f: MacroFleetComposition): number {
  let n = 0;
  for (const t of MACRO_SHIP_TYPES) n += f[t] ?? 0;
  return n;
}

export function fleetPower(f: MacroFleetComposition): number {
  let p = 0;
  for (const t of MACRO_SHIP_TYPES) {
    p += (f[t] ?? 0) * SHIP_STATS[t].power;
  }
  return p;
}

export function fleetUpkeep(f: MacroFleetComposition): number {
  let u = 0;
  for (const t of MACRO_SHIP_TYPES) {
    u += (f[t] ?? 0) * SHIP_STATS[t].upkeep * SHIP_STATS[t].creditCost;
  }
  return u;
}

/**
 * Soft logistics ceiling — mature empires sit in the low tens of thousands of
 * hulls, not tens of millions. Production and upkeep both key off this.
 */
export function fleetSupportCap(
  ownedSystems: number,
  shipyardCount: number,
  extras: { livingMetal?: boolean; warMobilization?: boolean } = {},
): number {
  const systems = Math.max(1, ownedSystems);
  const yards = Math.max(0, shipyardCount);
  let cap = 180 + systems * 48 + yards * 160;
  if (extras.warMobilization) cap *= 1.12;
  if (extras.livingMetal) cap *= 1.1;
  return Math.round(cap);
}

/** 0 = empty, 1 = at support, >1 = overstretched. */
export function fleetPressure(
  fleet: MacroFleetComposition,
  supportCap: number,
): number {
  const cap = Math.max(1, supportCap);
  return fleetCount(fleet) / cap;
}

/** Diminishing yield once fleets approach / exceed support. */
export function fleetBuildScale(pressure: number): number {
  if (pressure <= 0.55) return 1;
  if (pressure >= 1.6) return 0;
  if (pressure <= 1) return 1 / (1 + (pressure - 0.55) * 1.8);
  return Math.max(0, 0.35 / (1 + (pressure - 1) * 4));
}

export function addShips(
  f: MacroFleetComposition,
  type: MacroShipType,
  count: number,
): void {
  if (count <= 0) return;
  f[type] = (f[type] ?? 0) + count;
}

export function takeShips(
  from: MacroFleetComposition,
  fraction: number,
): MacroFleetComposition {
  const out: MacroFleetComposition = {};
  const f = Math.min(1, Math.max(0, fraction));
  for (const t of MACRO_SHIP_TYPES) {
    const n = from[t] ?? 0;
    if (n <= 0) continue;
    const take = Math.max(0, Math.floor(n * f));
    if (take <= 0) continue;
    out[t] = take;
    from[t] = n - take;
    if ((from[t] ?? 0) <= 0) delete from[t];
  }
  return out;
}

export function mergeFleets(
  a: MacroFleetComposition,
  b: MacroFleetComposition,
): MacroFleetComposition {
  const out = cloneFleet(a);
  for (const t of MACRO_SHIP_TYPES) {
    const n = b[t] ?? 0;
    if (n > 0) out[t] = (out[t] ?? 0) + n;
  }
  return out;
}

export function effectiveCombatPower(
  self: MacroFleetComposition,
  foe: MacroFleetComposition,
): number {
  const foeTotal = Math.max(1, fleetPower(foe));
  let power = 0;
  for (const t of MACRO_SHIP_TYPES) {
    const count = self[t] ?? 0;
    if (count <= 0) continue;
    const base = count * SHIP_STATS[t].power;
    const weak = WEAK_VS[t];
    let mult = 1;
    if (weak) {
      const counterShare =
        ((foe[weak] ?? 0) * SHIP_STATS[weak].power) / foeTotal;
      mult = 1 - (1 - MATCHUP_PENALTY) * counterShare;
    }
    power += base * mult;
  }
  return power;
}

/** Partial Lanchester step — scale both fleets toward remaining after a fractional exchange. */
export function resolveCombatTick(
  a: MacroFleetComposition,
  b: MacroFleetComposition,
  aEff: number,
  bEff: number,
  fraction: number,
): { a: MacroFleetComposition; b: MacroFleetComposition } {
  const f = Math.min(1, Math.max(0.02, fraction));
  const aBase = Math.max(1, fleetPower(a));
  const bBase = Math.max(1, fleetPower(b));
  if (aEff <= 0 && bEff <= 0) {
    return { a: emptyFleet(), b: emptyFleet() };
  }
  if (aEff <= 0) {
    return { a: emptyFleet(), b: scaleCompositionToPower(b, bBase * (1 - f * 0.15)) };
  }
  if (bEff <= 0) {
    return { a: scaleCompositionToPower(a, aBase * (1 - f * 0.15)), b: emptyFleet() };
  }

  // Mutual damage — keep close fights from vaporizing both fleets each tick.
  const aLossFrac = Math.min(0.35, (bEff / (aEff + bEff)) * f * 0.45);
  const bLossFrac = Math.min(0.35, (aEff / (aEff + bEff)) * f * 0.45);
  return {
    a: scaleCompositionToPower(a, aBase * (1 - aLossFrac)),
    b: scaleCompositionToPower(b, bBase * (1 - bLossFrac)),
  };
}

export function scaleCompositionToPower(
  comp: MacroFleetComposition,
  targetPower: number,
): MacroFleetComposition {
  const current = fleetPower(comp);
  if (current <= 0 || targetPower <= 0) return emptyFleet();
  // Soft floor — avoid wiping a close fight with integer truncation alone.
  const scale = Math.min(1, targetPower / current);
  const out: MacroFleetComposition = {};
  for (const t of MACRO_SHIP_TYPES) {
    const n = comp[t] ?? 0;
    if (n <= 0) continue;
    const next = n * scale >= 1 ? Math.max(1, Math.round(n * scale)) : 0;
    if (next > 0) out[t] = Math.min(n, next);
  }
  // Keep at least one ship if any power remains and flooring wiped everything.
  if (fleetCount(out) === 0 && targetPower > SHIP_STATS.corvette.power * 0.5) {
    out.corvette = 1;
  }
  return out;
}

export function formatComposition(f: MacroFleetComposition): string {
  const parts: string[] = [];
  const labels: Record<MacroShipType, string> = {
    corvette: "Cv",
    destroyer: "D",
    cruiser: "Cr",
    battleship: "B",
    carrier: "Ca",
    raider: "R",
    dreadnought: "Dr",
    defense_platform: "P",
  };
  for (const t of MACRO_SHIP_TYPES) {
    const n = f[t] ?? 0;
    if (n > 0) parts.push(`${n}${labels[t]}`);
  }
  return parts.length ? parts.join(" ") : "—";
}

export function defenseFromGarrison(
  garrison: number,
  platforms: number,
): MacroFleetComposition {
  const mix: MacroFleetComposition = {};
  const g = Math.max(0, garrison);
  // Local defense denser than v1, but not millions of virtual hulls.
  mix.corvette = Math.floor(g / 3.5);
  mix.destroyer = Math.floor(g / 12);
  mix.cruiser = Math.floor(g / 22);
  if (platforms > 0) mix.defense_platform = platforms * 3;
  if (fleetCount(mix) === 0 && g > 5) mix.corvette = 1;
  return mix;
}

export function syncDefenseMix(system: StarSystem): void {
  const platforms = system.developments.has("orbital_batteries")
    ? 2 + (system.developments.has("fortress_complex") ? 2 : 0)
    : system.developments.has("fortress_complex")
      ? 1
      : 0;
  system.defenseMix = defenseFromGarrison(system.garrison, platforms);
}

export function engagementDuration(
  mode: EngagementMode,
  totalPower: number,
  parity: number,
  siegeBonus: number,
): number {
  const logP = Math.log10(Math.max(10, totalPower));
  switch (mode) {
    case "skirmish":
      return Math.round(8 + logP * 3 + parity * 4);
    case "raid":
      return Math.round(6 + logP * 2);
    case "fleet_battle":
      return Math.round(18 + logP * 8 + parity * 12);
    case "siege":
      return Math.round(28 + logP * 10 + parity * 14 + siegeBonus * 20);
    default:
      return 12;
  }
}

export function engagementIntensity(
  totalPower: number,
  localPop: number,
  localCredits: number,
  devCount: number,
): number {
  const raw =
    Math.log10(Math.max(10, totalPower)) / 4 +
    Math.log10(Math.max(10, localPop)) / 5 +
    Math.log10(Math.max(10, localCredits)) / 5 +
    devCount * 0.08;
  return Math.min(1, Math.max(0.05, raw / 1.8));
}

export function tacticsFactor(
  empire: Empire,
  rng: () => number,
  mode: EngagementMode,
): number {
  let base = 0.85 + rng() * 0.3;
  if (empire.archetype === "strategist") base += 0.12;
  if (empire.archetype === "reckless") base += (rng() - 0.4) * 0.35;
  if (empire.researched.has("tactical_ai")) base += 0.1;
  if (empire.researched.has("deep_scanners")) base += 0.05;
  if (empire.researched.has("sensor_grid")) base += 0.08;
  if (empire.researched.has("quantum_command")) base += 0.12;
  if (mode === "siege" && empire.researched.has("iron_curtain")) base += 0.08;
  if (mode === "fleet_battle" && empire.researched.has("war_mobilization")) {
    base += 0.08;
  }
  const doctrine = empire.repeatableLevels.fleet_doctrine_ex ?? 0;
  if (doctrine > 0) base += Math.min(0.2, doctrine * 0.02);
  return Math.min(1.45, Math.max(0.55, base));
}

export function doctrineFactor(empire: Empire, mode: EngagementMode): number {
  let m = 1;
  if (mode === "raid" && (empire.archetype === "reckless" || empire.archetype === "opportunistic")) {
    m += 0.12;
  }
  if (mode === "siege" && (empire.archetype === "cautious" || empire.archetype === "isolationist")) {
    m += 0.1;
  }
  if (mode === "fleet_battle" && empire.archetype === "conqueror") m += 0.1;
  if (empire.researched.has("galactic_hegemony") && empire.traits.ambition > 0.6) {
    m += 0.08;
  }
  if (empire.researched.has("xenology_bureau") && empire.traits.xenophobia > 0.55) {
    m += 0.06;
  }
  const doctrine = empire.repeatableLevels.fleet_doctrine_ex ?? 0;
  if (doctrine > 0) m += Math.min(0.25, doctrine * 0.02);
  return m;
}

export function snapshotEngagement(
  e: ActiveEngagement | null,
): ActiveEngagement | null {
  if (!e) return null;
  return {
    mode: e.mode,
    attackerId: e.attackerId,
    defenderId: e.defenderId,
    committedA: cloneFleet(e.committedA),
    committedB: cloneFleet(e.committedB),
    ticksElapsed: e.ticksElapsed,
    ticksRemaining: e.ticksRemaining,
    intensity: e.intensity,
    tacticsSeed: e.tacticsSeed,
  };
}
