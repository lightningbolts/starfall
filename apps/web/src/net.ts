import type { ClientMessage, Intent, ServerMessage } from "@starfall/sim";

export type MessageHandler = (msg: ServerMessage) => void;

export class NetClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  onMessage: MessageHandler | null = null;
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;

  connect(url?: string): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const target = url ?? `${proto}://${location.host}/ws`;
    this.ws = new WebSocket(target);
    this.ws.addEventListener("open", () => this.onOpen?.());
    this.ws.addEventListener("close", () => this.onClose?.());
    this.ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
        this.onMessage?.(msg);
      } catch {
        /* ignore */
      }
    });
  }

  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  hello(displayName: string): void {
    this.send({ type: "Hello", displayName });
  }

  setReady(ready: boolean): void {
    this.send({ type: "SetReady", ready });
  }

  startMatch(): void {
    this.send({ type: "StartMatch" });
  }

  intent(intent: Intent): void {
    const sequence = this.seq++;
    this.send({ type: "Intent", sequence, intent });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
