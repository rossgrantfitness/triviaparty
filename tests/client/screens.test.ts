import { describe, expect, it } from "vitest";
import type { ClosestView, DrawingView, QuizView, StateMessage } from "@trivia/shared";
import { formatPoints, ordinal, screenFor, signedPoints, type AppState } from "../../client/src/screens";

function game(overrides: Partial<StateMessage>): StateMessage {
  return {
    type: "state",
    code: "ABCD",
    phase: "round",
    paused: false,
    hostConnected: true,
    players: [],
    timer: null,
    roundIndex: 0,
    roundCount: 3,
    roundKind: "classic",
    roundTitle: "Quiz Time",
    roundBlurb: "",
    round: null,
    you: { playerId: "p1" },
    ...overrides,
  };
}

const quizMe = { answer: null, vote: null, wager: null, maxWager: 500, canSteal: false, stealTarget: null };
function quiz(over: Partial<QuizView>): QuizView {
  return {
    kind: "classic",
    step: "question",
    questionNumber: 1,
    questionCount: 5,
    category: null,
    vote: null,
    question: null,
    reveal: null,
    wagers: null,
    steals: null,
    me: quizMe,
    ...over,
  };
}

function drawing(over: Partial<DrawingView>, me: Partial<NonNullable<DrawingView["me"]>> = {}): DrawingView {
  return {
    kind: "drawing",
    step: "drawing",
    drawingNumber: 0,
    drawingCount: 3,
    artistIds: [],
    artistId: null,
    strokes: null,
    options: null,
    reveal: null,
    me: { prompt: null, isArtist: false, submitted: false, lie: null, pick: null, ...me },
    ...over,
  };
}

const joined = (g: StateMessage): AppState => ({ connection: "connected", joined: true, kicked: false, game: g });
const screen = (round: StateMessage["round"], over: Partial<StateMessage> = {}) => screenFor(joined(game({ round, ...over })));

describe("screenFor: session", () => {
  it("connecting, join, kicked", () => {
    expect(screenFor({ connection: "connecting", joined: false, kicked: false, game: null }).kind).toBe("connecting");
    expect(screenFor({ connection: "connected", joined: false, kicked: false, game: null }).kind).toBe("join");
    expect(screenFor({ connection: "connected", joined: false, kicked: true, game: null }).kind).toBe("kicked");
  });

  it("lobby, intro, standings, game over", () => {
    expect(screen(null, { phase: "lobby" }).kind).toBe("lobby");
    expect(screen(null, { phase: "intro" }).kind).toBe("intro");
    expect(screen(null, { phase: "scoreboard" })).toEqual({ kind: "standings", final: false });
    expect(screen(null, { phase: "game_over" })).toEqual({ kind: "standings", final: true });
  });
});

describe("screenFor: quiz rounds", () => {
  it("vote, then what you voted for", () => {
    const vote = { categories: [{ id: "science", name: "Science", votes: 1 }] };
    expect(screen(quiz({ step: "vote", vote })).kind).toBe("vote");
    expect(screen(quiz({ step: "vote", vote, me: { ...quizMe, vote: "science" } }))).toEqual({ kind: "voted", category: "Science" });
  });

  it("wager, then the bet", () => {
    expect(screen(quiz({ kind: "wager", step: "wager" })).kind).toBe("wager");
    expect(screen(quiz({ kind: "wager", step: "wager", me: { ...quizMe, wager: 200 } }))).toEqual({ kind: "wagered", amount: 200 });
  });

  it("answer buttons, then the locked answer, then the reveal", () => {
    expect(screen(quiz({})).kind).toBe("question");
    expect(screen(quiz({ me: { ...quizMe, answer: 2 } }))).toEqual({ kind: "locked", choice: 2 });
    const reveal = { correctIndex: 2, answers: { p1: 2 }, fact: null };
    expect(screen(quiz({ step: "reveal", reveal, me: { ...quizMe, answer: 2 } }))).toEqual({ kind: "reveal", correct: true, answered: true });
    expect(screen(quiz({ step: "reveal", reveal }))).toEqual({ kind: "reveal", correct: false, answered: false });
  });

  it("only right answers get the steal screen", () => {
    expect(screen(quiz({ kind: "steal", step: "steal", me: { ...quizMe, canSteal: true } })).kind).toBe("steal");
    expect(screen(quiz({ kind: "steal", step: "steal" })).kind).toBe("steal_wait");
    expect(screen(quiz({ kind: "steal", step: "steal", me: { ...quizMe, canSteal: true, stealTarget: "p2" } })).kind).toBe("steal_wait");
  });
});

describe("screenFor: closest guess", () => {
  const base: ClosestView = {
    kind: "closest",
    step: "question",
    questionNumber: 1,
    questionCount: 3,
    question: { id: "q", category: "history", categoryName: "History", text: "When?", unit: "year" },
    reveal: null,
    me: { guess: null },
  };
  it("guess, guessed, reveal", () => {
    expect(screen(base).kind).toBe("guess");
    expect(screen({ ...base, me: { guess: 1969 } })).toEqual({ kind: "guessed", value: 1969 });
    expect(screen({ ...base, step: "reveal" }).kind).toBe("closest_reveal");
  });
});

describe("screenFor: drawing", () => {
  it("artists draw their prompt; everyone else waits", () => {
    expect(screen(drawing({}, { isArtist: true, prompt: "A cat" }))).toEqual({ kind: "draw", prompt: "A cat" });
    expect(screen(drawing({}, { isArtist: true, prompt: "A cat", submitted: true })).kind).toBe("drawn");
    expect(screen(drawing({})).kind).toBe("judge_wait");
  });

  it("judges write fakes and pick; the artist watches", () => {
    expect(screen(drawing({ step: "lying" })).kind).toBe("lie");
    expect(screen(drawing({ step: "lying" }, { lie: "A dog" }))).toEqual({ kind: "lied", text: "A dog" });
    expect(screen(drawing({ step: "lying" }, { isArtist: true })).kind).toBe("artist_wait");
    expect(screen(drawing({ step: "picking" })).kind).toBe("pick");
    expect(screen(drawing({ step: "picking" }, { pick: "o1" })).kind).toBe("picked");
    expect(screen(drawing({ step: "reveal" })).kind).toBe("drawing_reveal");
  });
});

describe("formatting", () => {
  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  });
  it("adds thousands separators and signs", () => {
    expect(formatPoints(12345)).toBe("12,345");
    expect(signedPoints(500)).toBe("+500");
    expect(signedPoints(-300)).toBe("-300");
  });
});
