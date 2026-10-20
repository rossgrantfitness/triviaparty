import { categoryName, type ClosestGuessQuestion, type ClosestView, type GameRules, type PlayerInput } from "@trivia/shared";
import { fail, ok, type Result } from "../util";
import { everyoneDone, type Player, type Round, type RoundContext } from "./types";

export interface ClosestResult {
  playerId: string;
  guess: number | null;
  distance: number | null;
  place: number | null;
  points: number;
}

/**
 * Rank guesses by distance from the answer. Ties share a place. Points go to the
 * top places (closest_points), plus a bonus for an exact hit. No guess, no points.
 */
export function rankGuesses(answer: number, guesses: Map<string, number>, playerIds: string[], rules: GameRules): ClosestResult[] {
  const scored = playerIds
    .filter((id) => guesses.has(id))
    .map((id) => ({ playerId: id, guess: guesses.get(id)!, distance: Math.abs(guesses.get(id)! - answer) }))
    .sort((a, b) => a.distance - b.distance);
  const results: ClosestResult[] = [];
  let place = 0;
  let previous: number | null = null;
  scored.forEach((s, i) => {
    if (previous === null || s.distance !== previous) place = i + 1;
    previous = s.distance;
    const base = rules.closest_points[place - 1] ?? 0;
    results.push({ ...s, place, points: base + (s.distance === 0 ? rules.closest_exact_bonus : 0) });
  });
  for (const id of playerIds) {
    if (!guesses.has(id)) results.push({ playerId: id, guess: null, distance: null, place: null, points: 0 });
  }
  return results;
}

/** Type a number; nearest guesses win. Nobody is ever fully out. */
export class ClosestRound implements Round {
  readonly kind = "closest" as const;
  step: "question" | "reveal" = "question";

  private queue: ClosestGuessQuestion[] = [];
  private current: ClosestGuessQuestion | null = null;
  private number = 0;
  private total = 0;
  private guesses = new Map<string, number>();
  private results: ClosestResult[] = [];

  constructor(private readonly ctx: RoundContext) {}

  start(): void {
    this.queue = this.ctx.content.takeClosest(this.ctx.rules.closest_questions);
    this.total = this.queue.length;
    this.next();
  }

  private next(): void {
    const q = this.queue.shift();
    if (!q) return this.ctx.finish();
    this.current = q;
    this.number++;
    this.guesses.clear();
    this.results = [];
    this.step = "question";
    this.ctx.schedule(this.ctx.rules.closest_seconds * 1000, () => this.reveal());
    this.ctx.changed();
  }

  private reveal(): void {
    const q = this.current!;
    this.results = rankGuesses(q.answer, this.guesses, this.ctx.players().map((p) => p.id), this.ctx.rules);
    this.ctx.newScoringMoment();
    for (const r of this.results) if (r.points > 0) this.ctx.award(r.playerId, r.points);
    this.step = "reveal";
    // A little longer than a normal reveal: there's a number line to read.
    this.ctx.schedule((this.ctx.rules.reveal_seconds + 2) * 1000, () => this.next());
    this.ctx.changed();
  }

  input(player: Player, message: PlayerInput): Result<null> {
    if (message.type !== "guess") return fail("not_allowed", "Type a number for this one.");
    if (this.step !== "question") return fail("not_allowed", "Guesses are closed.");
    if (this.guesses.has(player.id)) return fail("not_allowed", "Your guess is already locked in.");
    this.guesses.set(player.id, message.value);
    this.ctx.changed();
    this.playersChanged();
    return ok(null);
  }

  hasActed(playerId: string): boolean {
    return this.guesses.has(playerId);
  }

  playersChanged(): void {
    if (this.ctx.rules.end_phase_when_everyone_acted && this.step === "question" && everyoneDone(this.ctx.players(), this.guesses)) {
      this.reveal();
    }
  }

  skip(): void {
    if (this.step === "question") this.reveal();
    else this.next();
  }

  view(viewerId: string | null): ClosestView {
    const q = this.current!;
    return {
      kind: "closest",
      step: this.step,
      questionNumber: this.number,
      questionCount: this.total,
      question: { id: q.id, category: q.category, categoryName: categoryName(q.category), text: q.question, unit: q.unit ?? null },
      reveal: this.step === "reveal" ? { answer: q.answer, fact: q.fact ?? null, results: this.results } : null,
      me: viewerId ? { guess: this.guesses.get(viewerId) ?? null } : null,
    };
  }
}
