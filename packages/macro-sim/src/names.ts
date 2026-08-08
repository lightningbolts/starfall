import { createRng, pick } from "./rng.js";

const SYLLABLES = [
  "zor",
  "kai",
  "vel",
  "thar",
  "nyx",
  "sol",
  "dra",
  "quel",
  "mir",
  "vox",
  "ash",
  "ryn",
  "tor",
  "hel",
  "syl",
  "kra",
  "lun",
  "pex",
  "jor",
  "fen",
  "ika",
  "oru",
  "ael",
  "uin",
  "esk",
  "bal",
  "cin",
  "dor",
  "eth",
  "gal",
] as const;

const ADJECTIVES = [
  "Crimson",
  "Silent",
  "Ashen",
  "Radiant",
  "Iron",
  "Hollow",
  "Verdant",
  "Stellar",
  "Obsidian",
  "Gilded",
  "Frozen",
  "Burning",
  "Eternal",
  "Shattered",
  "Azure",
  "Pale",
  "Vast",
  "Hidden",
  "Ancient",
  "Rising",
] as const;

const GOVERNMENTS = [
  "Imperium",
  "Hegemony",
  "Concord",
  "Dominion",
  "Collective",
  "Republic",
  "Syndicate",
  "Pact",
  "League",
  "Order",
] as const;

const SYSTEM_PREFIX = [
  "Alpha",
  "Beta",
  "Gamma",
  "Delta",
  "Kepler",
  "Nova",
  "Cygnus",
  "Lyra",
  "Vega",
  "Orion",
  "Pulsar",
  "Halo",
] as const;

function titleCaseSyllable(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function generateEmpireName(
  seed: number,
  index: number,
  used: Set<string>,
): string {
  const rng = createRng(seed ^ (index * 0x9e3779b9) ^ 0xdeadbeef);
  for (let attempt = 0; attempt < 64; attempt++) {
    const a = titleCaseSyllable(pick(rng, SYLLABLES));
    const b = titleCaseSyllable(pick(rng, SYLLABLES));
    const adj = pick(rng, ADJECTIVES);
    const gov = pick(rng, GOVERNMENTS);
    const pattern = Math.floor(rng() * 3);
    const name =
      pattern === 0
        ? `${adj} ${a}${b} ${gov}`
        : pattern === 1
          ? `${a}${b} ${gov}`
          : `${adj} ${gov} of ${a}${b}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `Empire ${index + 1}`;
  used.add(fallback);
  return fallback;
}

export function generateSystemName(seed: number, regionId: string, i: number): string {
  const rng = createRng(
    seed ^ hashStr(regionId) ^ (i * 0x85ebca6b) ^ 0x165667b1,
  );
  const prefix = pick(rng, SYSTEM_PREFIX);
  const syl = titleCaseSyllable(pick(rng, SYLLABLES));
  const n = 1 + Math.floor(rng() * 99);
  return `${prefix} ${syl}-${n}`;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
