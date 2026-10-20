import type { GameRules, PlayerInput, RoundKind, RoundView } from "@trivia/shared";
import type { ContentPool } from "../content";
import type { Result } from "../util";

export interface Player {
  id: string;
  /** Secret the phone keeps so it can rejoin the same seat. */
  token: string;
  name: string;
  animal: string;
  seat: number;
  score: number;
  connected: boolean;
  lastPoints: number;
  roundPoints: number;
  /** How many times this player has been an artist this session. */
  drawings: number;
}

/** What a round can ask of the room it runs in. */
export interface RoundContext {
  readonly rules: GameRules;
  readonly rng: () => number;
  readonly content: ContentPool;
  /** Everyone in the room, seat order. */
  players(): Player[];
  player(id: string): Player | undefined;
  /** Add (or subtract) points. Score never drops below 0. Returns the change actually applied. */
  award(playerId: string, points: number): number;
  /** Start a new scoring moment: clears everyone's lastPoints. */
  newScoringMoment(): void;
  /** One timer per room; scheduling replaces the previous one. Pausing is handled for you. */
  schedule(ms: number, then: () => void): void;
  timeLeftMs(): number;
  /** Tell everyone something visible changed. */
  changed(): void;
  /** The round is over. */
  finish(): void;
}

/** One round type. Each lives in its own file so new types plug in without touching others. */
export interface Round {
  readonly kind: RoundKind;
  start(): void;
  input(player: Player, message: PlayerInput): Result<null>;
  /** Has this player done what the current step asks? */
  hasActed(playerId: string): boolean;
  view(viewerId: string | null): RoundView;
  /** Host pressed Next: end the current step now. */
  skip(): void;
  /** Someone joined, left or dropped: a step may be able to end early. */
  playersChanged(): void;
}

/** True when every connected player in `among` is in `done`. False if nobody is connected. */
export function everyoneDone(among: Player[], done: { has(id: string): boolean }): boolean {
  const active = among.filter((p) => p.connected);
  return active.length > 0 && active.every((p) => done.has(p.id));
}
