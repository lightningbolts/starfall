import { describe, expect, it } from "vitest";
import { createSimConfig } from "./balance.js";
import { createMatch } from "./match.js";
import { emptyTurn, executeNextTick } from "./tick.js";
import { generateGalaxy, validateGalaxy } from "./galaxy.js";
import type { StampedIntent, Turn } from "./types.js";

describe("galaxy generator", () => {
  it("produces valid galaxy for 8 players", () => {
    const g = generateGalaxy({ seed: 42, playerCount: 8, nodeCount: 40 });
    const v = validateGalaxy(g.map, g.homeworldIds, 8);
    expect(v.errors).toEqual([]);
    expect(g.homeworldIds).toHaveLength(8);
    expect(Object.keys(g.map.nodes)).toHaveLength(40);
    for (const hw of g.homeworldIds) {
      expect(g.map.nodes[hw]?.role).toBe("homeworld");
    }
  });
});

describe("match + tick", () => {
  it("creates match with starting kits", () => {
    const { state } = createMatch({ seed: 1, playerCount: 4, nodeCount: 24 });
    expect(Object.keys(state.players)).toHaveLength(4);
    for (const p of Object.values(state.players)) {
      expect(p.credits).toBe(80);
      expect(p.homeworldId).toBeTruthy();
      const home = state.nodes[p.homeworldId!]!;
      expect(home.ownerId).toBe(p.id);
      expect(home.population).toBe(25);
    }
    const fighters = Object.values(state.fleets).reduce(
      (n, f) => n + (f.composition.fighter ?? 0),
      0,
    );
    expect(fighters).toBe(20);
  });

  it("advances empty ticks and pulses economy", () => {
    const { state, game, config } = createMatch({
      seed: 2,
      playerCount: 2,
      nodeCount: 16,
    });
    const startCredits = state.players.p0!.credits;
    for (let t = 0; t < 10; t++) {
      executeNextTick(state, emptyTurn(t), config, game);
    }
    // Homeworld + any bank nodes pulse at tick 10
    expect(state.tick).toBe(10);
    expect(state.players.p0!.credits).toBeGreaterThanOrEqual(startCredits);
  });

  it("builds fighters at homeworld via intents", () => {
    const { state, game, config } = createMatch({
      seed: 3,
      playerCount: 2,
      nodeCount: 16,
    });
    const home = state.players.p0!.homeworldId!;
    const turn: Turn = {
      turnNumber: 0,
      intents: [
        {
          clientId: "c0",
          sequence: 0,
          intent: {
            type: "BuildShips",
            nodeId: home,
            shipType: "fighter",
            count: 1,
          },
        } satisfies StampedIntent,
      ],
    };
    executeNextTick(state, turn, config, game);
    expect(state.nodes[home]!.buildQueue.length).toBe(1);
    expect(state.players.p0!.credits).toBe(70);
  });
});

describe("combat integration", () => {
  it("resolves fight when two fleets meet", () => {
    const config = createSimConfig();
    const { state, game } = createMatch({
      seed: 99,
      playerCount: 2,
      nodeCount: 20,
    });
    // Place both fleets on same neutral-ish node: use p0 home, move p1 fleet there artificially
    const home0 = state.players.p0!.homeworldId!;
    const f1 = Object.values(state.fleets).find((f) => f.ownerId === "p1")!;
    f1.location = { kind: "node", nodeId: home0 };
    f1.composition = { cruiser: 3 }; // 120
    const f0 = Object.values(state.fleets).find((f) => f.ownerId === "p0")!;
    f0.composition = { fighter: 10, cruiser: 1 }; // 140

    executeNextTick(state, emptyTurn(0), config, game);
    // p0 should win; p1 fleet gone or empty
    const p1Fleets = Object.values(state.fleets).filter((f) => f.ownerId === "p1");
    const p1Power = p1Fleets.reduce(
      (n, f) => n + (f.composition.fighter ?? 0) * 10 + (f.composition.cruiser ?? 0) * 40,
      0,
    );
    expect(p1Power).toBe(0);
    const p0 = Object.values(state.fleets).find((f) => f.ownerId === "p0");
    expect(p0).toBeTruthy();
    expect(
      (p0!.composition.fighter ?? 0) + (p0!.composition.cruiser ?? 0),
    ).toBeGreaterThan(0);
  });
});
