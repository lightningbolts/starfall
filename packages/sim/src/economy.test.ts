import { describe, expect, it } from "vitest";
import { createMatch } from "./match.js";
import { emptyTurn, executeNextTick } from "./tick.js";
import { canResearch, techCost } from "./helpers.js";

describe("research + alliances", () => {
  it("researches tier-1 tech when funded", () => {
    const { state, game, config } = createMatch({
      seed: 11,
      playerCount: 2,
      nodeCount: 16,
    });
    state.players.p0!.credits = 100;
    executeNextTick(
      state,
      {
        turnNumber: 0,
        intents: [
          {
            clientId: "c0",
            sequence: 0,
            intent: { type: "ResearchTech", techId: "advanced_propulsion" },
          },
        ],
      },
      config,
      game,
    );
    expect(state.players.p0!.researched.has("advanced_propulsion")).toBe(true);
    expect(state.players.p0!.credits).toBe(100 - techCost("advanced_propulsion", config.balance));
    expect(canResearch(state.players.p0!, "heavy_warships")).toBe(true);
  });

  it("forms and breaks alliances", () => {
    const { state, game, config } = createMatch({
      seed: 12,
      playerCount: 2,
      nodeCount: 16,
    });
    executeNextTick(
      state,
      {
        turnNumber: 0,
        intents: [
          {
            clientId: "c0",
            sequence: 0,
            intent: { type: "ProposeAlliance", toPlayerId: "p1" },
          },
        ],
      },
      config,
      game,
    );
    executeNextTick(
      state,
      {
        turnNumber: 1,
        intents: [
          {
            clientId: "c1",
            sequence: 0,
            intent: { type: "AcceptAlliance", fromPlayerId: "p0" },
          },
        ],
      },
      config,
      game,
    );
    expect(state.players.p0!.allies).toContain("p1");
    expect(state.players.p1!.allies).toContain("p0");

    executeNextTick(
      state,
      {
        turnNumber: 2,
        intents: [
          {
            clientId: "c0",
            sequence: 0,
            intent: { type: "BreakAlliance", withPlayerId: "p1" },
          },
        ],
      },
      config,
      game,
    );
    expect(state.players.p0!.allies).not.toContain("p1");
    expect(state.players.p1!.allies).not.toContain("p0");
  });

  it("upgrades owned node", () => {
    const { state, game, config } = createMatch({
      seed: 13,
      playerCount: 2,
      nodeCount: 16,
    });
    const home = state.players.p0!.homeworldId!;
    state.players.p0!.credits = 200;
    executeNextTick(
      state,
      {
        turnNumber: 0,
        intents: [
          {
            clientId: "c0",
            sequence: 0,
            intent: { type: "UpgradeNode", nodeId: home },
          },
        ],
      },
      config,
      game,
    );
    expect(state.nodes[home]!.level).toBe(2);
  });
});

describe("economy cargo", () => {
  it("stockpiles resource credits and launches cargo", () => {
    const { state, game, config } = createMatch({
      seed: 14,
      playerCount: 2,
      nodeCount: 20,
    });
    // Give p0 a resource node
    const resId = Object.values(state.map.nodes).find(
      (n) => n.role === "resource",
    )!.id;
    state.nodes[resId]!.ownerId = "p0";
    state.nodes[resId]!.ownedSinceTick = 0;

    for (let t = 0; t < 20; t++) {
      executeNextTick(state, emptyTurn(t), config, game);
    }
    // After two pulses (tick 10 and 20), stockpile or cargo ships should exist
    const stock = state.nodes[resId]!.cargoStockpile;
    const cargos = Object.values(state.cargoShips).filter((c) => c.ownerId === "p0");
    expect(stock + cargos.reduce((s, c) => s + c.cargoCredits, 0)).toBeGreaterThan(0);
  });
});
