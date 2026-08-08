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
  it("trims Hello display names", () => {
    expect(parseClientMessage({ type: "Hello", displayName: "  Ace  " })).toEqual({
      type: "Hello",
      displayName: "Ace",
    });
    expect(parseClientMessage({ type: "Hello", displayName: "   " })).toBeNull();
  });
});

describe("MatchRoom", () => {
  it("runs lobby → match → ticks with fogged views", () => {
    const room = new MatchRoom({
      seed: 42,
      roundTicks: 50,
      turnIntervalMs: 10_000, // disable auto; we tick manually
      capacity: 4,
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
      expect(tick.view.self.credits).toBeLessThan(80);
    }

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
    // Fleets still present — no AI cleanup
    expect(Object.keys(room.getStateForTests()!.fleets).length).toBeGreaterThan(0);
    room.stop();
    vi.useRealTimers();
  });
});
