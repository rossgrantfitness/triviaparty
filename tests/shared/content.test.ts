import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DrawingPackSchema, QuestionPackSchema, normalizeTitle, type Question } from "@trivia/shared";

const root = join(import.meta.dirname, "../../content");
const questionDir = join(root, "questions");
const files = readdirSync(questionDir).filter((f) => f.endsWith(".json"));
const all: Question[] = [];

describe("question packs in content/questions", () => {
  it("has packs", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  const ids = new Map<string, string>();
  for (const file of files) {
    it(`${file} matches the question format`, () => {
      const pack = QuestionPackSchema.parse(JSON.parse(readFileSync(join(questionDir, file), "utf8")));
      for (const q of pack.questions) {
        expect(ids.get(q.id), `duplicate id ${q.id}`).toBeUndefined();
        ids.set(q.id, file);
        expect(q.source, `${q.id} has no source`).toBeTruthy();
        if (q.type === "multiple_choice") {
          expect(new Set(q.choices).size, `${q.id} has duplicate choices`).toBe(q.choices.length);
        }
        all.push(q);
      }
    });
  }

  it("has no near-duplicate questions", () => {
    const seen = new Map<string, string>();
    for (const q of all) {
      const key = normalizeTitle(q.question);
      expect(seen.get(key), `${q.id} repeats ${seen.get(key)}`).toBeUndefined();
      seen.set(key, q.id);
    }
  });

  it("spreads correct answers across A-D (no letter over 35%)", () => {
    const mc = all.filter((q) => q.type === "multiple_choice");
    const counts = [0, 0, 0, 0, 0, 0];
    for (const q of mc) counts[q.answer as number]!++;
    for (const n of counts) expect(n / mc.length).toBeLessThanOrEqual(0.35);
  });

  it("has hard questions for the Final Showdown and numbers for Closest Guess", () => {
    expect(all.filter((q) => q.type === "multiple_choice" && q.difficulty >= 4).length).toBeGreaterThanOrEqual(10);
    expect(all.filter((q) => q.type === "closest_guess").length).toBeGreaterThanOrEqual(20);
  });
});

describe("drawing prompts", () => {
  const pack = DrawingPackSchema.parse(JSON.parse(readFileSync(join(root, "drawing", "prompts.json"), "utf8")));

  it("has enough prompts and house lies", () => {
    expect(pack.prompts.length).toBeGreaterThanOrEqual(100);
    expect(pack.decoys.length).toBeGreaterThanOrEqual(30);
  });

  it("has no duplicates, and no house lie matches a real prompt", () => {
    const prompts = new Set(pack.prompts.map((p) => normalizeTitle(p.prompt)));
    expect(prompts.size).toBe(pack.prompts.length);
    for (const d of pack.decoys) expect(prompts.has(normalizeTitle(d)), d).toBe(false);
  });
});
