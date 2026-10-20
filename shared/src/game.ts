// Content and rules formats. Questions and drawing prompts are data (content/);
// rules come from host/config/game_rules.json and are sent by the host at game start.

import { z } from "zod";

// ---- Questions (manifest section 8) ----

const QuestionBase = {
  id: z.string().min(1),
  category: z.string().min(1),
  difficulty: z.number().int().min(1).max(5),
  question: z.string().min(1),
  source: z.string().optional(),
  verified_by: z.string().nullable().optional(),
  verified_on: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  time_sensitive: z.boolean().optional(),
  /** Optional one-line fun fact shown at the reveal. */
  fact: z.string().optional(),
};

export const MultipleChoiceSchema = z.object({
  ...QuestionBase,
  type: z.literal("multiple_choice"),
  choices: z.array(z.string().min(1)).min(2).max(6),
  answer: z.number().int().min(0),
});

export const ClosestGuessSchema = z.object({
  ...QuestionBase,
  type: z.literal("closest_guess"),
  answer: z.number(),
  /** Shown after the number, e.g. "years", "km". */
  unit: z.string().optional(),
});

export const QuestionSchema = z
  .discriminatedUnion("type", [MultipleChoiceSchema, ClosestGuessSchema])
  .superRefine((q, ctx) => {
    if (q.type === "multiple_choice" && q.answer >= q.choices.length) {
      ctx.addIssue({ code: "custom", message: "answer must point at one of the choices", path: ["answer"] });
    }
  });

export type MultipleChoiceQuestion = z.infer<typeof MultipleChoiceSchema>;
export type ClosestGuessQuestion = z.infer<typeof ClosestGuessSchema>;
export type Question = MultipleChoiceQuestion | ClosestGuessQuestion;

export const QuestionPackSchema = z.object({
  pack: z.string().min(1),
  questions: z.array(QuestionSchema),
});

// ---- Drawing prompts ----

export const DrawingPromptSchema = z.object({
  id: z.string().min(1),
  /** What the artist is asked to draw. Also the "real title" players try to spot. */
  prompt: z.string().min(1).max(60),
});

export type DrawingPrompt = z.infer<typeof DrawingPromptSchema>;

export const DrawingPackSchema = z.object({
  pack: z.string().min(1),
  prompts: z.array(DrawingPromptSchema),
  /** House lies: filler fake titles used when there are too few players to fill the options. */
  decoys: z.array(z.string().min(1).max(60)),
});

/** One pen stroke. Coordinates are 0..1000 on a square canvas, flattened x,y,x,y. */
export const StrokeSchema = z.object({
  c: z.number().int().min(0).max(15),
  w: z.number().int().min(0).max(3),
  p: z.array(z.number().int().min(0).max(1000)).min(2).max(4000),
});

export type Stroke = z.infer<typeof StrokeSchema>;

export const MAX_STROKES = 400;
export const MAX_LIE_LENGTH = 45;

/** Pen colors for drawings (index = Stroke.c). Asagi-shu palette first. Phones and TV share this. */
export const PEN_COLORS = [
  "#2b2b2b", // sumi
  "#d8453a", // shu
  "#6b9bb0", // asagi
  "#3f6e82", // deep asagi
  "#f4eee0", // gofun (works as an eraser on the paper)
  "#e8a33d", // ochre
  "#7db58c", // leaf green
  "#f0948a", // blush pink
  "#8c6a4f", // wood brown
  "#9b7cc4", // wisteria
] as const;

/** Pen widths in canvas units (index = Stroke.w). */
export const PEN_WIDTHS = [6, 14, 28, 60] as const;

// ---- Rounds and rules ----

export const ROUND_KINDS = ["classic", "wager", "closest", "steal", "drawing", "final"] as const;
export type RoundKind = (typeof ROUND_KINDS)[number];

export const ROUND_INFO: Record<RoundKind, { title: string; blurb: string }> = {
  classic: { title: "Quiz Time", blurb: "Vote for a category, then answer fast. Quicker right answers score more." },
  wager: { title: "High Roller", blurb: "See the category, bet your points, then answer. Right wins the bet, wrong loses it." },
  closest: { title: "Closest Guess", blurb: "Type a number. Nearest guess wins big, and everyone close scores something." },
  steal: { title: "Sticky Fingers", blurb: "Answer right and you get to steal points from anyone you like." },
  drawing: { title: "Doodle Duel", blurb: "Draw your secret prompt. Then write fake titles for the other drawings and spot the real one." },
  final: { title: "Final Showdown", blurb: "One hard question. Bet as much as you dare. Anyone can still win." },
};

