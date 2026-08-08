import { beginEngagement, pressureBorder, reinforceSystem, tryColonize } from "./combat.js";
import { tryDiplomacy } from "./diplomacy.js";
import { tryBuildShips } from "./economy.js";
import { fleetPower } from "./ships.js";
import {
  pickPlanetaryTarget,
  pickResearchTarget,
  tryBuildPlanetary,
  tryResearch,
} from "./tech.js";
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
    events.push(...decideMilitary(state, empire, config, rng));
  }
  return events;
}

function decideMilitary(
  state: MacroState,
  empire: Empire,
  config: MacroConfig,
  rng: () => number,
): MacroEvent[] {
  const events: MacroEvent[] = [];
  if (empire.ownedSystems.size === 0) return events;

  // Technocrats research first.
  if (
    empire.traits.curiosity > 0.45 ||
    empire.archetype === "technocrat"
  ) {
    if (rng() < 0.35 + empire.traits.curiosity * 0.5) {
      const tech = pickResearchTarget(empire, rng);
      if (tech) {
        const ev = tryResearch(state, empire, tech);
        if (ev) events.push(ev);
      }
    }
  } else if (rng() < 0.12 + empire.traits.curiosity * 0.25) {
    const tech = pickResearchTarget(empire, rng);
    if (tech) {
      const ev = tryResearch(state, empire, tech);
      if (ev) events.push(ev);
    }
  }

  // Planetary developments
  if (rng() < 0.25 + empire.traits.curiosity * 0.15 + empire.traits.ambition * 0.1) {
    const sid = randomOwned(empire, rng);
    if (sid) {
      const system = state.systems[sid]!;
      const dev = pickPlanetaryTarget(empire, system, rng);
      if (dev) {
        const ev = tryBuildPlanetary(state, empire, system, dev);
        if (ev) events.push(ev);
      }
    }
  }

  tryBuildShips(state, empire, rng);

  const isolation =
    empire.archetype === "isolationist" || empire.archetype === "cautious";
  const expandChance =
    (isolation ? 0.28 : 0.4) +
    empire.traits.aggression * 0.15 +
    empire.traits.ambition * 0.2 +
    empire.traits.risk * 0.08 -
    (empire.archetype === "technocrat" ? 0.08 : 0);

  if (rng() < expandChance) {
    const frontier = uncolonizedFrontier(state, empire);
    let claims = 0;
    const maxClaims =
      empire.traits.ambition > 0.7
        ? config.maxClaimsPerPulse
        : Math.max(1, config.maxClaimsPerPulse - 1);
    while (claims < maxClaims && frontier.length > 0) {
      const idx = Math.floor(rng() * frontier.length);
      const target = frontier.splice(idx, 1)[0]!;
      if (!tryColonize(state, empire, target)) break;
      claims++;
    }
    // Do NOT return early — allow attack same pulse.
  }

  const reinforceChance =
    (1 - empire.traits.aggression) * 0.28 +
    (isolation ? 0.35 : 0.06) +
    empire.traits.xenophobia * 0.05;
  if (rng() < reinforceChance) {
    const target = randomOwned(empire, rng);
    if (target) {
      const fraction =
        0.1 +
        empire.traits.risk * 0.04 +
        (isolation ? 0.16 : 0);
      reinforceSystem(state.systems[target]!, fraction);
    }
  }

  const attackChance =
    empire.traits.aggression * 0.42 +
    empire.traits.risk * 0.18 +
    empire.traits.ambition * 0.15 +
    empire.traits.xenophobia * 0.1 +
    (empire.archetype === "aggressive" || empire.archetype === "conqueror"
      ? 0.22
      : 0) +
    (empire.archetype === "reckless" ? 0.25 : 0) -
    (empire.archetype === "strategist" ? 0.05 : 0) -
    (isolation ? 0.2 : 0);

  if (rng() > attackChance) return events;

  const target = pickHostileTarget(state, empire, rng);
  if (!target) return events;

  let margin = empire.traits.risk > 0.55 ? 1.0 : 1.25;
  if (empire.archetype === "reckless") margin = 0.85;
  if (empire.archetype === "strategist") margin = 1.45;
  if (empire.researched.has("war_mobilization")) margin *= 0.92;

  const local = localPower(state, empire.id, target);
  const targetPow = targetPower(state, target);
  if (local < targetPow * margin) {
    if (empire.traits.aggression < 0.65 && empire.traits.ambition < 0.7) {
      return events;
    }
  }

  const amount =
    0.1 +
    empire.traits.aggression * 0.12 +
    empire.traits.risk * 0.08 +
    (empire.researched.has("war_mobilization") ? 0.08 : 0);

  pressureBorder(state, empire.id, target, amount, rng);

  // Conquerors finish wounded empires.
  if (empire.traits.ambition > 0.75 && rng() < 0.4) {
    const sys = state.systems[target]!;
    if (sys.ownerId && state.empires[sys.ownerId]!.ownedSystems.size < 5) {
      beginEngagement(
        state,
        sys,
        empire.id,
        sys.developments.has("fortress_complex") ? "siege" : "fleet_battle",
        rng,
      );
    }
  }

  return events;
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
      const foe = state.empires[n.ownerId]!;
      const weakness = 1 / Math.max(1, n.garrison + fleetPower(n.defenseMix));
      const capitalBonus =
        foe.capitalSystemId === nid ? empire.traits.greed * 0.35 : 0;
      const woundedBonus =
        foe.ownedSystems.size < 6 ? empire.traits.ambition * 0.4 : 0;
      const contestedBonus = n.contested?.vs === empire.id ? 0.25 : 0;
      const score =
        weakness + capitalBonus + woundedBonus + contestedBonus + rng() * 0.05;
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
  let power = fleetPower(state.empires[empireId]!.fleet) * 0.2;
  for (const nid of target.hyperlanes) {
    const n = state.systems[nid]!;
    if (n.ownerId === empireId) power += n.garrison;
  }
  return power;
}

function targetPower(state: MacroState, targetId: SystemId): number {
  const s = state.systems[targetId]!;
  return Math.max(1, s.garrison + fleetPower(s.defenseMix));
}
