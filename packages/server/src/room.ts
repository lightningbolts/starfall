import {
  buildPlayerView,
  computeScores,
  createMatch,
  createSimConfig,
  createVisionMemory,
  DEFAULT_BALANCE,
  emptyTurn,
  executeNextTick,
  type ClientId,
  type Game,
  type GameState,
  type LobbySeat,
  type PlayerId,
  type ScoreRank,
  type SeatRosterEntry,
  type ServerMessage,
  type SimConfig,
  type StampedIntent,
  type VisionMemory,
  type WirePhase,
} from "@starfall/sim";
import { seatColorsForPlayers } from "./colors.js";

export interface SeatRuntime {
  clientId: ClientId;
  displayName: string;
  ready: boolean;
  connected: boolean;
  /** Wall-clock ms when last disconnected; null if connected. */
  disconnectedAt: number | null;
  playerId: PlayerId | null;
  send: (msg: ServerMessage) => void;
}

export interface MatchRoomOptions {
  capacity?: number;
  seed?: number;
  roundTicks?: number;
  nodeCountFactor?: number;
  disconnectGraceMs?: number;
  turnIntervalMs?: number;
}

const DEFAULTS = {
  capacity: 8,
  disconnectGraceMs: 60_000,
  nodeCountFactor: 2.5,
  turnIntervalMs: 100,
};

export class MatchRoom {
  readonly capacity: number;
  readonly disconnectGraceMs: number;
  readonly nodeCountFactor: number;
  readonly turnIntervalMs: number;
  seed: number;
  roundTicks: number;

  phase: WirePhase = "lobby";
  private seats = new Map<ClientId, SeatRuntime>();
  private intentBuffer: StampedIntent[] = [];
  private turnNumber = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: GameState | null = null;
  private game: Game | null = null;
  private config: SimConfig;
  private memories = new Map<PlayerId, VisionMemory>();
  private seatColorMap: Record<PlayerId, string> = {};
  private markedDisconnected = new Set<PlayerId>();

  constructor(opts: MatchRoomOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULTS.capacity;
    this.disconnectGraceMs = opts.disconnectGraceMs ?? DEFAULTS.disconnectGraceMs;
    this.nodeCountFactor = opts.nodeCountFactor ?? DEFAULTS.nodeCountFactor;
    this.turnIntervalMs = opts.turnIntervalMs ?? DEFAULTS.turnIntervalMs;
    this.seed = opts.seed ?? Math.floor(Math.random() * 1e9);
    this.roundTicks =
      opts.roundTicks ?? Math.min(DEFAULT_BALANCE.roundTicks, 3600);
    this.config = createSimConfig(DEFAULT_BALANCE, {
      roundTicks: this.roundTicks,
    });
  }

  getSeat(clientId: ClientId): SeatRuntime | undefined {
    return this.seats.get(clientId);
  }

  seatList(): LobbySeat[] {
    const list = [...this.seats.values()];
    return list.map((s, i) => ({
      clientId: s.clientId,
      displayName: s.displayName,
      ready: s.ready,
      connected: s.connected,
      host: i === 0,
    }));
  }

  private hostClientId(): ClientId | null {
    const first = this.seats.values().next().value as SeatRuntime | undefined;
    return first?.clientId ?? null;
  }

  private broadcast(msg: ServerMessage, except?: ClientId): void {
    for (const s of this.seats.values()) {
      if (except && s.clientId === except) continue;
      if (!s.connected) continue;
      s.send(msg);
    }
  }

  private lobbyUpdate(): void {
    this.broadcast({
      type: "LobbyUpdate",
      seats: this.seatList(),
      phase: this.phase,
      seed: this.phase === "lobby" ? this.seed : this.seed,
    });
  }

