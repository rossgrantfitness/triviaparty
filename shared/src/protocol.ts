// Every network message between host, phones and server is defined here.
// Keep docs/PROTOCOL.md and host/scripts/protocol.gd in sync with this file.

/** Bump when a message shape changes in a way old clients can't handle. */
export const PROTOCOL_VERSION = 1;

/** Default port the relay server listens on during development. */
export const DEFAULT_SERVER_PORT = 8787;

export type ClientRole = "host" | "player";

// ---- Client -> Server ----

/** First message every client sends after the socket opens. */
export interface HelloMessage {
  type: "hello";
  role: ClientRole;
  protocolVersion: number;
}

export type ClientMessage = HelloMessage;

// ---- Server -> Client ----

/** Reply to a valid hello. */
export interface WelcomeMessage {
  type: "welcome";
  connectionId: string;
  role: ClientRole;
  protocolVersion: number;
}

export type ErrorCode = "bad_message" | "protocol_mismatch";

export interface ErrorMessage {
  type: "error";
  code: ErrorCode;
  message: string;
}

export type ServerMessage = WelcomeMessage | ErrorMessage;

// ---- Helpers ----

export type ParseResult<T> = { ok: true; message: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(raw: string): ParseResult<Record<string, unknown>> {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
  if (!isRecord(data) || typeof data.type !== "string") {
    return { ok: false, error: "message must be an object with a string 'type'" };
  }
  return { ok: true, message: data };
}

/** Validate a raw message the server received from a host or phone. */
export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  const data = parsed.message;

  switch (data.type) {
    case "hello":
      if (data.role !== "host" && data.role !== "player") {
        return { ok: false, error: "hello.role must be 'host' or 'player'" };
      }
      if (typeof data.protocolVersion !== "number") {
        return { ok: false, error: "hello.protocolVersion must be a number" };
      }
      return { ok: true, message: { type: "hello", role: data.role, protocolVersion: data.protocolVersion } };
    default:
      return { ok: false, error: `unknown message type '${data.type}'` };
  }
}

/** Validate a raw message a phone received from the server. */
export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  const data = parsed.message;

  switch (data.type) {
    case "welcome":
      if (typeof data.connectionId !== "string" || typeof data.protocolVersion !== "number") {
        return { ok: false, error: "welcome is missing connectionId or protocolVersion" };
      }
      if (data.role !== "host" && data.role !== "player") {
        return { ok: false, error: "welcome.role must be 'host' or 'player'" };
      }
      return {
        ok: true,
        message: {
          type: "welcome",
          connectionId: data.connectionId,
          role: data.role,
          protocolVersion: data.protocolVersion,
        },
      };
    case "error":
      if (typeof data.code !== "string" || typeof data.message !== "string") {
        return { ok: false, error: "error is missing code or message" };
      }
      return { ok: true, message: { type: "error", code: data.code as ErrorCode, message: data.message } };
    default:
      return { ok: false, error: `unknown message type '${data.type}'` };
  }
}

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}
