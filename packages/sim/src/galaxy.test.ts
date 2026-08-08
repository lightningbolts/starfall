import { describe, expect, it } from "vitest";
import {
  generateGalaxy,
  homeSpacingTarget,
  recommendedNodeCount,
  validateGalaxy,
} from "./galaxy.js";
import type { GalaxyNode, NodeId } from "./types.js";

const PLAYER_COUNTS = [2, 3, 4, 6, 8, 12, 16, 24, 32, 50, 100];
const SEEDS = [1, 42, 777, 20_260_808];

function hops(
  nodes: Record<NodeId, GalaxyNode>,
  a: NodeId,
  b: NodeId,
): number {
  if (a === b) return 0;
  const dist = new Map<NodeId, number>([[a, 0]]);
  const q = [a];
  for (let i = 0; i < q.length; i++) {
    const cur = q[i]!;
    for (const n of nodes[cur]!.neighbors) {
      if (dist.has(n)) continue;
      dist.set(n, dist.get(cur)! + 1);
      if (n === b) return dist.get(n)!;
      q.push(n);
    }
  }
  return Infinity;
}

describe("galaxy generator", () => {
  // The previous suite tolerated soft failures, which is why every shipped map
  // was an unvalidated degree-2 tree from the relaxed fallback.
  it.each(PLAYER_COUNTS)("produces a valid galaxy for %i players", (players) => {
    for (const seed of SEEDS) {
      const g = generateGalaxy({ seed, playerCount: players });
      const v = validateGalaxy(g.map, g.homeworldIds, players);
      expect(v.errors).toEqual([]);
      expect(v.ok).toBe(true);
      expect(g.homeworldIds).toHaveLength(players);
    }
  });

  it("honours an explicit nodeCount", () => {
    const g = generateGalaxy({ seed: 5, playerCount: 8, nodeCount: 60 });
    expect(Object.keys(g.map.nodes)).toHaveLength(60);
    expect(validateGalaxy(g.map, g.homeworldIds, 8).ok).toBe(true);
  });

  it("is deterministic for a given seed", () => {
    const a = generateGalaxy({ seed: 123, playerCount: 8 });
    const b = generateGalaxy({ seed: 123, playerCount: 8 });
    expect(JSON.stringify(b.map)).toBe(JSON.stringify(a.map));
    expect(b.homeworldIds).toEqual(a.homeworldIds);
  });

  it("keeps mean degree in band with real hubs and leaves", () => {
    const g = generateGalaxy({ seed: 42, playerCount: 16 });
    const degrees = Object.values(g.map.nodes).map((n) => n.neighbors.length);
    const mean = degrees.reduce((a, b) => a + b, 0) / degrees.length;
    expect(mean).toBeGreaterThanOrEqual(2.2);
    expect(mean).toBeLessThanOrEqual(3.2);
    expect(Math.max(...degrees)).toBeGreaterThanOrEqual(5);
    expect(degrees.filter((d) => d <= 2).length / degrees.length).toBeGreaterThan(0.1);
  });

  it("spaces homeworlds and never makes them adjacent", () => {
    const players = 8;
    const g = generateGalaxy({ seed: 42, playerCount: players });
    const spacing = homeSpacingTarget(Object.keys(g.map.nodes).length, players);
    expect(spacing).toBe(3);
    for (let i = 0; i < g.homeworldIds.length; i++) {
      for (let j = i + 1; j < g.homeworldIds.length; j++) {
        const a = g.homeworldIds[i]!;
        const b = g.homeworldIds[j]!;
        expect(g.map.nodes[a]!.neighbors).not.toContain(b);
        expect(hops(g.map.nodes, a, b)).toBeGreaterThanOrEqual(spacing);
      }
    }
  });

  it("puts a shipyard within 2 hops of every homeworld", () => {
    const g = generateGalaxy({ seed: 99, playerCount: 12 });
    const yards = Object.values(g.map.nodes)
      .filter((n) => n.role === "shipyard")
      .map((n) => n.id);
    for (const hw of g.homeworldIds) {
      const best = Math.min(...yards.map((sy) => hops(g.map.nodes, hw, sy)));
      expect(best).toBeLessThanOrEqual(2);
    }
  });

  it("never places a relic adjacent to a homeworld", () => {
    const g = generateGalaxy({ seed: 7, playerCount: 24 });
    const homes = new Set(g.homeworldIds);
    for (const n of Object.values(g.map.nodes)) {
      if (n.role !== "relic") continue;
      for (const nb of n.neighbors) expect(homes.has(nb)).toBe(false);
    }
  });

  it("emits a layout entry for every node", () => {
    const g = generateGalaxy({ seed: 3, playerCount: 8 });
    const ids = Object.keys(g.map.nodes);
    expect(Object.keys(g.map.layout ?? {})).toHaveLength(ids.length);
    for (const id of ids) {
      const p = g.map.layout![id]!;
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("scales node budget down toward the documented band", () => {
    expect(recommendedNodeCount(8)).toBe(41);
    expect(recommendedNodeCount(100)).toBe(300);
    expect(recommendedNodeCount(100) / 100).toBeLessThanOrEqual(3);
  });

  it("throws rather than silently shipping an invalid galaxy", () => {
    // 2 players on 4 nodes cannot satisfy spacing plus the role budget.
    expect(() =>
      generateGalaxy({ seed: 1, playerCount: 2, nodeCount: 4, maxAttempts: 3 }),
    ).toThrow(/no valid galaxy|could not construct/);
  });
});
