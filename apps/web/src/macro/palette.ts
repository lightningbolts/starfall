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

export interface Rgb {
  r: number;
  g: number;
  b: number;
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

/** Interior of an empire's territory — deep and desaturated so stars read on top. */
export function empireFill(hue: number): Rgb {
  return hslToRgb(normalizeHue(hue), 0.45, 0.17);
}

/** Territory rim, capital markers, and roster swatches. */
export function empireAccent(hue: number): Rgb {
  return hslToRgb(normalizeHue(hue), 0.58, 0.52);
}

export function rgbToCss(c: Rgb): string {
  const to255 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${to255(c.r)} ${to255(c.g)} ${to255(c.b)})`;
}

/** CSS color for a dashboard swatch; identical hue/level to the map rim. */
export function empireSwatchCss(hue: number): string {
  return rgbToCss(empireAccent(hue));
}

export function empireFillCss(hue: number): string {
  return rgbToCss(empireFill(hue));
}
