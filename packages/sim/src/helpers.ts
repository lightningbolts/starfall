import type { BalanceTable } from "./balance.js";
import type {
  FleetComposition,
  NodeRole,
  NodeState,
  PlayerState,
  ShipType,
  TechId,
} from "./types.js";
import { SHIP_TYPES, TECH_TIER } from "./types.js";

export function fleetPower(
  c: FleetComposition,
  balance: BalanceTable,
): number {
  let p = 0;
  for (const t of SHIP_TYPES) {
    const n = c[t] ?? 0;
    if (n > 0) p += n * balance.ships[t].power;
  }
  return p;
}

export function compositionShipCount(c: FleetComposition): number {
  let n = 0;
  for (const t of SHIP_TYPES) n += c[t] ?? 0;
  return n;
}

export function scaleCompositionToPower(
  c: FleetComposition,
  remainingPower: number,
  balance: BalanceTable,
): FleetComposition {
  const before = fleetPower(c, balance);
  if (before <= 0 || remainingPower <= 0) return {};
  if (remainingPower >= before) return { ...c };

  const out: FleetComposition = {};
  let used = 0;
  // Proportional by pre-fight power share; floor ship counts.
  for (const t of SHIP_TYPES) {
    const n = c[t] ?? 0;
    if (n <= 0) continue;
    const typePower = n * balance.ships[t].power;
    const share = typePower / before;
    const targetPower = remainingPower * share;
    const survivors = Math.floor(targetPower / balance.ships[t].power);
    if (survivors > 0) {
      out[t] = survivors;
      used += survivors * balance.ships[t].power;
    }
  }
  void used;
  return out;
}

export function canBuildBattleship(player: PlayerState): boolean {
  return player.researched.has("heavy_warships");
}

export function effectiveTicksPerHop(
  composition: FleetComposition,
  researched: ReadonlySet<TechId>,
  balance: BalanceTable,
): number {
  let max = 0;
  for (const t of SHIP_TYPES) {
    const n = composition[t] ?? 0;
    if (n <= 0) continue;
    max = Math.max(max, balance.ships[t].ticksPerHop);
  }
  if (max <= 0) return 1;
  if (researched.has("advanced_propulsion")) {
    max = Math.max(
      1,
      Math.floor(max * balance.tech.advanced_propulsion.ticksPerHopFactor),
    );
  }
  return max;
}

export function cargoTicksPerHop(
  researched: ReadonlySet<TechId>,
  balance: BalanceTable,
): number {
  let t = balance.cargoTicksPerHop;
  if (researched.has("lane_logistics")) {
    t = Math.max(
      1,
      Math.floor(t * balance.tech.lane_logistics.cargoTicksPerHopFactor),
    );
  }
  return t;
}

export function effectiveGarrison(
  node: NodeState,
  role: NodeRole,
  researched: ReadonlySet<TechId> | null,
  balance: BalanceTable,
): number {
  const rb = balance.roles[role];
  const levelsAbove = Math.max(0, node.level - 1);
  // Soft exponential on the L1 base, plus the flat per-level table.
  let g = Math.round(
    rb.garrisonBase * levelScale(node.level, 1 + rb.garrisonLevelFactor),
  );
  g += levelsAbove * rb.garrisonPerLevel;
  if (researched) {
    if (researched.has("fortified_colonies")) {
      g = Math.floor(g * balance.tech.fortified_colonies.garrisonFactor);
    }
    if (researched.has("orbital_shielding")) {
      g += balance.tech.orbital_shielding.garrisonFlat;
    }
  }
  return g;
}

export function upgradeCost(
  role: NodeRole,
  currentLevel: number,
  balance: BalanceTable,
): number {
  // cost to go from currentLevel → currentLevel+1
  // cost(n) = base × growth^(n-1) where n is the target level (n>=2)
  const target = currentLevel + 1;
  if (target < 2) return 0;
  const base = balance.roles[role].upgradeBaseCost;
  return Math.max(
    1,
    Math.round(base * Math.pow(balance.upgradeGrowth, target - 2)),
  );
}

/** Exponential level multiplier: growth^(level−1). L1 = 1. */
export function levelScale(level: number, growth: number): number {
  const above = Math.max(0, level - 1);
  if (above === 0 || growth <= 1) return 1;
  return Math.pow(growth, above);
}

/**
 * Scale a base rate by level. `growthMinusOne` of 0.2 → ×1.2 per level
 * (exponential). Always at least `base` so L1 stays readable.
 */
export function scaleByLevel(
  base: number,
  level: number,
  growthMinusOne: number,
): number {
  if (base <= 0) return 0;
  if (growthMinusOne <= 0) return base;
  const scaled = base * levelScale(level, 1 + growthMinusOne);
  return Math.max(base, Math.round(scaled));
}

export function techCost(techId: TechId, balance: BalanceTable): number {
  const tier = TECH_TIER[techId];
  return Math.round(
    balance.techCostBase * Math.pow(balance.techCostGrowth, tier - 1),
  );
}

export function canResearch(
  player: PlayerState,
  techId: TechId,
): boolean {
  if (player.researched.has(techId)) return false;
  const tier = TECH_TIER[techId];
  if (tier === 1) return true;
  const need = (tier - 1) as 1 | 2;
  for (const t of player.researched) {
    if (TECH_TIER[t] === need) return true;
  }
  return false;
}

