import { pickArchetype, traitsForArchetype } from "./archetypes.js";
import { beginEngagement } from "./combat.js";
import { emit } from "./log.js";
import { pick } from "./rng.js";
import { syncDefenseMix } from "./ships.js";
import {
  canResearch,
  grantTech,
  MACRO_TECH_IDS,
  TECH_LABEL,
  TECH_TIER,
} from "./tech.js";
import type {
  Empire,
  MacroEvent,
  MacroEventKind,
  MacroState,
  MacroTechId,
  StarSystem,
} from "./types.js";

interface WeightedKind {
  kind: MacroEventKind;
  weight: number;
}

const WORLD_EVENTS: WeightedKind[] = [
  { kind: "production_surge", weight: 14 },
  { kind: "rebellion", weight: 16 },
  { kind: "relic_discovery", weight: 10 },
  { kind: "pirate_raid", weight: 16 },
  { kind: "disaster", weight: 12 },
  { kind: "offensive_blitz", weight: 14 },
  { kind: "defensive_stronghold", weight: 12 },
  { kind: "plague", weight: 12 },
  { kind: "robbery", weight: 10 },
  { kind: "tech_breakthrough", weight: 14 },
  { kind: "coup", weight: 8 },
];

export function maybeSpawnRandomEvent(
  state: MacroState,
  chance: number,
  rng: () => number,
): MacroEvent[] {
  if (rng() > chance) return [];
  const alive = state.empireOrder.filter((id) => state.empires[id]!.alive);
  if (alive.length === 0) return [];

  // Curiosity empires more likely for breakthroughs — bias pick slightly.
  let kind = weightedPick(WORLD_EVENTS, rng);
  const empireId = pick(rng, alive);
  const empire = state.empires[empireId]!;
  if (empire.traits.curiosity > 0.6 && rng() < 0.25) {
    kind = "tech_breakthrough";
  }
  if (empire.traits.ambition > 0.7 && rng() < 0.2) {
    kind = "offensive_blitz";
  }

  const system = pickOwnedSystem(state, empire, rng);
  if (!system) return [];

  return [applyWorldEvent(state, kind, empire, system, rng)];
}

function weightedPick(items: WeightedKind[], rng: () => number): MacroEventKind {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = rng() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item.kind;
  }
  return items[items.length - 1]!.kind;
}

function pickOwnedSystem(
  state: MacroState,
  empire: Empire,
  rng: () => number,
): StarSystem | null {
  const size = empire.ownedSystems.size;
  if (size === 0) return null;
  let skip = Math.floor(rng() * size);
  for (const id of empire.ownedSystems) {
    if (skip === 0) return state.systems[id]!;
    skip--;
  }
  return null;
}

