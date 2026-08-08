import type { Game } from "./game.js";
import { fleetPower } from "./helpers.js";
import type { PlayerId } from "./types.js";

export function computeScores(game: Game): void {
  const bal = game.balance.score;
  for (const player of Object.values(game.state.players)) {
    let score = 0;
    let totalPop = 0;
    for (const node of Object.values(game.state.nodes)) {
      if (node.ownerId !== player.id) continue;
      score += bal.ownedNode;
      const role = game.state.map.nodes[node.id]?.role;
      if (role === "relic") score += bal.ownedRelicBonus;
      if (node.level > 1) {
        score += (node.level - 1) * bal.upgradeLevelAbove1;
      }
      totalPop += node.population;
    }
    score += Math.floor(player.credits / 10) * bal.per10Credits;
    score += Math.floor(totalPop / 10) * bal.per10Population;

    let power = 0;
    for (const f of Object.values(game.state.fleets)) {
      if (f.ownerId === player.id) power += fleetPower(f.composition, game.balance);
    }
    score += Math.floor(power / 100) * bal.per100FleetPower;
    score += player.researched.size * bal.perTech;
    player.score = score;
  }
}

export function checkWin(game: Game): void {
  if (game.state.status === "finished") return;

  const alive = Object.values(game.state.players).filter((p) => {
    if (p.eliminated) return false;
    return Object.values(game.state.nodes).some((n) => n.ownerId === p.id);
  });

  if (alive.length === 1) {
    game.state.status = "finished";
    game.state.winnerId = alive[0]!.id;
    return;
  }
  if (alive.length === 0) {
    game.state.status = "finished";
    game.state.winnerId = null;
    return;
  }

  if (game.state.tick >= game.config.roundTicks()) {
    game.state.status = "finished";
    let best: PlayerId | null = null;
    let bestScore = -Infinity;
    for (const p of Object.values(game.state.players)) {
      if (p.score > bestScore) {
        bestScore = p.score;
        best = p.id;
      } else if (p.score === bestScore && best !== null) {
        // Tie-break: lower player id
        if (p.id < best) best = p.id;
      }
    }
    game.state.winnerId = best;
  }
}
