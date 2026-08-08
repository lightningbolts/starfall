/**
 * 50-seat load: MatchRoom join/ready + ~100 ticks; log tick budget.
 * Usage: pnpm --filter @starfall/server exec tsx src/load.ts
 */
import type { ServerMessage } from "@starfall/sim";
import { MatchRoom } from "./room.js";

const SEATS = 50;
const TICKS = 100;

async function main(): Promise<void> {
  const room = new MatchRoom({
    seed: 99,
    roundTicks: TICKS + 50,
    turnIntervalMs: 10_000, // manual ticks only
    capacity: SEATS,
    nodeCountFactor: 2.5,
    fullSnapshotEvery: 50,
  });

  const inboxes: ServerMessage[][] = Array.from({ length: SEATS }, () => []);
  const tJoin = performance.now();
  for (let i = 0; i < SEATS; i++) {
    const idx = i;
    const result = room.join(`c${i}`, `P${i}`, (m) => {
      inboxes[idx]!.push(m);
    });
    if (!result.ok) throw new Error(`join failed: ${result.message}`);
  }
  console.log(`joined ${SEATS} in ${(performance.now() - tJoin).toFixed(0)}ms`);

  const tStart = performance.now();
  for (let i = 0; i < SEATS; i++) {
    room.setReady(`c${i}`, true);
  }
  if (room.phase !== "running") {
    throw new Error(`expected running, got ${room.phase}`);
  }
  console.log(
    `match started in ${(performance.now() - tStart).toFixed(0)}ms nodes=${Object.keys(room.getStateForTests()!.map.nodes).length}`,
  );

  const start0 = inboxes[0]!.find((m) => m.type === "MatchStart");
  if (start0?.type !== "MatchStart") throw new Error("no MatchStart for seat 0");
  if (start0.view.visibleNodes.length < 1) throw new Error("no vision");
  // Fogged: seat 0 should not see every node live
  const liveCount = Object.values(start0.view.nodes).filter(
    (n) => !("fogged" in n && n.fogged),
  ).length;
  if (liveCount >= Object.keys(room.getStateForTests()!.map.nodes).length) {
    throw new Error("expected fogged view (not full omniscience)");
  }

  for (let i = 0; i < TICKS; i++) {
    room.tickOnceForTests();
  }

  const tel = room.getTelemetry();
  const avg = tel.ticks ? tel.totalTickMs / tel.ticks : 0;
  console.log("load ok", {
    seats: SEATS,
    ticks: tel.ticks,
    avgTickMs: Number(avg.toFixed(2)),
    maxTickMs: Number(tel.maxTickMs.toFixed(2)),
    turnsArchived: room.getTurnArchive().length,
    snowball: tel.snowballRatio,
  });

  // Confirm deltas were used (not only full snapshots)
  const ticks = inboxes[0]!.filter((m) => m.type === "TickUpdate");
  const withDelta = ticks.filter(
    (m) => m.type === "TickUpdate" && m.delta && !m.full,
  );
  const withFull = ticks.filter(
    (m) => m.type === "TickUpdate" && m.full,
  );
  console.log("tick wire", {
    updates: ticks.length,
    deltas: withDelta.length,
    fulls: withFull.length,
  });
  if (withDelta.length < 1) {
    throw new Error("expected at least one delta TickUpdate");
  }

  if (tel.maxTickMs > 95) {
    console.warn(
      `warning: max tick ${tel.maxTickMs.toFixed(1)}ms approaches 100ms budget`,
    );
  }

  room.stop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
