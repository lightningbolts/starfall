import type { NodeRole, ShipType, TechId } from "./types.js";

export interface ShipStats {
  creditCost: number;
  power: number;
  buildTicks: number;
  ticksPerHop: number;
  requiresTech?: TechId;
}

export interface RoleBalance {
  creditsPerPulse: number;
  populationPerPulse: number;
  populationCap: number;
  garrisonBase: number;
  garrisonPerLevel: number;
  upgradeBaseCost: number;
  incomeMode: "bank" | "cargo" | "none";
  /** Linear per-level fraction of base (0.2 → +20% of base each level). */
  creditLevelFactor: number;
  popLevelFactor: number;
  popCapLevelFactor: number;
  /** Unused for garrison (flat garrisonPerLevel only); kept for role parity. */
  garrisonLevelFactor: number;
  cargoLevelFactor: number;
  buildProgressLevelFactor: number;
  /** Concurrent build slots per level (shipyard). 0 = no builds. */
  buildSlotsPerLevel: number;
}

export interface BalanceTable {
  msPerTick: number;
  turnIntervalMs: number;
  ticksPerSecond: number;
  roundTicks: number;
  upgradeGrowth: number;
  /** Levels that still use exponential cost growth; after this, cost is flat. */
  upgradeGrowthLevels: number;
  /** Soft RPS penalty when a ship type faces its counter (composition-weighted). */
  matchupPenalty: number;
  /** Max queued build orders ≈ slots × this. */
  buildQueueDepthPerSlot: number;
  visionBaseHops: number;
  surveyDronesBonusHops: number;
  homeworldFighterBuildTicksFactor: number;
  cargoLaunchThreshold: number;
  cargoTicksPerHop: number;
  cargoLootFraction: number;
  techCostBase: number;
  techCostGrowth: number;
  ships: Record<ShipType, ShipStats>;
  roles: Record<NodeRole, RoleBalance>;
  start: { credits: number; population: number; fighters: number };
  score: {
    ownedNode: number;
    ownedRelicBonus: number;
    upgradeLevelAbove1: number;
    per10Credits: number;
    per10Population: number;
    per100FleetPower: number;
    perTech: number;
    /** Awarded to the capturing player when they eliminate another. */
    eliminationBonus: number;
  };
  tech: {
    advanced_propulsion: { ticksPerHopFactor: number };
    fortified_colonies: { garrisonFactor: number };
    survey_drones: { visionBonusHops: number };
    lane_logistics: { cargoTicksPerHopFactor: number };
    population_efficiency: { corePopFactor: number };
    orbital_shielding: { garrisonFlat: number };
    rapid_deployment: { buildTicksFactor: number };
  };
}

