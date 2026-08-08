import type {
  Empire,
  MacroEvent,
  MacroState,
  MacroTechId,
  PlanetaryDevId,
  StarSystem,
} from "./types.js";
import { MAX_PLANETARY_DEVS } from "./types.js";
import { emit } from "./log.js";
import { addShips, fleetPower } from "./ships.js";

export const MACRO_TECH_IDS: readonly MacroTechId[] = [
  "industrial_foundries",
  "colony_administration",
  "militia_doctrine",
  "archive_networks",
  "megafarms",
  "fortress_worlds",
  "diplomatic_corps",
  "deep_scanners",
  "escort_doctrine",
  "war_mobilization",
  "planetary_shields",
  "capital_shipyards",
  "xenology_bureau",
  "singularity_labs",
  "tactical_ai",
  "galactic_hegemony",
  "eternal_archives",
  "iron_curtain",
  "pax_federation",
  "supercapital_frame",
] as const;

export const TECH_TIER: Record<MacroTechId, 1 | 2 | 3 | 4> = {
  industrial_foundries: 1,
  colony_administration: 1,
  militia_doctrine: 1,
  archive_networks: 1,
  megafarms: 2,
  fortress_worlds: 2,
  diplomatic_corps: 2,
  deep_scanners: 2,
  escort_doctrine: 2,
  war_mobilization: 3,
  planetary_shields: 3,
  capital_shipyards: 3,
  xenology_bureau: 3,
  singularity_labs: 3,
  tactical_ai: 3,
  galactic_hegemony: 4,
  eternal_archives: 4,
  iron_curtain: 4,
  pax_federation: 4,
  supercapital_frame: 4,
};

export const TECH_LABEL: Record<MacroTechId, string> = {
  industrial_foundries: "Industrial Foundries",
  colony_administration: "Colony Administration",
  militia_doctrine: "Militia Doctrine",
  archive_networks: "Archive Networks",
  megafarms: "Megafarms",
  fortress_worlds: "Fortress Worlds",
  diplomatic_corps: "Diplomatic Corps",
  deep_scanners: "Deep Scanners",
  escort_doctrine: "Escort Doctrine",
  war_mobilization: "War Mobilization",
  planetary_shields: "Planetary Shields",
  capital_shipyards: "Capital Shipyards",
  xenology_bureau: "Xenology Bureau",
  singularity_labs: "Singularity Labs",
  tactical_ai: "Tactical AI",
  galactic_hegemony: "Galactic Hegemony",
  eternal_archives: "Eternal Archives",
  iron_curtain: "Iron Curtain",
  pax_federation: "Pax Federation",
  supercapital_frame: "Supercapital Frame",
};

export const PLANETARY_DEV_IDS: readonly PlanetaryDevId[] = [
  "agro_domes",
  "mining_spires",
  "orbital_batteries",
  "shipyard_ring",
  "research_campus",
  "fortress_complex",
  "trade_hub",
  "plague_hospitals",
  "hidden_arsenals",
] as const;

export const PLANETARY_LABEL: Record<PlanetaryDevId, string> = {
  agro_domes: "Agro Domes",
  mining_spires: "Mining Spires",
  orbital_batteries: "Orbital Batteries",
  shipyard_ring: "Shipyard Ring",
  research_campus: "Research Campus",
  fortress_complex: "Fortress Complex",
  trade_hub: "Trade Hub",
  plague_hospitals: "Plague Hospitals",
  hidden_arsenals: "Hidden Arsenals",
};

export const PLANETARY_COST: Record<PlanetaryDevId, number> = {
  agro_domes: 40,
  mining_spires: 45,
  orbital_batteries: 55,
  shipyard_ring: 90,
  research_campus: 70,
  fortress_complex: 80,
  trade_hub: 50,
  plague_hospitals: 35,
  hidden_arsenals: 48,
};

export function techCost(tech: MacroTechId, empire: Empire): number {
  const tier = TECH_TIER[tech];
  let cost = 120 * Math.pow(2.1, tier - 1);
  if (empire.researched.has("archive_networks")) cost *= 0.85;
  let campuses = 0;
  for (const sid of empire.ownedSystems) {
    // Caller may not have systems — cost helper used with state usually.
    void sid;
  }
  void campuses;
  return Math.round(cost);
}

export function techCostWithState(
  state: MacroState,
  empire: Empire,
  tech: MacroTechId,
): number {
  let cost = techCost(tech, empire);
  let campuses = 0;
  for (const sid of empire.ownedSystems) {
    if (state.systems[sid]?.developments.has("research_campus")) campuses++;
  }
  cost *= Math.max(0.7, 1 - campuses * 0.03);
  return Math.round(cost);
}

