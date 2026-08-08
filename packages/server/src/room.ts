import {
  accumulateTelemetry,
  botIntents,
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
  policyForBotIndex,
  recommendedNodeCount,
  type BotBrain,
  type CombatResult,
  type TickUpdates,
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
  isBot: boolean;
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
  /** Nodes per player. Omit to use the sim's density curve for the seat count. */
  nodeCountFactor?: number;
  disconnectGraceMs?: number;
  turnIntervalMs?: number;
  /** Max intents per seat per turn. */
  maxIntentsPerTurn?: number;
  /** Full view every N ticks. */
  fullSnapshotEvery?: number;
  /** Optional JSONL path for per-tick telemetry. */
  telemetryPath?: string;
  /** Seat this many AI opponents in the lobby (ready immediately). */
  botCount?: number;
}

const DEFAULTS = {
  capacity: 100,
  disconnectGraceMs: 60_000,
  turnIntervalMs: 100,
  maxIntentsPerTurn: 8,
  fullSnapshotEvery: 50,
  botCount: 0,
};

/** Recent turns kept for debugging/replay. ~10 minutes at 100ms turns. */
const TURN_ARCHIVE_LIMIT = 6000;

export class MatchRoom {
  readonly capacity: number;
  readonly disconnectGraceMs: number;
  readonly nodeCountFactor: number | null;
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
  private bots: BotBrain[] = [];
  readonly botCount: number;

  constructor(opts: MatchRoomOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULTS.capacity;
    this.disconnectGraceMs = opts.disconnectGraceMs ?? DEFAULTS.disconnectGraceMs;
    this.nodeCountFactor = opts.nodeCountFactor ?? null;
    this.turnIntervalMs = opts.turnIntervalMs ?? DEFAULTS.turnIntervalMs;
    this.maxIntentsPerTurn =
      opts.maxIntentsPerTurn ?? DEFAULTS.maxIntentsPerTurn;
    this.fullSnapshotEvery =
      opts.fullSnapshotEvery ?? DEFAULTS.fullSnapshotEvery;
    this.telemetryPath = opts.telemetryPath ?? null;
    this.botCount = Math.max(0, opts.botCount ?? DEFAULTS.botCount);
    this.seed = opts.seed ?? Math.floor(Math.random() * 1e9);
    // 0 = unlimited (last player standing). Pass --ticks N for a timed score finish.
    this.roundTicks = opts.roundTicks ?? 0;
    this.config = createSimConfig(DEFAULT_BALANCE, {
      roundTicks: this.roundTicks,
    });
    if (this.botCount > 0) this.seedBots(this.botCount);
  }

  /** Fill lobby with ready AI seats (host remains first human). */
  private seedBots(count: number): void {
    // Always keep a seat free for the human who has not joined yet.
    const humans = [...this.seats.values()].filter((s) => !s.isBot).length;
    const room = Math.max(
      0,
      this.capacity - this.seats.size - (humans > 0 ? 0 : 1),
    );
    const n = Math.min(count, room);
    let i = 0;
    for (let added = 0; added < n; added++) {
      while (this.seats.has(`bot-${i}`)) i++;
      const clientId = `bot-${i}`;
      this.seats.set(clientId, {
        clientId,
        displayName: `Bot ${i + 1}`,
        ready: true,
        connected: true,
        isBot: true,
        disconnectedAt: null,
        playerId: null,
        send: () => undefined,
        intentsThisTurn: 0,
        rateLimitWarned: false,
      });
    }
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
    const hostId = this.hostClientId();
    return list.map((s) => ({
      clientId: s.clientId,
      displayName: s.displayName,
      ready: s.ready,
      connected: s.connected,
      host: s.clientId === hostId,
    }));
  }

  private hostClientId(): ClientId | null {
    for (const s of this.seats.values()) {
      if (!s.isBot) return s.clientId;
    }
    return null;
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
      isBot: false,
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
    if (!seat || seat.isBot || this.phase !== "lobby") return;
    seat.ready = ready;
    this.lobbyUpdate();
    const humans = [...this.seats.values()].filter((s) => !s.isBot);
    if (
      humans.length >= 1 &&
      this.seats.size >= 2 &&
      humans.every((s) => s.ready)
    ) {
      const host = this.hostClientId();
      if (host) this.startMatch(host);
    }
  }

