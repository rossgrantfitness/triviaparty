import { MAX_NAME_LENGTH, type ErrorCode, type GameRules } from "@trivia/shared";

export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; message: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T>(code: ErrorCode, message: string): Result<T> => ({ ok: false, code, message });

/** Points for one answer: base points plus a speed bonus that shrinks linearly to 0. */
export function scoreAnswer(correct: boolean, remainingMs: number, durationMs: number, rules: GameRules): number {
  if (!correct) return 0;
  const fraction = durationMs > 0 ? Math.min(1, Math.max(0, remainingMs / durationMs)) : 0;
  return rules.base_points + Math.round(rules.speed_bonus_max * fraction);
}

/** Strip what the TV can't or shouldn't show: control characters and emoji. */
export function cleanText(raw: string, maxLength: number): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    // The TV font has no emoji, so they would show as boxes.
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}‍️]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
}

/** Make a name safe to show: no control characters, trimmed, length-limited. */
export function cleanName(raw: string): string {
  return cleanText(raw, MAX_NAME_LENGTH);
}

/** Pick the vote winner: most votes, ties broken at random. No votes at all = random option. */
export function pickVoteWinner(counts: Map<string, number>, rng: () => number): string {
  const options = [...counts.keys()];
  const best = Math.max(...counts.values());
  const tied = options.filter((id) => counts.get(id) === best);
  return tied[Math.floor(rng() * tied.length)] ?? options[0]!;
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
