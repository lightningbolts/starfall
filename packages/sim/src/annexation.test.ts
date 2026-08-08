import { describe, expect, it } from "vitest";
import { createMatch } from "./match.js";
import { emptyTurn, executeNextTick } from "./tick.js";
import { effectiveGarrison } from "./helpers.js";

describe("annexation", () => {
  it("captures neutral with pop > garrison and escorts", () => {
    const { state, game, config } = createMatch({
      seed: 7,
      playerCount: 2,
      nodeCount: 20,
    });
    const home = state.players.p0!.homeworldId!;
    const neighbor = state.map.nodes[home]!.neighbors[0]!;
    // Ensure neighbor is neutral
    state.nodes[neighbor]!.ownerId = null;
    state.nodes[neighbor]!.level = 1;

    const fleet = Object.values(state.fleets).find((f) => f.ownerId === "p0")!;
    const gnode = state.map.nodes[neighbor]!;
    const garrison = effectiveGarrison(
      state.nodes[neighbor]!,
      gnode.role,
      null,
      config.balance,
    );
    const pop = garrison + 1;
    state.nodes[home]!.population = pop + 5;

    // Commit invasion + move in one turn
    executeNextTick(
      state,
      {
        turnNumber: 0,
        intents: [
          {
            clientId: "c0",
            sequence: 0,
            intent: {
              type: "CommitInvasion",
              fleetId: fleet.id,
              population: pop,
              fromNodeId: home,
            },
          },
          {
            clientId: "c0",
            sequence: 1,
            intent: {
              type: "MoveFleet",
              fleetId: fleet.id,
              path: [home, neighbor],
            },
          },
        ],
      },
      config,
      game,
    );

    // Travel takes multiple ticks — fast-forward
    const hops = 20; // fighter ticks per hop
    for (let i = 0; i < hops + 2; i++) {
      executeNextTick(state, emptyTurn(i + 1), config, game);
      if (state.nodes[neighbor]!.ownerId === "p0") break;
    }
    expect(state.nodes[neighbor]!.ownerId).toBe("p0");
  });
});
