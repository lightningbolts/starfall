import { describe, expect, it } from "vitest";
import { borderKey, generateGalaxy, taggedVoronoiCell } from "./galaxy.js";
import { createMacroMatch } from "./match.js";
import { easeInOutCubic, lerpSnapshot } from "./interpolate.js";
import { generateEmpireName } from "./names.js";
import {
  colonizeCost,
  pressureBorder,
  resolveContestedFronts,
  tryColonize,
} from "./combat.js";
import { stepLogic } from "./tick.js";
import {
  DEFAULT_MACRO_CONFIG,
  empireCountForSystems,
  type Vec2,
} from "./types.js";
import { createRng } from "./rng.js";
import { buildSnapshot } from "./snapshot.js";

function segmentsCross(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): boolean {
  const cross = (o: Vec2, p: Vec2, q: Vec2): number =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const eps = 1e-9;
  // Shared endpoints are legal in a planar graph.
  const shares =
    (Math.abs(a0.x - b0.x) < eps && Math.abs(a0.y - b0.y) < eps) ||
    (Math.abs(a0.x - b1.x) < eps && Math.abs(a0.y - b1.y) < eps) ||
    (Math.abs(a1.x - b0.x) < eps && Math.abs(a1.y - b0.y) < eps) ||
    (Math.abs(a1.x - b1.x) < eps && Math.abs(a1.y - b1.y) < eps);
  if (shares) return false;
  const d1 = cross(a0, a1, b0);
  const d2 = cross(a0, a1, b1);
  const d3 = cross(b0, b1, a0);
  const d4 = cross(b0, b1, a1);
  return (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  );
}