export function buildTicksRequired(
  shipType: ShipType,
  role: NodeRole,
  nodeLevel: number,
  researched: ReadonlySet<TechId>,
  balance: BalanceTable,
): number {
  let ticks = balance.ships[shipType].buildTicks;
  if (role === "homeworld") {
    ticks = Math.floor(ticks * balance.homeworldFighterBuildTicksFactor);
  }
  // tech-tree.md scopes rapid deployment to shipyards, not every build site.
  if (role === "shipyard" && researched.has("rapid_deployment")) {
    ticks = Math.max(
      1,
      Math.floor(ticks * balance.tech.rapid_deployment.buildTicksFactor),
    );
  }
  // Shipyard levels speed production exponentially: ticks / growth^(L-1)
  if (role === "shipyard" && nodeLevel > 1) {
    const growth = 1 + balance.roles.shipyard.buildProgressLevelFactor;
    ticks = Math.max(
      1,
      Math.round(ticks / levelScale(nodeLevel, growth)),
    );
  }
  return ticks;
}

/** Per-second (1 economy pulse) output of a single owned system. */
export interface NodeProduction {
  /** Direct credits into the bank this pulse. */
  bankCredits: number;
  /** Cargo stockpile this pulse (becomes credits when delivered). */
  cargoCredits: number;
  /** Population grown this pulse (0 when already at cap). */
  population: number;
  populationCap: number;
  /** What Upgrade raises for this role — for UI copy. */
  upgradeBoosts: string;
}

/**
 * Mirrors EconomyExecution pulse math so the HUD can show rates without
 * waiting for the next bank tick. Level factors are exponential growth−1
 * (0.2 → ×1.2 per level above 1).
 */
export function nodeProduction(
  role: NodeRole,
  level: number,
  population: number,
  researched: ReadonlySet<TechId> | null,
  balance: BalanceTable,
): NodeProduction {
  const rb = balance.roles[role];

  let bankCredits = 0;
  let cargoCredits = 0;
  if (rb.incomeMode === "bank" && rb.creditsPerPulse > 0) {
    bankCredits = scaleByLevel(
      rb.creditsPerPulse,
      level,
      rb.creditLevelFactor,
    );
  } else if (rb.incomeMode === "cargo" && rb.creditsPerPulse > 0) {
    cargoCredits = scaleByLevel(
      rb.creditsPerPulse,
      level,
      rb.cargoLevelFactor,
    );
  }

  let popCap = rb.populationCap;
  if (popCap > 0 && rb.popCapLevelFactor > 0) {
    popCap = scaleByLevel(popCap, level, rb.popCapLevelFactor);
  }

  let popGain = 0;
  if (rb.populationPerPulse > 0) {
    let pop = scaleByLevel(
      rb.populationPerPulse,
      level,
      rb.popLevelFactor,
    );
    if (role === "core_world" && researched?.has("population_efficiency")) {
      pop = Math.max(
        pop,
        Math.round(pop * balance.tech.population_efficiency.corePopFactor),
      );
    }
    const room = popCap > 0 ? Math.max(0, popCap - population) : pop;
    popGain = Math.min(pop, room);
  }

  return {
    bankCredits,
    cargoCredits,
    population: popGain,
    populationCap: popCap,
    upgradeBoosts: upgradeBoostLabel(role),
  };
}

export function upgradeBoostLabel(role: NodeRole): string {
  switch (role) {
    case "homeworld":
      return "Upgrade raises credits, pop, and garrison (soft exponential)";
    case "core_world":
      return "Upgrade raises pop growth, pop cap, and credit trickle";
    case "resource":
      return "Upgrade raises cargo credit output";
    case "relic":
      return "Upgrade raises relic cargo output";
    case "shipyard":
      return "Upgrade speeds builds and raises the credit trickle";
    case "relay":
      return "Upgrade raises vision range and garrison";
    default:
      return "Upgrade raises this system's output";
  }
}

export interface EmpireProduction {
  bankCreditsPerSec: number;
  cargoCreditsPerSec: number;
  populationPerSec: number;
}

/** Sum of owned-node pulse rates. 1 pulse = 1 second at default clock. */
export function empireProduction(
  nodes: Iterable<{
    role: NodeRole;
    level: number;
    population: number;
    ownerId: string | null;
  }>,
  selfId: string,
  researched: ReadonlySet<TechId>,
  balance: BalanceTable,
): EmpireProduction {
  let bankCreditsPerSec = 0;
  let cargoCreditsPerSec = 0;
  let populationPerSec = 0;
  for (const n of nodes) {
    if (n.ownerId !== selfId) continue;
    const p = nodeProduction(
      n.role,
      n.level,
      n.population,
      researched,
      balance,
    );
    bankCreditsPerSec += p.bankCredits;
    cargoCreditsPerSec += p.cargoCredits;
    populationPerSec += p.population;
  }
  return { bankCreditsPerSec, cargoCreditsPerSec, populationPerSec };
}

export function subtractComposition(
  from: FleetComposition,
  take: FleetComposition,
): FleetComposition | null {
  const out: FleetComposition = { ...from };
  for (const t of SHIP_TYPES) {
    const want = take[t] ?? 0;
    if (want <= 0) continue;
    const have = out[t] ?? 0;
    if (have < want) return null;
    const left = have - want;
    if (left === 0) delete out[t];
    else out[t] = left;
  }
  return out;
}

export function addComposition(
  a: FleetComposition,
  b: FleetComposition,
): FleetComposition {
  const out: FleetComposition = { ...a };
  for (const t of SHIP_TYPES) {
    const n = (out[t] ?? 0) + (b[t] ?? 0);
    if (n > 0) out[t] = n;
    else delete out[t];
  }
  return out;
}

export function isEmptyComposition(c: FleetComposition): boolean {
  return compositionShipCount(c) === 0;
}

export function laneId(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
