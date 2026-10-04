// Question and rules formats. Questions are data (content/questions/*.json);
// rules come from host/config/game_rules.json and are sent by the host at game start.

import { z } from "zod";

/** One multiple-choice question, as stored in a pack file (manifest section 8). */
export const QuestionSchema = z.object({
  id: z.string().min(1),
  type: z.literal("multiple_choice"),
  category: z.string().min(1),
  difficulty: z.number().int().min(1).max(5),
  question: z.string().min(1),
  choices: z.array(z.string().min(1)).min(2).max(6),
  answer: z.number().int().min(0),
  source: z.string().optional(),
  verified_by: z.string().nullable().optional(),
  verified_on: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  time_sensitive: z.boolean().optional(),
}).refine((q) => q.answer < q.choices.length, { message: "answer must point at one of the choices", path: ["answer"] });

export type Question = z.infer<typeof QuestionSchema>;

export const QuestionPackSchema = z.object({
  pack: z.string().min(1),
  questions: z.array(QuestionSchema),
});

/** Gameplay numbers. Defaults here are only a fallback; edit host/config/game_rules.json. */
export interface GameRules {
  questions_per_game: number;
  questions_per_category: number;
  category_choices: number;
  vote_seconds: number;
  question_seconds: number;
  reveal_seconds: number;
  scoreboard_seconds: number;
  base_points: number;
  speed_bonus_max: number;
  min_players: number;
  max_players: number;
  end_phase_when_everyone_acted: boolean;
}

export const DEFAULT_RULES: GameRules = {
  questions_per_game: 10,
  questions_per_category: 5,
  category_choices: 3,
  vote_seconds: 12,
  question_seconds: 20,
  reveal_seconds: 6,
  scoreboard_seconds: 5,
  base_points: 1000,
  speed_bonus_max: 500,
  min_players: 1,
  max_players: 16,
  end_phase_when_everyone_acted: true,
};

/** Rules as the host sends them: any subset, unknown keys (like "_comment") ignored. */
export const GameRulesInput = z
  .object({
    questions_per_game: z.number(),
    questions_per_category: z.number(),
    category_choices: z.number(),
    vote_seconds: z.number(),
    question_seconds: z.number(),
    reveal_seconds: z.number(),
    scoreboard_seconds: z.number(),
    base_points: z.number(),
    speed_bonus_max: z.number(),
    min_players: z.number(),
    max_players: z.number(),
    end_phase_when_everyone_acted: z.boolean(),
  })
  .partial();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Fill in defaults and keep every number in a sane range. */
export function resolveRules(input: Partial<GameRules>, maxPlayers: number): GameRules {
  const r = { ...DEFAULT_RULES, ...input };
  return {
    questions_per_game: Math.round(clamp(r.questions_per_game, 1, 100)),
    questions_per_category: Math.round(clamp(r.questions_per_category, 1, 100)),
    category_choices: Math.round(clamp(r.category_choices, 1, 6)),
    vote_seconds: clamp(r.vote_seconds, 0.05, 120),
    question_seconds: clamp(r.question_seconds, 0.05, 300),
    reveal_seconds: clamp(r.reveal_seconds, 0.05, 60),
    scoreboard_seconds: clamp(r.scoreboard_seconds, 0, 60),
    base_points: Math.round(clamp(r.base_points, 0, 100000)),
    speed_bonus_max: Math.round(clamp(r.speed_bonus_max, 0, 100000)),
    min_players: Math.round(clamp(r.min_players, 1, maxPlayers)),
    max_players: Math.round(clamp(r.max_players, 1, maxPlayers)),
    end_phase_when_everyone_acted: r.end_phase_when_everyone_acted,
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
