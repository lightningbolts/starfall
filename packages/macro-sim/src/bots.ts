import { abandonSystem, beginEngagement, pressureBorder, reinforceSystem, tryColonize } from "./combat.js";
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

  const frontier = uncolonizedFrontier(state, empire);
  const small = empire.ownedSystems.size < 18;
  const isolation =
    empire.archetype === "isolationist" || empire.archetype === "cautious";

  // Overextended empires prune weak fringe worlds back to wilderness.
  const withdrawn = maybeWithdraw(state, empire, rng);
  if (withdrawn.length) events.push(...withdrawn);

  // Colonize first while wilderness remains — early game is slower on purpose.
  const early = empire.ownedSystems.size < 6;
  const expandChance =
    (isolation ? 0.32 : 0.55) +
    empire.traits.aggression * 0.1 +
    empire.traits.ambition * 0.18 +
    empire.traits.risk * 0.05 +
    (small && !early ? 0.12 : 0) -
    (early ? 0.12 : 0) -
    (empire.archetype === "technocrat" ? 0.05 : 0);

  if (frontier.length > 0 && rng() < expandChance) {
    let claims = 0;
    const maxClaims = early
      ? 1
      : small
        ? Math.max(config.maxClaimsPerPulse, 2)
        : config.maxClaimsPerPulse;
    const pool = [...frontier];
    while (claims < maxClaims && pool.length > 0) {
      const idx = Math.floor(rng() * pool.length);
      const target = pool.splice(idx, 1)[0]!;
      if (!tryColonize(state, empire, target)) {
        // Try another frontier star before giving up this pulse.
        if (pool.length === 0) break;
        continue;
      }
      claims++;
    }
  }

  // Research after expansion — less aggressive when still sprawling.
  const researchChance = frontier.length > 0 && small
    ? 0.08 + empire.traits.curiosity * 0.2
    : 0.18 + empire.traits.curiosity * 0.4;
  if (
    (empire.traits.curiosity > 0.4 || empire.archetype === "technocrat") &&
    rng() < researchChance
  ) {
    const tech = pickResearchTarget(empire, rng);
    if (tech) {
      const ev = tryResearch(state, empire, tech);
      if (ev) events.push(ev);
    }
  } else if (rng() < 0.08 + empire.traits.curiosity * 0.2) {
    const tech = pickResearchTarget(empire, rng);
    if (tech) {
      const ev = tryResearch(state, empire, tech);
      if (ev) events.push(ev);
    }
  }

  // Planetary builds — prefer cores once the frontier is under control.
  const buildChance =
    frontier.length > 0 && small
      ? 0.08
      : 0.22 + empire.traits.curiosity * 0.15 + empire.traits.ambition * 0.1;
  if (rng() < buildChance) {
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

  // Ship builds are lower priority while colonizing.
  if (!(frontier.length > 0 && small && rng() < 0.55)) {
    tryBuildShips(state, empire, rng);
  }

  const reinforceChance =
    (1 - empire.traits.aggression) * 0.28 +
    (isolation ? 0.35 : 0.06) +
    empire.traits.xenophobia * 0.05;
  if (rng() < reinforceChance) {
    const target = randomOwned(empire, rng);
    if (target) {
      const fraction =
        0.1 + empire.traits.risk * 0.04 + (isolation ? 0.16 : 0);
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

/** Pull back from a weak fringe world when sprawl or caution says so. */
function maybeWithdraw(
  state: MacroState,
  empire: Empire,
  rng: () => number,
): MacroEvent[] {
  const size = empire.ownedSystems.size;
  if (size < 6) return [];

  const isolation =
    empire.archetype === "isolationist" || empire.archetype === "cautious";
  const overextended = size > 18;
  const chance =
    (isolation ? 0.22 : 0.08) +
    (overextended ? 0.18 : 0) +
    (size > 30 ? 0.12 : 0) +
    empire.traits.xenophobia * 0.06 -
    empire.traits.ambition * 0.04;
  if (rng() > Math.max(0.04, chance)) return [];

  let bestId: SystemId | null = null;
  let bestScore = Infinity;
  for (const sid of empire.ownedSystems) {
    if (sid === empire.capitalSystemId) continue;
    const s = state.systems[sid]!;
    if (s.engagement) continue;
    let friendly = 0;
    let hostile = 0;
    let wild = 0;
    for (const nid of s.hyperlanes) {
      const o = state.systems[nid]!.ownerId;
      if (!o) wild++;
      else if (o === empire.id) friendly++;
      else hostile++;
    }
    // Prefer weakly held, poorly connected, or contested fringe.
    const score =
      s.garrison +
      friendly * 12 -
      wild * 4 -
      hostile * 6 -
      (s.contested ? 10 : 0) -
      s.developments.size * 8;
    if (score < bestScore) {
      bestScore = score;
      bestId = sid;
    }
  }
  if (!bestId) return [];
  return abandonSystem(state, state.systems[bestId]!, "withdraw");
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
