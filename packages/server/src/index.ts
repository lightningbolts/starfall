#!/usr/bin/env node
import { startServer } from "./wsServer.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  return undefined;
}

const port = Number(arg("port") ?? 8787);
const seed = arg("seed") ? Number(arg("seed")) : undefined;
/** 0 or omit = last player standing (no time limit). */
const ticksRaw = arg("ticks");
const ticks = ticksRaw !== undefined ? Number(ticksRaw) : 0;
const players = arg("players") ? Number(arg("players")) : undefined;
const bots = arg("bots") ? Number(arg("bots")) : 0;
const staticDir = arg("static");
const telemetry = arg("telemetry");

const srv = startServer({
  port,
  seed,
  roundTicks: ticks,
  capacity: players ?? 100,
  botCount: bots,
  ...(staticDir ? { staticDir } : {}),
  ...(telemetry ? { telemetryPath: telemetry } : {}),
});

const bound = await srv.ready;
console.log(`Starfall server listening on http://localhost:${bound}`);
console.log(`WebSocket: ws://localhost:${bound}/ws`);
console.log(`Metrics: http://localhost:${bound}/metrics`);
console.log(`Capacity: ${srv.room.capacity}`);
if (bots > 0) console.log(`Bots: ${srv.room.botCount}`);
if (seed != null) console.log(`Seed: ${seed} (fixed)`);
else console.log(`Seed: random each match`);
if (ticks > 0) {
  console.log(`Round ticks: ${ticks} (timed score finish)`);
} else {
  console.log(`Win: last player standing (no time limit)`);
}
if (telemetry) console.log(`Telemetry JSONL: ${telemetry}`);
