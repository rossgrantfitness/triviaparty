import {
  MAX_LIE_LENGTH,
  normalizeTitle,
  type DrawingRevealItem,
  type DrawingView,
  type GameRules,
  type PlayerInput,
  type Stroke,
} from "@trivia/shared";
import { cleanText, fail, ok, shuffle, type Result } from "../util";
import { everyoneDone, type Player, type Round, type RoundContext } from "./types";

interface Artwork {
  artistId: string;
  prompt: string;
  strokes: Stroke[] | null;
}

interface Option {
  id: string;
  text: string;
  truth: boolean;
  authors: string[];
}

/**
 * Score one drawing (Drawful-style):
 *   spotting the real title: draw_truth_points to the guesser,
 *                            plus draw_artist_points to the artist per correct guesser;
 *   fooling someone with your lie: draw_fool_points per player fooled.
 */
export function scoreDrawing(artistId: string, options: Option[], picks: Map<string, string>, rules: GameRules): Map<string, number> {
  const points = new Map<string, number>();
  const add = (id: string, n: number) => points.set(id, (points.get(id) ?? 0) + n);
  const byId = new Map(options.map((o) => [o.id, o]));
  for (const [picker, optionId] of picks) {
    const option = byId.get(optionId);
    if (!option) continue;
    if (option.truth) {
      add(picker, rules.draw_truth_points);
      add(artistId, rules.draw_artist_points);
    } else {
      for (const author of option.authors) add(author, rules.draw_fool_points);
    }
  }
  return points;
}

/** Doodle Duel: draw a secret prompt, then fake titles for each drawing, then spot the real one. */
export class DrawingRound implements Round {
  readonly kind = "drawing" as const;
  step: "drawing" | "lying" | "picking" | "reveal" = "drawing";

  private artworks: Artwork[] = [];
  private judged: Artwork[] = [];
  private index = -1;
  private lies = new Map<string, string>();
  private options: Option[] = [];
  private picks = new Map<string, string>();
  private revealItems: DrawingRevealItem[] = [];
  private shown = 0;

  constructor(private readonly ctx: RoundContext) {}

  private get current(): Artwork | undefined {
    return this.judged[this.index];
  }

  start(): void {
    const r = this.ctx.rules;
    // Fair turns: whoever has drawn least goes first; ties broken at random.
    const artists = shuffle(this.ctx.players(), this.ctx.rng)
      .sort((a, b) => a.drawings - b.drawings)
      .slice(0, r.drawings_per_round);
    const prompts = this.ctx.content.takePrompts(artists.length);
    if (prompts.length === 0) return this.ctx.finish();
    this.artworks = artists.slice(0, prompts.length).map((p, i) => ({ artistId: p.id, prompt: prompts[i]!.prompt, strokes: null }));
    for (const art of this.artworks) {
      const player = this.ctx.player(art.artistId);
      if (player) player.drawings++;
    }
    this.step = "drawing";
    this.ctx.schedule(r.drawing_seconds * 1000, () => this.endDrawing());
    this.ctx.changed();
  }

  private endDrawing(): void {
    this.judged = shuffle(
      this.artworks.filter((a) => a.strokes && a.strokes.length > 0),
      this.ctx.rng,
    );
    this.index = -1;
    this.nextDrawing();
  }

  private nextDrawing(): void {
    this.index++;
    if (!this.current) return this.ctx.finish();
    this.lies.clear();
    this.picks.clear();
    this.options = [];
    this.revealItems = [];
    this.step = "lying";
    if (this.judges().length === 0) return this.beginPicking();
    this.ctx.schedule(this.ctx.rules.lie_seconds * 1000, () => this.beginPicking());
    this.ctx.changed();
  }

  /** Everyone except the artist of the drawing on screen. */
  private judges(): Player[] {
    const artist = this.current?.artistId;
    return this.ctx.players().filter((p) => p.id !== artist);
  }

  private beginPicking(): void {
    const art = this.current!;
    const options: Omit<Option, "id">[] = [{ text: art.prompt, truth: true, authors: [] }];
    for (const [author, text] of this.lies) options.push({ text, truth: false, authors: [author] });
    const taken = new Set(options.map((o) => normalizeTitle(o.text)));
    const missing = this.ctx.rules.drawing_min_options - options.length;
    if (missing > 0) {
      for (const decoy of this.ctx.content.decoys(missing, taken)) options.push({ text: decoy, truth: false, authors: [] });
    }
    this.options = shuffle(options, this.ctx.rng).map((o, i) => ({ ...o, id: `o${i + 1}` }));
    this.step = "picking";
    if (this.judges().length === 0) return this.beginReveal();
    this.ctx.schedule(this.ctx.rules.pick_seconds * 1000, () => this.beginReveal());
    this.ctx.changed();
  }

  private beginReveal(): void {
    const art = this.current!;
    const points = scoreDrawing(art.artistId, this.options, this.picks, this.ctx.rules);
    this.ctx.newScoringMoment();
    for (const [id, n] of points) this.ctx.award(id, n);

    const pickersOf = (o: Option) => [...this.picks].filter(([, id]) => id === o.id).map(([picker]) => picker);
    const lies = this.options
      .filter((o) => !o.truth && pickersOf(o).length > 0)
      .sort((a, b) => pickersOf(a).length - pickersOf(b).length);
    const truth = this.options.find((o) => o.truth)!;
    this.revealItems = [...lies, truth].map((o) => ({
      optionId: o.id,
      text: o.text,
      truth: o.truth,
      authors: o.authors,
      pickers: pickersOf(o),
    }));
    this.step = "reveal";
    this.shown = 1;
    this.scheduleRevealStep();
    this.ctx.changed();
  }

