import { describe, expect, it } from "vitest";
import { createSimConfig, DEFAULT_BALANCE } from "./balance.js";
import { buildTicksRequired } from "./helpers.js";
import { createMatch } from "./match.js";
import { emptyTurn, executeNextTick } from "./tick.js";
import type { NodeId, TechId } from "./types.js";

const BAL = DEFAULT_BALANCE;

/** BFS distance over the static map graph. */
function hops(
  map: { nodes: Record<NodeId, { neighbors: NodeId[] }> },
  a: NodeId,
  b: NodeId,
): number {
  if (a === b) return 0;
  const dist = new Map<NodeId, number>([[a, 0]]);
  const q = [a];
  for (let i = 0; i < q.length; i++) {
    const cur = q[i]!;
    for (const n of map.nodes[cur]!.neighbors) {
      if (dist.has(n)) continue;
      dist.set(n, dist.get(cur)! + 1);
      if (n === b) return dist.get(n)!;
      q.push(n);
    }
  }
  return Infinity;
}

describe("CancelInvasion deposit target (rulings.md §3)", () => {
  it("returns colonists to the nearest owned system, not an arbitrary one", () => {
    const { state, game, config } = createMatch({
      seed: 11,
      playerCount: 2,
      nodeCount: 30,
    });
    const home = state.players.p0!.homeworldId!;

    // Give p0 a second, distant holding so "nearest" is a meaningful choice.
    const far = Object.keys(state.nodes)
      .filter((id) => id !== home && state.nodes[id]!.ownerId === null)
      .sort((a, b) => hops(state.map, home, b) - hops(state.map, home, a))[0]!;
    state.nodes[far]!.ownerId = "p0";
    state.nodes[far]!.population = 0;
    expect(hops(state.map, home, far)).toBeGreaterThan(1);

    // Park the fleet on the far holding and load colonists there.
    const fleet = Object.values(state.fleets).find((f) => f.ownerId === "p0")!;
    fleet.location = { kind: "node", nodeId: far };
    fleet.invasionPopulation = 12;

    // ownedNodes()[0] is the homeworld — the old code deposited there.
    expect(game.ownedNodes("p0")[0]).toBe(home);
    const homePopBefore = state.nodes[home]!.population;

    executeNextTick(
      state,
      {
        turnNumber: 0,
        intents: [
          {
            clientId: "c0",
            sequence: 0,
            intent: { type: "CancelInvasion", fleetId: fleet.id },
          },
        ],
      },
      config,
      game,
    );

    expect(fleet.invasionPopulation).toBeUndefined();
    expect(state.nodes[far]!.population).toBe(12);
    expect(state.nodes[home]!.population).toBe(homePopBefore);
  });

  it("walks outward from the origin end when the fleet is in transit", () => {
    const { state, game, config } = createMatch({
      seed: 12,
      playerCount: 2,
      nodeCount: 30,
    });
    const home = state.players.p0!.homeworldId!;
    const dest = state.map.nodes[home]!.neighbors[0]!;
    const fleet = Object.values(state.fleets).find((f) => f.ownerId === "p0")!;
    fleet.location = {
      kind: "transit",
      from: home,
      to: dest,
      ticksRemaining: 8,
      hopTotalTicks: 20,
      path: [home, dest],
      pathIndex: 0,
    };
    fleet.invasionPopulation = 9;
    const before = state.nodes[home]!.population;

    executeNextTick(
      state,
      {
        turnNumber: 0,
        intents: [
          {
            clientId: "c0",
            sequence: 0,
            intent: { type: "CancelInvasion", fleetId: fleet.id },
          },
        ],
      },
      config,
      game,
    );

    expect(state.nodes[home]!.population).toBe(before + 9);
  });
});

