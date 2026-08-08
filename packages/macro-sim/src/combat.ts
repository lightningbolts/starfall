import { emit } from "./log.js";
import type {
  Empire,
  EmpireId,
  MacroConfig,
  MacroEvent,
  MacroState,
  StarSystem,
  SystemId,
} from "./types.js";

export interface CombatResult {
  events: MacroEvent[];
  flipped: SystemId[];
}

/**
 * Every ownership change goes through here so `Empire.ownedSystems` stays an
 * accurate index and no module has to scan the whole galaxy.
 */
export function setSystemOwner(
  state: MacroState,
  system: StarSystem,
  ownerId: EmpireId | null,
): void {
  if (system.ownerId === ownerId) return;
  if (system.ownerId) {
    state.empires[system.ownerId]?.ownedSystems.delete(system.id);
  }
  system.ownerId = ownerId;
  if (ownerId) state.empires[ownerId]?.ownedSystems.add(system.id);
}

/**
 * Credits needed to colonize one more star. Superlinear in territory, so
 * empires sprawl fast early and then stall until they take someone else's
 * space.
 */
export function colonizeCost(empire: Empire): number {
  const owned = empire.ownedSystems.size;
  return 8 + 1.4 * Math.pow(owned, 1.35);
}

/**
 * Fund a claim from the treasuries of adjacent owned systems. Returns false
 * when the frontier cannot pay, which is what paces expansion.
 */
export function tryColonize(
  state: MacroState,
  empire: Empire,
  systemId: SystemId,
): boolean {
  const target = state.systems[systemId];
  if (!target || target.ownerId) return false;

  const funders: StarSystem[] = [];
  let available = 0;
  for (const nid of target.hyperlanes) {
    const n = state.systems[nid];
    if (!n || n.ownerId !== empire.id) continue;
    funders.push(n);
    available += n.credits;
  }
  if (funders.length === 0) return false;

  const cost = colonizeCost(empire);
  if (available < cost) return false;

  for (const funder of funders) {
    funder.credits -= cost * (funder.credits / available);
  }

  setSystemOwner(state, target, empire.id);
  target.contested = null;
  target.population = Math.max(target.population, 14);
  target.credits = 4;
  target.garrison = Math.max(target.garrison, 10);

  // A nearby garrison escorts the colony ship.
  for (const funder of funders) {
    if (funder.garrison <= 18) continue;
    const spend = Math.min(funder.garrison * 0.12, 14);
    funder.garrison -= spend;
    target.garrison += spend * 0.6;
    break;
  }
  return true;
}

/**
 * Drift contested fronts on borders; flip ownership past threshold.
 * Mutates state systems/empires.
 */
