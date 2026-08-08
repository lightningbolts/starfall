import type {
  Empire,
  EmpireId,
  MacroConfig,
  MacroEvent,
  MacroState,
  Region,
  RegionId,
} from "./types.js";

export interface CombatResult {
  events: MacroEvent[];
  flipped: RegionId[];
}

/**
 * Drift contested fronts on borders; flip ownership past threshold.
 * Mutates state regions/empires.
 */
export function resolveContestedFronts(
  state: MacroState,
  config: MacroConfig,
): CombatResult {
  const events: MacroEvent[] = [];
  const flipped: RegionId[] = [];
  const tick = state.tick;

  for (const rid of state.regionOrder) {
    const region = state.regions[rid]!;
    if (!region.ownerId) continue;
    const owner = state.empires[region.ownerId];
    if (!owner?.alive) continue;

    // Find strongest hostile neighbor pressure
    let bestVs: EmpireId | null = null;
    let bestRatio = 0;
    let bestEnemyGarrison = 0;

    for (const nid of region.neighbors) {
      const n = state.regions[nid]!;
      if (!n.ownerId || n.ownerId === region.ownerId) continue;
      const enemy = state.empires[n.ownerId];
      if (!enemy?.alive) continue;
      if (owner.allies.includes(n.ownerId)) continue;
      const pressure = n.garrison / Math.max(1, region.garrison);
      if (pressure > bestRatio) {
        bestRatio = pressure;
        bestVs = n.ownerId;
        bestEnemyGarrison = n.garrison;
      }
    }

    if (!bestVs) {
      // Peaceful hinterland — ease contested down
      if (region.contested) {
        region.contested.pct = Math.max(0, region.contested.pct - config.contestedDriftScale * 0.5);
        if (region.contested.pct <= 0.02) region.contested = null;
      }
      continue;
    }

    const drift =
      config.contestedDriftScale *
      Math.tanh((bestRatio - 1) * 1.2) *
      (0.6 + 0.4 * (state.empires[bestVs]?.traits.aggression ?? 0.5));

    if (!region.contested || region.contested.vs !== bestVs) {
      region.contested = { vs: bestVs, pct: Math.max(0, drift) };
    } else {
      region.contested.pct = clamp01(region.contested.pct + drift);
    }

    if (region.contested.pct >= config.contestedFlipThreshold) {
      const from = region.ownerId;
      const to = bestVs;
      const wasCapital = owner.capitalRegionId === rid;
      flipRegion(state, region, to, bestEnemyGarrison * 0.25);
      flipped.push(rid);

      events.push({
        tick,
        kind: "front_collapse",
        empireIds: [from, to],
        regionId: rid,
        text: `${state.empires[to]!.name} seizes a contested border from ${owner.name}.`,
      });

      if (wasCapital) {
        events.push({
          tick,
          kind: "capital_fallen",
          empireIds: [from, to],
          regionId: rid,
          text: `Capital of ${owner.name} has fallen to ${state.empires[to]!.name}!`,
        });
        rehomeOrEliminate(state, from, events);
      }
    }
  }

  return { events, flipped };
}

function flipRegion(
  state: MacroState,
  region: Region,
  to: EmpireId,
  leftoverGarrison: number,
): void {
  region.ownerId = to;
  region.garrison = Math.max(8, leftoverGarrison);
  region.contested = null;
  region.population *= 0.85;
  region.credits *= 0.5;
}

function rehomeOrEliminate(
  state: MacroState,
  empireId: EmpireId,
  events: MacroEvent[],
): void {
  const empire = state.empires[empireId]!;
  const owned = state.regionOrder.filter(
    (id) => state.regions[id]!.ownerId === empireId,
  );
  if (owned.length === 0) {
    empire.alive = false;
    empire.allies = [];
    for (const other of Object.values(state.empires)) {
      other.allies = other.allies.filter((a) => a !== empireId);
    }
    events.push({
      tick: state.tick,
      kind: "empire_eliminated",
      empireIds: [empireId],
      regionId: null,
      text: `${empire.name} has been eliminated.`,
    });
    return;
  }
  // Pick densest garrison as new capital
  let best = owned[0]!;
  let bestG = -1;
  for (const id of owned) {
    const g = state.regions[id]!.garrison;
    if (g > bestG) {
      bestG = g;
      best = id;
    }
  }
  empire.capitalRegionId = best;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Bot-driven pressure: boost contested on a chosen border. */
export function pressureBorder(
  state: MacroState,
  attackerId: EmpireId,
  regionId: RegionId,
  amount: number,
): void {
  const region = state.regions[regionId];
  if (!region || region.ownerId === attackerId) return;
  if (!region.ownerId) {
    // Claim unowned wilderness
    region.ownerId = attackerId;
    region.contested = null;
    region.garrison = Math.max(12, region.garrison);
    region.population = Math.max(region.population, 20);
    region.credits = Math.max(region.credits, 8);
    for (const nid of region.neighbors) {
      const n = state.regions[nid]!;
      if (n.ownerId === attackerId && n.garrison > 15) {
        const spend = Math.min(n.garrison * 0.1, 12);
        n.garrison -= spend;
        region.garrison += spend * 0.5;
        break;
      }
    }
    return;
  }
  const owner = state.empires[region.ownerId];
  if (!owner || owner.allies.includes(attackerId)) return;
  if (!region.contested || region.contested.vs !== attackerId) {
    region.contested = { vs: attackerId, pct: amount };
  } else {
    region.contested.pct = clamp01(region.contested.pct + amount);
  }
  // Spend some attacker garrison from an adjacent owned region
  for (const nid of region.neighbors) {
    const n = state.regions[nid]!;
    if (n.ownerId === attackerId && n.garrison > 20) {
      const spend = Math.min(n.garrison * 0.15, 40);
      n.garrison -= spend;
      break;
    }
  }
}

export function reinforceRegion(region: Region, fraction: number): void {
  const move = region.credits * fraction;
  region.credits -= move;
  region.garrison += move * 0.9;
}