  /** The TV reveals one option at a time (fakes first, real title last), then a beat to read the scores. */
  private scheduleRevealStep(): void {
    this.ctx.schedule(this.ctx.rules.drawing_reveal_step_seconds * 1000, () => {
      if (this.shown >= this.revealItems.length + 1) return this.nextDrawing();
      this.shown++;
      this.scheduleRevealStep();
      this.ctx.changed();
    });
  }

  private shownCount(): number {
    return Math.min(this.revealItems.length, this.shown);
  }

  // ---- Inputs ----

  input(player: Player, message: PlayerInput): Result<null> {
    switch (message.type) {
      case "drawing": {
        if (this.step !== "drawing") return fail("not_allowed", "Drawing time is over.");
        const art = this.artworks.find((a) => a.artistId === player.id);
        if (!art) return fail("not_allowed", "You're a judge this round. Sit back and watch!");
        if (art.strokes) return fail("not_allowed", "Your drawing is already in.");
        art.strokes = message.strokes;
        break;
      }
      case "lie": {
        if (this.step !== "lying" || !this.current) return fail("not_allowed", "Too late for fibbing!");
        if (this.current.artistId === player.id) return fail("not_allowed", "That's your drawing! Let the others guess.");
        if (this.lies.has(player.id)) return fail("not_allowed", "Your fake title is already in.");
        const text = cleanText(message.text, MAX_LIE_LENGTH);
        if (!text) return fail("bad_message", "Write a fake title first.");
        const key = normalizeTitle(text);
        if (key === normalizeTitle(this.current.prompt)) {
          return fail("too_close", "Whoa, that's the real title! Write a fake one instead.");
        }
        if ([...this.lies.values()].some((l) => normalizeTitle(l) === key)) {
          return fail("duplicate", "Someone already wrote that. Try a different one!");
        }
        this.lies.set(player.id, text);
        break;
      }
      case "pick": {
        if (this.step !== "picking" || !this.current) return fail("not_allowed", "Picking is closed.");
        if (this.current.artistId === player.id) return fail("not_allowed", "That's your drawing!");
        if (this.picks.has(player.id)) return fail("not_allowed", "Your pick is locked in.");
        const option = this.options.find((o) => o.id === message.option);
        if (!option) return fail("bad_message", "That option isn't on the list.");
        if (option.authors.includes(player.id)) return fail("not_allowed", "That's your own fake! Pick the one you think is real.");
        this.picks.set(player.id, option.id);
        break;
      }
      default:
        return fail("not_allowed", "That doesn't do anything right now.");
    }
    this.ctx.changed();
    this.playersChanged();
    return ok(null);
  }

  hasActed(playerId: string): boolean {
    switch (this.step) {
      case "drawing":
        return this.artworks.some((a) => a.artistId === playerId && a.strokes !== null);
      case "lying":
        return this.lies.has(playerId);
      case "picking":
      case "reveal":
        return this.picks.has(playerId);
    }
  }

  playersChanged(): void {
    if (!this.ctx.rules.end_phase_when_everyone_acted) return;
    if (this.step === "drawing") {
      const artists = this.artworks.map((a) => this.ctx.player(a.artistId)).filter((p): p is Player => !!p);
      const done = new Set(this.artworks.filter((a) => a.strokes).map((a) => a.artistId));
      if (everyoneDone(artists, done)) this.endDrawing();
    } else if (this.step === "lying" && everyoneDone(this.judges(), this.lies)) {
      this.beginPicking();
    } else if (this.step === "picking" && everyoneDone(this.judges(), this.picks)) {
      this.beginReveal();
    }
  }

  skip(): void {
    switch (this.step) {
      case "drawing":
        return this.endDrawing();
      case "lying":
        return this.beginPicking();
      case "picking":
        return this.beginReveal();
      case "reveal":
        if (this.shown < this.revealItems.length) {
          this.shown = this.revealItems.length;
          this.scheduleRevealStep();
          return this.ctx.changed();
        }
        return this.nextDrawing();
    }
  }

  // ---- View ----

  view(viewerId: string | null): DrawingView {
    const art = this.step === "drawing" ? undefined : this.current;
    const mine = viewerId ? this.artworks.find((a) => a.artistId === viewerId) : undefined;
    return {
      kind: "drawing",
      step: this.step,
      drawingNumber: this.step === "drawing" ? 0 : this.index + 1,
      drawingCount: this.step === "drawing" ? this.artworks.length : this.judged.length,
      artistIds: this.artworks.map((a) => a.artistId),
      artistId: art?.artistId ?? null,
      strokes: art?.strokes ?? null,
      // The real title hides among the options; nothing marks it until the reveal.
      options: this.step === "picking" || this.step === "reveal" ? this.options.map((o) => ({ id: o.id, text: o.text })) : null,
      reveal: this.step === "reveal" ? { items: this.revealItems, shown: this.shownCount() } : null,
      me: viewerId
        ? {
            prompt: this.step === "drawing" && mine ? mine.prompt : null,
            isArtist: this.step === "drawing" ? !!mine : art?.artistId === viewerId,
            submitted: this.step === "drawing" ? !!mine?.strokes : this.hasActed(viewerId),
            lie: this.lies.get(viewerId) ?? null,
            pick: this.picks.get(viewerId) ?? null,
          }
        : null,
    };
  }
}
