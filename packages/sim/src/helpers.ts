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
  // Base table: garrisonBase + perLevel * levelsAbove
  let g = rb.garrisonBase + levelsAbove * rb.garrisonPerLevel;
  // Homeworld also scales garrison +20% per level above 1 (balance.md)
  if (role === "homeworld" && levelsAbove > 0) {
    g = Math.floor(g * (1 + levelsAbove * rb.garrisonLevelFactor));
  }
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
  return Math.floor(base * Math.pow(balance.upgradeGrowth, target - 2));
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
  if (researched.has("rapid_deployment")) {
    ticks = Math.max(
      1,
      Math.floor(ticks * balance.tech.rapid_deployment.buildTicksFactor),
    );
  }
  // Shipyard levels speed production: +25% progress per level above 1
  // Implemented as reduced ticks: ticks / (1 + 0.25*(L-1))
  if (role === "shipyard" && nodeLevel > 1) {
    const factor =
      1 +
      (nodeLevel - 1) * balance.roles.shipyard.buildProgressLevelFactor;
    ticks = Math.max(1, Math.floor(ticks / factor));
  }
  return ticks;
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