function applyWorldEvent(
  state: MacroState,
  kind: MacroEventKind,
  empire: Empire,
  system: StarSystem,
  rng: () => number,
): MacroEvent {
  const tick = state.tick;
  switch (kind) {
    case "production_surge": {
      empire.modifiers.productionMult = 1.35 + rng() * 0.25;
      empire.modifiers.productionTicksLeft = 40 + Math.floor(rng() * 40);
      return emit(state, {
        tick,
        kind,
        empireIds: [empire.id],
        systemId: system.id,
        text: `${empire.name} reports a production surge around ${system.name}.`,
      });
    }
    case "rebellion": {
      system.garrison *= 0.45;
      system.population *= 0.6;
      system.credits *= 0.7;
      if (system.contested) {
        system.contested.pct = Math.min(1, system.contested.pct + 0.3);
      } else {
        const foe = system.hyperlanes
          .map((n) => state.systems[n]!.ownerId)
          .find((o) => o && o !== empire.id);
        if (foe) system.contested = { vs: foe, pct: 0.35 };
      }
      syncDefenseMix(system);
      return emit(state, {
        tick,
        kind,
        empireIds: [empire.id],
        systemId: system.id,
        text: `Rebellion flares on ${system.name} against ${empire.name}.`,
      });
    }
    case "relic_discovery": {
      system.credits += 80 + rng() * 120;
      system.population += 40;
      empire.modifiers.garrisonMult = 1.2;
      empire.modifiers.garrisonTicksLeft = 50;
      return emit(state, {
        tick,
        kind,
        empireIds: [empire.id],
        systemId: system.id,
        text: `${empire.name} uncovers an ancient relic on ${system.name}.`,
      });
    }
    case "pirate_raid": {
      system.credits *= 0.5;
      system.garrison *= 0.7;
      syncDefenseMix(system);
      const foe = system.hyperlanes
        .map((n) => state.systems[n]!.ownerId)
        .find((o) => o && o !== empire.id);
      if (foe && rng() < 0.4) {
        beginEngagement(state, system, foe, "raid", rng);
      }
      return emit(state, {
        tick,
        kind,
        empireIds: [empire.id],
        systemId: system.id,
        text: `Pirates raid ${system.name}, held by ${empire.name}.`,
      });
    }
    case "disaster": {
      system.population *= 0.55;
      system.credits *= 0.65;
      return emit(state, {
        tick,
        kind,
        empireIds: [empire.id],
        systemId: system.id,
        text: `A cataclysm devastates ${system.name} in ${empire.name} space.`,
      });
    }
    case "offensive_blitz": {
      empire.modifiers.attackPressure = 1.45 + rng() * 0.3;
      empire.modifiers.attackPressureTicksLeft = 30 + Math.floor(rng() * 30);
      let borders = 0;
      for (const sid of empire.ownedSystems) {
        if (borders >= 2) break;
        for (const nid of state.systems[sid]!.hyperlanes) {
          const n = state.systems[nid]!;
          if (!n.ownerId || n.ownerId === empire.id) continue;
          if (empire.allies.includes(n.ownerId)) continue;
          if (!n.contested || n.contested.vs !== empire.id) {
            n.contested = { vs: empire.id, pct: 0.22 };
          } else {
            n.contested.pct = Math.min(1, n.contested.pct + 0.18);
          }
          beginEngagement(state, n, empire.id, "fleet_battle", rng);
          borders++;
          if (borders >= 2) break;
        }
      }
      return emit(state, {
        tick,
        kind,
        empireIds: [empire.id],
        systemId: system.id,
        text: `${empire.name} launches an offensive blitz from ${system.name}!`,
      });
    }
    case "defensive_stronghold": {
      system.garrison *= 1.8;
      system.garrison += 40;
      empire.modifiers.garrisonMult = 1.35;
      empire.modifiers.garrisonTicksLeft = 45;
      if (!system.developments.has("fortress_complex") && system.developments.size < 4) {
        // temporary fortification feel
        system.developments.add("orbital_batteries");
      }
      syncDefenseMix(system);
      return emit(state, {
        tick,
        kind,
        empireIds: [empire.id],
        systemId: system.id,
        text: `${empire.name} fortifies ${system.name} into a defensive stronghold.`,
      });
    }
    case "plague": {
      const queue = [system.id];
      const seen = new Set(queue);
      let hops = 0;
      while (queue.length && hops < 4) {
        const id = queue.shift()!;
        const s = state.systems[id]!;
        const resist = s.developments.has("plague_hospitals") ? 0.4 : 1;
        s.population *= 1 - 0.35 * resist;
        s.credits *= 1 - 0.25 * resist;
        hops++;
        for (const n of s.hyperlanes) {
          if (seen.has(n)) continue;
          if (state.systems[n]!.ownerId === empire.id) {
            seen.add(n);
            queue.push(n);
          }
        }
      }
      return emit(state, {
        tick,
        kind,
        empireIds: [empire.id],
        systemId: system.id,
        text: `Plague spreads from ${system.name} through ${empire.name} space.`,
      });
    }
    case "robbery": {
      const stolen = system.credits * (0.35 + rng() * 0.3);
      system.credits -= stolen;
      const neighbor = system.hyperlanes
        .map((n) => state.systems[n]!)
        .find((s) => s.ownerId && s.ownerId !== empire.id);
      if (neighbor) {
        neighbor.credits += stolen * 0.7;
        return emit(state, {
          tick,
          kind,
          empireIds: [empire.id, neighbor.ownerId!],
          systemId: system.id,
          text: `Raiders rob ${system.name}; spoils flow toward ${state.empires[neighbor.ownerId!]!.name}.`,
        });
      }
      return emit(state, {
        tick,
        kind,
        empireIds: [empire.id],
        systemId: system.id,
        text: `A daring robbery empties vaults on ${system.name}.`,
      });
    }
    case "tech_breakthrough": {
      const candidates = MACRO_TECH_IDS.filter(
        (t) =>
          !empire.researched.has(t) &&
          (TECH_TIER[t] <= 2 || canResearch(empire, t)),
      );
      if (candidates.length > 0) {
        const tech = candidates[Math.floor(rng() * candidates.length)]! as MacroTechId;
        grantTech(empire, tech);
        return emit(state, {
          tick,
          kind,
          empireIds: [empire.id],
          systemId: system.id,
          text: `${empire.name} achieves a breakthrough — ${TECH_LABEL[tech]}!`,
        });
      }
      empire.modifiers.productionMult = 1.4;
      empire.modifiers.productionTicksLeft = 60;
      empire.modifiers.garrisonMult = 1.25;
      empire.modifiers.garrisonTicksLeft = 60;
      return emit(state, {
        tick,
        kind,
        empireIds: [empire.id],
        systemId: system.id,
        text: `${empire.name} unlocks experimental doctrine around ${system.name}.`,
      });
    }
    case "coup":
    case "regime_change": {
      const old = empire.archetype;
      const next = pickArchetype(state.seed ^ state.tick, Math.floor(rng() * 100));
      empire.archetype = next;
      empire.traits = traitsForArchetype(next, state.seed, Math.floor(rng() * 50));
      if (
        empire.traits.xenophobia > 0.6 ||
        next === "xenophobe" ||
        next === "isolationist"
      ) {
        for (const ally of [...empire.allies]) {
          const other = state.empires[ally]!;
          empire.allies = empire.allies.filter((a) => a !== ally);
          other.allies = other.allies.filter((a) => a !== empire.id);
        }
      }
      if (!empire.researched.has("eternal_archives") && rng() < 0.15) {
        // rare tech loss without eternal archives — skip for stability
      }
      empire.modifiers.productionMult = 0.55;
      empire.modifiers.productionTicksLeft = 35;
      const capital = state.systems[empire.capitalSystemId]!;
      capital.garrison *= 0.7;
      capital.population *= 0.85;
      syncDefenseMix(capital);
      return emit(state, {
        tick,
        kind: "coup",
        empireIds: [empire.id],
        systemId: empire.capitalSystemId,
        text: `Coup in ${empire.name}! Regime shifts from ${old} to ${next}.`,
      });
    }
    default:
      return emit(state, {
        tick,
        kind,
        empireIds: [empire.id],
        systemId: system.id,
        text: `Something stirs near ${system.name}.`,
      });
  }
}
