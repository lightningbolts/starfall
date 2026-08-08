import {
  accumulateTelemetry,
  buildPlayerView,
  computeScores,
  createMatch,
  createMatchTelemetry,
  createSimConfig,
  createVisionMemory,
  DEFAULT_BALANCE,
  diffPlayerView,
  emptyTurn,
  executeNextTick,
  type ClientId,
  type Game,
  type GameState,
  type LobbySeat,
  type MatchTelemetry,
  type PlayerId,
  type PlayerView,
  type ScoreRank,
  type SeatRosterEntry,
  type ServerMessage,
  type SimConfig,
  type StampedIntent,
  type Turn,
  type VisionMemory,
  type WirePhase,
} from "@starfall/sim";
import { appendFileSync } from "node:fs";
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
  /** Intents accepted this turn (rate limit). */
  intentsThisTurn: number;
  rateLimitWarned: boolean;
}

export interface MatchRoomOptions {
  capacity?: number;
  seed?: number;
  roundTicks?: number;
  nodeCountFactor?: number;
  disconnectGraceMs?: number;
  turnIntervalMs?: number;
  /** Max intents per seat per turn. */
  maxIntentsPerTurn?: number;
  /** Full view every N ticks. */
  fullSnapshotEvery?: number;
  /** Optional JSONL path for per-tick telemetry. */
  telemetryPath?: string;
}

const DEFAULTS = {
  capacity: 100,
  disconnectGraceMs: 60_000,
  nodeCountFactor: 2.5,
  turnIntervalMs: 100,
  maxIntentsPerTurn: 8,
  fullSnapshotEvery: 50,
};

export class MatchRoom {
  readonly capacity: number;
  readonly disconnectGraceMs: number;
  readonly nodeCountFactor: number;
  readonly turnIntervalMs: number;
  readonly maxIntentsPerTurn: number;
  readonly fullSnapshotEvery: number;
  readonly telemetryPath: string | null;
  seed: number;
  roundTicks: number;

  phase: WirePhase = "lobby";
  private seats = new Map<ClientId, SeatRuntime>();
  private intentBuffer: StampedIntent[] = [];
  private turnNumber = 0;
  private turns: Turn[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: GameState | null = null;
  private game: Game | null = null;
  private config: SimConfig;
  private memories = new Map<PlayerId, VisionMemory>();
  private lastViews = new Map<PlayerId, PlayerView>();
  private seatColorMap: Record<PlayerId, string> = {};
  private markedDisconnected = new Set<PlayerId>();
  private telemetry = createMatchTelemetry();
  private prevEliminated = 0;
  private mapPayload: MatchStartMessageMap | null = null;
  private playersMeta: MatchStartPlayers | null = null;

  constructor(opts: MatchRoomOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULTS.capacity;
    this.disconnectGraceMs = opts.disconnectGraceMs ?? DEFAULTS.disconnectGraceMs;
    this.nodeCountFactor = opts.nodeCountFactor ?? DEFAULTS.nodeCountFactor;
    this.turnIntervalMs = opts.turnIntervalMs ?? DEFAULTS.turnIntervalMs;
    this.maxIntentsPerTurn =
      opts.maxIntentsPerTurn ?? DEFAULTS.maxIntentsPerTurn;
    this.fullSnapshotEvery =
      opts.fullSnapshotEvery ?? DEFAULTS.fullSnapshotEvery;
    this.telemetryPath = opts.telemetryPath ?? null;
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

  getTelemetry(): MatchTelemetry {
    return { ...this.telemetry };
  }

  getTurnArchive(): readonly Turn[] {
    return this.turns;
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
      seed: this.seed,
      capacity: this.capacity,
    });
  }

