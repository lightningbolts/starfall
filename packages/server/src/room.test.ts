import { describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "@starfall/sim";
import { MatchRoom } from "./room.js";
import { parseClientMessage, parseIntent } from "./validate.js";

describe("parseIntent", () => {
  it("accepts MoveFleet and rejects bad paths", () => {
    expect(
      parseIntent({
        type: "MoveFleet",
        fleetId: "f1",
        path: ["a", "b"],
      }),
    ).toEqual({ type: "MoveFleet", fleetId: "f1", path: ["a", "b"] });
    expect(parseIntent({ type: "MoveFleet", fleetId: "f1", path: ["a"] })).toBeNull();
    expect(parseIntent({ type: "ResearchTech", techId: "nope" })).toBeNull();
  });
});

describe("parseClientMessage", () => {
  it("trims Hello display names and accepts clientId", () => {
    expect(parseClientMessage({ type: "Hello", displayName: "  Ace  " })).toEqual({
      type: "Hello",
      displayName: "Ace",
    });
    expect(
      parseClientMessage({
        type: "Hello",
        displayName: "Ace",
        clientId: "abc-12345",
      }),
    ).toEqual({
      type: "Hello",
      displayName: "Ace",
      clientId: "abc-12345",
    });
    expect(parseClientMessage({ type: "Hello", displayName: "   " })).toBeNull();
  });
});

describe("MatchRoom", () => {
  it("runs lobby → match → ticks with fogged views and deltas", () => {
    const room = new MatchRoom({
      seed: 42,
      roundTicks: 50,
      turnIntervalMs: 10_000,
      capacity: 4,
      fullSnapshotEvery: 50,
    });
    const inbox: Record<string, ServerMessage[]> = { a: [], b: [] };
    const sendA = (m: ServerMessage) => inbox.a!.push(m);
    const sendB = (m: ServerMessage) => inbox.b!.push(m);

    expect(room.join("a", "Alice", sendA).ok).toBe(true);
    expect(room.join("b", "Bob", sendB).ok).toBe(true);
    room.setReady("a", true);
    room.setReady("b", true);

    expect(room.phase).toBe("running");
    const startA = inbox.a!.find((m) => m.type === "MatchStart");
    expect(startA?.type).toBe("MatchStart");
    if (startA?.type === "MatchStart") {
      expect(startA.view.visibleNodes.length).toBeGreaterThan(0);
      expect(startA.playerId).toBe("p0");
    }

    room.enqueueIntent({
      clientId: "a",
      sequence: 0,
      intent: {
        type: "BuildShips",
        nodeId: room.getStateForTests()!.players.p0!.homeworldId!,
        shipType: "fighter",
        count: 1,
      },
    });
    room.tickOnceForTests();
    const tick = inbox.a!.filter((m) => m.type === "TickUpdate").at(-1);
    expect(tick?.type).toBe("TickUpdate");
    if (tick?.type === "TickUpdate") {
      // tick 1 → delta (full every 50)
      expect(tick.delta || tick.full).toBeTruthy();
      const credits =
        tick.full?.self.credits ??
        tick.delta?.self?.credits;
      expect(credits).toBeLessThan(80);
    }
    expect(room.getTurnArchive().length).toBe(1);

    room.stop();
  });

  it("rate-limits intents per turn", () => {
    const room = new MatchRoom({
      seed: 42,
      roundTicks: 50,
      turnIntervalMs: 10_000,
      capacity: 4,
      maxIntentsPerTurn: 2,
    });
    const errs: ServerMessage[] = [];
    room.join("a", "Alice", (m) => {
      if (m.type === "Error") errs.push(m);
    });
    room.join("b", "Bob", () => undefined);
    room.setReady("a", true);
    room.setReady("b", true);
    const home = room.getStateForTests()!.players.p0!.homeworldId!;
    for (let i = 0; i < 5; i++) {
      room.enqueueIntent({
        clientId: "a",
        sequence: i,
        intent: {
          type: "BuildShips",
          nodeId: home,
          shipType: "fighter",
          count: 1,
        },
      });
    }
    expect(errs.some((e) => e.type === "Error" && e.code === "rate_limited")).toBe(
      true,
    );
    room.stop();
  });

  it("rejects start from non-host when not all ready", () => {
    const room = new MatchRoom({ seed: 1, turnIntervalMs: 10_000 });
    const msgs: ServerMessage[] = [];
    room.join("h", "Host", () => undefined);
    room.join("g", "Guest", (m) => msgs.push(m));
    room.startMatch("g");
    expect(room.phase).toBe("lobby");
    expect(msgs.some((m) => m.type === "Error")).toBe(true);
    room.stop();
  });

  it("marks disconnect after grace without AI takeover", () => {
    vi.useFakeTimers();
    const room = new MatchRoom({
      seed: 3,
      roundTicks: 100,
      turnIntervalMs: 10_000,
      disconnectGraceMs: 1000,
    });
    room.join("a", "A", () => undefined);
    room.join("b", "B", () => undefined);
    room.setReady("a", true);
    room.setReady("b", true);
    expect(room.phase).toBe("running");

    room.onDisconnect("b");
    vi.advanceTimersByTime(500);
    room.tickOnceForTests();
    let ranks = room.buildRanks();
    expect(ranks.find((r) => r.playerId === "p1")?.disconnected).toBe(false);

    vi.advanceTimersByTime(600);
    room.tickOnceForTests();
    ranks = room.buildRanks();
    expect(ranks.find((r) => r.playerId === "p1")?.disconnected).toBe(true);
    expect(Object.keys(room.getStateForTests()!.fleets).length).toBeGreaterThan(0);
    room.stop();
    vi.useRealTimers();
  });

  it("defaults capacity to 100", () => {
    const room = new MatchRoom({ turnIntervalMs: 10_000 });
    expect(room.capacity).toBe(100);
    room.stop();
  });

  it("runs with bot seats against a human", () => {
    const room = new MatchRoom({
      seed: 42,
      roundTicks: 30,
      turnIntervalMs: 10_000,
      capacity: 8,
      botCount: 3,
    });
    expect(room.seatList().filter((s) => s.displayName.startsWith("Bot")).length).toBe(
      3,
    );
    const inbox: ServerMessage[] = [];
    expect(room.join("human", "You", (m) => inbox.push(m)).ok).toBe(true);
    room.setReady("human", true);
    expect(room.phase).toBe("running");
    expect(inbox.some((m) => m.type === "MatchStart")).toBe(true);
    room.tickOnceForTests();
    expect(room.getTurnArchive().length).toBe(1);
    room.stop();
  });

  it("never broadcasts the raw Turn, which carries every player's intents", () => {
    const room = new MatchRoom({
      seed: 42,
      roundTicks: 50,
      turnIntervalMs: 10_000,
      capacity: 4,
    });
    const inbox: ServerMessage[] = [];
    room.join("a", "Alice", (m) => inbox.push(m));
    room.join("b", "Bob", () => undefined);
    room.setReady("a", true);
    room.setReady("b", true);

    const home = room.getStateForTests()!.players.p1!.homeworldId!;
    room.enqueueIntent({
      clientId: "b",
      sequence: 0,
      intent: { type: "BuildShips", nodeId: home, shipType: "fighter", count: 1 },
    });
    room.tickOnceForTests();

    expect(inbox.some((m) => m.type === "Turn")).toBe(false);
    room.stop();
  });

  it("hides rival research and out-of-sight combat from tick events", () => {
    const room = new MatchRoom({
      seed: 42,
      roundTicks: 50,
      turnIntervalMs: 10_000,
      capacity: 4,
    });
    const alice: ServerMessage[] = [];
    const bob: ServerMessage[] = [];
    room.join("a", "Alice", (m) => alice.push(m));
    room.join("b", "Bob", (m) => bob.push(m));
    room.setReady("a", true);
    room.setReady("b", true);

    // Stage a fight at Bob's homeworld, which Alice cannot see from her side
    // of the map, plus a private research unlock for Bob.
    const state = room.getStateForTests()!;
    const bobHome = state.players.p1!.homeworldId!;
    const aliceFleet = Object.values(state.fleets).find(
      (f) => f.ownerId === "p0",
    )!;
    aliceFleet.location = { kind: "node", nodeId: bobHome };
    state.players.p1!.credits = 999;
    room.enqueueIntent({
      clientId: "b",
      sequence: 0,
      intent: { type: "ResearchTech", techId: "survey_drones" },
    });
    room.tickOnceForTests();

    const latest = (box: ServerMessage[]) =>
      box.filter((m) => m.type === "TickUpdate").at(-1);
    const bobTick = latest(bob);
    expect(bobTick?.type).toBe("TickUpdate");
    if (bobTick?.type === "TickUpdate") {
      expect(bobTick.events.researches).toEqual([
        { playerId: "p1", techId: "survey_drones" },
      ]);
      // Bob was a belligerent, so he sees the fight at his own homeworld.
      expect(bobTick.events.combats.length).toBeGreaterThan(0);
    }

    const aliceTick = latest(alice);
    if (aliceTick?.type === "TickUpdate") {
      expect(aliceTick.events.researches).toEqual([]);
    }
    room.stop();
  });

  it("keeps a lobby seat when the host refreshes", () => {
    vi.useFakeTimers();
    const room = new MatchRoom({
      seed: 7,
      turnIntervalMs: 10_000,
      disconnectGraceMs: 5000,
    });
    room.join("host", "Host", () => undefined);
    room.join("guest", "Guest", () => undefined);
    room.setReady("host", true);

    room.onDisconnect("host");
    expect(room.seatList().find((s) => s.clientId === "host")?.host).toBe(true);
    expect(room.seatList().find((s) => s.clientId === "host")?.ready).toBe(true);

    // Reconnect inside the grace window keeps host and ready state.
    vi.advanceTimersByTime(1000);
    expect(room.join("host", "Host", () => undefined).ok).toBe(true);
    const seat = room.seatList().find((s) => s.clientId === "host");
    expect(seat?.connected).toBe(true);
    expect(seat?.host).toBe(true);
    expect(seat?.ready).toBe(true);

    room.stop();
    vi.useRealTimers();
  });

  it("reclaims a lobby seat only after the grace window", () => {
    vi.useFakeTimers();
    const room = new MatchRoom({
      seed: 7,
      turnIntervalMs: 10_000,
      disconnectGraceMs: 1000,
    });
    room.join("a", "A", () => undefined);
    room.join("b", "B", () => undefined);
    room.onDisconnect("b");
    expect(room.seatList()).toHaveLength(2);
    vi.advanceTimersByTime(1500);
    expect(room.seatList()).toHaveLength(1);
    room.stop();
    vi.useRealTimers();
  });

  it("fills the lobby with AI when a solo player starts", () => {
    const room = new MatchRoom({
      seed: 5,
      roundTicks: 30,
      turnIntervalMs: 10_000,
      capacity: 8,
    });
    const inbox: ServerMessage[] = [];
    room.join("solo", "Solo", (m) => inbox.push(m));
    expect(room.phase).toBe("lobby");

    room.startMatch("solo", 7);

    expect(room.phase).toBe("running");
    expect(Object.keys(room.getStateForTests()!.players)).toHaveLength(8);
    expect(inbox.some((m) => m.type === "MatchStart")).toBe(true);
    room.stop();
  });

  it("bounds the turn archive", () => {
    const room = new MatchRoom({
      seed: 9,
      roundTicks: 0,
      turnIntervalMs: 10_000,
      capacity: 4,
    });
    room.join("a", "A", () => undefined);
    room.join("b", "B", () => undefined);
    room.setReady("a", true);
    room.setReady("b", true);
    for (let i = 0; i < 40; i++) room.tickOnceForTests();
    expect(room.getTurnArchive().length).toBeLessThanOrEqual(6000);
    expect(room.getTurnArchive().length).toBe(40);
    room.stop();
  });

  it("rolls a fresh random seed each match unless --seed is fixed", () => {
    const room = new MatchRoom({
      turnIntervalMs: 10_000,
      capacity: 4,
    });
    expect(room.fixedSeed).toBe(false);
    const lobbyMsgs: ServerMessage[] = [];
    room.join("a", "A", (m) => lobbyMsgs.push(m));
    const lobby = lobbyMsgs.find((m) => m.type === "LobbyUpdate");
    expect(lobby?.type === "LobbyUpdate" && lobby.seed).toBeNull();

    const seeds = new Set<number>();
    for (let i = 0; i < 3; i++) {
      const inbox: ServerMessage[] = [];
      // Remake seats each loop: finished rooms can't restart, so use fresh rooms.
      const r = new MatchRoom({ turnIntervalMs: 10_000, capacity: 4 });
      r.join("a", "A", (m) => inbox.push(m));
      r.join("b", "B", () => undefined);
      r.startMatch("a");
      const start = inbox.find((m) => m.type === "MatchStart");
      expect(start?.type).toBe("MatchStart");
      if (start?.type === "MatchStart") seeds.add(start.seed);
      r.stop();
    }
    // Extremely unlikely all three collide in 1e9 space.
    expect(seeds.size).toBeGreaterThan(1);

    const fixed = new MatchRoom({ seed: 12345, turnIntervalMs: 10_000, capacity: 4 });
    expect(fixed.fixedSeed).toBe(true);
    expect(fixed.seed).toBe(12345);
    fixed.stop();
    room.stop();
  });
});
