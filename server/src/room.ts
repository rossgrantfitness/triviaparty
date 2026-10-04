import { randomUUID } from "node:crypto";
import {
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  categoryName,
  resolveRules,
  type Animal,
  type ErrorCode,
  type GameRules,
  type Phase,
  type PlayerView,
  type Question,
  type StateMessage,
} from "@trivia/shared";

export interface Player {
  id: string;
  /** Secret the phone keeps so it can rejoin the same seat. */
  token: string;
  name: string;
  animal: Animal;
  seat: number;
  score: number;
  connected: boolean;
  lastPoints: number;
}

export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; message: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(code: ErrorCode, message: string): Result<T> => ({ ok: false, code, message });

/** Points for one answer: base points plus a speed bonus that shrinks linearly to 0. */
export function scoreAnswer(correct: boolean, remainingMs: number, durationMs: number, rules: GameRules): number {
  if (!correct) return 0;
  const fraction = durationMs > 0 ? Math.min(1, Math.max(0, remainingMs / durationMs)) : 0;
  return rules.base_points + Math.round(rules.speed_bonus_max * fraction);
}

/** Make a name safe to show: no control characters, trimmed, length-limited. */
export function cleanName(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
}

/** Pick the vote winner: most votes, ties broken at random. No votes at all = random option. */
export function pickVoteWinner(counts: Map<string, number>, rng: () => number): string {
  const options = [...counts.keys()];
  const best = Math.max(...counts.values());
  const tied = options.filter((id) => counts.get(id) === best);
  return tied[Math.floor(rng() * tied.length)] ?? options[0]!;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/**
 * One game room: its players, its phase, its timer. Owns all game state.
 * Calls onChange whenever anything visible changes so the server can broadcast.
 */
export class Room {
  readonly hostToken = randomUUID();
  hostConnected = true;
  phase: Phase = "lobby";
  paused = false;

  private players = new Map<string, Player>();
  private rules: GameRules = resolveRules({}, MAX_PLAYERS);
  private pool: Question[] = [];
  private used = new Set<string>();
  private queue: Question[] = [];
  private current: Question | null = null;
  private questionNumber = 0;

  private voteOptions: string[] = [];
  private votes = new Map<string, string>();
  private voteWinner: string | null = null;
  private answers = new Map<string, { choice: number; remainingMs: number }>();

  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerDurationMs = 0;
  private timerEndsAt = 0;
  private pausedRemainingMs = 0;
  private autoPaused = false;

  constructor(
    readonly code: string,
    private readonly onChange: () => void,
    private readonly rng: () => number = Math.random,
  ) {}

  // ---- Players ----

  join(rawName: string, animal: Animal, token?: string): Result<Player> {
    if (token) {
      const existing = [...this.players.values()].find((p) => p.token === token);
      if (existing) {
        existing.connected = true;
        existing.animal = this.phase === "lobby" ? animal : existing.animal;
        this.onChange();
        return ok(existing);
      }
    }
    const name = cleanName(rawName);
    if (!name) return fail("bad_name", "Please enter a name.");
    if (this.players.size >= this.rules.max_players) return fail("room_full", "This room is full.");

    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    let unique = name;
    for (let n = 2; taken.has(unique.toLowerCase()); n++) {
      const suffix = ` ${n}`;
      unique = name.slice(0, MAX_NAME_LENGTH - suffix.length).trim() + suffix;
    }

    const seats = new Set([...this.players.values()].map((p) => p.seat));
    let seat = 1;
    while (seats.has(seat)) seat++;

    const player: Player = {
      id: randomUUID(),
      token: randomUUID(),
      name: unique,
      animal,
      seat,
      score: 0,
      connected: true,
      lastPoints: 0,
    };
    this.players.set(player.id, player);
    this.onChange();
    return ok(player);
  }

  setPlayerConnected(playerId: string, connected: boolean): void {
    const player = this.players.get(playerId);
    if (!player || player.connected === connected) return;
    player.connected = connected;
    this.onChange();
    if (!connected) this.endPhaseIfEveryoneActed();
  }

  kick(playerId: string): boolean {
    if (!this.players.delete(playerId)) return false;
    this.votes.delete(playerId);
    this.answers.delete(playerId);
    this.onChange();
    this.endPhaseIfEveryoneActed();
    return true;
  }

  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId);
  }

  get playerCount(): number {
    return this.players.size;
  }

  // ---- Host ----

  setHostConnected(connected: boolean): void {
    this.hostConnected = connected;
    if (!connected && this.isTimedPhase() && !this.paused) {
      this.autoPaused = true;
      this.setPaused(true);
      return;
    }
    if (connected && this.autoPaused) {
      this.autoPaused = false;
      this.setPaused(false);
      return;
    }
    this.onChange();
  }

  start(rules: Partial<GameRules>, questions: Question[]): Result<null> {
    if (this.phase !== "lobby") return fail("not_allowed", "A game is already running.");
    this.rules = resolveRules(rules, MAX_PLAYERS);
    if (this.players.size < this.rules.min_players) {
      return fail("not_enough_players", `Need at least ${this.rules.min_players} player(s) to start.`);
    }
    const unique = new Map(questions.map((q) => [q.id, q]));
    if (unique.size === 0) return fail("no_questions", "No questions were sent.");

    this.pool = [...unique.values()];
    this.used.clear();
    this.queue = [];
    this.questionNumber = 0;
    for (const p of this.players.values()) {
      p.score = 0;
      p.lastPoints = 0;
    }
    this.paused = false;
    this.beginCategoryVote();
    return ok(null);
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    if (!paused) this.autoPaused = false;
    if (paused) {
      this.paused = true;
      if (this.timer) {
        this.pausedRemainingMs = Math.max(0, this.timerEndsAt - Date.now());
        clearTimeout(this.timer);
        this.timer = null;
      }
    } else {
      this.paused = false;
      if (this.isTimedPhase()) this.schedule(this.pausedRemainingMs, false);
    }
    this.onChange();
  }

  /** End the current timed phase right now (host "next" button / debug). */
  skip(): void {
    if (!this.isTimedPhase()) return;
    this.paused = false;
    this.autoPaused = false;
    this.advance();
  }

  backToLobby(): void {
    this.clearTimer();
    this.phase = "lobby";
    this.paused = false;
    this.current = null;
    this.voteOptions = [];
    this.votes.clear();
    this.answers.clear();
    this.questionNumber = 0;
    for (const p of this.players.values()) {
      p.score = 0;
      p.lastPoints = 0;
    }
    this.onChange();
  }

  dispose(): void {
    this.clearTimer();
  }

  // ---- Player inputs ----

  vote(playerId: string, category: string): Result<null> {
    if (this.phase !== "category_vote" || this.paused) return fail("not_allowed", "Voting is closed.");
    if (!this.players.has(playerId)) return fail("not_allowed", "Not in this room.");
    if (!this.voteOptions.includes(category)) return fail("bad_message", "That category isn't on the ballot.");
    this.votes.set(playerId, category);
    this.onChange();
    this.endPhaseIfEveryoneActed();
    return ok(null);
  }

  answer(playerId: string, choice: number): Result<null> {
    if (this.phase !== "question" || this.paused || !this.current) return fail("not_allowed", "Answers are closed.");
    if (!this.players.has(playerId)) return fail("not_allowed", "Not in this room.");
    if (this.answers.has(playerId)) return fail("not_allowed", "Your answer is already locked in.");
    if (choice >= this.current.choices.length) return fail("bad_message", "No such choice.");
    this.answers.set(playerId, { choice, remainingMs: Math.max(0, this.timerEndsAt - Date.now()) });
    this.onChange();
    this.endPhaseIfEveryoneActed();
    return ok(null);
  }

  // ---- Phases ----

  private beginCategoryVote(): void {
    const remaining = this.pool.filter((q) => !this.used.has(q.id));
    const categories = [...new Set(remaining.map((q) => q.category))];
    if (categories.length === 0) {
      this.finish();
      return;
    }
    this.phase = "category_vote";
    this.voteOptions = shuffle(categories, this.rng).slice(0, this.rules.category_choices);
    this.votes.clear();
    this.voteWinner = null;
    this.current = null;
    this.schedule(this.rules.vote_seconds * 1000);
    this.onChange();
    // A single option needs no vote.
    if (this.voteOptions.length === 1) this.advance();
  }

  private beginQuestion(): void {
    const next = this.queue.shift();
    if (!next) {
      this.beginCategoryVote();
      return;
    }
    this.used.add(next.id);
    this.current = next;
    this.questionNumber++;
    this.answers.clear();
    for (const p of this.players.values()) p.lastPoints = 0;
    this.phase = "question";
    this.schedule(this.rules.question_seconds * 1000);
    this.onChange();
  }

  private beginReveal(): void {
    const question = this.current!;
    const durationMs = this.rules.question_seconds * 1000;
    for (const player of this.players.values()) {
      const answer = this.answers.get(player.id);
      const points = answer
        ? scoreAnswer(answer.choice === question.answer, answer.remainingMs, durationMs, this.rules)
        : 0;
      player.lastPoints = points;
      player.score += points;
    }
    this.phase = "reveal";
    this.schedule(this.rules.reveal_seconds * 1000);
    this.onChange();
  }

  private beginScoreboard(): void {
    if (this.rules.scoreboard_seconds <= 0) {
      this.afterScoreboard();
      return;
    }
    this.phase = "scoreboard";
    this.schedule(this.rules.scoreboard_seconds * 1000);
    this.onChange();
  }

  private afterScoreboard(): void {
    if (this.questionNumber >= this.rules.questions_per_game) {
      this.finish();
    } else if (this.queue.length > 0) {
      this.beginQuestion();
    } else {
      this.beginCategoryVote();
    }
  }

  private fillQueueFromVote(): void {
    const counts = new Map(this.voteOptions.map((id) => [id, 0]));
    for (const choice of this.votes.values()) counts.set(choice, (counts.get(choice) ?? 0) + 1);
    this.voteWinner = pickVoteWinner(counts, this.rng);

    const needed = Math.min(
      this.rules.questions_per_category,
      this.rules.questions_per_game - this.questionNumber,
    );
    const unused = this.pool.filter((q) => !this.used.has(q.id));
    const inCategory = shuffle(unused.filter((q) => q.category === this.voteWinner), this.rng);
    const others = shuffle(unused.filter((q) => q.category !== this.voteWinner), this.rng);
    this.queue = [...inCategory, ...others].slice(0, needed);
  }

  private finish(): void {
    this.clearTimer();
    this.phase = "game_over";
    this.current = null;
    this.onChange();
  }

  /** Called when a phase's timer runs out (or the host skips). */
  private advance(): void {
    this.clearTimer();
    switch (this.phase) {
      case "category_vote":
        this.fillQueueFromVote();
        if (this.queue.length === 0) this.finish();
        else this.beginQuestion();
        break;
      case "question":
        this.beginReveal();
        break;
      case "reveal":
        this.beginScoreboard();
        break;
      case "scoreboard":
        this.afterScoreboard();
        break;
      default:
        break;
    }
  }

  private endPhaseIfEveryoneActed(): void {
    if (!this.rules.end_phase_when_everyone_acted || this.paused) return;
    if (this.phase !== "category_vote" && this.phase !== "question") return;
    const active = [...this.players.values()].filter((p) => p.connected);
    if (active.length === 0) return;
    const acted = this.phase === "question" ? this.answers : this.votes;
    if (active.every((p) => acted.has(p.id))) this.advance();
  }

  private isTimedPhase(): boolean {
    return this.phase === "category_vote" || this.phase === "question" || this.phase === "reveal" || this.phase === "scoreboard";
  }

  private schedule(ms: number, resetDuration = true): void {
    this.clearTimer();
    if (resetDuration) this.timerDurationMs = ms;
    this.timerEndsAt = Date.now() + ms;
    if (this.paused) {
      this.pausedRemainingMs = ms;
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.advance();
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // ---- Views ----

  private ranks(): Map<string, number> {
    const sorted = [...this.players.values()].sort((a, b) => b.score - a.score);
    const ranks = new Map<string, number>();
    sorted.forEach((p, i) => {
      const prev = sorted[i - 1];
      ranks.set(p.id, prev && prev.score === p.score ? ranks.get(prev.id)! : i + 1);
    });
    return ranks;
  }

  /** The state a given viewer is allowed to see. Pass null for the host. */
  snapshotFor(playerId: string | null): StateMessage {
    const ranks = this.ranks();
    const acted = this.phase === "category_vote" ? this.votes : this.answers;
    const players: PlayerView[] = [...this.players.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        id: p.id,
        name: p.name,
        animal: p.animal,
        seat: p.seat,
        score: p.score,
        connected: p.connected,
        hasActed: (this.phase === "category_vote" || this.phase === "question" || this.phase === "reveal") && acted.has(p.id),
        lastPoints: p.lastPoints,
        rank: ranks.get(p.id) ?? 0,
      }));

    const timed = this.isTimedPhase();
    const remainingMs = this.paused ? this.pausedRemainingMs : Math.max(0, this.timerEndsAt - Date.now());

    const showQuestion = this.current && (this.phase === "question" || this.phase === "reveal");
    const counts = new Map(this.voteOptions.map((id) => [id, 0]));
    for (const choice of this.votes.values()) counts.set(choice, (counts.get(choice) ?? 0) + 1);

    const you = playerId ? this.players.get(playerId) : undefined;

    return {
      type: "state",
      code: this.code,
      phase: this.phase,
      paused: this.paused,
      hostConnected: this.hostConnected,
      players,
      timer: timed ? { durationMs: this.timerDurationMs, remainingMs } : null,
      questionNumber: this.questionNumber,
      questionCount: this.rules.questions_per_game,
      vote:
        this.phase === "category_vote"
          ? {
              categories: this.voteOptions.map((id) => ({ id, name: categoryName(id), votes: counts.get(id) ?? 0 })),
              winner: this.voteWinner,
            }
          : null,
      question: showQuestion
        ? {
            id: this.current!.id,
            category: this.current!.category,
            categoryName: categoryName(this.current!.category),
            difficulty: this.current!.difficulty,
            text: this.current!.question,
            choices: this.current!.choices,
          }
        : null,
      // The correct answer only ever leaves the server during the reveal.
      reveal:
        this.phase === "reveal" && this.current
          ? {
              correctIndex: this.current.answer,
              answers: Object.fromEntries(
                [...this.players.keys()].map((id) => [id, this.answers.get(id)?.choice ?? null]),
              ),
            }
          : null,
      you: you
        ? {
            playerId: you.id,
            answer: this.answers.get(you.id)?.choice ?? null,
            vote: this.votes.get(you.id) ?? null,
          }
        : null,
    };
  }
}
