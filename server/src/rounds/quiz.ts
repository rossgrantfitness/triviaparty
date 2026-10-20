import {
  categoryName,
  type MultipleChoiceQuestion,
  type PlayerInput,
  type QuizKind,
  type QuizStep,
  type QuizView,
} from "@trivia/shared";
import { fail, ok, pickVoteWinner, scoreAnswer, shuffle, type Result } from "../util";
import { everyoneDone, type Player, type Round, type RoundContext } from "./types";

/**
 * Multiple-choice rounds:
 *   classic: vote on a category, then answer fast (speed bonus).
 *   wager:   vote, then for each question: see the category, bet, answer. Win or lose the bet.
 *   steal:   like classic, and right answers pick someone to steal points from.
 *   final:   one hard question; everyone bets as much as they dare.
 */
export class QuizRound implements Round {
  step: QuizStep = "vote";

  private queue: MultipleChoiceQuestion[] = [];
  private current: MultipleChoiceQuestion | null = null;
  private number = 0;
  private total: number;
  private category: string | null = null;

  private voteOptions: string[] = [];
  private votes = new Map<string, string>();
  private wagers = new Map<string, number>();
  private answers = new Map<string, { choice: number; remainingMs: number }>();
  private stealTargets = new Map<string, string>();
  private steals: { thief: string; victim: string; amount: number }[] = [];

  constructor(
    readonly kind: QuizKind,
    private readonly ctx: RoundContext,
  ) {
    const r = ctx.rules;
    this.total = kind === "final" ? 1 : kind === "wager" ? r.wager_questions : kind === "steal" ? r.steal_questions : r.classic_questions;
  }

  private get usesWager(): boolean {
    return this.kind === "wager" || this.kind === "final";
  }

  start(): void {
    if (this.kind === "final") {
      const hardest = this.ctx.content.takeHardest();
      if (!hardest) return this.ctx.finish();
      this.queue = [hardest];
      this.category = hardest.category;
      this.nextQuestion();
      return;
    }
    this.beginVote();
  }

  // ---- Steps ----

  private beginVote(): void {
    const categories = this.ctx.content.categories(1);
    if (categories.length === 0) return this.ctx.finish();
    this.voteOptions = shuffle(categories, this.ctx.rng).slice(0, this.ctx.rules.category_choices);
    this.votes.clear();
    if (this.voteOptions.length === 1) return this.endVote();
    this.step = "vote";
    this.ctx.schedule(this.ctx.rules.vote_seconds * 1000, () => this.endVote());
    this.ctx.changed();
  }

  private endVote(): void {
    const counts = new Map(this.voteOptions.map((id) => [id, 0]));
    for (const choice of this.votes.values()) counts.set(choice, (counts.get(choice) ?? 0) + 1);
    this.category = pickVoteWinner(counts, this.ctx.rng);
    this.queue = this.ctx.content.takeMultipleChoice(this.category, this.total);
    this.total = this.queue.length;
    this.nextQuestion();
  }

  private nextQuestion(): void {
    const next = this.queue.shift();
    if (!next) return this.ctx.finish();
    this.current = next;
    this.number++;
    this.answers.clear();
    this.wagers.clear();
    this.stealTargets.clear();
    this.steals = [];
    if (this.usesWager) {
      this.category = next.category;
      this.step = "wager";
      const seconds = this.kind === "final" ? this.ctx.rules.final_wager_seconds : this.ctx.rules.wager_seconds;
      this.ctx.schedule(seconds * 1000, () => this.beginQuestion());
      this.ctx.changed();
      return;
    }
    this.beginQuestion();
  }

  private beginQuestion(): void {
    this.step = "question";
    const seconds = this.kind === "final" ? this.ctx.rules.final_question_seconds : this.ctx.rules.question_seconds;
    this.ctx.schedule(seconds * 1000, () => this.beginReveal());
    this.ctx.changed();
  }

  private beginReveal(): void {
    const question = this.current!;
    const r = this.ctx.rules;
    const durationMs = (this.kind === "final" ? r.final_question_seconds : r.question_seconds) * 1000;
    this.ctx.newScoringMoment();
    for (const player of this.ctx.players()) {
      const answer = this.answers.get(player.id);
      const correct = answer?.choice === question.answer;
      if (this.usesWager) {
        const bet = this.wagers.get(player.id) ?? 0;
        if (bet > 0) this.ctx.award(player.id, correct ? bet : -bet);
      } else if (answer) {
        this.ctx.award(player.id, scoreAnswer(correct, answer.remainingMs, durationMs, r));
      }
    }
    this.step = "reveal";
    this.ctx.schedule(r.reveal_seconds * 1000, () => this.afterReveal());
    this.ctx.changed();
  }

  private afterReveal(): void {
    if (this.kind === "steal" && this.thieves().length > 0 && this.ctx.players().length > 1) {
      this.step = "steal";
      this.ctx.schedule(this.ctx.rules.steal_seconds * 1000, () => this.resolveSteals());
      this.ctx.changed();
      return;
    }
    this.nextQuestion();
  }

  private resolveSteals(): void {
    this.ctx.newScoringMoment();
    this.steals = [];
    for (const thief of this.thieves()) {
      const target = this.stealTargets.get(thief.id) ?? this.leaderOtherThan(thief.id)?.id;
      if (!target || !this.ctx.player(target)) continue;
      const taken = -this.ctx.award(target, -this.ctx.rules.steal_points);
      if (taken > 0) this.ctx.award(thief.id, taken);
      this.steals.push({ thief: thief.id, victim: target, amount: taken });
    }
    this.step = "steal_reveal";
    this.ctx.schedule(this.ctx.rules.reveal_seconds * 1000, () => this.nextQuestion());
    this.ctx.changed();
  }

