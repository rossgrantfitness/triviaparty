// Decides which screen a phone shows. Pure functions, so they're easy to test.

import type { StateMessage } from "@trivia/shared";
import type { ConnectionState } from "./connection";

export type Screen =
  | { kind: "connecting" }
  | { kind: "join" }
  | { kind: "kicked" }
  | { kind: "lobby" }
  | { kind: "vote" }
  | { kind: "voted"; category: string }
  | { kind: "question" }
  | { kind: "locked"; choice: number }
  | { kind: "reveal"; correct: boolean; answered: boolean }
  | { kind: "scoreboard" }
  | { kind: "game_over" };

export interface AppState {
  connection: ConnectionState;
  joined: boolean;
  kicked: boolean;
  game: StateMessage | null;
}

export function screenFor(app: AppState): Screen {
  if (app.kicked) return { kind: "kicked" };
  if (!app.joined || !app.game) return app.connection === "connected" ? { kind: "join" } : { kind: "connecting" };
  const game = app.game;
  const you = game.you;
  switch (game.phase) {
    case "lobby":
      return { kind: "lobby" };
    case "category_vote": {
      const voted = you?.vote ? game.vote?.categories.find((c) => c.id === you.vote) : undefined;
      return voted ? { kind: "voted", category: voted.name } : { kind: "vote" };
    }
    case "question":
      return you?.answer != null ? { kind: "locked", choice: you.answer } : { kind: "question" };
    case "reveal": {
      const answer = you?.answer ?? null;
      return { kind: "reveal", answered: answer !== null, correct: answer !== null && answer === game.reveal?.correctIndex };
    }
    case "scoreboard":
      return { kind: "scoreboard" };
    case "game_over":
      return { kind: "game_over" };
  }
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export function formatPoints(n: number): string {
  return n.toLocaleString("en-US");
}

/** Letter and shape for each answer slot, matching the TV. Shapes help colour-blind players. */
export const CHOICE_LABELS = [
  { letter: "A", shape: "▲" },
  { letter: "B", shape: "●" },
  { letter: "C", shape: "■" },
  { letter: "D", shape: "◆" },
  { letter: "E", shape: "★" },
  { letter: "F", shape: "✚" },
];
