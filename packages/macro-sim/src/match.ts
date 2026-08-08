import { pickArchetype, traitsForArchetype } from "./archetypes.js";
import { generateRegionGalaxy } from "./galaxy.js";
import { generateEmpireName } from "./names.js";
import { createRng } from "./rng.js";
import type {
  Empire,
  EmpireId,
  MacroConfig,
  MacroState,
  MapSizeTier,
  Region,
} from "./types.js";
import {
  DEFAULT_MACRO_CONFIG,
  REGION_COUNTS,
  empireCountForRegions,
} from "./types.js";
import { buildSnapshot } from "./snapshot.js";
import type { MacroSnapshot } from "./types.js";

export interface CreateMacroOptions {
  seed?: number;
  mapSize?: MapSizeTier;
  regionCount?: number;
  empireCount?: number;
  config?: Partial<MacroConfig>;
}

export function createMacroMatch(opts: CreateMacroOptions = {}): {
  state: MacroState;
  config: MacroConfig;
  snapshot: MacroSnapshot;
} {
  const mapSize = opts.mapSize ?? "medium";
  const regionCount = opts.regionCount ?? REGION_COUNTS[mapSize];
  const empireCount = opts.empireCount ?? empireCountForRegions(regionCount);
  const config: MacroConfig = {
    ...DEFAULT_MACRO_CONFIG,
    ...opts.config,
    regionCount,
    empireCount,
  };
  const seed = opts.seed ?? (Math.floor(Math.random() * 0xffffffff) >>> 0);
  const galaxy = generateRegionGalaxy(seed, regionCount);
  const rng = createRng(seed ^ 0xcafebabe);

  const regions: Record<string, Region> = {};
  for (let i = 0; i < galaxy.ids.length; i++) {
    const id = galaxy.ids[i]!;
    regions[id] = {
      id,
      neighbors: galaxy.neighbors[i]!,
      ownerId: null,
      // Neutral wilderness — easy to claim, grows only after ownership
      population: 8 + rng() * 12,
      credits: 2 + rng() * 6,
      garrison: 0,
      contested: null,
      site: galaxy.sites[i]!,
      polygon: galaxy.polygons[i]!,
    };
  }

  const capitalIndices = farthestPointCapitals(
    galaxy.sites,
    empireCount,
    rng,
  );
  const usedNames = new Set<string>();
  const empires: Record<EmpireId, Empire> = {};
  const empireOrder: EmpireId[] = [];

  for (let i = 0; i < empireCount; i++) {
    const id = `e${i}`;
    const archetype = pickArchetype(seed, i);
    const capitalRegionId = galaxy.ids[capitalIndices[i]!]!;
    empires[id] = {
      id,
      name: generateEmpireName(seed, i, usedNames),
      colorHue: (i * 360) / empireCount + (rng() - 0.5) * 8,
      archetype,
      traits: traitsForArchetype(archetype, seed, i),
      capitalRegionId,
      allies: [],
      alive: true,
      modifiers: {
        productionMult: 1,
        productionTicksLeft: 0,
        garrisonMult: 1,
        garrisonTicksLeft: 0,
      },
    };
    empireOrder.push(id);
    // Empires start as a single capital region and expand from there
    const cap = regions[capitalRegionId]!;
    cap.ownerId = id;
    cap.population = 80 + rng() * 40;
    cap.credits = 60 + rng() * 40;
    cap.garrison = 50 + rng() * 30;
  }

  const state: MacroState = {
    tick: 0,
    seed,
    regions,
    empires,
    events: [
      {
        tick: 0,
        kind: "relic_discovery",
        empireIds: [],
        regionId: null,
        text: `Chronicle begins — ${empireCount} empires awaken across ${regionCount} regions.`,
      },
    ],
    status: "running",
    regionOrder: galaxy.ids,
    empireOrder,
  };

  return { state, config, snapshot: buildSnapshot(state) };
}

function farthestPointCapitals(
  sites: { x: number; y: number }[],
  count: number,
  rng: () => number,
): number[] {
  const n = sites.length;
  const chosen: number[] = [];
  chosen.push(Math.floor(rng() * n));
  while (chosen.length < count) {
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < n; i++) {
      if (chosen.includes(i)) continue;
      let minD = Infinity;
      for (const c of chosen) {
        const dx = sites[i]!.x - sites[c]!.x;
        const dy = sites[i]!.y - sites[c]!.y;
        minD = Math.min(minD, dx * dx + dy * dy);
      }
      if (minD > bestD) {
        bestD = minD;
        best = i;
      }
    }
    if (best < 0) break;
    chosen.push(best);
  }
  return chosen;
}

