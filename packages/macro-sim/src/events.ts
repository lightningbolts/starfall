import { emit } from "./log.js";
import { pick } from "./rng.js";
import type {
  Empire,
  MacroEvent,
  MacroEventKind,
  MacroState,
  StarSystem,
} from "./types.js";

interface WeightedKind {
  kind: MacroEventKind;
  weight: number;
}

const WORLD_EVENTS: WeightedKind[] = [
  { kind: "production_surge", weight: 28 },
  { kind: "rebellion", weight: 18 },
  { kind: "relic_discovery", weight: 16 },
  { kind: "pirate_raid", weight: 22 },
  { kind: "disaster", weight: 16 },
];

export function maybeSpawnRandomEvent(
  state: MacroState,
  chance: number,
  rng: () => number,
): MacroEvent[] {
  if (rng() > chance) return [];
  const alive = state.empireOrder.filter((id) => state.empires[id]!.alive);
  if (alive.length === 0) return [];

  const kind = weightedPick(WORLD_EVENTS, rng);
  const empireId = pick(rng, alive);
  const empire = state.empires[empireId]!;
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
      system.garrison *= 0.55;
      system.population *= 0.7;
      if (system.contested) {
        system.contested.pct = Math.min(1, system.contested.pct + 0.2);
      } else {
        const foe = system.hyperlanes
          .map((n) => state.systems[n]!.ownerId)
          .find((o) => o && o !== empire.id);
        if (foe) system.contested = { vs: foe, pct: 0.25 };
      }
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
      system.credits *= 0.65;
      system.garrison *= 0.8;
      return emit(state, {
        tick,
        kind,
        empireIds: [empire.id],
        systemId: system.id,
        text: `Pirates raid ${system.name}, held by ${empire.name}.`,
      });
    }
    case "disaster": {
      system.population *= 0.6;
      system.credits *= 0.75;
      return emit(state, {
        tick,
        kind,
        empireIds: [empire.id],
        systemId: system.id,
        text: `A cataclysm devastates ${system.name} in ${empire.name} space.`,
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