  join(
    clientId: ClientId,
    displayName: string,
    send: (msg: ServerMessage) => void,
  ): { ok: true } | { ok: false; code: string; message: string } {
    if (this.phase !== "lobby") {
      // Reconnect during match
      const existing = [...this.seats.values()].find(
        (s) => s.clientId === clientId || s.displayName === displayName,
      );
      // New connections mid-match not allowed without known clientId
      void existing;
      return {
        ok: false,
        code: "match_running",
        message: "Match already started",
      };
    }
    if (this.seats.has(clientId)) {
      const seat = this.seats.get(clientId)!;
      seat.connected = true;
      seat.disconnectedAt = null;
      seat.send = send;
      seat.displayName = displayName;
      send({
        type: "Welcome",
        clientId,
        playerId: null,
        capacity: this.capacity,
      });
      this.lobbyUpdate();
      return { ok: true };
    }
    if (this.seats.size >= this.capacity) {
      return { ok: false, code: "full", message: "Lobby is full" };
    }
    this.seats.set(clientId, {
      clientId,
      displayName,
      ready: false,
      connected: true,
      disconnectedAt: null,
      playerId: null,
      send,
    });
    send({
      type: "Welcome",
      clientId,
      playerId: null,
      capacity: this.capacity,
    });
    this.lobbyUpdate();
    return { ok: true };
  }

  /** Rebind an existing seat after WebSocket reconnect (lobby or match). */
  rebind(
    clientId: ClientId,
    send: (msg: ServerMessage) => void,
  ): boolean {
    const seat = this.seats.get(clientId);
    if (!seat) return false;
    seat.connected = true;
    seat.disconnectedAt = null;
    seat.send = send;
    if (seat.playerId) this.markedDisconnected.delete(seat.playerId);
    return true;
  }

  setReady(clientId: ClientId, ready: boolean): void {
    const seat = this.seats.get(clientId);
    if (!seat || this.phase !== "lobby") return;
    seat.ready = ready;
    this.lobbyUpdate();
    // Auto-start when all seated players ready and >= 2
    if (
      this.seats.size >= 2 &&
      [...this.seats.values()].every((s) => s.ready)
    ) {
      const host = this.hostClientId();
      if (host) this.startMatch(host);
    }
  }

  startMatch(requesterId: ClientId): void {
    if (this.phase !== "lobby") return;
    const host = this.hostClientId();
    if (host !== requesterId) {
      this.seats.get(requesterId)?.send({
        type: "Error",
        code: "not_host",
        message: "Only the host can start the match",
      });
      return;
    }
    if (this.seats.size < 2) {
      this.seats.get(requesterId)?.send({
        type: "Error",
        code: "need_players",
        message: "Need at least 2 players",
      });
      return;
    }

    const roster: SeatRosterEntry[] = [...this.seats.values()].map((s) => ({
      clientId: s.clientId,
      displayName: s.displayName,
    }));
    const playerCount = roster.length;
    const nodeCount = Math.max(
      Math.ceil(playerCount * this.nodeCountFactor),
      playerCount * 2,
    );

    const match = createMatch({
      seed: this.seed,
      playerCount,
      nodeCount,
      config: this.config,
      seats: roster,
    });
    this.state = match.state;
    this.game = match.game;
    this.config = match.config;
    this.phase = "running";
    this.turnNumber = 0;
    this.intentBuffer = [];
    this.memories.clear();
    this.markedDisconnected.clear();

    const playerIds = Object.keys(this.state.players) as PlayerId[];
    this.seatColorMap = seatColorsForPlayers(playerIds);

    for (const s of this.seats.values()) {
      const pid = this.state.clientToPlayer[s.clientId] ?? null;
      s.playerId = pid;
      if (pid) this.memories.set(pid, createVisionMemory());
    }

    computeScores(this.game);

    const mapPayload = {
      nodes: Object.fromEntries(
        Object.entries(this.state.map.nodes).map(([id, n]) => [
          id,
          { id: n.id, role: n.role, neighbors: [...n.neighbors] },
        ]),
      ),
      layout: this.state.map.layout
        ? { ...this.state.map.layout }
        : undefined,
    };

    const playersMeta = Object.fromEntries(
      Object.values(this.state.players).map((p) => [
        p.id,
        {
          id: p.id,
          displayName: p.displayName,
          homeworldId: p.homeworldId,
        },
      ]),
    );

    for (const s of this.seats.values()) {
      if (!s.playerId || !s.connected) continue;
      const memory = this.memories.get(s.playerId)!;
      const view = buildPlayerView(
        this.state,
        s.playerId,
        memory,
        this.config.balance,
      );
      s.send({
        type: "MatchStart",
        seed: this.seed,
        playerId: s.playerId,
        clientId: s.clientId,
        map: mapPayload,
        seatColors: this.seatColorMap,
        players: playersMeta,
        roundTicks: this.config.roundTicks(),
        view,
      });
    }

    this.lobbyUpdate();
    this.timer = setInterval(() => this.endTurn(), this.turnIntervalMs);
  }

