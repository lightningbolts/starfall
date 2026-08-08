import type { MacroSnapshot, MacroState } from "./types.js";

export function buildSnapshot(state: MacroState): MacroSnapshot {
  const regions: MacroSnapshot["regions"] = {};
  for (const id of state.regionOrder) {
    const r = state.regions[id]!;
    regions[id] = {
      ownerId: r.ownerId,
      population: r.population,
      credits: r.credits,
      garrison: r.garrison,
      contested: r.contested ? { ...r.contested } : null,
      site: { ...r.site },
      polygon: r.polygon.map((p) => ({ ...p })),
      neighbors: [...r.neighbors],
    };
  }

  const empires: MacroSnapshot["empires"] = {};
  for (const id of state.empireOrder) {
    const e = state.empires[id]!;
    let territory = 0;
    let population = 0;
    let credits = 0;
    let garrison = 0;
    for (const rid of state.regionOrder) {
      const r = state.regions[rid]!;
      if (r.ownerId !== id) continue;
      territory++;
      population += r.population;
      credits += r.credits;
      garrison += r.garrison;
    }
    empires[id] = {
      name: e.name,
      colorHue: e.colorHue,
      archetype: e.archetype,
      capitalRegionId: e.capitalRegionId,
      allies: [...e.allies],
      alive: e.alive,
      territory,
      population,
      credits,
      garrison,
    };
  }

  return {
    tick: state.tick,
    status: state.status,
    regions,
    empires,
    events: state.events.slice(-80).map((ev) => ({
      ...ev,
      empireIds: [...ev.empireIds],
    })),
    regionOrder: [...state.regionOrder],
    empireOrder: [...state.empireOrder],
  };
}
