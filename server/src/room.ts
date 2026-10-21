import { randomUUID } from "node:crypto";
import {
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  ROUND_INFO,
  resolveRules,
  type Accessory,
  type Animal,
  type GameRules,
  type Phase,
  type PlayerInput,
  type PlayerView,
  type RoundKind,
  type StartGameMessage,
  type StateMessage,
  type Stroke,
} from "@trivia/shared";
import { ContentPool } from "./content";
import { ClosestRound } from "./rounds/closest";
import { DrawingRound } from "./rounds/drawing";
import { DrawOffRound } from "./rounds/drawoff";
import { QuizRound } from "./rounds/quiz";
import type { Player, Round, RoundContext } from "./rounds/types";
import { cleanName, fail, ok, type Result } from "./util";

export type { Player } from "./rounds/types";
export { cleanName, pickVoteWinner, scoreAnswer, type Result } from "./util";

/** Which rounds this session plays, given the plan for the chosen length and what content exists. */
export function buildPlan(plan: RoundKind[], options: { drawing: boolean; content: ContentPool }): RoundKind[] {
  const { content } = options;
  return plan.filter((kind) => {
    if (kind === "drawing" || kind === "drawoff") return options.drawing && content.promptCount > 0;
    if (kind === "closest") return content.closestCount > 0;
    return content.multipleChoiceCount > 0;
  });
}

/**
 * One game room: its players, the session plan, the current round and the one timer.
 * Owns all game state. Calls onChange whenever anything visible changes so the server can broadcast.
 */
export class Room {
  readonly hostToken = randomUUID();
  hostConnected = true;
  phase: Phase = "lobby";
  paused = false;

  private players = new Map<string, Player>();
  private rules: GameRules = resolveRules({}, MAX_PLAYERS);
  private content: ContentPool = new ContentPool([], [], [], Math.random);
  private plan: RoundKind[] = [];
  private roundIndex = 0;
  private round: Round | null = null;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerDurationMs = 0;
  private timerEndsAt = 0;
  private timerCallback: (() => void) | null = null;
  private pausedRemainingMs = 0;
  private autoPaused = false;

  constructor(
    readonly code: string,
    private readonly onChange: () => void,
    private readonly rng: () => number = Math.random,
  ) {}

  // ---- Players ----