  private thieves(): Player[] {
    const answer = this.current?.answer;
    return this.ctx.players().filter((p) => this.answers.get(p.id)?.choice === answer);
  }

  private leaderOtherThan(id: string): Player | undefined {
    return this.ctx
      .players()
      .filter((p) => p.id !== id)
      .sort((a, b) => b.score - a.score)[0];
  }

  maxWager(player: Player): number {
    return Math.max(player.score, this.ctx.rules.wager_floor);
  }

  // ---- Inputs ----

  input(player: Player, message: PlayerInput): Result<null> {
    switch (message.type) {
      case "vote":
        if (this.step !== "vote") return fail("not_allowed", "Voting is closed.");
        if (!this.voteOptions.includes(message.category)) return fail("bad_message", "That category isn't on the ballot.");
        this.votes.set(player.id, message.category);
        break;
      case "wager": {
        if (this.step !== "wager") return fail("not_allowed", "Betting is closed.");
        if (this.wagers.has(player.id)) return fail("not_allowed", "Your bet is already in.");
        this.wagers.set(player.id, Math.min(message.amount, this.maxWager(player)));
        break;
      }
      case "answer": {
        if (this.step !== "question" || !this.current) return fail("not_allowed", "Answers are closed.");
        if (this.answers.has(player.id)) return fail("not_allowed", "Your answer is already locked in.");
        if (message.choice >= this.current.choices.length) return fail("bad_message", "No such choice.");
        this.answers.set(player.id, { choice: message.choice, remainingMs: this.ctx.timeLeftMs() });
        break;
      }
      case "steal": {
        if (this.step !== "steal") return fail("not_allowed", "No stealing right now.");
        if (!this.thieves().some((p) => p.id === player.id)) return fail("not_allowed", "Only right answers can steal.");
        if (message.target === player.id) return fail("not_allowed", "You can't steal from yourself!");
        if (!this.ctx.player(message.target)) return fail("bad_message", "That player isn't here.");
        if (this.stealTargets.has(player.id)) return fail("not_allowed", "You already picked.");
        this.stealTargets.set(player.id, message.target);
        break;
      }
      default:
        return fail("not_allowed", "That doesn't do anything right now.");
    }
    this.ctx.changed();
    this.playersChanged();
    return ok(null);
  }

  private actedSet(): { has(id: string): boolean } {
    switch (this.step) {
      case "vote":
        return this.votes;
      case "wager":
        return this.wagers;
      case "question":
      case "reveal":
        return this.answers;
      case "steal":
        return this.stealTargets;
      default:
        return new Set<string>();
    }
  }

  hasActed(playerId: string): boolean {
    return this.actedSet().has(playerId);
  }

  playersChanged(): void {
    if (!this.ctx.rules.end_phase_when_everyone_acted) return;
    const players = this.ctx.players();
    if (this.step === "vote" && everyoneDone(players, this.votes)) this.endVote();
    else if (this.step === "wager" && everyoneDone(players, this.wagers)) this.beginQuestion();
    else if (this.step === "question" && everyoneDone(players, this.answers)) this.beginReveal();
    else if (this.step === "steal" && everyoneDone(this.thieves(), this.stealTargets)) this.resolveSteals();
  }

  skip(): void {
    switch (this.step) {
      case "vote":
        return this.endVote();
      case "wager":
        return this.beginQuestion();
      case "question":
        return this.beginReveal();
      case "reveal":
        return this.afterReveal();
      case "steal":
        return this.resolveSteals();
      case "steal_reveal":
        return this.nextQuestion();
    }
  }

  // ---- View ----

  view(viewerId: string | null): QuizView {
    const q = this.current;
    const showQuestion = q && (this.step === "question" || this.step === "reveal" || this.step === "steal" || this.step === "steal_reveal");
    const revealed = q && (this.step === "reveal" || this.step === "steal" || this.step === "steal_reveal");
    const counts = new Map(this.voteOptions.map((id) => [id, 0]));
    for (const choice of this.votes.values()) counts.set(choice, (counts.get(choice) ?? 0) + 1);
    const me = viewerId ? this.ctx.player(viewerId) : undefined;
    return {
      kind: this.kind,
      step: this.step,
      questionNumber: this.number,
      questionCount: this.total,
      category: this.category ? { id: this.category, name: categoryName(this.category) } : null,
      vote:
        this.step === "vote"
          ? { categories: this.voteOptions.map((id) => ({ id, name: categoryName(id), votes: counts.get(id) ?? 0 })) }
          : null,
      question: showQuestion
        ? {
            id: q.id,
            category: q.category,
            categoryName: categoryName(q.category),
            difficulty: q.difficulty,
            text: q.question,
            choices: q.choices,
          }
        : null,
      // The correct answer only ever leaves the server from the reveal on.
      reveal: revealed
        ? {
            correctIndex: q.answer,
            answers: Object.fromEntries(this.ctx.players().map((p) => [p.id, this.answers.get(p.id)?.choice ?? null])),
            fact: q.fact ?? null,
          }
        : null,
      wagers: this.usesWager && revealed ? Object.fromEntries(this.wagers) : null,
      steals: this.step === "steal_reveal" ? this.steals : null,
      me: me
        ? {
            answer: this.answers.get(me.id)?.choice ?? null,
            vote: this.votes.get(me.id) ?? null,
            wager: this.wagers.get(me.id) ?? null,
            maxWager: this.maxWager(me),
            canSteal: this.step === "steal" && this.thieves().some((p) => p.id === me.id),
            stealTarget: this.stealTargets.get(me.id) ?? null,
          }
        : null,
    };
  }
}
