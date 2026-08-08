import { pressureBorder, reinforceRegion } from "./combat.js";
import { tryDiplomacy } from "./diplomacy.js";
import type { Empire, MacroEvent, MacroState, RegionId } from "./types.js";

export function runBotDecisions(
  state: MacroState,
  rng: () => number,
): MacroEvent[] {
  const events: MacroEvent[] = [];
  for (const eid of state.empireOrder) {
    const empire = state.empires[eid]!;
    if (!empire.alive) continue;
    events.push(...tryDiplomacy(state, empire, rng));
    decideMilitary(state, empire, rng);
  }
  return events;
}

function decideMilitary(
  state: MacroState,
  empire: Empire,
  rng: () => number,
): void {
  const owned = ownedRegions(state, empire.id);
  if (owned.length === 0) return;

  // Prefer settling wilderness while any unowned border exists
  const unownedTarget = pickUnownedNeighbor(state, empire, rng);
  if (unownedTarget) {
    const expandChance =
      0.28 +
      empire.traits.aggression * 0.2 +
      empire.traits.risk * 0.08 +
      (empire.archetype === "cautious" ? -0.12 : 0);
    if (rng() < expandChance) {
      pressureBorder(state, empire.id, unownedTarget, 1);
      return;
    }
  }

  // Reinforce: cautious / low risk empires invest more
  const reinforceChance =
    (1 - empire.traits.aggression) * 0.35 +
    (empire.archetype === "cautious" ? 0.3 : 0.08);
  if (rng() < reinforceChance) {
    const target = owned[Math.floor(rng() * owned.length)]!;
    const fraction =
      0.12 +
      empire.traits.risk * 0.05 +
      (empire.archetype === "cautious" ? 0.18 : 0);
    reinforceRegion(state.regions[target]!, fraction);
  }

  // Hostile pressure
  const attackChance =
    empire.traits.aggression * 0.35 +
    empire.traits.risk * 0.15 +
    (empire.archetype === "aggressive" ? 0.2 : 0);
  if (rng() > attackChance) return;

  const target = pickHostileTarget(state, empire, rng);
  if (!target) return;

  const margin = empire.traits.risk > 0.5 ? 1.05 : 1.35;
  if (
    localPower(state, empire.id, target) <
    targetGarrison(state, target) * margin
  ) {
    if (empire.traits.aggression < 0.7) return;
  }

  const amount =
    0.05 + empire.traits.aggression * 0.08 + empire.traits.risk * 0.05;
  pressureBorder(state, empire.id, target, amount);
}

function ownedRegions(state: MacroState, empireId: string): RegionId[] {
  return state.regionOrder.filter(
    (id) => state.regions[id]!.ownerId === empireId,
  );
}

function pickUnownedNeighbor(
  state: MacroState,
  empire: Empire,
  rng: () => number,
): RegionId | null {
  const candidates: RegionId[] = [];
  for (const rid of ownedRegions(state, empire.id)) {
    const r = state.regions[rid]!;
    for (const nid of r.neighbors) {
      if (!state.regions[nid]!.ownerId) candidates.push(nid);
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)]!;
}

function pickHostileTarget(
  state: MacroState,
  empire: Empire,
  rng: () => number,
): RegionId | null {
  const candidates: { id: RegionId; score: number }[] = [];
  for (const rid of ownedRegions(state, empire.id)) {
    const r = state.regions[rid]!;
    for (const nid of r.neighbors) {
      const n = state.regions[nid]!;
      if (!n.ownerId || n.ownerId === empire.id) continue;
      if (empire.allies.includes(n.ownerId)) continue;
      const weakness = 1 / Math.max(1, n.garrison);
      const capitalBonus =
        state.empires[n.ownerId]?.capitalRegionId === nid
          ? empire.traits.greed * 0.3
          : 0;
      candidates.push({
        id: nid,
        score: weakness + capitalBonus + rng() * 0.05,
      });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]!.id;
}

function localPower(
  state: MacroState,
  empireId: string,
  targetId: RegionId,
): number {
  const target = state.regions[targetId]!;
  let power = 0;
  for (const nid of target.neighbors) {
    const n = state.regions[nid]!;
    if (n.ownerId === empireId) power += n.garrison;
  }
  return power;
}

function targetGarrison(state: MacroState, targetId: RegionId): number {
  return Math.max(1, state.regions[targetId]!.garrison);
}
