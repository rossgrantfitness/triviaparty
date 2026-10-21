// Every network message between host, phones and server is defined here.
// Keep docs/PROTOCOL.md and host/scripts/protocol.gd in sync with this file.

import { z } from "zod";
import {
  DrawingPromptSchema,
  GameRulesInput,
  GameSettingsSchema,
  MAX_LIE_LENGTH,
  MAX_STROKES,
  QuestionSchema,
  StrokeSchema,
  type RoundKind,
  type Stroke,
} from "./game";

/** Bump when a message shape changes in a way old clients can't handle. */
export const PROTOCOL_VERSION = 4;

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

/** Hats and things players can put on their animal. */
export const ACCESSORIES = ["none", "party_hat", "headband", "bow", "crown", "top_hat", "flower", "glasses"] as const;
export type Accessory = (typeof ACCESSORIES)[number];

/**
 * Reactions players can send from their phone at any time. The TV shows a speech
 * bubble with the onomatopoeia and the animal acts it out.
 */
export const EMOTES = ["laugh", "wow", "love", "boo", "clap", "think", "taunt", "cry"] as const;
export type Emote = (typeof EMOTES)[number];

export const EMOTE_INFO: Record<Emote, { label: string; emoji: string; sound: string }> = {
  laugh: { label: "Haha", emoji: "😂", sound: "ワハハ" },
  wow: { label: "Wow", emoji: "😮", sound: "ワオ!" },
  love: { label: "Love it", emoji: "😍", sound: "♥♥♥" },
  boo: { label: "Boo", emoji: "👎", sound: "ブー!" },
  clap: { label: "Clap", emoji: "👏", sound: "パチパチ" },
  think: { label: "Hmm", emoji: "🤔", sound: "ムムム…" },
  taunt: { label: "Taunt", emoji: "😜", sound: "ベー!" },
  cry: { label: "Sob", emoji: "😭", sound: "シクシク" },
};

/** Self-portraits use the drawing pen too, with a lower stroke limit. */
export const MAX_AVATAR_STROKES = 150;

