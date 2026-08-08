import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE } from "./balance.js";
import { createMatch } from "./match.js";
import { emptyTurn, executeNextTick } from "./tick.js";
import {
  applyPlayerViewDelta,
  buildPlayerView,
  createVisionMemory,
  diffPlayerView,
} from "./view.js";

describe("elimination bonus", () => {
  it("awards eliminationBonus when last node is captured", () => {
    const { state, game, config } = createMatch({
      seed: 11,
      playerCount: 2,
      nodeCount: 16,
    });
    const p0 = state.players.p0!;
    const p1 = state.players.p1!;
    const home1 = p1.homeworldId!;

    // Strip p1 of everything except home1; remove p1 fleets
    for (const n of Object.values(state.nodes)) {
      if (n.ownerId === "p1" && n.id !== home1) n.ownerId = null;
    }
    for (const [id, f] of Object.entries(state.fleets)) {
      if (f.ownerId === "p1") delete state.fleets[id];
    }

    const fleet = Object.values(state.fleets).find((f) => f.ownerId === "p0")!;
    fleet.location = { kind: "node", nodeId: home1 };
    fleet.composition = { fighter: 5 };
    fleet.invasionPopulation = 10_000;
    state.nodes[home1]!.level = 1;

    const beforeBonus = p0.bonusScore;
    executeNextTick(state, emptyTurn(0), config, game);

    expect(state.nodes[home1]!.ownerId).toBe("p0");
    expect(p1.eliminated).toBe(true);
    expect(p0.bonusScore).toBe(
      beforeBonus + DEFAULT_BALANCE.score.eliminationBonus,
    );
    expect(p0.score).toBeGreaterThanOrEqual(
      DEFAULT_BALANCE.score.eliminationBonus,
    );
  });
});

describe("player view deltas", () => {
  it("round-trips via diff + apply", () => {
    const { state, config } = createMatch({
      seed: 3,
      playerCount: 2,
      nodeCount: 20,
    });
    const mem = createVisionMemory();
    const a = buildPlayerView(state, "p0", mem, config.balance);
    state.tick = 5;
    state.players.p0!.credits = 40;
    const b = buildPlayerView(state, "p0", mem, config.balance);
    const delta = diffPlayerView(a, b);
    const restored = applyPlayerViewDelta(a, delta);
    expect(restored.self.credits).toBe(40);
    expect(restored.tick).toBe(5);
    expect(restored.nodes).toEqual(b.nodes);
  });

  it("exposes alliance proposals on self", () => {
    const { state, config } = createMatch({
      seed: 4,
      playerCount: 2,
      nodeCount: 16,
    });
    state.allianceProposals.p0 = ["p1"];
    const view = buildPlayerView(
      state,
      "p0",
      createVisionMemory(),
      config.balance,
    );
    expect(view.self.allianceProposals).toEqual(["p1"]);
  });
});