  join(rawName: string, animal: Animal, token?: string, accessory: Accessory = "none"): Result<Player> {
    if (token) {
      const existing = [...this.players.values()].find((p) => p.token === token);
      if (existing) {
        existing.connected = true;
        if (this.phase === "lobby") {
          existing.animal = animal;
          existing.accessory = accessory;
        }
        this.onChange();
        return ok(existing);
      }
    }
    const name = cleanName(rawName);
    if (!name) return fail("bad_name", "Please enter a name (letters, not just emoji).");
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
      roundPoints: 0,
      drawings: 0,
      accessory,
      avatar: null,
      lastEmoteAt: 0,
    };
    this.players.set(player.id, player);
    this.onChange();
    this.round?.playersChanged();
    return ok(player);
  }

  setPlayerConnected(playerId: string, connected: boolean): void {
    const player = this.players.get(playerId);
    if (!player || player.connected === connected) return;
    player.connected = connected;
    this.onChange();
    if (!connected && !this.paused) this.round?.playersChanged();
  }

  kick(playerId: string): boolean {
    if (!this.players.delete(playerId)) return false;
    this.onChange();
    if (!this.paused) this.round?.playersChanged();
    return true;
  }

  /** Store a self-portrait. Returns false if the player isn't here. */
  setAvatar(playerId: string, strokes: Stroke[]): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    player.avatar = strokes.length ? strokes : null;
    this.onChange();
    return true;
  }

  avatars(): { playerId: string; strokes: Stroke[] }[] {
    return [...this.players.values()].filter((p) => p.avatar).map((p) => ({ playerId: p.id, strokes: p.avatar! }));
  }

  /** True if the emote may be shown (players are limited to one every emote_cooldown_seconds). */
  allowEmote(playerId: string, now = Date.now()): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    if (now - player.lastEmoteAt < this.rules.emote_cooldown_seconds * 1000) return false;
    player.lastEmoteAt = now;
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
    if (!connected && this.isTimed() && !this.paused) {
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

  start(message: Pick<StartGameMessage, "rules" | "settings" | "questions" | "prompts" | "decoys">): Result<null> {
    if (this.phase !== "lobby") return fail("not_allowed", "A game is already running.");
    this.rules = resolveRules(message.rules, MAX_PLAYERS);
    if (this.players.size < this.rules.min_players) {
      return fail("not_enough_players", `Need at least ${this.rules.min_players} player(s) to start.`);
    }
    const settings = message.settings;
    this.content = new ContentPool(message.questions, message.prompts, message.decoys, this.rng, settings.categories, settings.mode);
    // Doodle Party is all drawing, whatever the drawing switch says.
    const drawing = settings.mode === "doodle" || settings.drawing;
    this.plan = buildPlan(this.rules.modes[settings.mode][settings.length], { drawing, content: this.content });
    if (this.plan.length === 0) return fail("no_questions", "Nothing to play with these settings.");

    for (const p of this.players.values()) {
      p.score = 0;
      p.lastPoints = 0;
      p.roundPoints = 0;
      p.drawings = 0;
    }
    this.paused = false;
    this.roundIndex = 0;
    this.beginIntro();
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
      if (this.timerCallback) this.startTimer(this.pausedRemainingMs);
    }
    this.onChange();
  }

  /** End the current step right now (host "Next" button). */
  skip(): void {
    if (this.paused) {
      this.paused = false;
      this.autoPaused = false;
    }
    if (this.phase === "round" && this.round) return this.round.skip();
    if (this.timerCallback) {
      const callback = this.timerCallback;
      this.clearTimer();
      callback();
    }
  }

  backToLobby(): void {
    this.clearTimer();
    this.phase = "lobby";
    this.paused = false;
    this.round = null;
    this.roundIndex = 0;
    for (const p of this.players.values()) {
      p.score = 0;
      p.lastPoints = 0;
      p.roundPoints = 0;
    }
    this.onChange();
  }

  dispose(): void {
    this.clearTimer();
  }

  // ---- Player inputs ----

  input(playerId: string, message: PlayerInput): Result<null> {
    const player = this.players.get(playerId);
    if (!player) return fail("not_allowed", "Not in this room.");
    if (this.paused) return fail("not_allowed", "The game is paused.");
    if (this.phase !== "round" || !this.round) return fail("not_allowed", "Nothing to answer right now.");
    return this.round.input(player, message);
  }

  // ---- Session flow ----

  private beginIntro(): void {
    this.round = null;
    for (const p of this.players.values()) {
      p.roundPoints = 0;
      p.lastPoints = 0;
    }
    this.phase = "intro";
    this.schedule(this.rules.round_intro_seconds * 1000, () => this.beginRound());
    this.onChange();
  }

  private beginRound(): void {
    const kind = this.plan[this.roundIndex]!;
    const ctx = this.context();
    this.round =
      kind === "closest"
        ? new ClosestRound(ctx)
        : kind === "drawing"
          ? new DrawingRound(ctx)
          : kind === "drawoff"
            ? new DrawOffRound(ctx)
            : new QuizRound(kind, ctx);
    this.phase = "round";
    this.round.start();
  }

  private finishRound(): void {
    this.clearTimer();
    this.round = null;
    const last = this.roundIndex >= this.plan.length - 1;
    if (last) {
      this.phase = "game_over";
      this.onChange();
      return;
    }
    this.phase = "scoreboard";
    this.schedule(this.rules.scoreboard_seconds * 1000, () => {
      this.roundIndex++;
      this.beginIntro();
    });
    this.onChange();
  }

  private context(): RoundContext {
    // Guard against a finished round calling back into the room after a newer round started.
    const owner = { active: true };
    const room = this;
    return {
      rules: this.rules,
      rng: this.rng,
      content: this.content,
      players: () => [...room.players.values()].sort((a, b) => a.seat - b.seat),
      player: (id) => room.players.get(id),
      award(playerId, points) {
        const p = room.players.get(playerId);
        if (!p) return 0;
        const applied = Math.max(points, -p.score);
        p.score += applied;
        p.lastPoints += applied;
        p.roundPoints += applied;
        return applied;
      },
      newScoringMoment() {
        for (const p of room.players.values()) p.lastPoints = 0;
      },
      schedule(ms, then) {
        if (owner.active) room.schedule(ms, then);
      },
      timeLeftMs: () => (room.paused ? room.pausedRemainingMs : Math.max(0, room.timerEndsAt - Date.now())),
      changed() {
        if (owner.active) room.onChange();
      },
      finish() {
        if (!owner.active) return;
        owner.active = false;
        room.finishRound();
      },
    };
  }

  // ---- Timer ----

  private isTimed(): boolean {
    return this.phase === "intro" || this.phase === "round" || this.phase === "scoreboard";
  }

  private schedule(ms: number, then: () => void): void {
    this.clearTimer();
    this.timerDurationMs = ms;
    this.timerCallback = then;
    if (this.paused) {
      this.pausedRemainingMs = ms;
      this.timerEndsAt = Date.now() + ms;
      return;
    }
    this.startTimer(ms);
  }

  private startTimer(ms: number): void {
    this.timerEndsAt = Date.now() + ms;
    const callback = this.timerCallback;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.timerCallback !== callback) return;
      this.timerCallback = null;
      callback?.();
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerCallback = null;
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
    const round = this.phase === "round" ? this.round : null;
    const players: PlayerView[] = [...this.players.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        id: p.id,
        name: p.name,
        animal: p.animal as Animal,
        accessory: p.accessory as Accessory,
        hasAvatar: p.avatar !== null,
        seat: p.seat,
        score: p.score,
        connected: p.connected,
        hasActed: round?.hasActed(p.id) ?? false,
        lastPoints: p.lastPoints,
        roundPoints: p.roundPoints,
        rank: ranks.get(p.id) ?? 0,
      }));
    const kind = this.phase === "lobby" ? null : (this.plan[this.roundIndex] ?? null);
    const hasTimer = this.isTimed() && (this.timerCallback !== null || this.paused);
    const remainingMs = this.paused ? this.pausedRemainingMs : Math.max(0, this.timerEndsAt - Date.now());
    const you = playerId && this.players.has(playerId) ? { playerId } : null;
    return {
      type: "state",
      code: this.code,
      phase: this.phase,
      paused: this.paused,
      hostConnected: this.hostConnected,
      players,
      timer: hasTimer ? { durationMs: this.timerDurationMs, remainingMs } : null,
      roundIndex: this.roundIndex,
      roundCount: this.plan.length,
      roundKind: kind,
      roundTitle: kind ? ROUND_INFO[kind].title : null,
      roundBlurb: kind ? ROUND_INFO[kind].blurb : null,
      round: round ? round.view(you ? playerId : null) : null,
      you,
    };
  }
}
