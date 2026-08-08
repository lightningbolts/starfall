/** Curated HSL swatches — greys, earth, warm, cool, greens — for empire accents. */
export interface EmpireSwatch {
  hue: number;
  sat: number;
  light: number;
}

export const EMPIRE_SWATCH_BANK: readonly EmpireSwatch[] = [
  // Neutrals
  { hue: 210, sat: 0.08, light: 0.55 },
  { hue: 35, sat: 0.1, light: 0.52 },
  { hue: 220, sat: 0.14, light: 0.48 },
  { hue: 200, sat: 0.12, light: 0.58 },
  { hue: 0, sat: 0.05, light: 0.5 },
  // Earth / brown
  { hue: 25, sat: 0.42, light: 0.38 },
  { hue: 18, sat: 0.48, light: 0.42 },
  { hue: 30, sat: 0.35, light: 0.45 },
  { hue: 40, sat: 0.4, light: 0.55 },
  { hue: 38, sat: 0.55, light: 0.48 },
  { hue: 75, sat: 0.28, light: 0.42 },
  // Warm
  { hue: 12, sat: 0.62, light: 0.48 },
  { hue: 8, sat: 0.7, light: 0.52 },
  { hue: 0, sat: 0.65, light: 0.45 },
  { hue: 340, sat: 0.55, light: 0.55 },
  { hue: 28, sat: 0.7, light: 0.52 },
  { hue: 45, sat: 0.72, light: 0.5 },
  // Cool
  { hue: 175, sat: 0.55, light: 0.45 },
  { hue: 190, sat: 0.6, light: 0.5 },
  { hue: 205, sat: 0.58, light: 0.52 },
  { hue: 230, sat: 0.45, light: 0.5 },
  { hue: 265, sat: 0.4, light: 0.52 },
  // Greens
  { hue: 145, sat: 0.5, light: 0.4 },
  { hue: 130, sat: 0.35, light: 0.48 },
  { hue: 100, sat: 0.4, light: 0.45 },
  { hue: 160, sat: 0.45, light: 0.5 },
  // Extra distinct
  { hue: 320, sat: 0.45, light: 0.48 },
  { hue: 55, sat: 0.5, light: 0.42 },
  { hue: 280, sat: 0.35, light: 0.55 },
  { hue: 15, sat: 0.25, light: 0.4 },
  { hue: 195, sat: 0.25, light: 0.45 },
  { hue: 90, sat: 0.45, light: 0.38 },
  { hue: 350, sat: 0.5, light: 0.42 },
  { hue: 170, sat: 0.3, light: 0.55 },
  { hue: 48, sat: 0.2, light: 0.58 },
  { hue: 240, sat: 0.2, light: 0.42 },
];

function dist2(a: EmpireSwatch, b: EmpireSwatch): number {
  let dh = Math.abs(a.hue - b.hue);
  if (dh > 180) dh = 360 - dh;
  const ds = (a.sat - b.sat) * 180;
  const dl = (a.light - b.light) * 180;
  return dh * dh + ds * ds + dl * dl;
}

/**
 * Assign visually distinct swatches via farthest-neighbor from a curated bank.
 */
export function swatchForIndex(
  i: number,
  total: number,
  rng: () => number,
  picked: EmpireSwatch[],
): EmpireSwatch {
  const bank = EMPIRE_SWATCH_BANK;
  if (picked.length === 0) {
    const idx = Math.floor(rng() * bank.length);
    return { ...bank[idx]! };
  }

  let best: EmpireSwatch | null = null;
  let bestScore = -1;
  // Prefer unused bank entries.
  for (let attempt = 0; attempt < bank.length * 2; attempt++) {
    const base = bank[Math.floor(rng() * bank.length)]!;
    const candidate: EmpireSwatch = {
      hue: (base.hue + (rng() - 0.5) * 8 + 360) % 360,
      sat: Math.min(0.85, Math.max(0.04, base.sat + (rng() - 0.5) * 0.06)),
      light: Math.min(0.62, Math.max(0.32, base.light + (rng() - 0.5) * 0.05)),
    };
    let minD = Infinity;
    for (const p of picked) minD = Math.min(minD, dist2(candidate, p));
    if (minD > bestScore) {
      bestScore = minD;
      best = candidate;
    }
  }
  void total;
  void i;
  return best ?? { ...bank[i % bank.length]! };
}