export const GAME_LENGTHS = ["short", "standard", "long"] as const;
export type GameLength = (typeof GAME_LENGTHS)[number];

/** Gameplay numbers. Defaults here are only a fallback; edit host/config/game_rules.json. */
export interface GameRules {
  min_players: number;
  max_players: number;
  round_intro_seconds: number;
  scoreboard_seconds: number;
  end_phase_when_everyone_acted: boolean;
  // Quiz rounds
  vote_seconds: number;
  category_choices: number;
  question_seconds: number;
  reveal_seconds: number;
  base_points: number;
  speed_bonus_max: number;
  classic_questions: number;
  wager_questions: number;
  steal_questions: number;
  wager_seconds: number;
  /** Players with fewer points can still bet up to this much. */
  wager_floor: number;
  steal_points: number;
  steal_seconds: number;
  final_wager_seconds: number;
  final_question_seconds: number;
  // Closest guess
  closest_questions: number;
  closest_seconds: number;
  /** Points for 1st, 2nd, 3rd... closest. */
  closest_points: number[];
  closest_exact_bonus: number;
  // Drawing
  drawing_seconds: number;
  lie_seconds: number;
  pick_seconds: number;
  drawing_reveal_step_seconds: number;
  drawings_per_round: number;
  /** Total options shown per drawing (real title + lies + house lies). */
  drawing_min_options: number;
  draw_truth_points: number;
  draw_artist_points: number;
  draw_fool_points: number;
  // Session plans: which rounds, in order, for each length.
  plans: Record<GameLength, RoundKind[]>;
}

export const DEFAULT_RULES: GameRules = {
  min_players: 1,
  max_players: 16,
  round_intro_seconds: 6,
  scoreboard_seconds: 8,
  end_phase_when_everyone_acted: true,
  vote_seconds: 12,
  category_choices: 3,
  question_seconds: 20,
  reveal_seconds: 6,
  base_points: 1000,
  speed_bonus_max: 500,
  classic_questions: 5,
  wager_questions: 3,
  steal_questions: 4,
  wager_seconds: 15,
  wager_floor: 500,
  steal_points: 500,
  steal_seconds: 12,
  final_wager_seconds: 20,
  final_question_seconds: 30,
  closest_questions: 3,
  closest_seconds: 25,
  closest_points: [1000, 600, 300],
  closest_exact_bonus: 500,
  drawing_seconds: 80,
  lie_seconds: 40,
  pick_seconds: 25,
  drawing_reveal_step_seconds: 3.5,
  drawings_per_round: 6,
  drawing_min_options: 4,
  draw_truth_points: 1000,
  draw_artist_points: 500,
  draw_fool_points: 500,
  plans: {
    short: ["classic", "drawing", "final"],
    standard: ["classic", "drawing", "closest", "steal", "drawing", "final"],
    long: ["classic", "drawing", "wager", "closest", "drawing", "steal", "final"],
  },
};

const num = z.number();
const RoundKindSchema = z.enum(ROUND_KINDS);

/** Rules as the host sends them: any subset, unknown keys (like "_comment") ignored. */
export const GameRulesInput = z
  .object({
    min_players: num,
    max_players: num,
    round_intro_seconds: num,
    scoreboard_seconds: num,
    end_phase_when_everyone_acted: z.boolean(),
    vote_seconds: num,
    category_choices: num,
    question_seconds: num,
    reveal_seconds: num,
    base_points: num,
    speed_bonus_max: num,
    classic_questions: num,
    wager_questions: num,
    steal_questions: num,
    wager_seconds: num,
    wager_floor: num,
    steal_points: num,
    steal_seconds: num,
    final_wager_seconds: num,
    final_question_seconds: num,
    closest_questions: num,
    closest_seconds: num,
    closest_points: z.array(num).max(16),
    closest_exact_bonus: num,
    drawing_seconds: num,
    lie_seconds: num,
    pick_seconds: num,
    drawing_reveal_step_seconds: num,
    drawings_per_round: num,
    drawing_min_options: num,
    draw_truth_points: num,
    draw_artist_points: num,
    draw_fool_points: num,
    plans: z
      .object({
        short: z.array(RoundKindSchema).max(20),
        standard: z.array(RoundKindSchema).max(20),
        long: z.array(RoundKindSchema).max(20),
      })
      .partial(),
  })
  .partial();