export function resolveContestedFronts(
  state: MacroState,
  config: MacroConfig,
): CombatResult {
  const events: MacroEvent[] = [];
  const flipped: SystemId[] = [];
  const tick = state.tick;

  for (const sid of state.systemOrder) {
    const system = state.systems[sid]!;
    if (!system.ownerId) continue;
    const owner = state.empires[system.ownerId];
    if (!owner?.alive) continue;

    // Find strongest hostile neighbor pressure
    let bestVs: EmpireId | null = null;
    let bestRatio = 0;
    let bestEnemyGarrison = 0;

    for (const nid of system.hyperlanes) {
      const n = state.systems[nid]!;
      if (!n.ownerId || n.ownerId === system.ownerId) continue;
      const enemy = state.empires[n.ownerId];
      if (!enemy?.alive) continue;
      if (owner.allies.includes(n.ownerId)) continue;
      const pressure = n.garrison / Math.max(1, system.garrison);
      if (pressure > bestRatio) {
        bestRatio = pressure;
        bestVs = n.ownerId;
        bestEnemyGarrison = n.garrison;
      }
    }

    if (!bestVs) {
      // Peaceful hinterland — ease contested down
      if (system.contested) {
        system.contested.pct = Math.max(
          0,
          system.contested.pct - config.contestedDriftScale * 0.5,
        );
        if (system.contested.pct <= 0.02) system.contested = null;
      }
      continue;
    }

    // Overwhelming force must collapse a front fast, or wars stalemate forever.
    const advantage = Math.tanh((bestRatio - 1) * 1.2);
    const decisive = 1 + Math.min(3, Math.max(0, bestRatio - 1.5));
    const drift =
      config.contestedDriftScale *
      advantage *
      decisive *
      (0.6 + 0.4 * (state.empires[bestVs]?.traits.aggression ?? 0.5));

    if (!system.contested || system.contested.vs !== bestVs) {
      system.contested = { vs: bestVs, pct: Math.max(0, drift) };
    } else {
      system.contested.pct = clamp01(system.contested.pct + drift);
    }

    if (system.contested.pct >= config.contestedFlipThreshold) {
      const from = system.ownerId;
      const to = bestVs;
      const wasCapital = owner.capitalSystemId === sid;
      flipSystem(state, system, to, bestEnemyGarrison * 0.25);
      flipped.push(sid);

      events.push(
        emit(state, {
          tick,
          kind: "front_collapse",
          empireIds: [from, to],
          systemId: sid,
          text: `${state.empires[to]!.name} takes ${system.name} from ${owner.name}.`,
        }),
      );

      if (wasCapital) {
        events.push(
          emit(state, {
            tick,
            kind: "capital_fallen",
            empireIds: [from, to],
            systemId: sid,
            text: `${owner.name} loses its throneworld ${system.name} to ${state.empires[to]!.name}!`,
          }),
        );
        rehomeOrEliminate(state, from, events);
      }
    }
  }

  return { events, flipped };
}

function flipSystem(
  state: MacroState,
  system: StarSystem,
  to: EmpireId,
  leftoverGarrison: number,
): void {
  setSystemOwner(state, system, to);
  system.garrison = Math.max(8, leftoverGarrison);
  system.contested = null;
  system.population *= 0.85;
  system.credits *= 0.5;
}

function rehomeOrEliminate(
  state: MacroState,
  empireId: EmpireId,
  events: MacroEvent[],
): void {
  const empire = state.empires[empireId]!;
  if (empire.ownedSystems.size === 0) {
    empire.alive = false;
    empire.allies = [];
    for (const other of Object.values(state.empires)) {
      other.allies = other.allies.filter((a) => a !== empireId);
    }
    events.push(
      emit(state, {
        tick: state.tick,
        kind: "empire_eliminated",
        empireIds: [empireId],
        systemId: null,
        text: `${empire.name} has been eliminated.`,
      }),
    );
    return;
  }
  // Fall back on the strongest remaining garrison.
  let best: SystemId | null = null;
  let bestG = -1;
  for (const id of empire.ownedSystems) {
    const g = state.systems[id]!.garrison;
    if (g > bestG) {
      bestG = g;
      best = id;
    }
  }
  if (best) empire.capitalSystemId = best;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Bot-driven pressure on a hostile border system. */
export function pressureBorder(
  state: MacroState,
  attackerId: EmpireId,
  systemId: SystemId,
  amount: number,
): void {
  const system = state.systems[systemId];
  if (!system || system.ownerId === attackerId) return;
  if (!system.ownerId) {
    const attacker = state.empires[attackerId];
    if (attacker) tryColonize(state, attacker, systemId);
    return;
  }
  const owner = state.empires[system.ownerId];
  if (!owner || owner.allies.includes(attackerId)) return;
  if (!system.contested || system.contested.vs !== attackerId) {
    system.contested = { vs: attackerId, pct: amount };
  } else {
    system.contested.pct = clamp01(system.contested.pct + amount);
  }
  // Spend some attacker garrison from an adjacent owned system
  for (const nid of system.hyperlanes) {
    const n = state.systems[nid]!;
    if (n.ownerId === attackerId && n.garrison > 20) {
      const spend = Math.min(n.garrison * 0.15, 40);
      n.garrison -= spend;
      break;
    }
  }
}

export function reinforceSystem(system: StarSystem, fraction: number): void {
  const move = system.credits * fraction;
  system.credits -= move;
  system.garrison += move * 0.9;
}