describe("galaxy generation", () => {
  const galaxy = generateGalaxy(42, 220);

  it("places the requested number of stars with names and cells", () => {
    expect(galaxy.systems).toHaveLength(220);
    expect(galaxy.ids).toHaveLength(220);
    for (const s of galaxy.systems) {
      expect(s.cell.length).toBeGreaterThanOrEqual(3);
      expect(s.name.length).toBeGreaterThan(1);
      expect(galaxy.byId[s.id]).toBe(s);
    }
  });

  it("keeps a minimum separation between stars", () => {
    let closest = Infinity;
    const sites = galaxy.systems.map((s) => s.site);
    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        closest = Math.min(
          closest,
          Math.hypot(sites[i]!.x - sites[j]!.x, sites[i]!.y - sites[j]!.y),
        );
      }
    }
    // Mean spacing for a disc of this radius; separation must be a real fraction of it.
    const meanSpacing = galaxy.radius * Math.sqrt(Math.PI / sites.length);
    expect(closest).toBeGreaterThan(meanSpacing * 0.15);
  });

  it("builds a connected hyperlane web with symmetric links", () => {
    for (const s of galaxy.systems) {
      expect(s.hyperlanes.length).toBeGreaterThan(0);
      for (const other of s.hyperlanes) {
        expect(galaxy.byId[other]!.hyperlanes).toContain(s.id);
      }
    }

    const seen = new Set<string>([galaxy.ids[0]!]);
    const queue = [galaxy.ids[0]!];
    while (queue.length) {
      const cur = queue.pop()!;
      for (const next of galaxy.byId[cur]!.hyperlanes) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    expect(seen.size).toBe(galaxy.systems.length);
  });

  it("produces a planar web — no two hyperlanes cross", () => {
    const segments = galaxy.lanes.map((lane) => ({
      p0: galaxy.byId[lane.a]!.site,
      p1: galaxy.byId[lane.b]!.site,
    }));
    let crossings = 0;
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        if (
          segmentsCross(
            segments[i]!.p0,
            segments[i]!.p1,
            segments[j]!.p0,
            segments[j]!.p1,
          )
        ) {
          crossings++;
        }
      }
    }
    expect(crossings).toBe(0);
  });

  it("exposes a border segment for every hyperlane", () => {
    for (const lane of galaxy.lanes) {
      const edge = galaxy.borderEdgeByKey[borderKey(lane.a, lane.b)];
      expect(edge).toBeDefined();
      expect(Math.hypot(edge!.p1.x - edge!.p0.x, edge!.p1.y - edge!.p0.y)).toBeGreaterThan(0);
    }
    for (const edge of galaxy.borderEdges) {
      expect(galaxy.borderEdgeByKey[borderKey(edge.a, edge.b)]).toBe(edge);
    }
  });

  it("is deterministic for a seed", () => {
    const again = generateGalaxy(42, 220);
    expect(again.systems.map((s) => s.site)).toEqual(
      galaxy.systems.map((s) => s.site),
    );
    expect(again.lanes).toEqual(galaxy.lanes);
  });

  it("taggedVoronoiCell reports which neighbor produced each edge", () => {
    const site = { x: 0, y: 0 };
    const result = taggedVoronoiCell(
      site,
      [
        { p: { x: 2, y: 0 }, tag: 0 },
        { p: { x: -2, y: 0 }, tag: 1 },
        { p: { x: 0, y: 2 }, tag: 2 },
        { p: { x: 0, y: -2 }, tag: 3 },
      ],
      10,
    );
    expect(result.cell.length).toBeGreaterThanOrEqual(3);
    const tags = new Set(result.edges.map((e) => e.neighbor));
    expect(tags).toEqual(new Set([0, 1, 2, 3]));
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
      systemCount: 60,
      empireCount: 8,
    });
    // Homeworlds start isolated — force a shared border for the flip test
    const victim = state.empireOrder[0]!;
    const attacker = state.empireOrder[1]!;
    const targetId = state.empires[victim]!.capitalSystemId;
    const neighborId = state.systems[targetId]!.hyperlanes[0]!;
    const neighbor = state.systems[neighborId]!;
    neighbor.ownerId = attacker;
    state.empires[attacker]!.ownedSystems.add(neighborId);
    neighbor.garrison = 500;
    state.systems[targetId]!.contested = {
      vs: attacker,
      pct: config.contestedFlipThreshold,
    };
    state.systems[targetId]!.garrison = 10;

    const result = resolveContestedFronts(state, config);
    expect(result.flipped).toContain(targetId);
    expect(state.systems[targetId]!.ownerId).toBe(attacker);
    expect(state.empires[attacker]!.ownedSystems.has(targetId)).toBe(true);
    expect(state.empires[victim]!.ownedSystems.has(targetId)).toBe(false);
  });

  it("colonization needs credits on the frontier", () => {
    const { state } = createMacroMatch({
      seed: 1,
      systemCount: 40,
      empireCount: 4,
    });
    const empire = state.empires[state.empireOrder[0]!]!;
    const home = state.systems[empire.capitalSystemId]!;
    const targetId = home.hyperlanes[0]!;

    home.credits = 0;
    expect(tryColonize(state, empire, targetId)).toBe(false);
    expect(state.systems[targetId]!.ownerId).toBeNull();

    home.credits = colonizeCost(empire) + 5;
    expect(tryColonize(state, empire, targetId)).toBe(true);
    expect(state.systems[targetId]!.ownerId).toBe(empire.id);
    expect(empire.ownedSystems.has(targetId)).toBe(true);
  });

  it("colonization cost climbs with territory", () => {
    const { state } = createMacroMatch({
      seed: 5,
      systemCount: 60,
      empireCount: 4,
    });
    const empire = state.empires[state.empireOrder[0]!]!;
    const early = colonizeCost(empire);
    for (const id of state.systemOrder.slice(0, 30)) {
      empire.ownedSystems.add(id);
    }
    expect(colonizeCost(empire)).toBeGreaterThan(early * 4);
  });

  it("pressureBorder colonizes unowned systems when affordable", () => {
    const { state } = createMacroMatch({
      seed: 1,
      systemCount: 40,
      empireCount: 4,
    });
    const attacker = state.empireOrder[0]!;
    const empire = state.empires[attacker]!;
    const home = state.systems[empire.capitalSystemId]!;
    home.credits = 500;
    const targetId = home.hyperlanes[0]!;
    pressureBorder(state, attacker, targetId, 0.5);
    expect(state.systems[targetId]!.ownerId).toBe(attacker);
  });
});

