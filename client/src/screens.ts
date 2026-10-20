// Decides which screen a phone shows. Pure functions, so they're easy to test.

import type { ClosestView, DrawingView, QuizView, StateMessage } from "@trivia/shared";
import type { ConnectionState } from "./connection";

export type Screen =
  | { kind: "connecting" }
  | { kind: "join" }
  | { kind: "kicked" }
  | { kind: "lobby" }
  | { kind: "intro" }
  | { kind: "standings"; final: boolean }
  // Quiz rounds
  | { kind: "vote" }
  | { kind: "voted"; category: string }
  | { kind: "wager" }
  | { kind: "wagered"; amount: number }
  | { kind: "question" }
  | { kind: "locked"; choice: number }
  | { kind: "reveal"; correct: boolean; answered: boolean }
  | { kind: "steal" }
  | { kind: "steal_wait" }
  | { kind: "steal_reveal" }
  // Closest guess
  | { kind: "guess" }
  | { kind: "guessed"; value: number }
  | { kind: "closest_reveal" }
  // Drawing
  | { kind: "draw"; prompt: string }
  | { kind: "drawn" }
  | { kind: "judge_wait" }
  | { kind: "lie" }
  | { kind: "lied"; text: string }
  | { kind: "artist_wait" }
  | { kind: "pick" }
  | { kind: "picked" }
  | { kind: "drawing_reveal" };

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
  switch (game.phase) {
    case "lobby":
      return { kind: "lobby" };
    case "intro":
      return { kind: "intro" };
    case "scoreboard":
      return { kind: "standings", final: false };
    case "game_over":
      return { kind: "standings", final: true };
    case "round":
      break;
  }
  const round = game.round;
  if (!round) return { kind: "intro" };
  if (round.kind === "closest") return closestScreen(round);
  if (round.kind === "drawing") return drawingScreen(round);
  return quizScreen(round);
}

function quizScreen(round: QuizView): Screen {
  const me = round.me;
  switch (round.step) {
    case "vote": {
      const voted = me?.vote ? round.vote?.categories.find((c) => c.id === me.vote) : undefined;
      return voted ? { kind: "voted", category: voted.name } : { kind: "vote" };
    }
    case "wager":
      return me?.wager != null ? { kind: "wagered", amount: me.wager } : { kind: "wager" };
    case "question":
      return me?.answer != null ? { kind: "locked", choice: me.answer } : { kind: "question" };
    case "reveal": {
      const answer = me?.answer ?? null;
      return { kind: "reveal", answered: answer !== null, correct: answer !== null && answer === round.reveal?.correctIndex };
    }
    case "steal":
      return me?.canSteal && !me.stealTarget ? { kind: "steal" } : { kind: "steal_wait" };
    case "steal_reveal":
      return { kind: "steal_reveal" };
  }
}

function closestScreen(round: ClosestView): Screen {
  if (round.step === "reveal") return { kind: "closest_reveal" };
  return round.me?.guess != null ? { kind: "guessed", value: round.me.guess } : { kind: "guess" };
}

function drawingScreen(round: DrawingView): Screen {
  const me = round.me;
  switch (round.step) {
    case "drawing":
      if (!me?.isArtist) return { kind: "judge_wait" };
      return me.submitted || !me.prompt ? { kind: "drawn" } : { kind: "draw", prompt: me.prompt };
    case "lying":
      if (me?.isArtist) return { kind: "artist_wait" };
      return me?.lie ? { kind: "lied", text: me.lie } : { kind: "lie" };
    case "picking":
      if (me?.isArtist) return { kind: "artist_wait" };
      return me?.pick ? { kind: "picked" } : { kind: "pick" };
    case "reveal":
      return { kind: "drawing_reveal" };
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

/** "+1,200" / "-300" / "0" */
export function signedPoints(n: number): string {
  return n > 0 ? `+${formatPoints(n)}` : formatPoints(n);
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

/** Quick wager buttons as fractions of what you can bet. */
export const WAGER_STEPS = [
  { label: "Nothing", fraction: 0 },
  { label: "A quarter", fraction: 0.25 },
  { label: "Half", fraction: 0.5 },
  { label: "All in!", fraction: 1 },
];
