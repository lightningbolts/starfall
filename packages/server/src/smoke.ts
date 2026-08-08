/**
 * Two-client localhost smoke against an in-process server.
 * Usage: pnpm --filter @starfall/server exec tsx src/smoke.ts
 */
import WebSocket from "ws";
import type { ServerMessage } from "@starfall/sim";
import { startServer } from "./wsServer.js";

function once(
  ws: WebSocket,
  pred: (m: ServerMessage) => boolean,
  ms = 8000,
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for message")), ms);
    const onMsg = (data: WebSocket.RawData) => {
      const msg = JSON.parse(String(data)) as ServerMessage;
      if (pred(msg)) {
        clearTimeout(t);
        ws.off("message", onMsg);
        resolve(msg);
      }
    };
    ws.on("message", onMsg);
  });
}

async function openClient(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return ws;
}

async function main(): Promise<void> {
  const srv = startServer({
    port: 0,
    seed: 42,
    roundTicks: 80,
    turnIntervalMs: 40,
  });
  const port = await srv.ready;
  const url = `ws://127.0.0.1:${port}/ws`;

  try {
    const a = await openClient(url);
    const b = await openClient(url);
    const send = (ws: WebSocket, o: unknown) => ws.send(JSON.stringify(o));

    send(a, { type: "Hello", displayName: "Alice" });
    await once(a, (m) => m.type === "Welcome");
    send(b, { type: "Hello", displayName: "Bob" });
    await once(b, (m) => m.type === "Welcome");

    send(a, { type: "SetReady", ready: true });
    send(b, { type: "SetReady", ready: true });

    const startA = await once(a, (m) => m.type === "MatchStart");
    const startB = await once(b, (m) => m.type === "MatchStart");
    if (startA.type !== "MatchStart" || startB.type !== "MatchStart") {
      throw new Error("missing MatchStart");
    }
    if (startA.view.visibleNodes.length < 1) throw new Error("no vision");
    if (startA.playerId === startB.playerId) throw new Error("same seat");

    const home = startA.view.self.homeworldId!;
    send(a, {
      type: "Intent",
      sequence: 0,
      intent: {
        type: "BuildShips",
        nodeId: home,
        shipType: "fighter",
        count: 1,
      },
    });

    const tick = await once(
      a,
      (m) => m.type === "TickUpdate" && m.view.self.credits < 80,
    );
    if (tick.type !== "TickUpdate") throw new Error("no debiting tick");

    console.log("smoke ok", {
      port,
      seats: [startA.playerId, startB.playerId],
      credits: tick.view.self.credits,
      visible: startA.view.visibleNodes.length,
    });

    a.close();
    b.close();
  } finally {
    srv.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