/** Session-level phases. What happens inside a round is in `round.step`. */
export const PHASES = ["lobby", "intro", "round", "scoreboard", "game_over"] as const;
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
    settings: GameSettingsSchema.default({ mode: "party", length: "standard", drawing: true, categories: [] }),
    questions: z.array(QuestionSchema).default([]),
    prompts: z.array(DrawingPromptSchema).default([]),
    decoys: z.array(z.string().min(1).max(60)).default([]),
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
    accessory: z.enum(ACCESSORIES).default("none"),
    token: z.string().optional(),
  }),
  z.object({ type: z.literal("avatar"), strokes: z.array(StrokeSchema).max(MAX_AVATAR_STROKES) }),
  z.object({ type: z.literal("emote"), emote: z.enum(EMOTES) }),
  z.object({ type: z.literal("vote_drawing"), drawing: z.string().min(1) }),
  z.object({ type: z.literal("vote"), category: z.string() }),
  z.object({ type: z.literal("answer"), choice: z.number().int().min(0) }),
  z.object({ type: z.literal("wager"), amount: z.number().int().min(0) }),
  z.object({ type: z.literal("guess"), value: z.number().finite() }),
  z.object({ type: z.literal("steal"), target: z.string().min(1) }),
  z.object({ type: z.literal("drawing"), strokes: z.array(StrokeSchema).max(MAX_STROKES) }),
  z.object({ type: z.literal("lie"), text: z.string().max(MAX_LIE_LENGTH * 2) }),
  z.object({ type: z.literal("pick"), option: z.string().min(1) }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type HelloMessage = Extract<ClientMessage, { type: "hello" }>;
export type StartGameMessage = Extract<ClientMessage, { type: "start_game" }>;
/** Messages a phone sends during a round. */
export type PlayerInput = Extract<
  ClientMessage,
  { type: "vote" | "answer" | "wager" | "guess" | "steal" | "drawing" | "lie" | "pick" | "vote_drawing" }
>;

// ---- Server -> Client ----

export type ErrorCode =
  | "bad_message"
  | "protocol_mismatch"
  | "room_not_found"
  | "room_full"
  | "not_allowed"
  | "bad_name"
  | "not_enough_players"
  | "no_questions"
  | "too_close"
  | "duplicate";

export interface PlayerView {
  id: string;
  name: string;
  animal: Animal;
  accessory: Accessory;
  /** True once the player has drawn a self-portrait (the TV gets it as an `avatar` message). */
  hasAvatar: boolean;
  /** Seat number from 1, stable for the whole session. */
  seat: number;
  score: number;
  connected: boolean;
  /** True once this player has done what the current step asks (answered, voted, drawn…). */
  hasActed: boolean;
  /** Points from the most recent scoring moment (a reveal). Can be negative (wagers, steals). */
  lastPoints: number;
  /** Points earned in the current round so far. */
  roundPoints: number;
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

export type QuizKind = "classic" | "wager" | "steal" | "final";
export type QuizStep = "vote" | "wager" | "question" | "reveal" | "steal" | "steal_reveal";

export interface QuizView {
  kind: QuizKind;
  step: QuizStep;
  questionNumber: number;
  questionCount: number;
  /** Category of the current question block (shown before wagering). */
  category: { id: string; name: string } | null;
  vote: VoteView | null;
  question: QuestionView | null;
  reveal: {
    correctIndex: number;
    /** playerId -> chosen index, or null if they didn't answer. */
    answers: Record<string, number | null>;
    fact: string | null;
  } | null;
  /** Everyone's bets, shown from the reveal on. */
  wagers: Record<string, number> | null;
  steals: { thief: string; victim: string; amount: number }[] | null;
  me: {
    answer: number | null;
    vote: string | null;
    wager: number | null;
    maxWager: number;
    canSteal: boolean;
    stealTarget: string | null;
  } | null;
}

export interface ClosestView {
  kind: "closest";
  step: "question" | "reveal";
  questionNumber: number;
  questionCount: number;
  question: { id: string; category: string; categoryName: string; text: string; unit: string | null };
  reveal: {
    answer: number;
    fact: string | null;
    /** Sorted closest first. */
    results: { playerId: string; guess: number | null; distance: number | null; place: number | null; points: number }[];
  } | null;
  me: { guess: number | null } | null;
}

export interface DrawingRevealItem {
  optionId: string;
  text: string;
  truth: boolean;
  /** Who wrote this lie. Empty for the real title and for house lies. */
  authors: string[];
  pickers: string[];
}

export interface DrawingView {
  kind: "drawing";
  step: "drawing" | "lying" | "picking" | "reveal";
  /** 1-based, counts judged drawings. 0 while everyone is drawing. */
  drawingNumber: number;
  drawingCount: number;
  /** Who draws this round (during "drawing"), or whose drawing is up. */
  artistIds: string[];
  artistId: string | null;
  strokes: Stroke[] | null;
  options: { id: string; text: string }[] | null;
  reveal: {
    items: DrawingRevealItem[];
    /** How many items the TV should have revealed by now. */
    shown: number;
  } | null;
  me: {
    /** Your secret prompt, only while you're drawing it. */
    prompt: string | null;
    isArtist: boolean;
    submitted: boolean;
    lie: string | null;
    pick: string | null;
  } | null;
}

export interface DrawOffView {
  kind: "drawoff";
  step: "drawing" | "voting" | "reveal";
  /** Everyone draws this same prompt, so everyone (TV included) can see it. */
  prompt: string;
  /**
   * The finished drawings, numbered for voting. Strokes only go to the TV (phones vote
   * by number, looking at the big screen). Artists stay secret until the reveal.
   */
  gallery: { id: string; number: number; strokes: Stroke[] | null; artistId: string | null; votes: number | null }[];
  me: { submitted: boolean; vote: string | null; ownDrawing: string | null } | null;
}

export type RoundView = QuizView | ClosestView | DrawingView | DrawOffView;

export interface StateMessage {
  type: "state";
  code: string;
  phase: Phase;
  paused: boolean;
  hostConnected: boolean;
  players: PlayerView[];
  timer: TimerView | null;
  /** 0-based index of the current (or upcoming) round. */
  roundIndex: number;
  roundCount: number;
  roundKind: RoundKind | null;
  roundTitle: string | null;
  roundBlurb: string | null;
  round: RoundView | null;
  /** Only in messages to a player. */
  you: { playerId: string } | null;
}

export type ServerMessage =
  | { type: "welcome"; connectionId: string; role: ClientRole; protocolVersion: number }
  | { type: "error"; code: ErrorCode; message: string }
  | { type: "room_created"; code: string; hostToken: string }
  | { type: "joined"; code: string; playerId: string; token: string }
  | { type: "kicked" }
  /** To the TV: a player's self-portrait (sent when drawn, and for everyone when the TV connects). */
  | { type: "avatar"; playerId: string; strokes: Stroke[] }
  /** To the TV: a player reacted. */
  | { type: "emote"; playerId: string; emote: Emote }
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

const SERVER_TYPES = new Set(["welcome", "error", "room_created", "joined", "kicked", "avatar", "emote", "state"]);

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
