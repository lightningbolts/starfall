import type {
  Empire,
  MacroEvent,
  MacroState,
  MacroTechId,
  PlanetaryDevId,
  RepeatableTechId,
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
  "medical_corps",
  "logistics_network",
  "war_mobilization",
  "planetary_shields",
  "capital_shipyards",
  "xenology_bureau",
  "singularity_labs",
  "tactical_ai",
  "fleet_logistics",
  "terraforming_guilds",
  "espionage_bureau",
  "warp_doctrine",
  "galactic_hegemony",
  "eternal_archives",
  "iron_curtain",
  "pax_federation",
  "supercapital_frame",
  "advanced_shields",
  "sensor_grid",
  "medical_nanites",
  "stellar_engineering",
  "quantum_command",
  "living_metal",
  "void_navigation",
  "genesis_protocols",
] as const;

export const REPEATABLE_TECH_IDS: readonly RepeatableTechId[] = [
  "applied_sciences",
  "fleet_doctrine_ex",
  "industrial_excellence",
] as const;

export const TECH_TIER: Record<MacroTechId, 1 | 2 | 3 | 4 | 5> = {
  industrial_foundries: 1,
  colony_administration: 1,
  militia_doctrine: 1,
  archive_networks: 1,
  megafarms: 2,
  fortress_worlds: 2,
  diplomatic_corps: 2,
  deep_scanners: 2,
  escort_doctrine: 2,
  medical_corps: 2,
  logistics_network: 2,
  war_mobilization: 3,
  planetary_shields: 3,
  capital_shipyards: 3,
  xenology_bureau: 3,
  singularity_labs: 3,
  tactical_ai: 3,
  fleet_logistics: 3,
  terraforming_guilds: 3,
  espionage_bureau: 3,
  warp_doctrine: 3,
  galactic_hegemony: 4,
  eternal_archives: 4,
  iron_curtain: 4,
  pax_federation: 4,
  supercapital_frame: 4,
  advanced_shields: 4,
  sensor_grid: 4,
  medical_nanites: 4,
  stellar_engineering: 5,
  quantum_command: 5,
  living_metal: 5,
  void_navigation: 5,
  genesis_protocols: 5,
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
  medical_corps: "Medical Corps",
  logistics_network: "Logistics Network",
  war_mobilization: "War Mobilization",
  planetary_shields: "Planetary Shields",
  capital_shipyards: "Capital Shipyards",
  xenology_bureau: "Xenology Bureau",
  singularity_labs: "Singularity Labs",
  tactical_ai: "Tactical AI",
  fleet_logistics: "Fleet Logistics",
  terraforming_guilds: "Terraforming Guilds",
  espionage_bureau: "Espionage Bureau",
  warp_doctrine: "Warp Doctrine",
  galactic_hegemony: "Galactic Hegemony",
  eternal_archives: "Eternal Archives",
  iron_curtain: "Iron Curtain",
  pax_federation: "Pax Federation",
  supercapital_frame: "Supercapital Frame",
  advanced_shields: "Advanced Shields",
  sensor_grid: "Sensor Grid",
  medical_nanites: "Medical Nanites",
  stellar_engineering: "Stellar Engineering",
  quantum_command: "Quantum Command",
  living_metal: "Living Metal",
  void_navigation: "Void Navigation",
  genesis_protocols: "Genesis Protocols",
};

export const TECH_BLURB: Record<MacroTechId, string> = {
  industrial_foundries: "+15% credit output",
  colony_administration: "Cheaper colonization",
  militia_doctrine: "+15% garrison growth",
  archive_networks: "−15% research costs",
  megafarms: "+20% population growth",
  fortress_worlds: "Stronger capital & contested garrisons",
  diplomatic_corps: "Easier alliances",
  deep_scanners: "Better border pressure & tactics",
  escort_doctrine: "Unlocks destroyers",
  medical_corps: "Population recovery & plague resistance",
  logistics_network: "Lower sprawl upkeep",
  war_mobilization: "Faster offensives",
  planetary_shields: "+10% garrison; stronger sieges",
  capital_shipyards: "Unlocks battleships & carriers",
  xenology_bureau: "Xenophobe combat edge",
  singularity_labs: "+10% credits",
  tactical_ai: "+10% combat tactics",
  fleet_logistics: "Lower fleet upkeep",
  terraforming_guilds: "Cheaper colonies; higher pop ceilings",
  espionage_bureau: "Faster contested drift when attacking",
  warp_doctrine: "Shorter attacker engagement times",
  galactic_hegemony: "Ambition combat bonus",
  eternal_archives: "Further research discounts",
  iron_curtain: "Slower contested decay for defenders",
  pax_federation: "Ally economy bonus",
  supercapital_frame: "Unlocks dreadnoughts",
  advanced_shields: "Heavy siege defense",
  sensor_grid: "Tactics & scanner edge",
  medical_nanites: "Strong population recovery",
  stellar_engineering: "+18% credit output",
  quantum_command: "Major tactics bonus",
  living_metal: "Shipyard output surge",
  void_navigation: "Faster expansion pressure",
  genesis_protocols: "Population & credit surge",
};

