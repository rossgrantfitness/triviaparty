// Every network message between host, phones and server is defined here.
// Keep docs/PROTOCOL.md and host/scripts/protocol.gd in sync with this file.

import { z } from "zod";
import { GameRulesInput, QuestionSchema } from "./game";

/** Bump when a message shape changes in a way old clients can't handle. */
export const PROTOCOL_VERSION = 2;

/** Default port the relay server listens on during development. */
export const DEFAULT_SERVER_PORT = 8787;

/** Characters used in room codes: no I or O, so they can't be confused with 1 and 0. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;

/** Hard limit from the manifest. Rules can lower it, never raise it. */
export const MAX_PLAYERS = 16;
export const MAX_NAME_LENGTH = 12;

export const ANIMALS = ["dog", "cat", "bunny", "frog"] as const;
export type Animal = (typeof ANIMALS)[number];

export const PHASES = ["lobby", "category_vote", "question", "reveal", "scoreboard", "game_over"] as const;
export type Phase = (typeof PHASES)[number];

export type ClientRole = "host" | "player";

// ---- Client -> Server ----

const RoomCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`));

export const ClientMessageSchema = z.discriminatedUnion("type", [
  // Every client, first message after the socket opens.
  z.object({ type: z.literal("hello"), role: z.enum(["host", "player"]), protocolVersion: z.number() }),

  // Host only.
  z.object({ type: z.literal("create_room") }),
  z.object({ type: z.literal("resume_room"), code: RoomCode, hostToken: z.string().min(1) }),
  z.object({
    type: z.literal("start_game"),
    rules: GameRulesInput,
    questions: z.array(QuestionSchema).min(1),
  }),
  z.object({ type: z.literal("kick"), playerId: z.string().min(1) }),
  z.object({ type: z.literal("set_paused"), paused: z.boolean() }),
  z.object({ type: z.literal("skip") }),
  z.object({ type: z.literal("back_to_lobby") }),

  // Player only.
  z.object({
    type: z.literal("join"),
    code: RoomCode,
    name: z.string(),
    animal: z.enum(ANIMALS),
    token: z.string().optional(),
  }),
  z.object({ type: z.literal("vote"), category: z.string() }),
  z.object({ type: z.literal("answer"), choice: z.number().int().min(0) }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type HelloMessage = Extract<ClientMessage, { type: "hello" }>;

// ---- Server -> Client ----

export type ErrorCode =
  | "bad_message"
  | "protocol_mismatch"
  | "room_not_found"
  | "room_full"
  | "not_allowed"
  | "bad_name"
  | "not_enough_players"
  | "no_questions";

export interface PlayerView {
  id: string;
  name: string;
  animal: Animal;
  /** Seat number from 1, stable for the whole session. */
  seat: number;
  score: number;
  connected: boolean;
  /** True once this player has answered (or voted) in the current phase. */
  hasActed: boolean;
  /** Points from the most recent question (shown on reveal and scoreboard). */
  lastPoints: number;
  /** 1 = leader. Tied players share a rank. */
  rank: number;
}

export interface TimerView {
  durationMs: number;
  /** Time left when this message was sent. Clients count down from here. */
  remainingMs: number;
}

export interface VoteView {
  categories: { id: string; name: string; votes: number }[];
  /** Set once the vote is decided. */
  winner: string | null;
}

/** A question as phones and the TV see it: never contains the answer. */
export interface QuestionView {
  id: string;
  category: string;
  categoryName: string;
  difficulty: number;
  text: string;
  choices: string[];
}

export interface RevealView {
  correctIndex: number;
  /** playerId -> chosen index, or null if they didn't answer. */
  answers: Record<string, number | null>;
}

export interface StateMessage {
  type: "state";
  code: string;
  phase: Phase;
  paused: boolean;
  hostConnected: boolean;
  players: PlayerView[];
  timer: TimerView | null;
  questionNumber: number;
  questionCount: number;
  vote: VoteView | null;
  question: QuestionView | null;
  reveal: RevealView | null;
  /** Only in messages to a player: what this phone has done. */
  you: { playerId: string; answer: number | null; vote: string | null } | null;
}

export type ServerMessage =
  | { type: "welcome"; connectionId: string; role: ClientRole; protocolVersion: number }
  | { type: "error"; code: ErrorCode; message: string }
  | { type: "room_created"; code: string; hostToken: string }
  | { type: "joined"; code: string; playerId: string; token: string }
  | { type: "kicked" }
  | StateMessage;

// ---- Helpers ----

export type ParseResult<T> = { ok: true; message: T } | { ok: false; error: string };

/** Validate a raw message the server received from a host or phone. */
export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
  const result = ClientMessageSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, error: `${where}${issue?.message ?? "invalid message"}` };
  }
  return { ok: true, message: result.data };
}

const SERVER_TYPES = new Set(["welcome", "error", "room_created", "joined", "kicked", "state"]);

/**
 * Light check for messages a phone receives. The server is trusted, so this only
 * guards against garbage, not against every malformed field.
 */
export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: "message must be an object" };
  }
  const type = (data as { type?: unknown }).type;
  if (typeof type !== "string" || !SERVER_TYPES.has(type)) {
    return { ok: false, error: `unknown message type '${String(type)}'` };
  }
  return { ok: true, message: data as ServerMessage };
}

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}
