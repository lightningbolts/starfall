/**
 * Single source of truth for Chronicle colors. The map and the dashboard both
 * derive empire colors from here, so a roster swatch always matches its
 * territory on the map. Hexes mirror the `--sf-*` tokens in styles.css
 * (see docs/design/visuals.md).
 */

export const VOID = 0x07090d;
export const STARFIELD = 0x0c1018;
export const DUST = 0x1a2230;
export const LANE = 0x3a4558;
export const CARGO = 0x7aafc4;
export const UNOWNED = 0x6b7585;
export const SELF = 0xe8a838;
export const FOCUS = 0xf0d080;
export const DANGER = 0xc45c4a;
export const COMBAT_FLASH = 0xf5f2ea;
export const HUD_BORDER = 0x2a3344;

/** Event cue colors (map pulses + feed accents). */
export const EVENT_PLAGUE = 0x6bcf8e;
export const EVENT_REBELLION = 0xd4783a;
export const EVENT_BLITZ = 0xe05252;
export const EVENT_PIRATES = 0x9a8f7a;
export const EVENT_TECH = 0x5eb0e0;
export const EVENT_COUP = 0xc9a0dc;
export const EVENT_BATTLE = 0xf0c040;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface EmpireColor {
  hue: number;
  sat: number;
  light: number;
}

function normalizeHue(hue: number): number {
  return (((hue % 360) + 360) % 360) / 360;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) return { r: l, g: l, b: l };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return {
    r: channel(h + 1 / 3),
    g: channel(h),
    b: channel(h - 1 / 3),
  };
}

function asColor(
  hueOrColor: number | EmpireColor,
  sat?: number,
  light?: number,
): EmpireColor {
  if (typeof hueOrColor === "object") return hueOrColor;
  return {
    hue: hueOrColor,
    sat: sat ?? 0.58,
    light: light ?? 0.52,
  };
}

/** Interior of an empire's territory — deep and desaturated so stars read on top. */
export function empireFill(
  hueOrColor: number | EmpireColor,
  sat?: number,
  light?: number,
): Rgb {
  const c = asColor(hueOrColor, sat, light);
  return hslToRgb(
    normalizeHue(c.hue),
    Math.min(0.5, c.sat * 0.7),
    Math.min(0.22, c.light * 0.35),
  );
}

/** Territory rim, capital markers, and roster swatches. */
export function empireAccent(
  hueOrColor: number | EmpireColor,
  sat?: number,
  light?: number,
): Rgb {
  const c = asColor(hueOrColor, sat, light);
  return hslToRgb(normalizeHue(c.hue), c.sat, c.light);
}

export function rgbToCss(c: Rgb): string {
  const to255 = (v: number): number =>
    Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${to255(c.r)} ${to255(c.g)} ${to255(c.b)})`;
}

export function hexToRgb(hex: number): Rgb {
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
  };
}

/** CSS color for a dashboard swatch; identical hue/level to the map rim. */
export function empireSwatchCss(
  hueOrColor: number | EmpireColor,
  sat?: number,
  light?: number,
): string {
  return rgbToCss(empireAccent(hueOrColor, sat, light));
}

export function empireFillCss(
  hueOrColor: number | EmpireColor,
  sat?: number,
  light?: number,
): string {
  return rgbToCss(empireFill(hueOrColor, sat, light));
}

export function eventPulseColor(kind: string): number {
  switch (kind) {
    case "plague":
      return EVENT_PLAGUE;
    case "rebellion":
      return EVENT_REBELLION;
    case "offensive_blitz":
      return EVENT_BLITZ;
    case "pirate_raid":
    case "robbery":
      return EVENT_PIRATES;
    case "tech_breakthrough":
    case "tech_researched":
    case "relic_discovery":
      return EVENT_TECH;
    case "coup":
    case "regime_change":
      return EVENT_COUP;
    case "fleet_battle":
    case "border_clash":
    case "capital_fallen":
    case "front_collapse":
      return EVENT_BATTLE;
    default:
      return COMBAT_FLASH;
  }
}
