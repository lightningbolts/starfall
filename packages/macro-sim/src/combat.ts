import { emit } from "./log.js";
import { createRng } from "./rng.js";
import {
  cloneFleet,
  doctrineFactor,
  effectiveCombatPower,
  emptyFleet,
  engagementDuration,
  engagementIntensity,
  fleetPower,
  mergeFleets,
  resolveCombatTick,
  syncDefenseMix,
  takeShips,
  tacticsFactor,
  formatComposition,
} from "./ships.js";
import { colonizeCostMult, stripDevelopmentsOnFlip } from "./tech.js";
import type {
  ActiveEngagement,
  Empire,
  EmpireId,
  EngagementMode,
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
 * Credits needed to colonize one more star. Grows with territory so sprawl
 * decelerates, but stays affordable on the early/mid frontier.
 */
export function colonizeCost(empire: Empire): number {
  const owned = empire.ownedSystems.size;
  // Early colonies are a real investment; mid-game softens then sprawl tax bites.
  // ~11 at 1, ~18 at 5, ~28 at 12, ~55 at 30, ~95 at 50.
  const earlyPremium = owned < 6 ? 4.5 : owned < 12 ? 2 : 0;
  return (7 + earlyPremium + 1.15 * Math.pow(owned, 1.2)) * colonizeCostMult(empire);
}

/**
 * Fund a claim — prefer adjacent treasuries, then pull from the wider empire
 * so a rich core can still seed the frontier.
 */
export function tryColonize(
  state: MacroState,
  empire: Empire,
  systemId: SystemId,
): boolean {
  const target = state.systems[systemId];
  if (!target || target.ownerId) return false;

  const adjacent: StarSystem[] = [];
  let adjacentCredits = 0;
  for (const nid of target.hyperlanes) {
    const n = state.systems[nid];
    if (!n || n.ownerId !== empire.id) continue;
    adjacent.push(n);
    adjacentCredits += n.credits;
  }
  if (adjacent.length === 0) return false;

  const cost = colonizeCost(empire);
  let pool = adjacentCredits;
  const extras: StarSystem[] = [];
  if (pool < cost) {
    for (const sid of empire.ownedSystems) {
      const s = state.systems[sid]!;
      if (adjacent.includes(s)) continue;
      extras.push(s);
      pool += s.credits;
    }
  }
  if (pool < cost) return false;

  let remaining = cost;
  const payFrom = (systems: StarSystem[], available: number): void => {
    if (available <= 0 || remaining <= 0) return;
    const take = Math.min(remaining, available);
    for (const s of systems) {
      if (remaining <= 0) break;
      const share = available > 0 ? (s.credits / available) * take : 0;
      const paid = Math.min(s.credits, share);
      s.credits -= paid;
      remaining -= paid;
    }
  };

  payFrom(adjacent, adjacentCredits);
  if (remaining > 0.01) {
    const extraAvail = extras.reduce((sum, s) => sum + s.credits, 0);
    payFrom(extras, extraAvail);
  }
  if (remaining > 0.5) return false;

  setSystemOwner(state, target, empire.id);
  target.contested = null;
  target.engagement = null;
  target.population = Math.max(target.population, 14);
  target.credits = 4;
  target.garrison = Math.max(target.garrison, 10);
  target.developments = new Set();
  syncDefenseMix(target);

  for (const funder of adjacent) {
    if (funder.garrison <= 18) continue;
    const spend = Math.min(funder.garrison * 0.12, 14);
    funder.garrison -= spend;
    target.garrison += spend * 0.6;
    break;
  }
  return true;
}

/**
 * Advance active engagements and drift contested fronts; flip past threshold.
 */
export function resolveContestedFronts(
  state: MacroState,
  config: MacroConfig,
): CombatResult {
  const events: MacroEvent[] = [];
  const flipped: SystemId[] = [];
  const tick = state.tick;
  const rng = createRng(state.seed ^ (tick * 0x85ebca6b));

  for (const sid of state.systemOrder) {
    const system = state.systems[sid]!;
    if (system.engagement) {
      events.push(...tickEngagement(state, system, config, rng));
      if (
        system.contested &&
        system.contested.pct >= config.contestedFlipThreshold
      ) {
        const from = system.ownerId;
        const to = system.contested.vs;
        if (from && to) {
          const owner = state.empires[from]!;
          const wasCapital = owner.capitalSystemId === sid;
          const leftover = fleetPower(system.engagement?.committedA ?? emptyFleet()) * 0.2;
          flipSystem(state, system, to, Math.max(8, leftover / 10));
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
      continue;
    }

    if (!system.ownerId) continue;
    const owner = state.empires[system.ownerId];
    if (!owner?.alive) continue;

    let bestVs: EmpireId | null = null;
    let bestRatio = 0;
    let bestEnemyGarrison = 0;

    for (const nid of system.hyperlanes) {
      const n = state.systems[nid]!;
      if (!n.ownerId || n.ownerId === system.ownerId) continue;
      const enemy = state.empires[n.ownerId];
      if (!enemy?.alive) continue;
      if (owner.allies.includes(n.ownerId)) continue;
      const attackerPower = Math.max(
        1,
        fleetPower(enemy.fleet) * 0.15 + n.garrison,
      );
      const defenderPower = Math.max(
        1,
        fleetPower(system.defenseMix) + system.garrison,
      );
      const pressure = attackerPower / defenderPower;
      if (pressure > bestRatio) {
        bestRatio = pressure;
        bestVs = n.ownerId;
        bestEnemyGarrison = n.garrison;
      }
    }

    if (!bestVs) {
      if (system.contested) {
        let decay = config.contestedDriftScale * 0.5;
        if (owner.researched.has("iron_curtain")) decay *= 0.55;
        if (system.developments.has("fortress_complex")) decay *= 0.6;
        system.contested.pct = Math.max(0, system.contested.pct - decay);
        if (system.contested.pct <= 0.02) system.contested = null;
      }
      continue;
    }

    // Near-parity still drifts slowly toward the stronger neighbor.
    const advantage = Math.tanh((bestRatio - 0.85) * 1.1);
    const decisive = 1 + Math.min(3, Math.max(0, bestRatio - 1.3));
    let drift =
      config.contestedDriftScale *
      Math.max(0.15, advantage) *
      decisive *
      (0.6 + 0.4 * (state.empires[bestVs]?.traits.aggression ?? 0.5));
    if (state.empires[bestVs]?.researched.has("deep_scanners")) drift *= 1.15;

    if (!system.contested || system.contested.vs !== bestVs) {
      system.contested = { vs: bestVs, pct: Math.max(0, drift) };
    } else {
      system.contested.pct = clamp01(system.contested.pct + drift);
    }

    // Auto-escalate to an engagement when pressure is meaningful.
    if (system.contested.pct > 0.18 && bestRatio > 0.9 && rng() < 0.08) {
      const mode: EngagementMode =
        owner.capitalSystemId === sid ||
        system.developments.has("fortress_complex")
          ? "siege"
          : bestRatio > 1.4
            ? "fleet_battle"
            : "skirmish";
      beginEngagement(state, system, bestVs, mode, rng);
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

function tickEngagement(
  state: MacroState,
  system: StarSystem,
  config: MacroConfig,
  rng: () => number,
): MacroEvent[] {
  const eng = system.engagement!;
  const attacker = state.empires[eng.attackerId];
  const defender = state.empires[eng.defenderId];
  const events: MacroEvent[] = [];
  if (!attacker?.alive || !defender?.alive) {
    system.engagement = null;
    return events;
  }

  const tacticsRng = createRng(eng.tacticsSeed ^ (eng.ticksElapsed * 9973));
  let aEff =
    effectiveCombatPower(eng.committedA, eng.committedB) *
    tacticsFactor(attacker, tacticsRng, eng.mode) *
    doctrineFactor(attacker, eng.mode);
  let bEff =
    effectiveCombatPower(eng.committedB, eng.committedA) *
    tacticsFactor(defender, tacticsRng, eng.mode) *
    doctrineFactor(defender, eng.mode);

  if (eng.mode === "siege") {
    bEff *= 1.15 + (system.developments.has("orbital_batteries") ? 0.2 : 0);
    bEff *= system.developments.has("fortress_complex") ? 1.25 : 1;
    if (defender.researched.has("planetary_shields")) bEff *= 1.1;
  }
  if (eng.mode === "raid") {
    aEff *= 1.1;
    bEff *= 0.85;
  }
  if (attacker.modifiers.attackPressureTicksLeft > 0) {
    aEff *= attacker.modifiers.attackPressure;
  }

  const fraction = 1 / Math.max(1, eng.ticksRemaining);
  const next = resolveCombatTick(
    eng.committedA,
    eng.committedB,
    aEff,
    bEff,
    fraction,
  );
  eng.committedA = next.a;
  eng.committedB = next.b;
  eng.ticksElapsed += 1;
  eng.ticksRemaining = Math.max(0, eng.ticksRemaining - 1);

  const margin = (aEff - bEff) / Math.max(1, aEff + bEff);
  if (!system.contested || system.contested.vs !== eng.attackerId) {
    system.contested = {
      vs: eng.attackerId,
      pct: Math.max(0.05, margin * 0.1),
    };
  } else {
    system.contested.pct = clamp01(
      system.contested.pct + margin * config.contestedDriftScale * 4,
    );
  }

  // Attrition bleeds lightly into system garrison.
  system.garrison = Math.max(
    4,
    system.garrison * (1 - Math.abs(margin) * 0.008),
  );
  syncDefenseMix(system);

  const wiped =
    fleetPower(eng.committedA) < 5 || fleetPower(eng.committedB) < 5;
  if (eng.ticksRemaining <= 0 || wiped) {
    const aWon = fleetPower(eng.committedA) >= fleetPower(eng.committedB);
    // Return survivors to strategic pools.
    attacker.fleet = mergeFleets(attacker.fleet, eng.committedA);
    // Defender survivors reinforce local defense / garrison budget.
    const defPower = fleetPower(eng.committedB);
    system.garrison = Math.max(system.garrison, defPower / 12);
    syncDefenseMix(system);

    if (eng.mode === "raid" && aWon) {
      system.credits *= 0.7;
      system.population *= 0.9;
    }

    events.push(
      emit(state, {
        tick: state.tick,
        kind: eng.mode === "skirmish" ? "border_clash" : "fleet_battle",
        empireIds: [eng.attackerId, eng.defenderId],
        systemId: system.id,
        text: aWon
          ? `${attacker.name} prevails at ${system.name} (${formatComposition(eng.committedA)} remain).`
          : `${defender.name} holds ${system.name} against ${attacker.name} (${formatComposition(eng.committedB)} remain).`,
      }),
    );
    system.engagement = null;
  }

  return events;
}

export function beginEngagement(
  state: MacroState,
  system: StarSystem,
  attackerId: EmpireId,
  mode: EngagementMode,
  rng: () => number,
): ActiveEngagement | null {
  if (!system.ownerId || system.engagement) return null;
  const attacker = state.empires[attackerId];
  const defender = state.empires[system.ownerId];
  if (!attacker?.alive || !defender?.alive) return null;

  const commitFrac =
    mode === "skirmish" ? 0.06 : mode === "raid" ? 0.05 : mode === "siege" ? 0.18 : 0.12;
  const pressure =
    attacker.modifiers.attackPressureTicksLeft > 0
      ? attacker.modifiers.attackPressure
      : 1;
  const committedA = takeShips(attacker.fleet, commitFrac * Math.min(1.15, pressure));
  syncDefenseMix(system);
  const committedB = cloneFleet(system.defenseMix);
  // Pull some defender strategic fleet for non-raid.
  if (mode !== "raid") {
    const reinf = takeShips(defender.fleet, mode === "siege" ? 0.1 : 0.07);
    Object.assign(committedB, mergeFleets(committedB, reinf));
  }

  if (fleetPower(committedA) < 8 && fleetPower(attacker.fleet) > 0) {
    Object.assign(committedA, takeShips(attacker.fleet, 0.08));
  }

  const totalPower = fleetPower(committedA) + fleetPower(committedB);
  const parity =
    1 -
    Math.abs(fleetPower(committedA) - fleetPower(committedB)) /
      Math.max(1, totalPower);
  const siegeBonus =
    (system.developments.has("fortress_complex") ? 1 : 0) +
    (system.developments.has("orbital_batteries") ? 0.6 : 0) +
    (defender.capitalSystemId === system.id ? 0.8 : 0);

  let duration = engagementDuration(mode, totalPower, parity, siegeBonus);
  if (attacker.modifiers.attackPressureTicksLeft > 0 && mode !== "siege") {
    duration = Math.max(6, Math.round(duration * 0.7));
  }
  if (mode === "siege" && system.developments.has("fortress_complex")) {
    duration = Math.round(duration * 1.25);
  }

  const intensity = engagementIntensity(
    totalPower,
    system.population,
    system.credits,
    system.developments.size,
  );

  const eng: ActiveEngagement = {
    mode,
    attackerId,
    defenderId: system.ownerId,
    committedA,
    committedB,
    ticksElapsed: 0,
    ticksRemaining: duration,
    intensity,
    tacticsSeed: Math.floor(rng() * 0xffffffff) >>> 0,
  };
  system.engagement = eng;
  if (!system.contested || system.contested.vs !== attackerId) {
    system.contested = { vs: attackerId, pct: 0.12 + intensity * 0.1 };
  }
  return eng;
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
  system.engagement = null;
  system.population *= 0.8;
  system.credits *= 0.45;
  stripDevelopmentsOnFlip(system);
  syncDefenseMix(system);
}

/**
 * Relinquish a system to wilderness — used for rebellions, disasters, and
 * deliberate withdrawals when an empire overextends.
 */
export function abandonSystem(
  state: MacroState,
  system: StarSystem,
  reason: "rebellion" | "disaster" | "withdraw" = "withdraw",
): MacroEvent[] {
  const from = system.ownerId;
  if (!from) return [];
  const empire = state.empires[from];
  if (!empire) return [];

  const wasCapital = empire.capitalSystemId === system.id;
  setSystemOwner(state, system, null);
  system.contested = null;
  system.engagement = null;
  system.population = Math.max(6, system.population * 0.35);
  system.credits = Math.max(0, system.credits * 0.15);
  system.garrison = Math.max(2, system.garrison * 0.2);
  system.developments = new Set();
  syncDefenseMix(system);

  const verb =
    reason === "rebellion"
      ? "falls into anarchy"
      : reason === "disaster"
        ? "is left desolate"
        : "is abandoned";
  const events: MacroEvent[] = [
    emit(state, {
      tick: state.tick,
      kind: "territory_abandoned",
      empireIds: [from],
      systemId: system.id,
      text: `${system.name} ${verb}; ${empire.name} withdraws and the system turns neutral.`,
    }),
  ];

  if (empire.ownedSystems.size === 0) {
    empire.alive = false;
    empire.allies = [];
    empire.fleet = emptyFleet();
    for (const other of Object.values(state.empires)) {
      other.allies = other.allies.filter((a) => a !== from);
    }
    events.push(
      emit(state, {
        tick: state.tick,
        kind: "empire_eliminated",
        empireIds: [from],
        systemId: null,
        text: `${empire.name} has been eliminated.`,
      }),
    );
  } else if (wasCapital) {
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
  return events;
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
    empire.fleet = emptyFleet();
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

/** Bot-driven pressure on a hostile border system — may open an engagement. */
export function pressureBorder(
  state: MacroState,
  attackerId: EmpireId,
  systemId: SystemId,
  amount: number,
  rng?: () => number,
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

  const attacker = state.empires[attackerId]!;
  const roll = rng ?? createRng(state.seed ^ state.tick ^ systemId.length);
  const mode: EngagementMode =
    owner.capitalSystemId === systemId ||
    system.developments.has("fortress_complex")
      ? "siege"
      : amount > 0.2 || fleetPower(attacker.fleet) > 200
        ? "fleet_battle"
        : "skirmish";

  if (!system.engagement && (amount > 0.12 || roll() < 0.35)) {
    beginEngagement(state, system, attackerId, mode, roll);
  }

  for (const nid of system.hyperlanes) {
    const n = state.systems[nid]!;
    if (n.ownerId === attackerId && n.garrison > 15) {
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
  syncDefenseMix(system);
}
