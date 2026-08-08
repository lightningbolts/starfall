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
import type { PlayerView } from "./view.js";

export type WirePhase = "lobby" | "running" | "finished";

export interface LobbySeat {
  clientId: ClientId;
  displayName: string;
  ready: boolean;
  connected: boolean;
  /** First seat is host. */
  host: boolean;
}

/** C→S: join lobby with display name. */
export interface HelloMessage {
  type: "Hello";
  displayName: string;
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
}

export interface LobbyUpdateMessage {
  type: "LobbyUpdate";
  seats: LobbySeat[];
  phase: WirePhase;
  seed: number | null;
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
  view: PlayerView;
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
