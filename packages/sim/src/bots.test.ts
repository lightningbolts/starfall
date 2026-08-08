import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "./balance.js";
import { botIntents, policyForBotIndex, type BotBrain } from "./bots.js";
import { effectiveGarrison } from "./helpers.js";
import { createMatch } from "./match.js";
import { executeNextTick } from "./tick.js";
import type { GameState, StampedIntent } from "./types.js";

const BAL = DEFAULT_BALANCE;

/** Intents are authorised by clientId, so brains must use the seated one. */
function brainsFor(state: GameState): BotBrain[] {
  const byPlayer = new Map(
    Object.entries(state.clientToPlayer).map(([c, p]) => [p, c]),
  );
  return Object.keys(state.players).map((playerId, i) => ({
    playerId,
    clientId: byPlayer.get(playerId)!,
    policy: policyForBotIndex(i),
    seq: 0,
  }));
}

/** Run a full bot-vs-bot match for `ticks` and report what happened. */
function runFfa(seed: number, players: number, ticks: number) {
  const { state, game, config } = createMatch({
    seed,
    playerCount: players,
    nodeCount: players * 5,
  });
  const brains = brainsFor(state);
  for (let t = 0; t < ticks; t++) {
    const intents: StampedIntent[] = [];
    for (const b of brains) intents.push(...botIntents(state, b, config.balance));
    executeNextTick(state, { turnNumber: t, intents }, config, game);
    if (state.status === "finished") break;
  }
  return { state, brains };
}

describe("bot brains", () => {
  it("expand beyond their homeworld within a few minutes of play", () => {
    const { state } = runFfa(101, 4, 1800);
    const holdings = Object.keys(state.players).map(
      (p) => Object.values(state.nodes).filter((n) => n.ownerId === p).length,
    );
    expect(Math.max(...holdings)).toBeGreaterThan(1);
    // Not a single runaway: several bots should be on the board.
    expect(holdings.filter((h) => h >= 1).length).toBeGreaterThanOrEqual(2);
  });

  it("spend their economy on ships, tech and upgrades", () => {
    const { state } = runFfa(102, 4, 1200);
    const players = Object.values(state.players);
    expect(players.some((p) => p.researched.size > 0)).toBe(true);
    const builtSomething = Object.values(state.fleets).length > 0;
    expect(builtSomething).toBe(true);
    const upgraded = Object.values(state.nodes).some(
      (n) => n.ownerId !== null && n.level > 1,
    );
    expect(upgraded).toBe(true);
  });

  it("size invasions against the defender's real garrison", () => {
    const { state, game, config } = createMatch({
      seed: 103,
      playerCount: 2,
      nodeCount: 20,
    });
    const brain: BotBrain = {
      playerId: "p0",
      clientId: "c0",
      policy: "hard",
      seq: 0,
    };
    const home = state.players.p0!.homeworldId!;
    state.nodes[home]!.population = 40;

    let commit: StampedIntent | undefined;
    for (let t = 0; t < 200 && !commit; t++) {
      const intents = botIntents(state, brain, config.balance);
      commit = intents.find((i) => i.intent.type === "CommitInvasion");
      if (commit) {
        const move = intents.find((i) => i.intent.type === "MoveFleet");
        expect(move).toBeDefined();
        const dest =
          move!.intent.type === "MoveFleet" ? move!.intent.path.at(-1)! : "";
        const target = state.nodes[dest]!;
        const need =
          effectiveGarrison(
            target,
            state.map.nodes[dest]!.role,
            target.ownerId ? state.players[target.ownerId]!.researched : null,
            BAL,
          ) + 1;
        if (commit.intent.type === "CommitInvasion") {
          expect(commit.intent.population).toBe(need);
        }
        break;
      }
      executeNextTick(state, { turnNumber: t, intents }, config, game);
    }
    expect(commit).toBeDefined();
  });

  it("act on a difficulty-dependent cadence", () => {
    const { state, config } = createMatch({
      seed: 104,
      playerCount: 2,
      nodeCount: 16,
    });
    const counts: Record<string, number> = {};
    for (const policy of ["easy", "normal", "hard"] as const) {
      const brain: BotBrain = { playerId: "p0", clientId: "c0", policy, seq: 0 };
      let acted = 0;
      for (let t = 0; t < 120; t++) {
        state.tick = t;
        if (botIntents(state, brain, config.balance).length > 0) acted++;
      }
      counts[policy] = acted;
    }
    expect(counts.hard!).toBeGreaterThan(counts.easy!);
  });

  it("stay silent once eliminated", () => {
    const { state, config } = createMatch({
      seed: 105,
      playerCount: 2,
      nodeCount: 16,
    });
    state.players.p0!.eliminated = true;
    const brain: BotBrain = {
      playerId: "p0",
      clientId: "c0",
      policy: "hard",
      seq: 0,
    };
    for (let t = 0; t < 40; t++) {
      state.tick = t;
      expect(botIntents(state, brain, config.balance)).toEqual([]);
    }
  });

  it("are deterministic for a given seed", () => {
    const a = runFfa(106, 4, 600);
    const b = runFfa(106, 4, 600);
    const snap = (s: GameState) =>
      Object.values(s.nodes)
        .map((n) => `${n.id}:${n.ownerId ?? "-"}:${n.level}`)
        .sort()
        .join("|");
    expect(snap(a.state)).toBe(snap(b.state));
  });
});
