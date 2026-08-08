import type { Empire, EmpireId, MacroEvent, MacroState } from "./types.js";

export function tryDiplomacy(
  state: MacroState,
  empire: Empire,
  rng: () => number,
): MacroEvent[] {
  if (!empire.alive) return [];
  const events: MacroEvent[] = [];
  const tick = state.tick;

  // Break alliances when opportunistic / low loyalty and ally looks overextended
  for (const allyId of [...empire.allies]) {
    const ally = state.empires[allyId];
    if (!ally?.alive) {
      empire.allies = empire.allies.filter((a) => a !== allyId);
      continue;
    }
    const overextended = frontierPressure(state, allyId) > 2.2;
    const breakChance =
      (1 - empire.traits.loyalty) * 0.15 +
      (empire.archetype === "opportunistic" && overextended ? 0.35 : 0) +
      empire.traits.greed * 0.05;
    if (rng() < breakChance) {
      breakAlliance(state, empire.id, allyId);
      events.push({
        tick,
        kind: "alliance_broken",
        empireIds: [empire.id, allyId],
        regionId: null,
        text: `${empire.name} breaks its pact with ${ally.name}.`,
      });
    }
  }

  // Propose alliance
  if (empire.allies.length >= 3) return events;
  const proposeChance =
    empire.traits.loyalty * 0.08 +
    (empire.archetype === "opportunistic" ? 0.12 : 0.04) +
    (empire.archetype === "loyal" ? 0.1 : 0);
  if (rng() > proposeChance) return events;

  const candidate = pickAllyCandidate(state, empire, rng);
  if (!candidate) return events;
  const other = state.empires[candidate]!;
  const accept =
    other.traits.loyalty * 0.5 +
    (1 - other.traits.aggression) * 0.3 +
    other.traits.greed * 0.1;
  if (rng() < accept) {
    formAlliance(empire, other);
    events.push({
      tick,
      kind: "alliance_formed",
      empireIds: [empire.id, other.id],
      regionId: null,
      text: `${empire.name} and ${other.name} form a pact.`,
    });
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

function frontierPressure(state: MacroState, empireId: EmpireId): number {
  let hostile = 0;
  let owned = 0;
  for (const rid of state.regionOrder) {
    const r = state.regions[rid]!;
    if (r.ownerId !== empireId) continue;
    owned++;
    for (const nid of r.neighbors) {
      const n = state.regions[nid]!;
      if (n.ownerId && n.ownerId !== empireId) {
        const other = state.empires[n.ownerId];
        if (other && !other.allies.includes(empireId)) hostile++;
      }
    }
  }
  return owned === 0 ? 0 : hostile / owned;
}

function pickAllyCandidate(
  state: MacroState,
  empire: Empire,
  rng: () => number,
): EmpireId | null {
  const candidates: EmpireId[] = [];
  for (const id of state.empireOrder) {
    if (id === empire.id) continue;
    const e = state.empires[id]!;
    if (!e.alive) continue;
    if (empire.allies.includes(id)) continue;
    if (borders(state, empire.id, id)) candidates.push(id);
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)]!;
}

function borders(state: MacroState, a: EmpireId, b: EmpireId): boolean {
  for (const rid of state.regionOrder) {
    const r = state.regions[rid]!;
    if (r.ownerId !== a) continue;
    for (const nid of r.neighbors) {
      if (state.regions[nid]!.ownerId === b) return true;
    }
  }
  return false;
}
