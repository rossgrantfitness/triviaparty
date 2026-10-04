import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  QuestionSchema,
  categoryName,
  encodeMessage,
  parseClientMessage,
  parseServerMessage,
  resolveRules,
} from "@trivia/shared";

describe("parseClientMessage", () => {
  it("accepts a valid hello", () => {
    const raw = encodeMessage({ type: "hello", role: "host", protocolVersion: PROTOCOL_VERSION });
    expect(parseClientMessage(raw)).toEqual({
      ok: true,
      message: { type: "hello", role: "host", protocolVersion: PROTOCOL_VERSION },
    });
  });

  it("rejects text that is not JSON", () => {
    expect(parseClientMessage("hi there").ok).toBe(false);
  });

  it("rejects an unknown message type", () => {
    expect(parseClientMessage(JSON.stringify({ type: "dance" })).ok).toBe(false);
  });

  it("uppercases and validates room codes in join", () => {
    const result = parseClientMessage(JSON.stringify({ type: "join", code: " abcd ", name: "Sam", animal: "frog" }));
    expect(result.ok && result.message.type === "join" && result.message.code).toBe("ABCD");
  });

  it("rejects room codes with confusable letters", () => {
    expect(parseClientMessage(JSON.stringify({ type: "join", code: "AB0O", name: "Sam", animal: "frog" })).ok).toBe(false);
  });

  it("rejects unknown animals", () => {
    expect(parseClientMessage(JSON.stringify({ type: "join", code: "ABCD", name: "Sam", animal: "dragon" })).ok).toBe(false);
  });

  it("rejects negative answers", () => {
    expect(parseClientMessage(JSON.stringify({ type: "answer", choice: -1 })).ok).toBe(false);
  });

  it("drops extra fields", () => {
    const raw = JSON.stringify({ type: "hello", role: "player", protocolVersion: 1, admin: true });
    const result = parseClientMessage(raw);
    expect(result.ok && result.message).toEqual({ type: "hello", role: "player", protocolVersion: 1 });
  });
});

describe("parseServerMessage", () => {
  it("accepts known types", () => {
    expect(parseServerMessage(encodeMessage({ type: "kicked" })).ok).toBe(true);
  });

  it("rejects unknown types", () => {
    expect(parseServerMessage(JSON.stringify({ type: "hack" })).ok).toBe(false);
  });
});

describe("QuestionSchema", () => {
  const base = {
    id: "sci-1",
    type: "multiple_choice",
    category: "science",
    difficulty: 2,
    question: "Q?",
    choices: ["a", "b", "c", "d"],
    answer: 1,
  };
  it("accepts a valid question", () => {
    expect(QuestionSchema.safeParse(base).success).toBe(true);
  });
  it("rejects an answer index past the choices", () => {
    expect(QuestionSchema.safeParse({ ...base, answer: 4 }).success).toBe(false);
  });
});

describe("resolveRules", () => {
  it("never allows more than the hard player cap", () => {
    expect(resolveRules({ max_players: 99 }, 16).max_players).toBe(16);
  });
  it("fills in defaults", () => {
    expect(resolveRules({}, 16).question_seconds).toBe(20);
  });
});

describe("categoryName", () => {
  it("uses friendly names", () => {
    expect(categoryName("animals_nature")).toBe("Animals & Nature");
    expect(categoryName("space_stuff")).toBe("Space Stuff");
  });
});
