import { describe, expect, it } from "vitest";
import type { StateMessage } from "@trivia/shared";
import { formatPoints, ordinal, screenFor, type AppState } from "../../client/src/screens";

function game(overrides: Partial<StateMessage>): StateMessage {
  return {
    type: "state",
    code: "ABCD",
    phase: "lobby",
    paused: false,
    hostConnected: true,
    players: [],
    timer: null,
    questionNumber: 0,
    questionCount: 10,
    vote: null,
    question: null,
    reveal: null,
    you: { playerId: "p1", answer: null, vote: null },
    ...overrides,
  };
}

const joined = (g: StateMessage): AppState => ({ connection: "connected", joined: true, kicked: false, game: g });

describe("screenFor", () => {
  it("shows connecting before the socket is up", () => {
    expect(screenFor({ connection: "connecting", joined: false, kicked: false, game: null }).kind).toBe("connecting");
  });

  it("shows the join form once connected", () => {
    expect(screenFor({ connection: "connected", joined: false, kicked: false, game: null }).kind).toBe("join");
  });

  it("shows kicked over everything", () => {
    expect(screenFor({ connection: "connected", joined: false, kicked: true, game: null }).kind).toBe("kicked");
  });

  it("shows the vote, then what you voted for", () => {
    const vote = { categories: [{ id: "science", name: "Science", votes: 1 }], winner: null };
    expect(screenFor(joined(game({ phase: "category_vote", vote }))).kind).toBe("vote");
    const voted = screenFor(joined(game({ phase: "category_vote", vote, you: { playerId: "p1", answer: null, vote: "science" } })));
    expect(voted).toEqual({ kind: "voted", category: "Science" });
  });

  it("shows answer buttons, then the locked answer", () => {
    expect(screenFor(joined(game({ phase: "question" }))).kind).toBe("question");
    expect(screenFor(joined(game({ phase: "question", you: { playerId: "p1", answer: 2, vote: null } })))).toEqual({ kind: "locked", choice: 2 });
  });

  it("marks a correct answer on reveal", () => {
    const reveal = { correctIndex: 2, answers: { p1: 2 } };
    expect(screenFor(joined(game({ phase: "reveal", reveal, you: { playerId: "p1", answer: 2, vote: null } })))).toEqual({
      kind: "reveal",
      correct: true,
      answered: true,
    });
  });

  it("marks no answer on reveal", () => {
    const reveal = { correctIndex: 2, answers: { p1: null } };
    expect(screenFor(joined(game({ phase: "reveal", reveal })))).toEqual({ kind: "reveal", correct: false, answered: false });
  });
});

describe("formatting", () => {
  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  });
  it("adds thousands separators", () => {
    expect(formatPoints(12345)).toBe("12,345");
  });
});