describe("colonists stay embarked (rulings.md §3)", () => {
  it("keeps them aboard while the fleet waits on a system you own", () => {
    const { state, game, config } = createMatch({
      seed: 41,
      playerCount: 2,
      nodeCount: 24,
    });
    const home = state.players.p0!.homeworldId!;
    const fleet = Object.values(state.fleets).find((f) => f.ownerId === "p0")!;
    const before = state.nodes[home]!.population;

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
              population: 20,
              fromNodeId: home,
            },
          },
        ],
      },
      config,
      game,
    );

    expect(fleet.invasionPopulation).toBe(20);
    expect(state.nodes[home]!.population).toBeLessThanOrEqual(before - 20 + 2);

    // Still aboard many ticks later, so the player can move whenever they like.
    for (let i = 0; i < 25; i++) {
      executeNextTick(state, emptyTurn(i + 1), config, game);
    }
    expect(state.fleets[fleet.id]!.invasionPopulation).toBe(20);
  });

  it("still hands them back on an explicit CancelInvasion", () => {
    const { state, game, config } = createMatch({
      seed: 42,
      playerCount: 2,
      nodeCount: 24,
    });
    const home = state.players.p0!.homeworldId!;
    const fleet = Object.values(state.fleets).find((f) => f.ownerId === "p0")!;
    fleet.invasionPopulation = 15;
    const before = state.nodes[home]!.population;

    executeNextTick(
      state,
      {
        turnNumber: 0,
        intents: [
          {
            clientId: "c0",
            sequence: 0,
            intent: { type: "CancelInvasion", fleetId: fleet.id },
          },
        ],
      },
      config,
      game,
    );

    expect(fleet.invasionPopulation).toBeUndefined();
    expect(state.nodes[home]!.population).toBeGreaterThanOrEqual(before + 15);
  });
});

describe("colonist fleets are interdictable in transit", () => {
  function stageConvoy(seed: number) {
    const config = createSimConfig();
    const { state, game } = createMatch({ seed, playerCount: 2, nodeCount: 24 });
    const home = state.players.p0!.homeworldId!;
    const dest = state.map.nodes[home]!.neighbors[0]!;
    const transit = {
      kind: "transit" as const,
      from: home,
      to: dest,
      ticksRemaining: 8,
      hopTotalTicks: 20,
      path: [home, dest],
      pathIndex: 0,
    };
    const convoy = Object.values(state.fleets).find((f) => f.ownerId === "p0")!;
    convoy.composition = {};
    convoy.invasionPopulation = 20;
    convoy.location = { ...transit };
    const raider = Object.values(state.fleets).find((f) => f.ownerId === "p1")!;
    raider.location = { ...transit };
    return { state, game, config, convoy, raider };
  }

  it("destroys an unescorted convoy that meets a hostile fleet on a lane", () => {
    const { state, game, config, convoy, raider } = stageConvoy(31);
    raider.composition = { cruiser: 2 };

    executeNextTick(state, emptyTurn(0), config, game);

    expect(state.fleets[convoy.id]).toBeUndefined();
    // The raider takes no losses: unarmed transports cannot shoot back.
    expect(state.fleets[raider.id]!.composition.cruiser).toBe(2);
  });

  it("spares the convoy when the hostile fleet is also unarmed", () => {
    const { state, game, config, convoy, raider } = stageConvoy(32);
    raider.composition = {};
    raider.invasionPopulation = 5;

    executeNextTick(state, emptyTurn(0), config, game);

    expect(state.fleets[convoy.id]).toBeDefined();
    expect(state.fleets[convoy.id]!.invasionPopulation).toBe(20);
  });

  it("takes the colonists down with their escort when the escort loses", () => {
    const { state, game, config, convoy, raider } = stageConvoy(33);
    convoy.composition = { fighter: 1 };
    raider.composition = { battleship: 2 };

    executeNextTick(state, emptyTurn(0), config, game);

    expect(state.fleets[convoy.id]).toBeUndefined();
  });

  it("leaves an escorted convoy alone when nothing hostile is present", () => {
    const { state, game, config, convoy } = stageConvoy(34);
    for (const f of Object.values(state.fleets)) {
      if (f.ownerId === "p1") delete state.fleets[f.id];
    }

    executeNextTick(state, emptyTurn(0), config, game);

    expect(state.fleets[convoy.id]!.invasionPopulation).toBe(20);
  });
});

describe("rapid_deployment scope (tech-tree.md)", () => {
  const withTech = new Set<TechId>(["rapid_deployment"]);
  const without = new Set<TechId>();

  it("speeds shipyard builds", () => {
    const base = buildTicksRequired("cruiser", "shipyard", 1, without, BAL);
    const fast = buildTicksRequired("cruiser", "shipyard", 1, withTech, BAL);
    expect(fast).toBeLessThan(base);
  });

  it("does not speed homeworld or other-role builds", () => {
    for (const role of ["homeworld", "core_world", "relay"] as const) {
      expect(buildTicksRequired("fighter", role, 1, withTech, BAL)).toBe(
        buildTicksRequired("fighter", role, 1, without, BAL),
      );
    }
  });
});
