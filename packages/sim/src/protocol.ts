/**
 * Wire protocol envelopes shared by server + web (ADR 002).
 * Server stamps clientId; clients never send identity on intents.
 */

import type {
  ClientId,
  Intent,
  PlayerId,
  StampedIntent,
  TickUpdates,
  Turn,
  TurnNumber,
} from "./types.js";
import type { PlayerView, PlayerViewDelta } from "./view.js";

export type WirePhase = "lobby" | "running" | "finished";

export interface LobbySeat {
  clientId: ClientId;
  displayName: string;
  ready: boolean;
  connected: boolean;
  /** First seat is host. */
  host: boolean;
}

/** C→S: join lobby with display name; optional clientId for reconnect. */
export interface HelloMessage {
  type: "Hello";
  displayName: string;
  /** Persist across reconnects; must match an existing seat to rebind. */
  clientId?: ClientId;
}

/** S→C: assigned seat. */
export interface WelcomeMessage {
  type: "Welcome";
  clientId: ClientId;
  playerId: PlayerId | null;
  capacity: number;
}

/** C→S: ready toggle / host start. */
export interface SetReadyMessage {
  type: "SetReady";
  ready: boolean;
}

export interface StartMatchMessage {
  type: "StartMatch";
  /** Fill empty seats with AI so one human can start alone. */
  botCount?: number;
  /** Override bot difficulty (default: soft ladder). */
  difficulty?: "easy" | "normal" | "hard";
  /** Map density preset. */
  mapSize?: "small" | "medium" | "large";
  /** Watch bots only — requester becomes an omniscient spectator. */
  spectator?: boolean;
}

export interface LobbyUpdateMessage {
  type: "LobbyUpdate";
  seats: LobbySeat[];
  phase: WirePhase;
  seed: number | null;
  capacity: number;
}

export interface MatchStartMessage {
  type: "MatchStart";
  seed: number;
  playerId: PlayerId;
  clientId: ClientId;
  /** Static map (roles + neighbors + layout). */
  map: {
    nodes: Record<
      string,
      { id: string; role: string; neighbors: string[] }
    >;
    layout?: Record<string, { x: number; y: number }>;
  };
  /** Seat colors keyed by playerId (HSL strings). */
  seatColors: Record<PlayerId, string>;
  players: Record<
    PlayerId,
    { id: PlayerId; displayName: string; homeworldId: string | null }
  >;
  roundTicks: number;
  view: PlayerView;
  /** True when the client is watching bots, not commanding. */
  spectator?: boolean;
}

/** C→S: player action (identity stamped server-side). */
export interface ClientIntentMessage {
  type: "Intent";
  sequence: number;
  intent: Intent;
}

export interface TurnMessage {
  type: "Turn";
  turn: Turn;
}

export interface ScoreRank {
  playerId: PlayerId;
  displayName: string;
  score: number;
  rank: number;
  eliminated: boolean;
  disconnected: boolean;
}

export interface TickUpdateMessage {
  type: "TickUpdate";
  /** Full fogged snapshot (every 50 ticks, MatchStart, reconnect). */
  full?: PlayerView;
  /** Sparse patch when full is omitted. */
  delta?: PlayerViewDelta;
  events: TickUpdates;
  /** Present every 10 ticks (and on match start). */
  ranks?: ScoreRank[];
}

export interface MatchOverMessage {
  type: "MatchOver";
  winnerId: PlayerId | null;
  ranks: ScoreRank[];
  turnNumber: TurnNumber;
}

export interface ErrorMessage {
  type: "Error";
  code: string;
  message: string;
}

export type ClientMessage =
  | HelloMessage
  | SetReadyMessage
  | StartMatchMessage
  | ClientIntentMessage;

export type ServerMessage =
  | WelcomeMessage
  | LobbyUpdateMessage
  | MatchStartMessage
  | TurnMessage
  | TickUpdateMessage
  | MatchOverMessage
  | ErrorMessage;

export type { StampedIntent, Intent, Turn };