/** What the host picks in the lobby. */
export const GameSettingsSchema = z.object({
  length: z.enum(GAME_LENGTHS).default("standard"),
  drawing: z.boolean().default(true),
  /** Category ids to use; empty = all. */
  categories: z.array(z.string()).max(50).default([]),
});

export type GameSettings = z.infer<typeof GameSettingsSchema>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const secs = (v: number, max = 300) => clamp(v, 0.05, max);
const count = (v: number, max = 100) => Math.round(clamp(v, 1, max));
const points = (v: number) => Math.round(clamp(v, 0, 100000));

/** Fill in defaults and keep every number in a sane range. */
export function resolveRules(input: z.infer<typeof GameRulesInput>, maxPlayers: number): GameRules {
  const r = { ...DEFAULT_RULES, ...input, plans: { ...DEFAULT_RULES.plans, ...(input.plans ?? {}) } };
  return {
    min_players: Math.round(clamp(r.min_players, 1, maxPlayers)),
    max_players: Math.round(clamp(r.max_players, 1, maxPlayers)),
    round_intro_seconds: secs(r.round_intro_seconds, 60),
    scoreboard_seconds: clamp(r.scoreboard_seconds, 0, 60),
    end_phase_when_everyone_acted: r.end_phase_when_everyone_acted,
    vote_seconds: secs(r.vote_seconds, 120),
    category_choices: count(r.category_choices, 6),
    question_seconds: secs(r.question_seconds),
    reveal_seconds: secs(r.reveal_seconds, 60),
    base_points: points(r.base_points),
    speed_bonus_max: points(r.speed_bonus_max),
    classic_questions: count(r.classic_questions),
    wager_questions: count(r.wager_questions),
    steal_questions: count(r.steal_questions),
    wager_seconds: secs(r.wager_seconds),
    wager_floor: points(r.wager_floor),
    steal_points: points(r.steal_points),
    steal_seconds: secs(r.steal_seconds),
    final_wager_seconds: secs(r.final_wager_seconds),
    final_question_seconds: secs(r.final_question_seconds),
    closest_questions: count(r.closest_questions),
    closest_seconds: secs(r.closest_seconds),
    closest_points: (r.closest_points.length ? r.closest_points : DEFAULT_RULES.closest_points).map(points),
    closest_exact_bonus: points(r.closest_exact_bonus),
    drawing_seconds: secs(r.drawing_seconds, 600),
    lie_seconds: secs(r.lie_seconds),
    pick_seconds: secs(r.pick_seconds),
    drawing_reveal_step_seconds: secs(r.drawing_reveal_step_seconds, 30),
    drawings_per_round: count(r.drawings_per_round, 16),
    drawing_min_options: Math.round(clamp(r.drawing_min_options, 2, 12)),
    draw_truth_points: points(r.draw_truth_points),
    draw_artist_points: points(r.draw_artist_points),
    draw_fool_points: points(r.draw_fool_points),
    plans: {
      short: r.plans.short.length ? r.plans.short : DEFAULT_RULES.plans.short,
      standard: r.plans.standard.length ? r.plans.standard : DEFAULT_RULES.plans.standard,
      long: r.plans.long.length ? r.plans.long : DEFAULT_RULES.plans.long,
    },
  };
}

/** Display names for category ids (manifest section 8). Unknown ids are title-cased. */
export const CATEGORY_NAMES: Record<string, string> = {
  general: "General",
  science: "Science",
  history: "History",
  geography: "Geography",
  animals_nature: "Animals & Nature",
  food_drink: "Food & Drink",
  movies_tv: "Movies & TV",
  music: "Music",
  sports: "Sports",
  video_games: "Video Games",
  art_literature: "Art & Literature",
  language_words: "Language & Words",
};

export function categoryName(id: string): string {
  return CATEGORY_NAMES[id] ?? id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Lowercase, strip punctuation and articles: used to catch lies that are really the truth. */
export function normalizeTitle(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(a|an|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
