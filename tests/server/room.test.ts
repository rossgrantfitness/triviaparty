import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RULES, type GameRules, type Question } from "@trivia/shared";
import { Room, cleanName, pickVoteWinner, scoreAnswer } from "../../server/src/room";

function makeQuestions(category: string, count: number): Question[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${category}-${i}`,
    type: "multiple_choice" as const,
    category,
    difficulty: 2,
    question: `${category} question ${i}?`,
    choices: ["A", "B", "C", "D"],
    answer: i % 4,
  }));
}

const QUESTIONS = [...makeQuestions("science", 6), ...makeQuestions("history", 6), ...makeQuestions("geography", 6)];

const FAST: Partial<GameRules> = {
  questions_per_game: 4,
  questions_per_category: 2,
  vote_seconds: 10,
  question_seconds: 20,
  reveal_seconds: 5,
  scoreboard_seconds: 5,
};

let changes = 0;
let room: Room;

beforeEach(() => {
  vi.useFakeTimers();
  changes = 0;
  room = new Room("ABCD", () => changes++, () => 0);
});

afterEach(() => {
  room.dispose();
  vi.useRealTimers();
});

function join(name: string) {
  const result = room.join(name, "cat");
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

describe("scoreAnswer", () => {
  it("gives nothing for a wrong answer", () => {
    expect(scoreAnswer(false, 20000, 20000, DEFAULT_RULES)).toBe(0);
  });
  it("gives base plus the full bonus for an instant answer", () => {
    expect(scoreAnswer(true, 20000, 20000, DEFAULT_RULES)).toBe(DEFAULT_RULES.base_points + DEFAULT_RULES.speed_bonus_max);
  });
  it("gives base plus half the bonus at the halfway mark", () => {
    expect(scoreAnswer(true, 10000, 20000, DEFAULT_RULES)).toBe(DEFAULT_RULES.base_points + DEFAULT_RULES.speed_bonus_max / 2);
  });
  it("gives just base points at the buzzer", () => {
    expect(scoreAnswer(true, 0, 20000, DEFAULT_RULES)).toBe(DEFAULT_RULES.base_points);
  });
});

describe("pickVoteWinner", () => {
  it("picks the most votes", () => {
    expect(pickVoteWinner(new Map([["a", 1], ["b", 3], ["c", 0]]), () => 0.99)).toBe("b");
  });
  it("breaks ties at random among the tied options only", () => {
    const counts = new Map([["a", 2], ["b", 2], ["c", 1]]);
    expect(pickVoteWinner(counts, () => 0)).toBe("a");
    expect(pickVoteWinner(counts, () => 0.99)).toBe("b");
  });
});

describe("cleanName", () => {
  it("trims, collapses spaces and caps length", () => {
    expect(cleanName("   Sam    the   Great Destroyer  ")).toBe("Sam the Grea");
  });
  it("strips control characters", () => {
    expect(cleanName("A\u0000B\u0007C")).toBe("ABC");
  });
});

describe("joining", () => {
  it("gives seats in order and makes duplicate names unique", () => {
    const a = join("Sam");
    const b = join("sam");
    expect(a.seat).toBe(1);
    expect(b.seat).toBe(2);
    expect(b.name).toBe("sam 2");
  });

  it("rejects an empty name", () => {
    expect(room.join("   ", "dog").ok).toBe(false);
  });

  it("caps the room at 16 players", () => {
    for (let i = 0; i < 16; i++) join(`P${i}`);
    const result = room.join("Late", "frog");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("room_full");
  });

  it("lets a player rejoin their seat with their token, score intact", () => {
    const p = join("Ana");
    room.start(FAST, QUESTIONS);
    vi.advanceTimersByTime(10_000); // vote ends
    room.answer(p.id, 0);
    room.setPlayerConnected(p.id, false);
    vi.advanceTimersByTime(20_000);
    const scoreBefore = room.snapshotFor(null).players[0]!.score;

    const again = room.join("whatever", "dog", p.token);
    expect(again.ok && again.value.id).toBe(p.id);
    const view = room.snapshotFor(p.id).players[0]!;
    expect(view.connected).toBe(true);
    expect(view.score).toBe(scoreBefore);
    expect(view.name).toBe("Ana");
  });
});

describe("game flow", () => {
  it("runs vote -> question -> reveal -> scoreboard ... -> game over", () => {
    const phases: string[] = [];
    const watched = new Room("WXYZ", () => {
      if (phases.at(-1) !== watched.phase) phases.push(watched.phase);
    });
    watched.join("Ana", "dog");
    watched.join("Ben", "frog");
    expect(watched.start(FAST, QUESTIONS).ok).toBe(true);
    vi.advanceTimersByTime(10 * 60_000);
    room = watched;
    expect(room.phase).toBe("game_over");
    expect(room.snapshotFor(null).questionNumber).toBe(4);
    // Two blocks of two questions means two votes.
    expect(phases.filter((p) => p === "category_vote").length).toBe(2);
    expect(phases.slice(0, 5)).toEqual(["lobby", "category_vote", "question", "reveal", "scoreboard"]);
  });

  it("never sends the answer before the reveal", () => {
    const p = join("Ana");
    join("Ben");
    room.start(FAST, QUESTIONS);
    vi.advanceTimersByTime(10_000);
    expect(room.phase).toBe("question");
    for (const view of [room.snapshotFor(null), room.snapshotFor(p.id)]) {
      expect(view.reveal).toBeNull();
      expect(JSON.stringify(view.question)).not.toContain("answer");
    }
  });

  it("scores a fast correct answer and ends early when everyone answered", () => {
    const a = join("Ana");
    const b = join("Ben");
    room.start(FAST, QUESTIONS);
    room.vote(a.id, "science");
    room.vote(b.id, "science");
    expect(room.phase).toBe("question"); // everyone voted, no waiting
    const id = room.snapshotFor(null).question!.id;
    const correct = QUESTIONS.find((q) => q.id === id)!.answer;
    expect(id.startsWith("science")).toBe(true);

    vi.advanceTimersByTime(5_000); // 15 of 20 s left
    room.answer(a.id, correct);
    room.answer(b.id, (correct + 1) % 4);
    expect(room.phase).toBe("reveal");

    const view = room.snapshotFor(null);
    expect(view.reveal!.correctIndex).toBe(correct);
    const ana = view.players.find((p) => p.id === a.id)!;
    const ben = view.players.find((p) => p.id === b.id)!;
    expect(ana.lastPoints).toBe(1000 + 375);
    expect(ana.rank).toBe(1);
    expect(ben.score).toBe(0);
    expect(ben.rank).toBe(2);
  });

  it("locks the first answer", () => {
    const a = join("Ana");
    join("Ben");
    room.start(FAST, QUESTIONS);
    vi.advanceTimersByTime(10_000);
    expect(room.answer(a.id, 1).ok).toBe(true);
    expect(room.answer(a.id, 2).ok).toBe(false);
    expect(room.snapshotFor(a.id).you!.answer).toBe(1);
  });

  it("ignores disconnected players when deciding if everyone answered", () => {
    const a = join("Ana");
    const b = join("Ben");
    room.start(FAST, QUESTIONS);
    vi.advanceTimersByTime(10_000);
    room.setPlayerConnected(b.id, false);
    room.answer(a.id, 0);
    expect(room.phase).toBe("reveal");
  });

  it("pause freezes the timer and resume continues it", () => {
    join("Ana");
    room.start(FAST, QUESTIONS);
    vi.advanceTimersByTime(10_000);
    expect(room.phase).toBe("question");
    vi.advanceTimersByTime(8_000);
    room.setPaused(true);
    vi.advanceTimersByTime(60_000);
    expect(room.phase).toBe("question");
    expect(room.snapshotFor(null).timer!.remainingMs).toBe(12_000);
    room.setPaused(false);
    vi.advanceTimersByTime(11_999);
    expect(room.phase).toBe("question");
    vi.advanceTimersByTime(1);
    expect(room.phase).toBe("reveal");
  });

  it("auto-pauses when the host drops and resumes when it returns", () => {
    join("Ana");
    room.start(FAST, QUESTIONS);
    room.setHostConnected(false);
    expect(room.paused).toBe(true);
    room.setHostConnected(true);
    expect(room.paused).toBe(false);
  });

  it("kick removes the player", () => {
    const a = join("Ana");
    expect(room.kick(a.id)).toBe(true);
    expect(room.snapshotFor(null).players).toHaveLength(0);
  });

  it("skip jumps to the next phase", () => {
    join("Ana");
    room.start(FAST, QUESTIONS);
    room.skip();
    expect(room.phase).toBe("question");
  });

  it("does not repeat questions within a game", () => {
    join("Ana");
    room.start({ ...FAST, questions_per_game: 18, questions_per_category: 3 }, QUESTIONS);
    const seen: string[] = [];
    for (let i = 0; i < 200 && room.phase !== "game_over"; i++) {
      const q = room.snapshotFor(null).question;
      if (room.phase === "question" && q) seen.push(q.id);
      room.skip();
    }
    expect(seen).toHaveLength(18);
    expect(new Set(seen).size).toBe(18);
  });

  it("back to lobby resets scores", () => {
    const a = join("Ana");
    room.start(FAST, QUESTIONS);
    vi.advanceTimersByTime(10_000);
    const id = room.snapshotFor(null).question!.id;
    room.answer(a.id, QUESTIONS.find((q) => q.id === id)!.answer);
    room.backToLobby();
    expect(room.phase).toBe("lobby");
    expect(room.snapshotFor(null).players[0]!.score).toBe(0);
  });

  it("refuses to start without enough players", () => {
    expect(room.start({ min_players: 3 }, QUESTIONS).ok).toBe(false);
  });

  it("reports changes", () => {
    join("Ana");
    expect(changes).toBeGreaterThan(0);
  });
});
