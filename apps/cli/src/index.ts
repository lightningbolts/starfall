#!/usr/bin/env node
import {
  createMatch,
  createMatchTelemetry,
  createSimConfig,
  executeNextTick,
  formatTelemetrySummary,
  accumulateTelemetry,
  botIntents,
  resolveBotPolicy,
  type BotBrain,
  type BotDifficulty,
  type Turn,
} from "@starfall/sim";

function parseArgs(argv: string[]) {
  const args: {
    seed: number;
    players: number;
    ticks: number;
    nodes?: number;
    difficulty?: BotDifficulty;
  } = {
    seed: 42,
    players: 8,
    ticks: 12_000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--seed") args.seed = Number(argv[++i]);
    else if (a === "--players") args.players = Number(argv[++i]);
    else if (a === "--ticks") args.ticks = Number(argv[++i]);
    else if (a === "--nodes") args.nodes = Number(argv[++i]);
    else if (a === "--difficulty") {
      const d = argv[++i];
      if (d === "easy" || d === "normal" || d === "hard") args.difficulty = d;
    } else if (a === "--help") {
      console.log(`Usage: starfall ffa [--seed N] [--players N] [--ticks N] [--nodes N] [--difficulty easy|normal|hard]
  Default: seed=42 players=8 ticks=12000 (20 min)`);
      process.exit(0);
    }
  }
  return args;
}

function runFfa() {
  const args = parseArgs(process.argv.slice(2));
  const config = createSimConfig(undefined, { roundTicks: args.ticks });
  const { state, game } = createMatch({
    seed: args.seed,
    playerCount: args.players,
    nodeCount: args.nodes ?? Math.max(args.players * 4, 24),
    config,
  });

  const brains: BotBrain[] = Array.from({ length: args.players }, (_, i) => ({
    playerId: `p${i}`,
    clientId: `c${i}`,
    policy: resolveBotPolicy(i, args.difficulty),
    seq: 0,
  }));

  console.log(
    `Starfall FFA  seed=${args.seed} players=${args.players} ticks=${args.ticks} nodes=${Object.keys(state.map.nodes).length}${args.difficulty ? ` difficulty=${args.difficulty}` : ""}`,
  );

  const tel = createMatchTelemetry();
  let prevElim = 0;
  const t0 = Date.now();
  let turnNumber = 0;
  while (state.status === "running" && state.tick < args.ticks) {
    const intents = brains.flatMap((b) =>
      botIntents(state, b, config.balance),
    );
    const turn: Turn = { turnNumber, intents };
    const step0 = performance.now();
    const { updates } = executeNextTick(state, turn, config, game);
    accumulateTelemetry(
      tel,
      state,
      updates,
      performance.now() - step0,
      prevElim,
    );
    prevElim = Object.values(state.players).filter((p) => p.eliminated).length;
    turnNumber += 1;

    if (state.tick % 1000 === 0) {
      const alive = Object.values(state.players).filter((p) => !p.eliminated)
        .length;
      console.log(
        `  tick ${state.tick}/${args.ticks} alive=${alive} fleets=${Object.keys(state.fleets).length}`,
      );
    }
  }

  const elapsed = Date.now() - t0;
  console.log(`\nMatch finished in ${elapsed}ms wall | sim ticks=${state.tick}`);
  console.log(`Status: ${state.status} winner=${state.winnerId ?? "none"}`);
  console.log(`Telemetry: ${formatTelemetrySummary(tel)}`);
  console.log("\nScoreboard:");
  const ranked = Object.values(state.players).sort((a, b) => b.score - a.score);
  for (const p of ranked) {
    const nodes = Object.values(state.nodes).filter((n) => n.ownerId === p.id)
      .length;
    console.log(
      `  ${p.displayName.padEnd(12)} score=${String(p.score).padStart(5)} nodes=${String(nodes).padStart(3)} credits=${String(p.credits).padStart(5)} techs=${p.researched.size} ${p.eliminated ? "ELIM" : ""}`,
    );
  }
}

runFfa();
