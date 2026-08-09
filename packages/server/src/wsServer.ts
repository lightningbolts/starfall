import { createServer as createHttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientId, ServerMessage } from "@starfall/sim";
import { MatchRoom, type MatchRoomOptions } from "./room.js";
import { parseClientMessage } from "./validate.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

export interface ServerOptions extends MatchRoomOptions {
  port?: number;
  staticDir?: string;
}

export function startServer(opts: ServerOptions = {}): {
  port: number;
  room: MatchRoom;
  staticDir: string | undefined;
  close: () => void;
  ready: Promise<number>;
} {
  const port = opts.port ?? (Number(process.env.PORT) || 8787);
  const room = new MatchRoom(opts);
  const staticDir = resolveStaticDir(opts.staticDir);

  const httpServer = createHttpServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");

    if (urlPath === "/metrics") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify(room.getTelemetry(), null, 2));
      return;
    }

    if (!staticDir) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("Starfall server — connect via WebSocket\n");
      return;
    }
    let rel = urlPath === "/" ? "/index.html" : urlPath;
    const filePath = normalize(join(staticDir, rel));
    if (
      !filePath.startsWith(staticDir) ||
      !existsSync(filePath) ||
      !statSync(filePath).isFile()
    ) {
      const fallback = join(staticDir, "index.html");
      if (existsSync(fallback)) {
        res.writeHead(200, { "content-type": MIME[".html"] });
        res.end(readFileSync(fallback));
        return;
      }
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = extname(filePath);
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
    });
    res.end(readFileSync(filePath));
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    let clientId: ClientId | null = null;
    let joined = false;

    const send = (msg: ServerMessage): void => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    };

    ws.on("message", (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        send({ type: "Error", code: "bad_json", message: "Invalid JSON" });
        return;
      }
      const msg = parseClientMessage(parsed);
      if (!msg) {
        send({
          type: "Error",
          code: "bad_message",
          message: "Invalid message",
        });
        return;
      }

      if (msg.type === "Hello") {
        if (joined && clientId) {
          room.rebind(clientId, send);
          send({
            type: "Welcome",
            clientId,
            playerId: room.getSeat(clientId)?.playerId ?? null,
            capacity: room.capacity,
          });
          return;
        }

        // Prefer persisted clientId so reconnect / reload keeps the seat.
        clientId = msg.clientId ?? randomUUID();
        const result = room.join(clientId, msg.displayName, send);
        if (!result.ok) {
          send({ type: "Error", code: result.code, message: result.message });
          ws.close();
          return;
        }
        joined = true;
        return;
      }

      if (!clientId || !joined) {
        send({
          type: "Error",
          code: "hello_first",
          message: "Send Hello first",
        });
        return;
      }

      if (msg.type === "SetReady") {
        room.setReady(clientId, msg.ready);
        return;
      }
      if (msg.type === "StartMatch") {
        room.startMatch(clientId, {
          botFill: Math.min(msg.botCount ?? 0, Math.max(0, room.capacity - 1)),
          difficulty: msg.difficulty,
          mapSize: msg.mapSize,
          spectator: msg.spectator,
        });
        return;
      }
      if (msg.type === "Intent") {
        room.enqueueIntent({
          clientId,
          sequence: msg.sequence,
          intent: msg.intent,
        });
      }
    });

    ws.on("close", () => {
      if (clientId) room.onDisconnect(clientId);
    });
  });

  let boundPort = port;
  const ready = new Promise<number>((resolveReady, reject) => {
    httpServer.once("error", reject);
    // Bind all interfaces for cloud hosts (Render, Fly, etc.).
    httpServer.listen(port, "0.0.0.0", () => {
      const addr = httpServer.address();
      boundPort = addr && typeof addr === "object" ? addr.port : port;
      resolveReady(boundPort);
    });
  });

  return {
    get port() {
      return boundPort;
    },
    room,
    staticDir,
    ready,
    close: () => {
      room.stop();
      wss.close();
      httpServer.close();
    },
  };
}

/** Prefer a directory that actually contains index.html (cwd varies under pnpm). */
function resolveStaticDir(requested?: string): string | undefined {
  const candidates: string[] = [];
  if (requested) {
    candidates.push(resolve(requested));
    // `pnpm --filter @starfall/server exec` runs with cwd packages/server
    candidates.push(resolve(process.cwd(), "../../", requested));
  }
  try {
    const here = fileURLToPath(new URL(".", import.meta.url));
    candidates.push(resolve(here, "../../../apps/web/dist"));
  } catch {
    /* ignore */
  }
  candidates.push(resolve(process.cwd(), "apps/web/dist"));
  candidates.push(resolve(process.cwd(), "../../apps/web/dist"));

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) return candidate;
  }
  return requested ? resolve(requested) : undefined;
}