  startMatch(requesterId: ClientId, botFill = 0): void {
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
    // Solo play: top the lobby up with AI so one human can start immediately.
    if (botFill > 0) {
      const humans = [...this.seats.values()].filter((s) => !s.isBot).length;
      const existingBots = this.seats.size - humans;
      this.seedBots(Math.max(0, botFill - existingBots));
    }
    if (this.seats.size < 2) {
      this.seats.get(requesterId)?.send({
        type: "Error",
        code: "need_players",
        message: "Need at least 2 players — add a bot or wait for someone to join",
      });
      return;
    }

    const roster: SeatRosterEntry[] = [...this.seats.values()].map((s) => ({
      clientId: s.clientId,
      displayName: s.displayName,
    }));
    const playerCount = roster.length;
    const nodeCount =
      this.nodeCountFactor === null
        ? recommendedNodeCount(playerCount)
        : Math.max(
            Math.ceil(playerCount * this.nodeCountFactor),
            playerCount * 3,
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

    this.bots = [];
    for (const s of this.seats.values()) {
      if (!s.isBot || !s.playerId) continue;
      const idx = Number(s.clientId.replace(/^bot-/, "")) || 0;
      this.bots.push({
        playerId: s.playerId,
        clientId: s.clientId,
        policy: policyForBotIndex(idx),
        seq: 0,
      });
    }

    computeScores(this.game);

    this.mapPayload = {
      nodes: Object.fromEntries(
        Object.entries(this.state.map.nodes).map(([id, n]) => [
          id,
          { id: n.id, role: n.role, neighbors: [...n.neighbors] },
        ]),
      ),
      layout: { ...(this.state.map.layout ?? {}) },
    };
    if (Object.keys(this.mapPayload.layout).length < 2) {
      // Should never happen after ensureMapLayout — keep payload valid
      const ids = Object.keys(this.mapPayload.nodes);
      this.mapPayload.layout = Object.fromEntries(
        ids.map((id, i) => {
          const a = (2 * Math.PI * i) / Math.max(ids.length, 1);
          const r = Math.max(5, Math.sqrt(ids.length) * 1.6);
          return [id, { x: Math.cos(a) * r, y: Math.sin(a) * r }];
        }),
      );
    }

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
      if (!s.playerId || !s.connected || s.isBot) continue;
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

  /**
   * Seats survive a disconnect in the lobby too, so a browser refresh keeps
   * host status and ready state instead of silently reshuffling the host.
   */
  onDisconnect(clientId: ClientId): void {
    const seat = this.seats.get(clientId);
    if (!seat || seat.isBot) return;
    seat.connected = false;
    seat.disconnectedAt = Date.now();
    seat.send = () => undefined;
    this.lobbyUpdate();
    if (this.phase === "lobby") {
      // Reclaim the seat only if they never come back.
      setTimeout(() => this.reapLobbySeat(clientId), this.disconnectGraceMs)
        .unref?.();
    }
  }

  private reapLobbySeat(clientId: ClientId): void {
    if (this.phase !== "lobby") return;
    const seat = this.seats.get(clientId);
    if (!seat || seat.connected || seat.isBot) return;
    this.seats.delete(clientId);
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

    // AI intents for this turn (before human buffer drain)
    for (const brain of this.bots) {
      const intents = botIntents(this.state, brain, this.config.balance);
      for (const intent of intents) this.intentBuffer.push(intent);
    }

    const intents = this.intentBuffer;
    this.intentBuffer = [];
    const turn =
      intents.length === 0
        ? emptyTurn(this.turnNumber)
        : { turnNumber: this.turnNumber, intents };
    // Ring buffer: an unbounded archive grows without limit across a long match.
    this.turns.push(turn);
    if (this.turns.length > TURN_ARCHIVE_LIMIT) {
      this.turns.splice(0, this.turns.length - TURN_ARCHIVE_LIMIT);
    }

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

    // The raw Turn carries every player's intents, which bypasses fog entirely.
    // Clients only need their own fogged view, so it is never broadcast.

    for (const s of this.seats.values()) {
      if (!s.playerId || !s.connected || s.isBot) continue;
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
      const events = filterUpdatesForPlayer(updates, s.playerId, view);

      if (sendFull || !prev) {
        s.send({
          type: "TickUpdate",
          full: view,
          events,
          ...(ranks ? { ranks } : {}),
        });
      } else {
        s.send({
          type: "TickUpdate",
          delta: diffPlayerView(prev, view),
          events,
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

/**
 * Trim tick events to what the receiving player can actually observe. Sending
 * every combat and annexation on the map leaked enemy activity through fog.
 */
function filterUpdatesForPlayer(
  updates: TickUpdates,
  playerId: PlayerId,
  view: PlayerView,
): TickUpdates {
  const visible = new Set(view.visibleNodes);
  const seesLocation = (loc: CombatResult["location"]): boolean =>
    loc.kind === "node"
      ? visible.has(loc.nodeId)
      : visible.has(loc.from) || visible.has(loc.to);

  return {
    combats: updates.combats.filter(
      (c) =>
        c.winnerId === playerId || c.loserId === playerId || seesLocation(c.location),
    ),
    annexations: updates.annexations.filter(
      (a) =>
        a.attackerId === playerId ||
        a.previousOwnerId === playerId ||
        visible.has(a.nodeId),
    ),
    // Research is private: you never see what a rival unlocked.
    researches: updates.researches.filter((r) => r.playerId === playerId),
  };
}

type MatchStartMessageMap = {
  nodes: Record<string, { id: string; role: string; neighbors: string[] }>;
  layout: Record<string, { x: number; y: number }>;
};

type MatchStartPlayers = Record<
  PlayerId,
  { id: PlayerId; displayName: string; homeworldId: string | null }
>;
