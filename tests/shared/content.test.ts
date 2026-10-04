import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { QuestionPackSchema } from "@trivia/shared";

const dir = join(import.meta.dirname, "../../content/questions");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

describe("question packs in content/questions", () => {
  it("has at least one pack", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  const ids = new Map<string, string>();
  for (const file of files) {
    it(`${file} matches the question format and has unique ids`, () => {
      const pack = QuestionPackSchema.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
      for (const q of pack.questions) {
        expect(ids.get(q.id), `duplicate id ${q.id}`).toBeUndefined();
        ids.set(q.id, file);
        expect(new Set(q.choices).size, `${q.id} has duplicate choices`).toBe(q.choices.length);
        expect(q.source, `${q.id} has no source`).toBeTruthy();
      }
    });
  }
});
