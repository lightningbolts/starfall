import { fleetPower, snapshotEngagement } from "./ships.js";
import type { MacroSnapshot, MacroState } from "./types.js";

/**
 * Dynamic fields only — geometry is shared by reference, so a snapshot costs a
 * few numbers per system rather than a polygon copy.
 */
export function buildSnapshot(state: MacroState): MacroSnapshot {
  const systems: MacroSnapshot["systems"] = {};
  for (const id of state.systemOrder) {
    const s = state.systems[id]!;
    systems[id] = {
      ownerId: s.ownerId,
      population: s.population,
      credits: s.credits,
      garrison: s.garrison,
      contested: s.contested ? { ...s.contested } : null,
      developments: [...s.developments],
      defenseMix: { ...s.defenseMix },
      engagement: snapshotEngagement(s.engagement),
    };
  }

  const empires: MacroSnapshot["empires"] = {};
  for (const id of state.empireOrder) {
    const e = state.empires[id]!;
    let population = 0;
    let credits = 0;
    let garrison = 0;
    for (const sid of e.ownedSystems) {
      const s = state.systems[sid]!;
      population += s.population;
      credits += s.credits;
      garrison += s.garrison;
    }
    empires[id] = {
      name: e.name,
      colorHue: e.colorHue,
      colorSat: e.colorSat,
      colorLight: e.colorLight,
      archetype: e.archetype,
      capitalSystemId: e.capitalSystemId,
      allies: [...e.allies],
      alive: e.alive,
      territory: e.ownedSystems.size,
      population,
      credits,
      garrison,
      researched: [...e.researched],
      fleet: { ...e.fleet },
      fleetPower: fleetPower(e.fleet),
    };
  }

  return {
    tick: state.tick,
    status: state.status,
    geometry: state.geometry,
    systems,
    empires,
    events: state.events.slice(-120),
    systemOrder: state.systemOrder,
    empireOrder: state.empireOrder,
  };
}
