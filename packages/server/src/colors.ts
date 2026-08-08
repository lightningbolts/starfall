import type { PlayerId } from "@starfall/sim";

/** Stable procedural HSL seat colors; local client remaps self to amber. */
export function seatColorsForPlayers(playerIds: PlayerId[]): Record<PlayerId, string> {
  const n = Math.max(playerIds.length, 1);
  const out: Record<PlayerId, string> = {};
  for (let i = 0; i < playerIds.length; i++) {
    const hue = Math.round((360 / n) * i + 12) % 360;
    // Avoid pure purple-neon default accent; keep sat/light in design band
    out[playerIds[i]!] = `hsl(${hue} 70% 50%)`;
  }
  return out;
}
