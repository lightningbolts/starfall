import { pressureBorder, reinforceSystem, tryColonize } from "./combat.js";
import { tryDiplomacy } from "./diplomacy.js";
import type {
  Empire,
  MacroConfig,
  MacroEvent,
  MacroState,
  SystemId,
} from "./types.js";

export function runBotDecisions(
  state: MacroState,
  config: MacroConfig,
  rng: () => number,
  withDiplomacy: boolean,
): MacroEvent[] {
  const events: MacroEvent[] = [];
  for (const eid of state.empireOrder) {
    const empire = state.empires[eid]!;
    if (!empire.alive) continue;
    if (withDiplomacy) events.push(...tryDiplomacy(state, empire, rng));
    decideMilitary(state, empire, config, rng);
  }
  return events;
}

function decideMilitary(
  state: MacroState,
  empire: Empire,
  config: MacroConfig,
  rng: () => number,
): void {
  if (empire.ownedSystems.size === 0) return;

  // Colonize while affordable frontier stars remain.
  const expandChance =
    0.55 +
    empire.traits.aggression * 0.2 +
    empire.traits.risk * 0.1 +
    (empire.archetype === "cautious" ? -0.15 : 0);
  if (rng() < expandChance) {
    const frontier = uncolonizedFrontier(state, empire);
    let claims = 0;
    while (claims < config.maxClaimsPerPulse && frontier.length > 0) {
      const idx = Math.floor(rng() * frontier.length);
      const target = frontier.splice(idx, 1)[0]!;
      if (!tryColonize(state, empire, target)) break;
      claims++;
    }
    if (claims > 0) return;
  }

  // Reinforce: cautious / low risk empires invest more
  const reinforceChance =
    (1 - empire.traits.aggression) * 0.35 +
    (empire.archetype === "cautious" ? 0.3 : 0.08);
  if (rng() < reinforceChance) {
    const target = randomOwned(empire, rng);
    if (target) {
      const fraction =
        0.12 +
        empire.traits.risk * 0.05 +
        (empire.archetype === "cautious" ? 0.18 : 0);
      reinforceSystem(state.systems[target]!, fraction);
    }
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

function uncolonizedFrontier(state: MacroState, empire: Empire): SystemId[] {
  const out: SystemId[] = [];
  const seen = new Set<SystemId>();
  for (const sid of empire.ownedSystems) {
    for (const nid of state.systems[sid]!.hyperlanes) {
      if (seen.has(nid)) continue;
      seen.add(nid);
      if (!state.systems[nid]!.ownerId) out.push(nid);
    }
  }
  return out;
}

function randomOwned(empire: Empire, rng: () => number): SystemId | null {
  const size = empire.ownedSystems.size;
  if (size === 0) return null;
  let target = Math.floor(rng() * size);
  for (const id of empire.ownedSystems) {
    if (target === 0) return id;
    target--;
  }
  return null;
}

function pickHostileTarget(
  state: MacroState,
  empire: Empire,
  rng: () => number,
): SystemId | null {
  let bestId: SystemId | null = null;
  let bestScore = -Infinity;
  for (const sid of empire.ownedSystems) {
    for (const nid of state.systems[sid]!.hyperlanes) {
      const n = state.systems[nid]!;
      if (!n.ownerId || n.ownerId === empire.id) continue;
      if (empire.allies.includes(n.ownerId)) continue;
      const weakness = 1 / Math.max(1, n.garrison);
      const capitalBonus =
        state.empires[n.ownerId]?.capitalSystemId === nid
          ? empire.traits.greed * 0.3
          : 0;
      const score = weakness + capitalBonus + rng() * 0.05;
      if (score > bestScore) {
        bestScore = score;
        bestId = nid;
      }
    }
  }
  return bestId;
}

function localPower(
  state: MacroState,
  empireId: string,
  targetId: SystemId,
): number {
  const target = state.systems[targetId]!;
  let power = 0;
  for (const nid of target.hyperlanes) {
    const n = state.systems[nid]!;
    if (n.ownerId === empireId) power += n.garrison;
  }
  return power;
}

function targetGarrison(state: MacroState, targetId: SystemId): number {
  return Math.max(1, state.systems[targetId]!.garrison);
}