  join(
    clientId: ClientId,
    displayName: string,
    send: (msg: ServerMessage) => void,
  ): { ok: true } | { ok: false; code: string; message: string } {
    // Mid-match reconnect via known clientId
    if (this.phase === "running" || this.phase === "finished") {
      if (!this.seats.has(clientId)) {
        return {
          ok: false,
          code: "match_running",
          message: "Match already started",
        };
      }
      const rebound = this.rebind(clientId, send);
      if (!rebound) {
        return {
          ok: false,
          code: "unknown_seat",
          message: "Unknown seat",
        };
      }
      send({
        type: "Welcome",
        clientId,
        playerId: this.seats.get(clientId)?.playerId ?? null,
        capacity: this.capacity,
      });
      if (this.phase === "running") {
        this.sendMatchResync(clientId);
      }
      this.lobbyUpdate();
      return { ok: true };
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
      intentsThisTurn: 0,
      rateLimitWarned: false,
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

  /** Full MatchStart resync for mid-match reconnect. */
  private sendMatchResync(clientId: ClientId): void {
    const seat = this.seats.get(clientId);
    if (
      !seat?.playerId ||
      !this.state ||
      !this.mapPayload ||
      !this.playersMeta
    ) {
      return;
    }
    const memory = this.memories.get(seat.playerId);
    if (!memory) return;
    const view = buildPlayerView(
      this.state,
      seat.playerId,
      memory,
      this.config.balance,
    );
    this.lastViews.set(seat.playerId, view);
    seat.send({
      type: "MatchStart",
      seed: this.seed,
      playerId: seat.playerId,
      clientId: seat.clientId,
      map: this.mapPayload,
      seatColors: this.seatColorMap,
      players: this.playersMeta,
      roundTicks: this.config.roundTicks(),
      view,
    });
  }

  setReady(clientId: ClientId, ready: boolean): void {
    const seat = this.seats.get(clientId);
    if (!seat || this.phase !== "lobby") return;
    seat.ready = ready;
    this.lobbyUpdate();
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
    this.turns = [];
    this.intentBuffer = [];
    this.memories.clear();
    this.lastViews.clear();
    this.markedDisconnected.clear();
    this.telemetry = createMatchTelemetry();
    this.prevEliminated = 0;

    const playerIds = Object.keys(this.state.players) as PlayerId[];
    this.seatColorMap = seatColorsForPlayers(playerIds);

    for (const s of this.seats.values()) {
      const pid = this.state.clientToPlayer[s.clientId] ?? null;
      s.playerId = pid;
      s.intentsThisTurn = 0;
      s.rateLimitWarned = false;
      if (pid) this.memories.set(pid, createVisionMemory());
    }

    computeScores(this.game);

    this.mapPayload = {
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

    this.playersMeta = Object.fromEntries(
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
      this.lastViews.set(s.playerId, view);
      s.send({
        type: "MatchStart",
        seed: this.seed,
        playerId: s.playerId,
        clientId: s.clientId,
        map: this.mapPayload,
        seatColors: this.seatColorMap,
        players: this.playersMeta,
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
    if (seat.intentsThisTurn >= this.maxIntentsPerTurn) {
      if (!seat.rateLimitWarned) {
        seat.rateLimitWarned = true;
        seat.send({
          type: "Error",
          code: "rate_limited",
          message: `Max ${this.maxIntentsPerTurn} intents per turn`,
        });
      }
      return;
    }
    seat.intentsThisTurn += 1;
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

    for (const s of this.seats.values()) {
      s.intentsThisTurn = 0;
      s.rateLimitWarned = false;
    }

    const intents = this.intentBuffer;
    this.intentBuffer = [];
    const turn =
      intents.length === 0
        ? emptyTurn(this.turnNumber)
        : { turnNumber: this.turnNumber, intents };
    this.turns.push(turn);

    const t0 = performance.now();
    const { updates } = executeNextTick(
      this.state,
      turn,
      this.config,
      this.game,
    );
    const tickMs = performance.now() - t0;
    this.turnNumber += 1;

    accumulateTelemetry(
      this.telemetry,
      this.state,
      updates,
      tickMs,
      this.prevEliminated,
    );
    this.prevEliminated = Object.values(this.state.players).filter(
      (p) => p.eliminated,
    ).length;

    if (this.telemetryPath) {
      try {
        appendFileSync(
          this.telemetryPath,
          JSON.stringify({
            tick: this.state.tick,
            tickMs,
            combats: updates.combats.length,
            annex: updates.annexations.length,
            alive: this.telemetry.alivePlayers,
            snowball: this.telemetry.snowballRatio,
          }) + "\n",
        );
      } catch {
        /* ignore write errors */
      }
    }

    const includeRanks =
      this.state.tick % 10 === 0 || this.state.status === "finished";
    const ranks = includeRanks ? this.buildRanks() : undefined;
    const sendFull =
      this.state.tick % this.fullSnapshotEvery === 0 ||
      this.state.status === "finished";

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
      const prev = this.lastViews.get(s.playerId);
      this.lastViews.set(s.playerId, view);

      if (sendFull || !prev) {
        s.send({
          type: "TickUpdate",
          full: view,
          events: updates,
          ...(ranks ? { ranks } : {}),
        });
      } else {
        s.send({
          type: "TickUpdate",
          delta: diffPlayerView(prev, view),
          events: updates,
          ...(ranks ? { ranks } : {}),
        });
      }
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

type MatchStartMessageMap = {
  nodes: Record<string, { id: string; role: string; neighbors: string[] }>;
  layout?: Record<string, { x: number; y: number }>;
};

type MatchStartPlayers = Record<
  PlayerId,
  { id: PlayerId; displayName: string; homeworldId: string | null }
>;
