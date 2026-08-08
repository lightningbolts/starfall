import { describe, expect, it } from "vitest";
import { generateRegionGalaxy, voronoiCell } from "./galaxy.js";
import { createMacroMatch } from "./match.js";
import { easeInOutCubic, lerpSnapshot } from "./interpolate.js";
import { generateEmpireName } from "./names.js";
import { pressureBorder, resolveContestedFronts } from "./combat.js";
import { stepLogic } from "./tick.js";
import { DEFAULT_MACRO_CONFIG } from "./types.js";
import { createRng } from "./rng.js";
import { buildSnapshot } from "./snapshot.js";

describe("galaxy adjacency", () => {
  it("produces connected undirected neighbors and valid polygons", () => {
    const g = generateRegionGalaxy(42, 80);
    expect(g.ids).toHaveLength(80);
    expect(g.sites).toHaveLength(80);
    expect(g.polygons).toHaveLength(80);

    // Undirected
    const index = new Map(g.ids.map((id, i) => [id, i]));
    for (let i = 0; i < g.ids.length; i++) {
      for (const nid of g.neighbors[i]!) {
        const j = index.get(nid)!;
        expect(g.neighbors[j]).toContain(g.ids[i]);
      }
    }

    // Connected via BFS
    const seen = new Set<string>();
    const q = [g.ids[0]!];
    seen.add(q[0]!);
    while (q.length) {
      const u = q.pop()!;
      const ui = index.get(u)!;
      for (const v of g.neighbors[ui]!) {
        if (!seen.has(v)) {
          seen.add(v);
          q.push(v);
        }
      }
    }
    expect(seen.size).toBe(80);

    for (const poly of g.polygons) {
      expect(poly.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("voronoiCell clips to a polygon", () => {
    const site = { x: 0, y: 0 };
    const poly = voronoiCell(
      site,
      [
        { x: 2, y: 0 },
        { x: -2, y: 0 },
        { x: 0, y: 2 },
        { x: 0, y: -2 },
      ],
      10,
    );
    expect(poly.length).toBeGreaterThanOrEqual(3);
  });
});

describe("names", () => {
  it("generates unique empire names", () => {
    const used = new Set<string>();
    const names = Array.from({ length: 60 }, (_, i) =>
      generateEmpireName(7, i, used),
    );
    expect(new Set(names).size).toBe(60);
  });
});

describe("contested flips", () => {
  it("flips ownership past threshold", () => {
    const { state, config } = createMacroMatch({
      seed: 99,
      regionCount: 60,
      empireCount: 8,
    });
    // Capitals start isolated — force a shared border for the flip test
    const victim = state.empireOrder[0]!;
    const attacker = state.empireOrder[1]!;
    const targetId = state.empires[victim]!.capitalRegionId;
    const neighbor = state.regions[targetId]!.neighbors[0]!;
    state.regions[neighbor]!.ownerId = attacker;
    state.regions[neighbor]!.garrison = 500;
    state.regions[targetId]!.contested = {
      vs: attacker,
      pct: config.contestedFlipThreshold,
    };
    state.regions[targetId]!.garrison = 10;

    const result = resolveContestedFronts(state, config);
    expect(result.flipped).toContain(targetId);
    expect(state.regions[targetId]!.ownerId).toBe(attacker);
    expect(state.regions[targetId]!.ownerId).not.toBe(victim);
  });

  it("pressureBorder claims unowned regions", () => {
    const { state } = createMacroMatch({ seed: 1, regionCount: 40, empireCount: 4 });
    const rid = state.regionOrder.find((id) => !state.regions[id]!.ownerId)!;
    const attacker = state.empireOrder[0]!;
    pressureBorder(state, attacker, rid, 0.5);
    expect(state.regions[rid]!.ownerId).toBe(attacker);
  });
});

describe("seed stability", () => {
  it("bot ticks are deterministic for the same seed", () => {
    const a = createMacroMatch({ seed: 12345, regionCount: 80, empireCount: 12 });
    const b = createMacroMatch({ seed: 12345, regionCount: 80, empireCount: 12 });
    const cfg = { ...DEFAULT_MACRO_CONFIG, regionCount: 80, empireCount: 12 };

    for (let i = 0; i < 5; i++) {
      stepLogic(a.state, cfg);
      stepLogic(b.state, cfg);
    }

    expect(a.state.tick).toBe(b.state.tick);
    for (const id of a.state.regionOrder) {
      expect(a.state.regions[id]!.ownerId).toBe(b.state.regions[id]!.ownerId);
      expect(a.state.regions[id]!.garrison).toBeCloseTo(b.state.regions[id]!.garrison, 5);
    }
    expect(a.state.events.map((e) => e.text)).toEqual(b.state.events.map((e) => e.text));
  });
});

describe("interpolate", () => {
  it("easeInOutCubic endpoints", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 5);
  });

  it("lerpSnapshot endpoints match source snapshots", () => {
    const { state, config } = createMacroMatch({
      seed: 3,
      regionCount: 50,
      empireCount: 6,
    });
    const snapA = buildSnapshot(state);
    stepLogic(state, config);
    const snapB = buildSnapshot(state);

    const at0 = lerpSnapshot(snapA, snapB, 0, (t) => t);
    const at1 = lerpSnapshot(snapA, snapB, 1, (t) => t);

    for (const id of snapA.regionOrder) {
      expect(at0.regions[id]!.population).toBeCloseTo(snapA.regions[id]!.population, 5);
      expect(at1.regions[id]!.population).toBeCloseTo(snapB.regions[id]!.population, 5);
    }
    for (const id of snapA.empireOrder) {
      expect(at0.empires[id]!.territory).toBeCloseTo(snapA.empires[id]!.territory, 5);
      expect(at1.empires[id]!.territory).toBeCloseTo(snapB.empires[id]!.territory, 5);
    }
  });
});

describe("createMacroMatch", () => {
  it("starts each empire at a capital only; wilderness is unowned", () => {
    const { state, snapshot } = createMacroMatch({
      seed: 55,
      mapSize: "small",
    });
    expect(state.regionOrder.length).toBe(400);
    expect(state.empireOrder.length).toBe(20);
    let owned = 0;
    for (const id of state.regionOrder) {
      expect(state.regions[id]!.polygon.length).toBeGreaterThanOrEqual(3);
      if (state.regions[id]!.ownerId) owned++;
    }
    expect(owned).toBe(state.empireOrder.length);
    for (const eid of state.empireOrder) {
      const e = state.empires[eid]!;
      expect(state.regions[e.capitalRegionId]!.ownerId).toBe(eid);
      expect(snapshot.empires[eid]!.territory).toBe(1);
    }
    const names = state.empireOrder.map((id) => state.empires[id]!.name);
    expect(new Set(names).size).toBe(names.length);
    expect(snapshot.tick).toBe(0);
  });

  it("expands from capitals into unowned regions over ticks", () => {
    const { state, config } = createMacroMatch({
      seed: 77,
      regionCount: 80,
      empireCount: 8,
    });
    const startOwned = state.regionOrder.filter(
      (id) => state.regions[id]!.ownerId,
    ).length;
    expect(startOwned).toBe(8);
    for (let i = 0; i < 200; i++) stepLogic(state, config);
    const laterOwned = state.regionOrder.filter(
      (id) => state.regions[id]!.ownerId,
    ).length;
    expect(laterOwned).toBeGreaterThan(startOwned);
  });
});

describe("rng smoke", () => {
  it("createRng is deterministic", () => {
    const a = createRng(1);
    const b = createRng(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