/** Embedded from docs/design/balance.csv — sim stays pure (no fs). */
export const DEFAULT_BALANCE: BalanceTable = {
  msPerTick: 100,
  turnIntervalMs: 100,
  ticksPerSecond: 10,
  roundTicks: 12_000,
  // Soft exponential through upgradeGrowthLevels, then flat.
  upgradeGrowth: 1.22,
  upgradeGrowthLevels: 5,
  matchupPenalty: 0.85,
  buildQueueDepthPerSlot: 8,
  visionBaseHops: 1,
  surveyDronesBonusHops: 1,
  homeworldFighterBuildTicksFactor: 2,
  cargoLaunchThreshold: 4,
  cargoTicksPerHop: 40,
  cargoLootFraction: 1.0,
  techCostBase: 60,
  techCostGrowth: 2.25,
  ships: {
    fighter: {
      creditCost: 10,
      power: 12,
      buildTicks: 20,
      ticksPerHop: 20,
    },
    cruiser: {
      creditCost: 40,
      power: 40,
      buildTicks: 60,
      ticksPerHop: 40,
    },
    battleship: {
      creditCost: 120,
      power: 90,
      buildTicks: 160,
      ticksPerHop: 80,
      requiresTech: "heavy_warships",
    },
  },
  roles: {
    homeworld: {
      creditsPerPulse: 2,
      populationPerPulse: 1,
      // Must exceed L1 shipyard garrison (25) so the opening claim is possible
      populationCap: 40,
      garrisonBase: 40,
      garrisonPerLevel: 8,
      upgradeBaseCost: 25,
      incomeMode: "bank",
      creditLevelFactor: 0.2,
      popLevelFactor: 0.15,
      popCapLevelFactor: 0.12,
      garrisonLevelFactor: 0,
      cargoLevelFactor: 0,
      buildProgressLevelFactor: 0,
      buildSlotsPerLevel: 0,
    },
    core_world: {
      creditsPerPulse: 2,
      populationPerPulse: 3,
      populationCap: 40,
      garrisonBase: 20,
      garrisonPerLevel: 5,
      upgradeBaseCost: 20,
      incomeMode: "bank",
      creditLevelFactor: 0.12,
      popLevelFactor: 0.22,
      popCapLevelFactor: 0.18,
      garrisonLevelFactor: 0,
      cargoLevelFactor: 0,
      buildProgressLevelFactor: 0,
      buildSlotsPerLevel: 0,
    },
    resource: {
      creditsPerPulse: 4,
      populationPerPulse: 0,
      populationCap: 0,
      garrisonBase: 15,
      garrisonPerLevel: 4,
      upgradeBaseCost: 20,
      incomeMode: "cargo",
      creditLevelFactor: 0,
      popLevelFactor: 0,
      popCapLevelFactor: 0,
      garrisonLevelFactor: 0,
      cargoLevelFactor: 0.25,
      buildProgressLevelFactor: 0,
      buildSlotsPerLevel: 0,
    },
    shipyard: {
      creditsPerPulse: 2,
      populationPerPulse: 0,
      populationCap: 0,
      garrisonBase: 25,
      garrisonPerLevel: 6,
      upgradeBaseCost: 30,
      incomeMode: "bank",
      creditLevelFactor: 0.12,
      popLevelFactor: 0,
      popCapLevelFactor: 0,
      garrisonLevelFactor: 0,
      cargoLevelFactor: 0,
      buildProgressLevelFactor: 0.2,
      buildSlotsPerLevel: 1,
    },
    relay: {
      creditsPerPulse: 0,
      populationPerPulse: 0,
      populationCap: 0,
      garrisonBase: 10,
      garrisonPerLevel: 3,
      upgradeBaseCost: 15,
      incomeMode: "none",
      creditLevelFactor: 0,
      popLevelFactor: 0,
      popCapLevelFactor: 0,
      garrisonLevelFactor: 0,
      cargoLevelFactor: 0,
      buildProgressLevelFactor: 0,
      buildSlotsPerLevel: 0,
    },
    relic: {
      creditsPerPulse: 10,
      populationPerPulse: 0,
      populationCap: 0,
      garrisonBase: 30,
      garrisonPerLevel: 8,
      upgradeBaseCost: 40,
      incomeMode: "cargo",
      creditLevelFactor: 0,
      popLevelFactor: 0,
      popCapLevelFactor: 0,
      garrisonLevelFactor: 0,
      cargoLevelFactor: 0.22,
      buildProgressLevelFactor: 0,
      buildSlotsPerLevel: 0,
    },
  },
  start: { credits: 80, population: 25, fighters: 5 },
  score: {
    ownedNode: 10,
    ownedRelicBonus: 15,
    upgradeLevelAbove1: 3,
    per10Credits: 1,
    per10Population: 1,
    per100FleetPower: 2,
    perTech: 5,
    eliminationBonus: 50,
  },
  tech: {
    advanced_propulsion: { ticksPerHopFactor: 0.8 },
    fortified_colonies: { garrisonFactor: 1.25 },
    survey_drones: { visionBonusHops: 1 },
    lane_logistics: { cargoTicksPerHopFactor: 0.75 },
    population_efficiency: { corePopFactor: 1.25 },
    orbital_shielding: { garrisonFlat: 15 },
    rapid_deployment: { buildTicksFactor: 0.75 },
  },
};

export interface SimConfig {
  msPerTick(): number;
  turnIntervalMs(): number;
  roundTicks(): number;
  balance: BalanceTable;
}

export function createSimConfig(
  balance: BalanceTable = DEFAULT_BALANCE,
  overrides?: Partial<{ roundTicks: number }>,
): SimConfig {
  const roundTicks = overrides?.roundTicks ?? balance.roundTicks;
  return {
    msPerTick: () => balance.msPerTick,
    turnIntervalMs: () => balance.turnIntervalMs,
    roundTicks: () => roundTicks,
    balance,
  };
}
