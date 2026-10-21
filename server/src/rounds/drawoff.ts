import type { DrawOffView, GameRules, PlayerInput, Stroke } from "@trivia/shared";
import { fail, ok, shuffle, type Result } from "../util";
import { everyoneDone, type Player, type Round, type RoundContext } from "./types";

interface Entry {
  id: string;
  number: number;
  artistId: string;
  strokes: Stroke[];
}

/**
 * Draw-Off scoring: draw-off_vote_points for every vote your drawing gets,
 * plus a bonus for the drawing(s) with the most votes (ties all win).
 */
export function scoreDrawOff(entries: { id: string; artistId: string }[], votes: Map<string, string>, rules: GameRules): Map<string, number> {
  const counts = new Map(entries.map((e) => [e.id, 0]));
  for (const id of votes.values()) if (counts.has(id)) counts.set(id, counts.get(id)! + 1);
  const best = Math.max(0, ...counts.values());
  const points = new Map<string, number>();
  for (const e of entries) {
    const n = counts.get(e.id) ?? 0;
    const total = n * rules.drawoff_vote_points + (best > 0 && n === best ? rules.drawoff_winner_bonus : 0);
    if (total > 0) points.set(e.artistId, (points.get(e.artistId) ?? 0) + total);
  }
  return points;
}

/** Everyone draws the same prompt, then the room votes for its favorite. */
export class DrawOffRound implements Round {
  readonly kind = "drawoff" as const;
  step: "drawing" | "voting" | "reveal" = "drawing";

  private prompt = "";
  private drawings = new Map<string, Stroke[]>();
  private entries: Entry[] = [];
  private votes = new Map<string, string>();
  private counts = new Map<string, number>();

  constructor(private readonly ctx: RoundContext) {}

  start(): void {
    const [prompt] = this.ctx.content.takePrompts(1);
    if (!prompt) return this.ctx.finish();
    this.prompt = prompt.prompt;
    this.step = "drawing";
    this.ctx.schedule(this.ctx.rules.drawing_seconds * 1000, () => this.beginVoting());
    this.ctx.changed();
  }

  private beginVoting(): void {
    const finished = [...this.drawings].filter(([id, strokes]) => strokes.length > 0 && this.ctx.player(id));
    this.entries = shuffle(finished, this.ctx.rng).map(([artistId, strokes], i) => ({ id: `d${i + 1}`, number: i + 1, artistId, strokes }));
    // Nothing to vote on with fewer than two drawings.
    if (this.entries.length < 2) return this.beginReveal();
    this.votes.clear();
    this.step = "voting";
    this.ctx.schedule(this.ctx.rules.drawoff_vote_seconds * 1000, () => this.beginReveal());
    this.ctx.changed();
  }

  private beginReveal(): void {
    this.counts = new Map(this.entries.map((e) => [e.id, 0]));
    for (const id of this.votes.values()) this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
    this.ctx.newScoringMoment();
    for (const [playerId, points] of scoreDrawOff(this.entries, this.votes, this.ctx.rules)) this.ctx.award(playerId, points);
    this.step = "reveal";
    this.ctx.schedule((this.ctx.rules.reveal_seconds + 3) * 1000, () => this.ctx.finish());
    this.ctx.changed();
  }

  /** Who can vote: everyone with something to vote for besides their own drawing. */
  private voters(): Player[] {
    return this.ctx.players().filter((p) => this.entries.some((e) => e.artistId !== p.id));
  }

  input(player: Player, message: PlayerInput): Result<null> {
    if (message.type === "drawing") {
      if (this.step !== "drawing") return fail("not_allowed", "Pens down! Drawing time is over.");
      if (this.drawings.has(player.id)) return fail("not_allowed", "Your drawing is already in.");
      this.drawings.set(player.id, message.strokes);
    } else if (message.type === "vote_drawing") {
      if (this.step !== "voting") return fail("not_allowed", "Voting is closed.");
      const entry = this.entries.find((e) => e.id === message.drawing);
      if (!entry) return fail("bad_message", "No such drawing.");
      if (entry.artistId === player.id) return fail("not_allowed", "Nice try! You can't vote for your own drawing.");
      if (this.votes.has(player.id)) return fail("not_allowed", "Your vote is in.");
      this.votes.set(player.id, entry.id);
    } else {
      return fail("not_allowed", "That doesn't do anything right now.");
    }
    this.ctx.changed();
    this.playersChanged();
    return ok(null);
  }

  hasActed(playerId: string): boolean {
    return this.step === "drawing" ? this.drawings.has(playerId) : this.votes.has(playerId);
  }

  playersChanged(): void {
    if (!this.ctx.rules.end_phase_when_everyone_acted) return;
    if (this.step === "drawing" && everyoneDone(this.ctx.players(), this.drawings)) this.beginVoting();
    else if (this.step === "voting" && everyoneDone(this.voters(), this.votes)) this.beginReveal();
  }

  skip(): void {
    if (this.step === "drawing") this.beginVoting();
    else if (this.step === "voting") this.beginReveal();
    else this.ctx.finish();
  }

  view(viewerId: string | null): DrawOffView {
    const reveal = this.step === "reveal";
    const own = viewerId ? this.entries.find((e) => e.artistId === viewerId) : undefined;
    const gallery = this.entries.map((e) => ({
      id: e.id,
      number: e.number,
      // Phones vote by number; only the TV gets the actual drawings.
      strokes: viewerId === null ? e.strokes : null,
      artistId: reveal ? e.artistId : null,
      votes: reveal ? (this.counts.get(e.id) ?? 0) : null,
    }));
    if (reveal) gallery.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));
    return {
      kind: "drawoff",
      step: this.step,
      prompt: this.prompt,
      gallery,
      me: viewerId
        ? { submitted: this.drawings.has(viewerId), vote: this.votes.get(viewerId) ?? null, ownDrawing: own?.id ?? null }
        : null,
    };
  }
}