export const REPEATABLE_LABEL: Record<RepeatableTechId, string> = {
  applied_sciences: "Applied Sciences",
  fleet_doctrine_ex: "Fleet Doctrine Ex",
  industrial_excellence: "Industrial Excellence",
};

export const REPEATABLE_BLURB: Record<RepeatableTechId, string> = {
  applied_sciences: "+3% research discount per level (stacking)",
  fleet_doctrine_ex: "+2% combat doctrine & −2% fleet upkeep per level",
  industrial_excellence: "+3% credit output per level",
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

const MILITARY_STRIP: ReadonlySet<PlanetaryDevId> = new Set([
  "orbital_batteries",
  "fortress_complex",
  "hidden_arsenals",
  "shipyard_ring",
]);

export function techCost(tech: MacroTechId, empire: Empire): number {
  const tier = TECH_TIER[tech];
  let cost = 120 * Math.pow(2.1, tier - 1);
  if (empire.researched.has("archive_networks")) cost *= 0.85;
  if (empire.researched.has("eternal_archives")) cost *= 0.9;
  const applied = empire.repeatableLevels.applied_sciences ?? 0;
  if (applied > 0) cost *= Math.max(0.45, 1 - applied * 0.03);
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

export function repeatableCost(
  state: MacroState,
  empire: Empire,
  track: RepeatableTechId,
): number {
  const level = empire.repeatableLevels[track] ?? 0;
  let cost = 900 * Math.pow(1.35, level);
  if (empire.researched.has("archive_networks")) cost *= 0.85;
  if (empire.researched.has("eternal_archives")) cost *= 0.9;
  const applied = empire.repeatableLevels.applied_sciences ?? 0;
  if (applied > 0) cost *= Math.max(0.45, 1 - applied * 0.03);
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
  const need = (tier - 1) as 1 | 2 | 3 | 4;
  for (const id of empire.researched) {
    if (TECH_TIER[id] === need) return true;
  }
  return false;
}

export function canResearchRepeatable(empire: Empire): boolean {
  for (const id of empire.researched) {
    if (TECH_TIER[id] >= 4) return true;
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

export function tryResearchRepeatable(
  state: MacroState,
  empire: Empire,
  track: RepeatableTechId,
): MacroEvent | null {
  if (!canResearchRepeatable(empire)) return null;
  const cost = repeatableCost(state, empire, track);
  if (!spendEmpireCredits(state, empire, cost)) return null;
  const next = (empire.repeatableLevels[track] ?? 0) + 1;
  empire.repeatableLevels[track] = next;
  return emit(state, {
    tick: state.tick,
    kind: "tech_researched",
    empireIds: [empire.id],
    systemId: empire.capitalSystemId,
    text: `${empire.name} advances ${REPEATABLE_LABEL[track]} to level ${next}.`,
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

export function grantRepeatableLevel(
  empire: Empire,
  track: RepeatableTechId,
): number {
  const next = (empire.repeatableLevels[track] ?? 0) + 1;
  empire.repeatableLevels[track] = next;
  return next;
}

export function pickResearchTarget(
  empire: Empire,
  rng: () => number,
): MacroTechId | null {
  const options = MACRO_TECH_IDS.filter((t) => canResearch(empire, t));
  if (options.length === 0) return null;
  options.sort((a, b) => {
    const ta = TECH_TIER[a] + (techAffinity(empire, a) ? -0.4 : 0);
    const tb = TECH_TIER[b] + (techAffinity(empire, b) ? -0.4 : 0);
    return ta - tb + (rng() - 0.5) * 0.2;
  });
  return options[0]!;
}

export function pickRepeatableTarget(
  empire: Empire,
  rng: () => number,
): RepeatableTechId | null {
  if (!canResearchRepeatable(empire)) return null;
  const options = [...REPEATABLE_TECH_IDS];
  const idx = Math.floor(rng() * options.length);
  return options[idx] ?? null;
}

function techAffinity(empire: Empire, tech: MacroTechId): boolean {
  if (empire.traits.curiosity > 0.55) {
    return (
      tech === "archive_networks" ||
      tech === "singularity_labs" ||
      tech === "tactical_ai" ||
      tech === "eternal_archives" ||
      tech === "sensor_grid" ||
      tech === "quantum_command" ||
      tech === "genesis_protocols"
    );
  }
  if (empire.traits.ambition > 0.6) {
    return (
      tech === "war_mobilization" ||
      tech === "capital_shipyards" ||
      tech === "galactic_hegemony" ||
      tech === "supercapital_frame" ||
      tech === "living_metal" ||
      tech === "void_navigation"
    );
  }
  if (empire.traits.xenophobia > 0.6) {
    return (
      tech === "iron_curtain" ||
      tech === "xenology_bureau" ||
      tech === "militia_doctrine" ||
      tech === "advanced_shields"
    );
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

/** Strip military sites on conquest; civilian infrastructure remains. */
export function stripDevelopmentsOnFlip(system: StarSystem): void {
  for (const d of [...system.developments]) {
    if (MILITARY_STRIP.has(d)) system.developments.delete(d);
  }
}

export function creditProductionMult(empire: Empire, system: StarSystem): number {
  let m = 1;
  if (empire.researched.has("industrial_foundries")) m *= 1.15;
  if (empire.researched.has("singularity_labs")) m *= 1.1;
  if (empire.researched.has("stellar_engineering")) m *= 1.18;
  if (empire.researched.has("genesis_protocols")) m *= 1.12;
  if (system.developments.has("mining_spires")) m *= 1.25;
  if (system.developments.has("trade_hub")) m *= 1.12;
  if (empire.researched.has("pax_federation")) {
    m *= 1 + Math.min(0.2, empire.allies.length * 0.03);
  }
  const industrial = empire.repeatableLevels.industrial_excellence ?? 0;
  if (industrial > 0) m *= 1 + industrial * 0.03;
  return m;
}

export function popProductionMult(empire: Empire, system: StarSystem): number {
  let m = 1;
  if (empire.researched.has("megafarms")) m *= 1.2;
  if (empire.researched.has("medical_corps")) m *= 1.08;
  if (empire.researched.has("medical_nanites")) m *= 1.12;
  if (empire.researched.has("genesis_protocols")) m *= 1.15;
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
  let m = empire.researched.has("colony_administration") ? 0.75 : 1;
  if (empire.researched.has("terraforming_guilds")) m *= 0.85;
  if (empire.researched.has("void_navigation")) m *= 0.9;
  return m;
}

export function sprawlUpkeepMult(empire: Empire): number {
  let m = 1;
  if (empire.researched.has("logistics_network")) m *= 0.75;
  return m;
}

export function fleetUpkeepMult(empire: Empire): number {
  let m = 1;
  if (empire.researched.has("fleet_logistics")) m *= 0.8;
  const doctrine = empire.repeatableLevels.fleet_doctrine_ex ?? 0;
  if (doctrine > 0) m *= Math.max(0.4, 1 - doctrine * 0.02);
  return m;
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
  const living = empire.researched.has("living_metal") ? 1.5 : 1;
  for (const sid of empire.ownedSystems) {
    const s = state.systems[sid]!;
    if (!s.developments.has("shipyard_ring")) continue;
    if (empire.researched.has("capital_shipyards")) {
      addShips(empire.fleet, "cruiser", Math.round(40 * living));
      if (Math.floor(fleetPower(empire.fleet) / 2000) % 2 === 0) {
        addShips(empire.fleet, "battleship", Math.round(8 * living));
      }
      if (
        empire.researched.has("supercapital_frame") &&
        Math.floor(state.tick / 30 + sid.length) % 3 === 0
      ) {
        addShips(empire.fleet, "dreadnought", Math.round(2 * living));
      }
    } else {
      addShips(empire.fleet, "corvette", Math.round(80 * living));
    }
    if (s.developments.has("hidden_arsenals")) {
      addShips(empire.fleet, "raider", Math.round(40 * living));
      addShips(empire.fleet, "corvette", Math.round(40 * living));
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
      t === "deep_scanners" ||
      t === "advanced_shields" ||
      t === "sensor_grid" ||
      t === "quantum_command" ||
      t === "living_metal" ||
      t === "espionage_bureau" ||
      t === "warp_doctrine"
    ) {
      s += TECH_TIER[t];
    }
  }
  return s;
}

export function totalTechScore(
  researched: Iterable<MacroTechId>,
  repeatableLevels: Partial<Record<RepeatableTechId, number>>,
): number {
  let s = militaryTechScore(researched);
  for (const t of researched) {
    if (
      !(
        t === "militia_doctrine" ||
        t === "escort_doctrine" ||
        t === "war_mobilization" ||
        t === "capital_shipyards" ||
        t === "tactical_ai" ||
        t === "planetary_shields" ||
        t === "supercapital_frame" ||
        t === "galactic_hegemony" ||
        t === "iron_curtain" ||
        t === "deep_scanners" ||
        t === "advanced_shields" ||
        t === "sensor_grid" ||
        t === "quantum_command" ||
        t === "living_metal" ||
        t === "espionage_bureau" ||
        t === "warp_doctrine"
      )
    ) {
      s += TECH_TIER[t] * 0.5;
    }
  }
  for (const id of REPEATABLE_TECH_IDS) {
    s += (repeatableLevels[id] ?? 0) * 2;
  }
  return Math.round(s);
}
