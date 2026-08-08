#!/usr/bin/env node
import { startServer } from "./wsServer.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  return undefined;
}

const port = Number(arg("port") ?? 8787);
const seed = arg("seed") ? Number(arg("seed")) : undefined;
const ticks = arg("ticks") ? Number(arg("ticks")) : undefined;
const players = arg("players") ? Number(arg("players")) : undefined;
const staticDir = arg("static");

const srv = startServer({
  port,
  seed,
  roundTicks: ticks,
  capacity: players ?? 8,
  ...(staticDir ? { staticDir } : {}),
});

const bound = await srv.ready;
console.log(`Starfall server listening on http://localhost:${bound}`);
console.log(`WebSocket: ws://localhost:${bound}/ws`);
if (seed != null) console.log(`Seed: ${seed}`);
if (ticks != null) console.log(`Round ticks: ${ticks}`);