  enqueueIntent(intent: StampedIntent): void {
    if (this.phase !== "running") return;
    const seat = this.seats.get(intent.clientId);
    if (!seat?.connected || !seat.playerId) return;
    if (this.markedDisconnected.has(seat.playerId)) return;
    this.intentBuffer.push(intent);
  }

  onDisconnect(clientId: ClientId): void {
    const seat = this.seats.get(clientId);
    if (!seat) return;
    seat.connected = false;
    seat.disconnectedAt = Date.now();
    if (this.phase === "lobby") {
      this.seats.delete(clientId);
      this.lobbyUpdate();
      return;
    }
    this.lobbyUpdate();
  }

  private checkDisconnectGrace(): void {
    const now = Date.now();
    for (const seat of this.seats.values()) {
      if (seat.connected || seat.disconnectedAt == null || !seat.playerId)
        continue;
      if (now - seat.disconnectedAt >= this.disconnectGraceMs) {
        this.markedDisconnected.add(seat.playerId);
      }
    }
  }

  buildRanks(): ScoreRank[] {
    if (!this.state) return [];
    const rows = Object.values(this.state.players).map((p) => ({
      playerId: p.id,
      displayName: p.displayName,
      score: p.score,
      eliminated: p.eliminated,
      disconnected: this.markedDisconnected.has(p.id),
    }));
    rows.sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));
    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
  }

  private endTurn(): void {
    if (this.phase !== "running" || !this.state || !this.game) return;
    this.checkDisconnectGrace();

    const intents = this.intentBuffer;
    this.intentBuffer = [];
    const turn =
      intents.length === 0
        ? emptyTurn(this.turnNumber)
        : { turnNumber: this.turnNumber, intents };

    const { updates } = executeNextTick(
      this.state,
      turn,
      this.config,
      this.game,
    );
    this.turnNumber += 1;

    const includeRanks =
      this.state.tick % 10 === 0 || this.state.status === "finished";
    const ranks = includeRanks ? this.buildRanks() : undefined;

    this.broadcast({ type: "Turn", turn });

    for (const s of this.seats.values()) {
      if (!s.playerId || !s.connected) continue;
      const memory = this.memories.get(s.playerId);
      if (!memory) continue;
      const view = buildPlayerView(
        this.state,
        s.playerId,
        memory,
        this.config.balance,
      );
      s.send({
        type: "TickUpdate",
        view,
        events: updates,
        ...(ranks ? { ranks } : {}),
      });
    }

    if (this.state.status === "finished") {
      this.finish();
    }
  }

  private finish(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.phase = "finished";
    const ranks = this.buildRanks();
    this.broadcast({
      type: "MatchOver",
      winnerId: this.state?.winnerId ?? null,
      ranks,
      turnNumber: this.state?.turnNumber ?? this.turnNumber,
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Test helper: force one turn without waiting. */
  tickOnceForTests(): void {
    this.endTurn();
  }

  getStateForTests(): GameState | null {
    return this.state;
  }
}