export function canResearch(empire: Empire, tech: MacroTechId): boolean {
  if (empire.researched.has(tech)) return false;
  const tier = TECH_TIER[tech];
  if (tier === 1) return true;
  const need = (tier - 1) as 1 | 2 | 3;
  for (const id of empire.researched) {
    if (TECH_TIER[id] === need) return true;
  }
  return false;
}

export function empireTreasury(state: MacroState, empire: Empire): number {
  let c = 0;
  for (const sid of empire.ownedSystems) c += state.systems[sid]!.credits;
  return c;
}

export function spendEmpireCredits(
  state: MacroState,
  empire: Empire,
  amount: number,
): boolean {
  if (amount <= 0) return true;
  const total = empireTreasury(state, empire);
  if (total < amount) return false;
  for (const sid of empire.ownedSystems) {
    const s = state.systems[sid]!;
    const share = s.credits / total;
    s.credits = Math.max(0, s.credits - amount * share);
  }
  return true;
}

export function tryResearch(
  state: MacroState,
  empire: Empire,
  tech: MacroTechId,
): MacroEvent | null {
  if (!canResearch(empire, tech)) return null;
  const cost = techCostWithState(state, empire, tech);
  if (!spendEmpireCredits(state, empire, cost)) return null;
  empire.researched.add(tech);
  return emit(state, {
    tick: state.tick,
    kind: "tech_researched",
    empireIds: [empire.id],
    systemId: empire.capitalSystemId,
    text: `${empire.name} unlocks ${TECH_LABEL[tech]}.`,
  });
}

export function grantTech(empire: Empire, tech: MacroTechId): boolean {
  if (empire.researched.has(tech)) return false;
  if (!canResearch(empire, tech) && TECH_TIER[tech] > 1) {
    // Allow breakthrough to skip prereq for T1–T2 only.
    if (TECH_TIER[tech] > 2) return false;
  }
  empire.researched.add(tech);
  return true;
}

export function pickResearchTarget(
  empire: Empire,
  rng: () => number,
): MacroTechId | null {
  const options = MACRO_TECH_IDS.filter((t) => canResearch(empire, t));
  if (options.length === 0) return null;
  // Prefer lower tiers, curiosity biases toward archive/singularity/tactical.
  options.sort((a, b) => {
    const ta = TECH_TIER[a] + (techAffinity(empire, a) ? -0.4 : 0);
    const tb = TECH_TIER[b] + (techAffinity(empire, b) ? -0.4 : 0);
    return ta - tb + (rng() - 0.5) * 0.2;
  });
  return options[0]!;
}

function techAffinity(empire: Empire, tech: MacroTechId): boolean {
  if (empire.traits.curiosity > 0.55) {
    return (
      tech === "archive_networks" ||
      tech === "singularity_labs" ||
      tech === "tactical_ai" ||
      tech === "eternal_archives"
    );
  }
  if (empire.traits.ambition > 0.6) {
    return (
      tech === "war_mobilization" ||
      tech === "capital_shipyards" ||
      tech === "galactic_hegemony" ||
      tech === "supercapital_frame"
    );
  }
  if (empire.traits.xenophobia > 0.6) {
    return tech === "iron_curtain" || tech === "xenology_bureau" || tech === "militia_doctrine";
  }
  if (empire.archetype === "diplomat") {
    return tech === "diplomatic_corps" || tech === "pax_federation";
  }
  return false;
}

export function canBuildPlanetary(
  state: MacroState,
  empire: Empire,
  system: StarSystem,
  dev: PlanetaryDevId,
): boolean {
  if (system.ownerId !== empire.id) return false;
  if (system.developments.has(dev)) return false;
  if (system.developments.size >= MAX_PLANETARY_DEVS) return false;
  if (dev === "shipyard_ring" && !empire.researched.has("capital_shipyards")) {
    return false;
  }
  return system.credits >= PLANETARY_COST[dev] * 0.5;
}

export function tryBuildPlanetary(
  state: MacroState,
  empire: Empire,
  system: StarSystem,
  dev: PlanetaryDevId,
): MacroEvent | null {
  if (!canBuildPlanetary(state, empire, system, dev)) return null;
  const cost = PLANETARY_COST[dev];
  if (system.credits >= cost) {
    system.credits -= cost;
  } else {
    const need = cost - system.credits;
    system.credits = 0;
    if (!spendEmpireCredits(state, empire, need)) return null;
  }
  system.developments.add(dev);
  return emit(state, {
    tick: state.tick,
    kind: "planetary_built",
    empireIds: [empire.id],
    systemId: system.id,
    text: `${empire.name} builds ${PLANETARY_LABEL[dev]} on ${system.name}.`,
  });
}

