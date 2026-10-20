import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RULES,
  type ClosestView,
  type DrawingPrompt,
  type DrawingView,
  type GameRules,
  type Question,
  type QuizView,
  type StateMessage,
} from "@trivia/shared";
import { ContentPool } from "../../server/src/content";
import { Room, buildPlan, cleanName, pickVoteWinner, scoreAnswer } from "../../server/src/room";
import { rankGuesses } from "../../server/src/rounds/closest";
import { scoreDrawing } from "../../server/src/rounds/drawing";

function mc(category: string, count: number, difficulty = 2): Question[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${category}-${i}`,
    type: "multiple_choice" as const,
    category,
    difficulty,
    question: `${category} question ${i}?`,
    choices: ["A", "B", "C", "D"],
    answer: i % 4,
  }));
}

function closest(count: number): Question[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `cg-${i}`,
    type: "closest_guess" as const,
    category: "history",
    difficulty: 2,
    question: `What year ${i}?`,
    answer: 1900 + i,
    unit: "year",
  }));
}

const PROMPTS: DrawingPrompt[] = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, prompt: `A cat wearing hat number ${i}` }));
const DECOYS = ["A sad toaster", "Grandma's jet ski", "Moon cheese", "A very tired cloud", "Spaghetti tornado"];
const QUESTIONS = [...mc("science", 8), ...mc("history", 8), ...mc("geography", 8), ...mc("music", 3, 5), ...closest(4)];

let room: Room;
let phases: string[];

beforeEach(() => {
  vi.useFakeTimers();
  phases = [];
  room = new Room("ABCD", () => {
    const step = `${room.phase}:${(room.snapshotFor(null).round as { step?: string } | null)?.step ?? ""}`;
    if (phases.at(-1) !== step) phases.push(step);
  }, () => 0.3);
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

function start(plan: GameRules["plans"]["short"], rules: Partial<GameRules> = {}, drawing = true) {
  return room.start({
    rules: { ...rules, plans: { short: plan } },
    settings: { length: "short", drawing, categories: [] },
    questions: QUESTIONS,
    prompts: PROMPTS,
    decoys: DECOYS,
  });
}

const host = (): StateMessage => room.snapshotFor(null);
const quiz = (id: string | null = null) => room.snapshotFor(id).round as QuizView;
const drawing = (id: string | null = null) => room.snapshotFor(id).round as DrawingView;
const closestView = (id: string | null = null) => room.snapshotFor(id).round as ClosestView;
const correctAnswer = () => QUESTIONS.find((q) => q.id === quiz().question!.id)!.answer as number;
const skipIntro = () => vi.advanceTimersByTime(DEFAULT_RULES.round_intro_seconds * 1000);

// ---- Pure rules ----

describe("scoring helpers", () => {
  it("scores answers with a speed bonus", () => {
    expect(scoreAnswer(false, 20000, 20000, DEFAULT_RULES)).toBe(0);
    expect(scoreAnswer(true, 20000, 20000, DEFAULT_RULES)).toBe(1500);
    expect(scoreAnswer(true, 10000, 20000, DEFAULT_RULES)).toBe(1250);
    expect(scoreAnswer(true, 0, 20000, DEFAULT_RULES)).toBe(1000);
  });

  it("breaks vote ties at random among the tied options only", () => {
    const counts = new Map([["a", 2], ["b", 2], ["c", 1]]);
    expect(pickVoteWinner(counts, () => 0)).toBe("a");
    expect(pickVoteWinner(counts, () => 0.99)).toBe("b");
  });

  it("cleans names", () => {
    expect(cleanName("   Sam    the   Great Destroyer  ")).toBe("Sam the Grea");
    expect(cleanName("Sam 🤖🎉")).toBe("Sam");
    expect(cleanName("A\u0000B\u0007C")).toBe("ABC");
  });

  it("ranks closest guesses with shared places and an exact bonus", () => {
    const guesses = new Map([["a", 1969], ["b", 1970], ["c", 1968], ["d", 2000]]);
    const results = rankGuesses(1969, guesses, ["a", "b", "c", "d", "e"], DEFAULT_RULES);
    const by = Object.fromEntries(results.map((r) => [r.playerId, r]));
    expect(by.a).toMatchObject({ place: 1, points: 1000 + 500 });
    expect(by.b).toMatchObject({ place: 2, points: 600 });
    expect(by.c).toMatchObject({ place: 2, points: 600 });
    expect(by.d).toMatchObject({ place: 4, points: 0 });
    expect(by.e).toMatchObject({ guess: null, points: 0 });
  });

  it("scores a drawing: truth spotters, the artist, and liars who fooled people", () => {
    const options = [
      { id: "o1", text: "real", truth: true, authors: [] },
      { id: "o2", text: "lie by b", truth: false, authors: ["b"] },
      { id: "o3", text: "house lie", truth: false, authors: [] },
    ];
    const picks = new Map([["b", "o1"], ["c", "o2"], ["d", "o2"], ["e", "o3"]]);
    const points = scoreDrawing("a", options, picks, DEFAULT_RULES);
    expect(points.get("b")).toBe(1000 + 500 * 2);
    expect(points.get("a")).toBe(500);
    expect(points.get("c")).toBeUndefined();
    expect(points.get("e")).toBeUndefined();
  });

  it("drops rounds the content or settings can't support", () => {
    const pool = new ContentPool(mc("science", 3), [], [], Math.random);
    expect(buildPlan(["classic", "drawing", "closest", "final"], { drawing: true, content: pool })).toEqual(["classic", "final"]);
    const withPrompts = new ContentPool(mc("science", 3), PROMPTS, DECOYS, Math.random);
    expect(buildPlan(["classic", "drawing"], { drawing: false, content: withPrompts })).toEqual(["classic"]);
  });
});

// ---- Players ----

describe("joining", () => {
  it("gives seats in order and makes duplicate names unique", () => {
    expect(join("Sam").seat).toBe(1);
    expect(join("sam").name).toBe("sam 2");
  });

  it("caps the room at 16 players", () => {
    for (let i = 0; i < 16; i++) join(`P${i}`);
    const result = room.join("Late", "frog");
    expect(!result.ok && result.code).toBe("room_full");
  });

  it("lets a player rejoin their seat with their token, score intact", () => {
    const p = join("Ana");
    start(["classic"], { classic_questions: 2 });
    skipIntro();
    room.input(p.id, { type: "vote", category: quiz().vote!.categories[0]!.id });
    room.input(p.id, { type: "answer", choice: correctAnswer() });
    room.setPlayerConnected(p.id, false);
    const score = host().players[0]!.score;
    expect(score).toBeGreaterThan(1000);
    const again = room.join("whatever", "dog", p.token);
    expect(again.ok && again.value.id).toBe(p.id);
    expect(host().players[0]).toMatchObject({ score, connected: true, name: "Ana" });
  });
});

// ---- Session flow ----

describe("session flow", () => {
  it("runs intro -> round -> scoreboard -> ... -> game over", () => {
    join("Ana");
    join("Ben");
    expect(start(["classic", "closest", "final"], { classic_questions: 2, closest_questions: 1 }).ok).toBe(true);
    vi.advanceTimersByTime(30 * 60_000);
    expect(room.phase).toBe("game_over");
    expect(phases).toEqual(
      expect.arrayContaining(["intro:", "round:vote", "round:question", "round:reveal", "scoreboard:", "round:wager", "game_over:"]),
    );
    expect(phases.indexOf("intro:")).toBe(phases.indexOf("lobby:") + 1);
  });

  it("tells everyone which round is coming", () => {
    join("Ana");
    start(["closest", "classic"]);
    expect(host()).toMatchObject({ phase: "intro", roundKind: "closest", roundTitle: "Closest Guess", roundIndex: 0, roundCount: 2 });
  });

  it("pauses and resumes the timer", () => {
    join("Ana");
    start(["classic"]);
    vi.advanceTimersByTime(2000);
    room.setPaused(true);
    vi.advanceTimersByTime(60_000);
    expect(room.phase).toBe("intro");
    expect(host().timer!.remainingMs).toBe(DEFAULT_RULES.round_intro_seconds * 1000 - 2000);
    room.setPaused(false);
    vi.advanceTimersByTime(DEFAULT_RULES.round_intro_seconds * 1000 - 2000);
    expect(room.phase).toBe("round");
  });

  it("auto-pauses when the TV drops and resumes when it returns", () => {
    join("Ana");
    start(["classic"]);
    room.setHostConnected(false);
    expect(room.paused).toBe(true);
    room.setHostConnected(true);
    expect(room.paused).toBe(false);
  });

  it("skip moves the session along", () => {
    join("Ana");
    start(["classic"]);
    room.skip();
    expect(room.phase).toBe("round");
    room.skip(); // vote
    expect(quiz().step).toBe("question");
  });

  it("back to lobby resets scores", () => {
    const a = join("Ana");
    start(["classic"]);
    skipIntro();
    room.skip();
    room.input(a.id, { type: "answer", choice: correctAnswer() });
    room.backToLobby();
    expect(host()).toMatchObject({ phase: "lobby" });
    expect(host().players[0]!.score).toBe(0);
  });

  it("refuses to start without enough players", () => {
    expect(start(["classic"], { min_players: 3 }).ok).toBe(false);
  });

  it("never repeats a question in a session", () => {
    join("Ana");
    start(["classic", "classic", "classic"], { classic_questions: 8 });
    const seen: string[] = [];
    for (let i = 0; i < 300 && room.phase !== "game_over"; i++) {
      const q = room.phase === "round" ? quiz().question : null;
      if (q && quiz().step === "question") seen.push(q.id);
      room.skip();
    }
    expect(seen.length).toBe(24);
    expect(new Set(seen).size).toBe(24);
  });
});

// ---- Quiz rounds ----

describe("classic round", () => {
  it("never sends the answer before the reveal, and ends early when everyone answered", () => {
    const a = join("Ana");
    const b = join("Ben");
    start(["classic"], { classic_questions: 2 });
    skipIntro();
    room.input(a.id, { type: "vote", category: "science" });
    room.input(b.id, { type: "vote", category: "science" });
    expect(quiz().step).toBe("question");
    for (const view of [room.snapshotFor(null), room.snapshotFor(a.id)]) {
      expect((view.round as QuizView).reveal).toBeNull();
      expect(JSON.stringify(view.round)).not.toContain("answer\":" + correctAnswer());
    }
    vi.advanceTimersByTime(5000);
    room.input(a.id, { type: "answer", choice: correctAnswer() });
    expect(room.input(a.id, { type: "answer", choice: 0 }).ok).toBe(false);
    room.input(b.id, { type: "answer", choice: (correctAnswer() + 1) % 4 });
    expect(quiz().step).toBe("reveal");
    const ana = host().players.find((p) => p.id === a.id)!;
    expect(ana.lastPoints).toBe(1000 + 375);
    expect(quiz().reveal!.correctIndex).toBe(correctAnswer());
  });
});

describe("wager round", () => {
  it("wins or loses the bet, capped at your points (or the floor)", () => {
    const a = join("Ana");
    const b = join("Ben");
    start(["wager"], { wager_questions: 1 });
    skipIntro();
    room.skip(); // vote
    expect(quiz().step).toBe("wager");
    expect(quiz(a.id).me!.maxWager).toBe(500);
    expect(quiz().question).toBeNull();
    room.input(a.id, { type: "wager", amount: 99999 });
    room.input(b.id, { type: "wager", amount: 300 });
    expect(quiz().step).toBe("question");
    room.input(a.id, { type: "answer", choice: correctAnswer() });
    room.input(b.id, { type: "answer", choice: (correctAnswer() + 1) % 4 });
    const players = host().players;
    expect(players.find((p) => p.id === a.id)!.score).toBe(500);
    expect(players.find((p) => p.id === b.id)!.score).toBe(0);
    expect(quiz().wagers).toEqual({ [a.id]: 500, [b.id]: 300 });
  });
});

describe("steal round", () => {
  it("lets right answers take points from a chosen player", () => {
    const a = join("Ana");
    const b = join("Ben");
    start(["steal"], { steal_questions: 2, steal_points: 400 });
    skipIntro();
    room.skip();
    // Q1: only Ben right, he can steal from Ana (who has 0) — nothing to take.
    room.input(b.id, { type: "answer", choice: correctAnswer() });
    room.input(a.id, { type: "answer", choice: (correctAnswer() + 1) % 4 });
    room.skip(); // reveal -> steal
    expect(quiz().step).toBe("steal");
    expect(quiz(b.id).me!.canSteal).toBe(true);
    expect(quiz(a.id).me!.canSteal).toBe(false);
    expect(room.input(b.id, { type: "steal", target: b.id }).ok).toBe(false);
    room.input(b.id, { type: "steal", target: a.id });
    expect(quiz().step).toBe("steal_reveal");
    expect(quiz().steals).toEqual([{ thief: b.id, victim: a.id, amount: 0 }]);
    room.skip();
    // Q2: Ana right, steals from Ben (default target is the leader).
    room.input(a.id, { type: "answer", choice: correctAnswer() });
    room.input(b.id, { type: "answer", choice: (correctAnswer() + 1) % 4 });
    const benBefore = host().players.find((p) => p.id === b.id)!.score;
    room.skip(); // reveal -> steal
    room.skip(); // nobody picked: steal from the leader
    expect(quiz().steals).toEqual([{ thief: a.id, victim: b.id, amount: 400 }]);
    expect(host().players.find((p) => p.id === b.id)!.score).toBe(benBefore - 400);
  });
});

describe("final round", () => {
  it("uses one of the hardest questions", () => {
    join("Ana");
    start(["final"]);
    skipIntro();
    expect(quiz().step).toBe("wager");
    expect(quiz().category!.id).toBe("music");
    room.skip();
    expect(quiz().question!.difficulty).toBe(5);
  });
});

// ---- Closest guess ----

describe("closest round", () => {
  it("scores nearest guesses", () => {
    const a = join("Ana");
    const b = join("Ben");
    start(["closest"], { closest_questions: 1 });
    skipIntro();
    const q = QUESTIONS.find((x) => x.id === closestView().question.id)!;
    expect(closestView().reveal).toBeNull();
    room.input(a.id, { type: "guess", value: (q.answer as number) + 1 });
    room.input(b.id, { type: "guess", value: (q.answer as number) + 50 });
    const view = closestView();
    expect(view.step).toBe("reveal");
    expect(view.reveal!.results[0]).toMatchObject({ playerId: a.id, place: 1, points: 1000 });
    expect(view.reveal!.results[1]).toMatchObject({ playerId: b.id, place: 2, points: 600 });
  });
});

// ---- Drawing ----

describe("drawing round", () => {
  const stroke = { c: 0, w: 1, p: [10, 10, 500, 500] };

  it("runs draw -> lie -> pick -> reveal for each drawing and scores it", () => {
    const a = join("Ana");
    const b = join("Ben");
    const c = join("Cy");
    start(["drawing"]);
    skipIntro();
    let view = drawing(a.id);
    expect(view.step).toBe("drawing");
    expect(view.me!.prompt).toBeTruthy();
    expect(drawing().me).toBeNull(); // the TV never sees prompts
    for (const p of [a, b, c]) room.input(p.id, { type: "drawing", strokes: [stroke] });

    for (let n = 1; n <= 3; n++) {
      view = drawing();
      expect(view).toMatchObject({ step: "lying", drawingNumber: n, drawingCount: 3 });
      expect(view.strokes).toEqual([stroke]);
      const artist = view.artistId!;
      const judges = [a, b, c].filter((p) => p.id !== artist);
      expect(room.input(artist, { type: "lie", text: "nope" }).ok).toBe(false);
      room.input(judges[0]!.id, { type: "lie", text: "A dog in a tuxedo" });
      const dup = room.input(judges[1]!.id, { type: "lie", text: "a DOG in a tuxedo!" });
      expect(!dup.ok && dup.code).toBe("duplicate");
      room.input(judges[1]!.id, { type: "lie", text: "Toast on holiday" });
      view = drawing();
      expect(view.step).toBe("picking");
      expect(view.options!.length).toBe(DEFAULT_RULES.drawing_min_options);
      const truthText = drawing(artist).options!.map((o) => o.text).find((t) => t.startsWith("A cat wearing hat"))!;
      const truth = view.options!.find((o) => o.text === truthText)!;
      const lie0 = view.options!.find((o) => o.text === "A dog in a tuxedo")!;
      expect(room.input(judges[0]!.id, { type: "pick", option: lie0.id }).ok).toBe(false); // own lie
      const scoresBefore = new Map(host().players.map((p) => [p.id, p.score]));
      room.input(judges[0]!.id, { type: "pick", option: truth.id });
      room.input(judges[1]!.id, { type: "pick", option: lie0.id });
      view = drawing();
      expect(view.step).toBe("reveal");
      expect(view.reveal!.items.at(-1)).toMatchObject({ truth: true, pickers: [judges[0]!.id] });
      const gained = (id: string) => host().players.find((p) => p.id === id)!.score - scoresBefore.get(id)!;
      expect(gained(judges[0]!.id)).toBe(1000 + 500); // spotted the truth + fooled judges[1]
      expect(gained(artist)).toBe(500);
      expect(gained(judges[1]!.id)).toBe(0);
      // Step through the reveal.
      vi.advanceTimersByTime(DEFAULT_RULES.drawing_reveal_step_seconds * 1000 * (view.reveal!.items.length + 1));
    }
    expect(room.phase).toBe("game_over");
  });

  it("won't accept the real title as a lie", () => {
    const a = join("Ana");
    const b = join("Ben");
    start(["drawing"]);
    skipIntro();
    const promptA = drawing(a.id).me!.prompt!;
    room.input(a.id, { type: "drawing", strokes: [stroke] });
    room.skip(); // Ben didn't draw: only Ana's drawing is judged
    expect(drawing()).toMatchObject({ step: "lying", drawingCount: 1, artistId: a.id });
    const result = room.input(b.id, { type: "lie", text: promptA.toUpperCase() + "!!" });
    expect(!result.ok && result.code).toBe("too_close");
  });

  it("with lots of players, only some draw, and they rotate next round", () => {
    const players = Array.from({ length: 10 }, (_, i) => join(`P${i}`));
    start(["drawing", "drawing"], { drawings_per_round: 4 });
    skipIntro();
    const first = new Set(drawing().artistIds);
    expect(first.size).toBe(4);
    const judge = players.find((p) => !first.has(p.id))!;
    expect(drawing(judge.id).me).toMatchObject({ isArtist: false, prompt: null });
    expect(room.input(judge.id, { type: "drawing", strokes: [stroke] }).ok).toBe(false);
    // Nobody draws: round ends, next drawing round picks different artists.
    room.skip();
    expect(room.phase).toBe("scoreboard");
    room.skip();
    skipIntro();
    const second = drawing().artistIds;
    expect(second.some((id) => first.has(id))).toBe(false);
  });
});
