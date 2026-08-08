import type {
  Empire,
  MacroEvent,
  MacroEventKind,
  MacroState,
  Region,
} from "./types.js";
import { pick } from "./rng.js";

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
  const region = pickOwnedRegion(state, empireId, rng);
  if (!region) return [];

  return [applyWorldEvent(state, kind, empire, region, rng)];
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

function pickOwnedRegion(
  state: MacroState,
  empireId: string,
  rng: () => number,
): Region | null {
  const owned = state.regionOrder.filter(
    (id) => state.regions[id]!.ownerId === empireId,
  );
  if (owned.length === 0) return null;
  return state.regions[pick(rng, owned)]!;
}

function applyWorldEvent(
  state: MacroState,
  kind: MacroEventKind,
  empire: Empire,
  region: Region,
  rng: () => number,
): MacroEvent {
  const tick = state.tick;
  switch (kind) {
    case "production_surge": {
      empire.modifiers.productionMult = 1.35 + rng() * 0.25;
      empire.modifiers.productionTicksLeft = 40 + Math.floor(rng() * 40);
      return {
        tick,
        kind,
        empireIds: [empire.id],
        regionId: region.id,
        text: `${empire.name} reports a production surge in the frontier.`,
      };
    }
    case "rebellion": {
      region.garrison *= 0.55;
      region.population *= 0.7;
      if (region.contested) region.contested.pct = Math.min(1, region.contested.pct + 0.2);
      else if (region.neighbors.some((n) => {
        const o = state.regions[n]!.ownerId;
        return o && o !== empire.id;
      })) {
        const foe = region.neighbors
          .map((n) => state.regions[n]!.ownerId)
          .find((o) => o && o !== empire.id);
        if (foe) region.contested = { vs: foe, pct: 0.25 };
      }
      return {
        tick,
        kind,
        empireIds: [empire.id],
        regionId: region.id,
        text: `Rebellion flares within ${empire.name} space.`,
      };
    }
    case "relic_discovery": {
      region.credits += 80 + rng() * 120;
      region.population += 40;
      empire.modifiers.garrisonMult = 1.2;
      empire.modifiers.garrisonTicksLeft = 50;
      return {
        tick,
        kind,
        empireIds: [empire.id],
        regionId: region.id,
        text: `${empire.name} uncovers an ancient relic.`,
      };
    }
    case "pirate_raid": {
      region.credits *= 0.65;
      region.garrison *= 0.8;
      return {
        tick,
        kind,
        empireIds: [empire.id],
        regionId: region.id,
        text: `Pirates raid a sector held by ${empire.name}.`,
      };
    }
    case "disaster": {
      region.population *= 0.6;
      region.credits *= 0.75;
      return {
        tick,
        kind,
        empireIds: [empire.id],
        regionId: region.id,
        text: `A natural disaster devastates territory of ${empire.name}.`,
      };
    }
    default:
      return {
        tick,
        kind,
        empireIds: [empire.id],
        regionId: region.id,
        text: `Something stirs in ${empire.name} space.`,
      };
  }
}