export function stripDevelopmentsOnFlip(system: StarSystem): void {
  system.developments.clear();
}

export function creditProductionMult(empire: Empire, system: StarSystem): number {
  let m = 1;
  if (empire.researched.has("industrial_foundries")) m *= 1.15;
  if (empire.researched.has("singularity_labs")) m *= 1.1;
  if (system.developments.has("mining_spires")) m *= 1.25;
  if (system.developments.has("trade_hub")) m *= 1.12;
  if (empire.researched.has("pax_federation")) {
    m *= 1 + Math.min(0.2, empire.allies.length * 0.03);
  }
  return m;
}

export function popProductionMult(empire: Empire, system: StarSystem): number {
  let m = 1;
  if (empire.researched.has("megafarms")) m *= 1.2;
  if (system.developments.has("agro_domes")) m *= 1.3;
  return m;
}

export function garrisonGrowthMult(empire: Empire, system: StarSystem): number {
  let m = 1;
  if (empire.researched.has("militia_doctrine")) m *= 1.15;
  if (
    empire.researched.has("fortress_worlds") &&
    (system.id === empire.capitalSystemId || system.contested)
  ) {
    m *= 1.25;
  }
  if (empire.researched.has("planetary_shields")) m *= 1.1;
  return m;
}

export function colonizeCostMult(empire: Empire): number {
  return empire.researched.has("colony_administration") ? 0.75 : 1;
}

export function shipUnlockOk(empire: Empire, type: string): boolean {
  if (type === "destroyer") return empire.researched.has("escort_doctrine");
  if (type === "battleship" || type === "carrier") {
    return empire.researched.has("capital_shipyards");
  }
  if (type === "dreadnought") return empire.researched.has("supercapital_frame");
  return true;
}

export function applyShipyardPulse(state: MacroState, empire: Empire): void {
  for (const sid of empire.ownedSystems) {
    const s = state.systems[sid]!;
    if (!s.developments.has("shipyard_ring")) continue;
    if (empire.researched.has("capital_shipyards")) {
      addShips(empire.fleet, "cruiser", 1);
      if (Math.floor(fleetPower(empire.fleet) / 50) % 2 === 0) {
        addShips(empire.fleet, "battleship", 1);
      }
    } else {
      addShips(empire.fleet, "corvette", 2);
    }
    if (s.developments.has("hidden_arsenals")) {
      addShips(empire.fleet, "raider", 1);
      addShips(empire.fleet, "corvette", 1);
    }
  }
}

export function pickPlanetaryTarget(
  empire: Empire,
  system: StarSystem,
  rng: () => number,
): PlanetaryDevId | null {
  const prefs: PlanetaryDevId[] = [];
  if (empire.traits.ambition > 0.55 || empire.archetype === "conqueror") {
    prefs.push("shipyard_ring", "orbital_batteries", "mining_spires");
  }
  if (empire.archetype === "technocrat" || empire.traits.curiosity > 0.6) {
    prefs.push("research_campus", "agro_domes");
  }
  if (empire.archetype === "isolationist" || empire.archetype === "cautious") {
    prefs.push("fortress_complex", "orbital_batteries", "plague_hospitals");
  }
  if (empire.archetype === "xenophobe" || empire.archetype === "reckless") {
    prefs.push("hidden_arsenals", "orbital_batteries");
  }
  if (empire.archetype === "diplomat") prefs.push("trade_hub", "agro_domes");
  if (system.id === empire.capitalSystemId) {
    prefs.unshift("fortress_complex", "research_campus");
  }
  prefs.push("mining_spires", "agro_domes", "trade_hub");
  for (const d of prefs) {
    if (!system.developments.has(d)) {
      if (d === "shipyard_ring" && !empire.researched.has("capital_shipyards")) {
        continue;
      }
      if (rng() < 0.7) return d;
    }
  }
  for (const d of PLANETARY_DEV_IDS) {
    if (!system.developments.has(d)) {
      if (d === "shipyard_ring" && !empire.researched.has("capital_shipyards")) {
        continue;
      }
      return d;
    }
  }
  return null;
}

export function militaryTechScore(researched: Iterable<MacroTechId>): number {
  let s = 0;
  for (const t of researched) {
    if (
      t === "militia_doctrine" ||
      t === "escort_doctrine" ||
      t === "war_mobilization" ||
      t === "capital_shipyards" ||
      t === "tactical_ai" ||
      t === "planetary_shields" ||
      t === "supercapital_frame" ||
      t === "galactic_hegemony" ||
      t === "iron_curtain" ||
      t === "deep_scanners"
    ) {
      s += TECH_TIER[t];
    }
  }
  return s;
}
