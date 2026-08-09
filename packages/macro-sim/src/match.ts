import { pickArchetype, traitsForArchetype } from "./archetypes.js";
import { generateGalaxy } from "./galaxy.js";
import { generateEmpireName } from "./names.js";
import { createRng } from "./rng.js";
import { emptyFleet } from "./ships.js";
import { buildSnapshot } from "./snapshot.js";
import { swatchForIndex, type EmpireSwatch } from "./swatches.js";
import type {
  Empire,
  EmpireId,
  MacroConfig,
  MacroSnapshot,
  MacroState,
  MapSizeTier,
  StarSystem,
  SystemId,
  Vec2,
} from "./types.js";
import {
  DEFAULT_MACRO_CONFIG,
  SYSTEM_COUNTS,
  empireCountForSystems,
} from "./types.js";

export interface CreateMacroOptions {
  seed?: number;
  mapSize?: MapSizeTier;
  systemCount?: number;
  empireCount?: number;
  config?: Partial<MacroConfig>;
}

export function createMacroMatch(opts: CreateMacroOptions = {}): {
  state: MacroState;
  config: MacroConfig;
  snapshot: MacroSnapshot;
} {
  const mapSize = opts.mapSize ?? "medium";
  const systemCount = opts.systemCount ?? SYSTEM_COUNTS[mapSize];
  const empireCount = opts.empireCount ?? empireCountForSystems(systemCount);
  const config: MacroConfig = {
    ...DEFAULT_MACRO_CONFIG,
    ...opts.config,
    systemCount,
    empireCount,
  };
  const seed = opts.seed ?? (Math.floor(Math.random() * 0xffffffff) >>> 0);
  const geometry = generateGalaxy(seed, systemCount);
  const rng = createRng(seed ^ 0xcafebabe);

  const systems: Record<SystemId, StarSystem> = {};
  for (const geo of geometry.systems) {
    systems[geo.id] = {
      id: geo.id,
      name: geo.name,
      starClass: geo.starClass,
      site: geo.site,
      hyperlanes: geo.hyperlanes,
      ownerId: null,
      population: 6 + rng() * 10,
      credits: 2 + rng() * 5,
      garrison: 0,
      contested: null,
      developments: new Set(),
      defenseMix: emptyFleet(),
      engagement: null,
    };
  }

  const capitalIndices = farthestPointCapitals(
    geometry.systems.map((s) => s.site),
    empireCount,
    rng,
  );
  const usedNames = new Set<string>();
  const empires: Record<EmpireId, Empire> = {};
  const empireOrder: EmpireId[] = [];
  const picked: EmpireSwatch[] = [];

  for (let i = 0; i < capitalIndices.length; i++) {
    const id = `e${i}`;
    const archetype = pickArchetype(seed, i);
    const capitalSystemId = geometry.ids[capitalIndices[i]!]!;
    const swatch = swatchForIndex(i, capitalIndices.length, rng, picked);
    picked.push(swatch);
    empires[id] = {
      id,
      name: generateEmpireName(seed, i, usedNames),
      colorHue: swatch.hue,
      colorSat: swatch.sat,
      colorLight: swatch.light,
      archetype,
      traits: traitsForArchetype(archetype, seed, i),
      capitalSystemId,
      allies: [],
      alive: true,
      ownedSystems: new Set<SystemId>(),
      modifiers: {
        productionMult: 1,
        productionTicksLeft: 0,
        garrisonMult: 1,
        garrisonTicksLeft: 0,
        attackPressure: 1,
        attackPressureTicksLeft: 0,
      },
      researched: new Set(),
      repeatableLevels: {},
      fleet: emptyFleet(),
    };
    empireOrder.push(id);

    const home = systems[capitalSystemId]!;
    home.ownerId = id;
    empires[id]!.ownedSystems.add(capitalSystemId);
    home.population = 70 + rng() * 40;
    home.credits = 55 + rng() * 45;
    home.garrison = 45 + rng() * 30;
    // Starter flotilla — larger than original v1, still under early soft-cap
    empires[id]!.fleet = {
      corvette: 48 + Math.floor(rng() * 24),
      raider: 8 + Math.floor(rng() * 6),
    };
  }

  const state: MacroState = {
    tick: 0,
    seed,
    geometry,
    systems,
    empires,
    events: [],
    eventSeq: 0,
    status: "running",
    systemOrder: [...geometry.ids],
    empireOrder,
    enclavePulses: {},
  };

  state.eventSeq = 1;
  state.events.push({
    seq: 1,
    tick: 0,
    kind: "relic_discovery",
    empireIds: [],
    systemId: null,
    text: `Chronicle begins — ${empireOrder.length} empires awaken among ${systemCount} stars.`,
  });

  return { state, config, snapshot: buildSnapshot(state) };
}

/** Farthest-point sampling so homeworlds start far apart. */
function farthestPointCapitals(
  sites: Vec2[],
  count: number,
  rng: () => number,
): number[] {
  const n = sites.length;
  if (n === 0) return [];
  const wanted = Math.min(count, n);
  const chosen: number[] = [];
  const minDist: number[] = new Array<number>(n).fill(Infinity);

  const take = (idx: number): void => {
    chosen.push(idx);
    const p = sites[idx]!;
    for (let i = 0; i < n; i++) {
      const q = sites[i]!;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = dx * dx + dy * dy;
      if (d < minDist[i]!) minDist[i] = d;
    }
  };

  take(Math.floor(rng() * n));
  while (chosen.length < wanted) {
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < n; i++) {
      if (minDist[i]! > bestD) {
        bestD = minDist[i]!;
        best = i;
      }
    }
    if (best < 0) break;
    take(best);
  }
  return chosen;
}
