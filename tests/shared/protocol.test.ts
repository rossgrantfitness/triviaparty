import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, encodeMessage, parseClientMessage, parseServerMessage } from "@trivia/shared";

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

  it("rejects a message without a type", () => {
    expect(parseClientMessage(JSON.stringify({ role: "host" })).ok).toBe(false);
  });

  it("rejects an unknown role", () => {
    const raw = JSON.stringify({ type: "hello", role: "audience", protocolVersion: PROTOCOL_VERSION });
    expect(parseClientMessage(raw).ok).toBe(false);
  });

  it("rejects an unknown message type", () => {
    expect(parseClientMessage(JSON.stringify({ type: "dance" })).ok).toBe(false);
  });

  it("drops extra fields", () => {
    const raw = JSON.stringify({ type: "hello", role: "player", protocolVersion: 1, admin: true });
    const result = parseClientMessage(raw);
    expect(result.ok && result.message).toEqual({ type: "hello", role: "player", protocolVersion: 1 });
  });
});

describe("parseServerMessage", () => {
  it("accepts a welcome", () => {
    const raw = encodeMessage({ type: "welcome", connectionId: "abc", role: "player", protocolVersion: 1 });
    expect(parseServerMessage(raw).ok).toBe(true);
  });

  it("accepts an error", () => {
    const raw = encodeMessage({ type: "error", code: "bad_message", message: "nope" });
    expect(parseServerMessage(raw).ok).toBe(true);
  });

  it("rejects a welcome without a connectionId", () => {
    expect(parseServerMessage(JSON.stringify({ type: "welcome", role: "player", protocolVersion: 1 })).ok).toBe(false);
  });
});
