import { emit } from "./log.js";
import type { Empire, EmpireId, MacroEvent, MacroState } from "./types.js";

export function tryDiplomacy(
  state: MacroState,
  empire: Empire,
  rng: () => number,
): MacroEvent[] {
  if (!empire.alive) return [];
  const events: MacroEvent[] = [];
  const tick = state.tick;

  for (const allyId of [...empire.allies]) {
    const ally = state.empires[allyId];
    if (!ally?.alive) {
      empire.allies = empire.allies.filter((a) => a !== allyId);
      continue;
    }
    const overextended = frontierPressure(state, allyId) > 2.2;
    const softCapPenalty = empire.allies.length * 0.015;
    const breakChance =
      (1 - empire.traits.loyalty) * 0.1 +
      empire.traits.greed * 0.04 +
      empire.traits.xenophobia * 0.06 +
      softCapPenalty +
      (empire.archetype === "opportunistic" && overextended ? 0.25 : 0) +
      (empire.archetype === "strategist" && overextended ? 0.12 : 0);
    if (rng() < breakChance) {
      breakAlliance(state, empire.id, allyId);
      events.push(
        emit(state, {
          tick,
          kind: "alliance_broken",
          empireIds: [empire.id, allyId],
          systemId: null,
          text: `${empire.name} breaks its pact with ${ally.name}.`,
        }),
      );
    }
  }

  // No hard ally cap — xenophobes / isolationists simply rarely propose.
  const proposeChance =
    empire.traits.loyalty * 0.1 +
    (1 - empire.traits.xenophobia) * 0.08 +
    (empire.archetype === "diplomat" ? 0.22 : 0) +
    (empire.archetype === "loyal" ? 0.12 : 0) +
    (empire.archetype === "opportunistic" ? 0.1 : 0) -
    (empire.archetype === "xenophobe" ? 0.15 : 0) -
    (empire.archetype === "isolationist" ? 0.18 : 0) -
    (empire.archetype === "conqueror" ? 0.06 : 0);

  if (empire.researched.has("diplomatic_corps")) {
    // handled below via accept/propose bump
  }

  let propose = proposeChance;
  if (empire.researched.has("diplomatic_corps")) propose += 0.1;
  if (rng() > Math.max(0.02, propose)) return events;

  const candidate = pickAllyCandidate(state, empire, rng);
  if (!candidate) return events;
  const other = state.empires[candidate]!;

  let accept =
    other.traits.loyalty * 0.45 +
    (1 - other.traits.aggression) * 0.25 +
    (1 - other.traits.xenophobia) * 0.35 +
    other.traits.greed * 0.08;
  if (other.researched.has("diplomatic_corps")) accept += 0.12;
  if (other.archetype === "xenophobe" || other.archetype === "isolationist") {
    accept *= 0.25;
  }
  if (empire.researched.has("xenology_bureau") && other.traits.xenophobia > 0.5) {
    accept += 0.15;
  }

  if (rng() < accept) {
    formAlliance(empire, other);
    events.push(
      emit(state, {
        tick,
        kind: "alliance_formed",
        empireIds: [empire.id, other.id],
        systemId: null,
        text: `${empire.name} and ${other.name} form a pact.`,
      }),
    );
  }
  return events;
}

function formAlliance(a: Empire, b: Empire): void {
  if (!a.allies.includes(b.id)) a.allies.push(b.id);
  if (!b.allies.includes(a.id)) b.allies.push(a.id);
}

function breakAlliance(state: MacroState, a: EmpireId, b: EmpireId): void {
  const ea = state.empires[a]!;
  const eb = state.empires[b]!;
  ea.allies = ea.allies.filter((x) => x !== b);
  eb.allies = eb.allies.filter((x) => x !== a);
}

/** Hostile lane crossings per owned system. */
function frontierPressure(state: MacroState, empireId: EmpireId): number {
  const empire = state.empires[empireId];
  if (!empire || empire.ownedSystems.size === 0) return 0;
  let hostile = 0;
  for (const sid of empire.ownedSystems) {
    for (const nid of state.systems[sid]!.hyperlanes) {
      const n = state.systems[nid]!;
      if (n.ownerId && n.ownerId !== empireId) {
        const other = state.empires[n.ownerId];
        if (other && !other.allies.includes(empireId)) hostile++;
      }
    }
  }
  return hostile / empire.ownedSystems.size;
}

function pickAllyCandidate(
  state: MacroState,
  empire: Empire,
  rng: () => number,
): EmpireId | null {
  const neighbors = borderingEmpires(state, empire);
  const candidates = neighbors.filter(
    (id) => id !== empire.id && !empire.allies.includes(id),
  );
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)]!;
}

function borderingEmpires(state: MacroState, empire: Empire): EmpireId[] {
  const out = new Set<EmpireId>();
  for (const sid of empire.ownedSystems) {
    for (const nid of state.systems[sid]!.hyperlanes) {
      const ownerId = state.systems[nid]!.ownerId;
      if (!ownerId || ownerId === empire.id) continue;
      if (state.empires[ownerId]?.alive) out.add(ownerId);
    }
  }
  return [...out];
}