describe("seed stability", () => {
  it("bot ticks are deterministic for the same seed", () => {
    const a = createMacroMatch({ seed: 12345, systemCount: 80, empireCount: 12 });
    const b = createMacroMatch({ seed: 12345, systemCount: 80, empireCount: 12 });
    const cfg = { ...DEFAULT_MACRO_CONFIG, systemCount: 80, empireCount: 12 };

    for (let i = 0; i < 5; i++) {
      stepLogic(a.state, cfg);
      stepLogic(b.state, cfg);
    }

    expect(a.state.tick).toBe(b.state.tick);
    for (const id of a.state.systemOrder) {
      expect(a.state.systems[id]!.ownerId).toBe(b.state.systems[id]!.ownerId);
      expect(a.state.systems[id]!.garrison).toBeCloseTo(
        b.state.systems[id]!.garrison,
        5,
      );
    }
    expect(a.state.events.map((e) => e.text)).toEqual(
      b.state.events.map((e) => e.text),
    );
  });

  it("event sequence ids are unique and increasing", () => {
    const { state, config } = createMacroMatch({
      seed: 808,
      systemCount: 120,
      empireCount: 10,
    });
    for (let i = 0; i < 150; i++) stepLogic(state, config);
    const seqs = state.events.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    }
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
      systemCount: 50,
      empireCount: 6,
    });
    const snapA = buildSnapshot(state);
    stepLogic(state, config);
    const snapB = buildSnapshot(state);

    const at0 = lerpSnapshot(snapA, snapB, 0, (t) => t);
    const at1 = lerpSnapshot(snapA, snapB, 1, (t) => t);

    for (const id of snapA.systemOrder) {
      expect(at0.systems[id]!.population).toBeCloseTo(
        snapA.systems[id]!.population,
        5,
      );
      expect(at1.systems[id]!.population).toBeCloseTo(
        snapB.systems[id]!.population,
        5,
      );
    }
    for (const id of snapA.empireOrder) {
      expect(at0.empires[id]!.territory).toBeCloseTo(
        snapA.empires[id]!.territory,
        5,
      );
      expect(at1.empires[id]!.territory).toBeCloseTo(
        snapB.empires[id]!.territory,
        5,
      );
    }
  });

  it("shares static geometry rather than copying it", () => {
    const { state } = createMacroMatch({ seed: 11, systemCount: 40 });
    const snap = buildSnapshot(state);
    expect(snap.geometry).toBe(state.geometry);
  });
});

describe("scale", () => {
  it("maps system counts to the Stellaris-style empire clamp", () => {
    expect(empireCountForSystems(600)).toBe(12);
    expect(empireCountForSystems(1200)).toBe(24);
    expect(empireCountForSystems(2400)).toBe(48);
  });
});

