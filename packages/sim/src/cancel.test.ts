import { describe, expect, it } from "vitest";
import { createMatch } from "./match.js";
import { emptyTurn, executeNextTick } from "./tick.js";

describe("CancelMove halfway rule", () => {
  it("returns toward origin when cancel early in hop", () => {
    const { state, game, config } = createMatch({
      seed: 21,
      playerCount: 2,
      nodeCount: 16,
    });
    const home = state.players.p0!.homeworldId!;
    const dest = state.map.nodes[home]!.neighbors[0]!;
    const fleet = Object.values(state.fleets).find((f) => f.ownerId === "p0")!;

    executeNextTick(
      state,
      {
        turnNumber: 0,
        intents: [
          {
            clientId: "c0",
            sequence: 0,
            intent: { type: "MoveFleet", fleetId: fleet.id, path: [home, dest] },
          },
        ],
      },
      config,
      game,
    );

    // Advance a few ticks (< half of 20)
    for (let i = 0; i < 5; i++) {
      executeNextTick(state, emptyTurn(i + 1), config, game);
    }
    expect(fleet.location.kind).toBe("transit");

    executeNextTick(
      state,
      {
        turnNumber: 10,
        intents: [
          {
            clientId: "c0",
            sequence: 1,
            intent: { type: "CancelMove", fleetId: fleet.id },
          },
        ],
      },
      config,
      game,
    );
    // After cancel, arrives next tick at nearer endpoint (origin)
    executeNextTick(state, emptyTurn(11), config, game);
    expect(fleet.location.kind).toBe("node");
    if (fleet.location.kind === "node") {
      expect(fleet.location.nodeId).toBe(home);
    }
  });
});
