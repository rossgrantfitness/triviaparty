import {
  normalizeTitle,
  type ClosestGuessQuestion,
  type DrawingPrompt,
  type MultipleChoiceQuestion,
  type Question,
} from "@trivia/shared";
import { shuffle } from "./util";

/**
 * This session's questions and prompts. Hands each one out at most once per game
 * (prompts are reused only if the pack runs out).
 */
export class ContentPool {
  private mc: MultipleChoiceQuestion[];
  private closest: ClosestGuessQuestion[];
  private prompts: DrawingPrompt[];
  private used = new Set<string>();
  private usedPrompts = new Set<string>();

  constructor(
    questions: Question[],
    prompts: DrawingPrompt[],
    private readonly decoyPool: string[],
    private readonly rng: () => number,
    categories: string[] = [],
  ) {
    const unique = [...new Map(questions.map((q) => [q.id, q])).values()];
    const allowed = (q: Question) => categories.length === 0 || categories.includes(q.category);
    this.mc = unique.filter((q): q is MultipleChoiceQuestion => q.type === "multiple_choice" && allowed(q));
    this.closest = unique.filter((q): q is ClosestGuessQuestion => q.type === "closest_guess" && allowed(q));
    // If the category filter leaves nothing, fall back to everything rather than an empty game.
    if (this.mc.length === 0) this.mc = unique.filter((q): q is MultipleChoiceQuestion => q.type === "multiple_choice");
    if (this.closest.length === 0) this.closest = unique.filter((q): q is ClosestGuessQuestion => q.type === "closest_guess");
    this.prompts = [...new Map(prompts.map((p) => [p.id, p])).values()];
  }

  get multipleChoiceCount(): number {
    return this.mc.length;
  }

  get closestCount(): number {
    return this.closest.length;
  }

  get promptCount(): number {
    return this.prompts.length;
  }

  /** Categories that still have at least `min` unused multiple-choice questions. */
  categories(min = 1): string[] {
    const counts = new Map<string, number>();
    for (const q of this.mc) if (!this.used.has(q.id)) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
    return [...counts].filter(([, n]) => n >= min).map(([c]) => c);
  }

  /** Up to n unused multiple-choice questions, from `category` first, then anything. */
  takeMultipleChoice(category: string | null, n: number): MultipleChoiceQuestion[] {
    const unused = this.mc.filter((q) => !this.used.has(q.id));
    const first = shuffle(unused.filter((q) => q.category === category), this.rng);
    const rest = shuffle(unused.filter((q) => q.category !== category), this.rng);
    return this.mark([...first, ...rest].slice(0, n));
  }

  /** One of the hardest unused questions, for the final. */
  takeHardest(): MultipleChoiceQuestion | undefined {
    const unused = this.mc.filter((q) => !this.used.has(q.id));
    if (unused.length === 0) return undefined;
    const top = Math.max(...unused.map((q) => q.difficulty));
    const hard = unused.filter((q) => q.difficulty >= Math.min(top, 4));
    return this.mark([hard[Math.floor(this.rng() * hard.length)]!])[0];
  }

  takeClosest(n: number): ClosestGuessQuestion[] {
    return this.mark(shuffle(this.closest.filter((q) => !this.used.has(q.id)), this.rng).slice(0, n));
  }

  takePrompts(n: number): DrawingPrompt[] {
    let fresh = shuffle(this.prompts.filter((p) => !this.usedPrompts.has(p.id)), this.rng);
    if (fresh.length < n) {
      this.usedPrompts.clear();
      fresh = shuffle(this.prompts, this.rng);
    }
    const picked = fresh.slice(0, n);
    for (const p of picked) this.usedPrompts.add(p.id);
    return picked;
  }

  /** House lies that don't clash with anything already on screen. */
  decoys(n: number, taken: Set<string>): string[] {
    return shuffle(this.decoyPool, this.rng)
      .filter((d) => !taken.has(normalizeTitle(d)))
      .slice(0, n);
  }

  private mark<T extends Question>(questions: T[]): T[] {
    for (const q of questions) this.used.add(q.id);
    return questions;
  }
}