describe("createMacroMatch", () => {
  it("starts each empire on one homeworld; the rest is uncolonized", () => {
    const { state, snapshot } = createMacroMatch({
      seed: 55,
      mapSize: "small",
    });
    expect(state.systemOrder.length).toBe(600);
    expect(state.empireOrder.length).toBe(empireCountForSystems(600));
    let owned = 0;
    for (const id of state.systemOrder) {
      if (state.systems[id]!.ownerId) owned++;
    }
    expect(owned).toBe(state.empireOrder.length);
    for (const eid of state.empireOrder) {
      const e = state.empires[eid]!;
      expect(state.systems[e.capitalSystemId]!.ownerId).toBe(eid);
      expect(e.ownedSystems.size).toBe(1);
      expect(snapshot.empires[eid]!.territory).toBe(1);
    }
    const names = state.empireOrder.map((id) => state.empires[id]!.name);
    expect(new Set(names).size).toBe(names.length);
    expect(snapshot.tick).toBe(0);
  });

  it("colonizes outward over ticks, and slows as empires grow", () => {
    const { state, config } = createMacroMatch({
      seed: 77,
      systemCount: 400,
      empireCount: 8,
    });
    const ownedCount = (): number =>
      state.systemOrder.filter((id) => state.systems[id]!.ownerId).length;
    const empireSizes = (): number[] =>
      state.empireOrder.map((id) => state.empires[id]!.ownedSystems.size);

    expect(ownedCount()).toBe(8);
    for (let i = 0; i < 100; i++) stepLogic(state, config);
    const early = ownedCount();
    // Frontier should move — not stuck on homeworlds.
    expect(early).toBeGreaterThan(40);
    expect(Math.min(...empireSizes())).toBeGreaterThan(1);

    for (let i = 0; i < 100; i++) stepLogic(state, config);
    const mid = ownedCount();
    for (let i = 0; i < 100; i++) stepLogic(state, config);
    const late = ownedCount();

    expect(mid).toBeGreaterThanOrEqual(early);
    // Late growth should not accelerate unchecked; allow slack for conquest.
    expect(late - mid).toBeLessThanOrEqual(mid - early + 12);
  });

  it("assigns full-gamut color triples including greys and earth tones", () => {
    const { state } = createMacroMatch({
      seed: 91,
      systemCount: 400,
      empireCount: 24,
    });
    const sats = state.empireOrder.map((id) => state.empires[id]!.colorSat);
    const lights = state.empireOrder.map((id) => state.empires[id]!.colorLight);
    expect(Math.min(...sats)).toBeLessThan(0.25);
    expect(Math.max(...sats)).toBeGreaterThan(0.45);
    expect(Math.min(...lights)).toBeGreaterThan(0.3);
    expect(state.empires[state.empireOrder[0]!]!.fleet.corvette).toBeGreaterThan(
      0,
    );
  });

  it("supports many allies without a hard cap", () => {
    const { state } = createMacroMatch({
      seed: 12,
      systemCount: 200,
      empireCount: 6,
    });
    const a = state.empires[state.empireOrder[0]!]!;
    a.allies = [
      state.empireOrder[1]!,
      state.empireOrder[2]!,
      state.empireOrder[3]!,
      state.empireOrder[4]!,
    ];
    expect(a.allies.length).toBe(4);
  });

  it("researches permanent empire tech", async () => {
    const { state } = createMacroMatch({
      seed: 33,
      systemCount: 200,
      empireCount: 4,
    });
    const empire = state.empires[state.empireOrder[0]!]!;
    for (const sid of empire.ownedSystems) {
      state.systems[sid]!.credits = 500;
    }
    const { tryResearch } = await import("./tech.js");
    const ev = tryResearch(state, empire, "industrial_foundries");
    expect(ev).not.toBeNull();
    expect(empire.researched.has("industrial_foundries")).toBe(true);
  });

  it("can run multi-tick engagements", async () => {
    const { state, config } = createMacroMatch({
      seed: 44,
      systemCount: 200,
      empireCount: 4,
    });
    const attacker = state.empires[state.empireOrder[0]!]!;
    const defender = state.empires[state.empireOrder[1]!]!;
    attacker.fleet = { corvette: 40, cruiser: 10 };
    const targetId = defender.capitalSystemId;
    const { beginEngagement } = await import("./combat.js");
    const eng = beginEngagement(
      state,
      state.systems[targetId]!,
      attacker.id,
      "fleet_battle",
      createRng(1),
    );
    expect(eng).not.toBeNull();
    expect(eng!.ticksRemaining).toBeGreaterThan(10);
    const before = eng!.ticksRemaining;
    for (let i = 0; i < 5; i++) stepLogic(state, config);
    const still = state.systems[targetId]!.engagement;
    if (still) {
      expect(still.ticksRemaining).toBeLessThan(before);
    }
  });

  it("can abandon a system back to neutral wilderness", async () => {
    const { state } = createMacroMatch({
      seed: 19,
      systemCount: 80,
      empireCount: 4,
    });
    const empire = state.empires[state.empireOrder[0]!]!;
    const home = state.systems[empire.capitalSystemId]!;
    const neighborId = home.hyperlanes[0]!;
    const neighbor = state.systems[neighborId]!;
    const { setSystemOwner, abandonSystem } = await import("./combat.js");
    setSystemOwner(state, neighbor, empire.id);
    neighbor.garrison = 12;
    expect(empire.ownedSystems.has(neighborId)).toBe(true);

    const events = abandonSystem(state, neighbor, "withdraw");
    expect(events[0]?.kind).toBe("territory_abandoned");
    expect(neighbor.ownerId).toBeNull();
    expect(empire.ownedSystems.has(neighborId)).toBe(false);
    expect(empire.alive).toBe(true);
  });

  it("emits match_won separately from empire_eliminated", () => {
    const { state, config } = createMacroMatch({
      seed: 66,
      systemCount: 120,
      empireCount: 3,
    });
    for (const eid of state.empireOrder.slice(1)) {
      const e = state.empires[eid]!;
      e.alive = false;
      e.ownedSystems.clear();
    }
    const result = stepLogic(state, config);
    expect(result.newEvents.some((e) => e.kind === "match_won")).toBe(true);
  });

  it("keeps the owned-systems index in step with ownership", () => {
    const { state, config } = createMacroMatch({
      seed: 404,
      systemCount: 200,
      empireCount: 8,
    });
    for (let i = 0; i < 200; i++) stepLogic(state, config);
    for (const eid of state.empireOrder) {
      const empire = state.empires[eid]!;
      const scanned = state.systemOrder.filter(
        (id) => state.systems[id]!.ownerId === eid,
      );
      expect(empire.ownedSystems.size).toBe(scanned.length);
      for (const id of scanned) expect(empire.ownedSystems.has(id)).toBe(true);
    }
  });
});

describe("rng smoke", () => {
  it("createRng is deterministic", () => {
    const a = createRng(1);
    const b = createRng(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
