import {
  DEFAULT_SERVER_PORT,
  PROTOCOL_VERSION,
  encodeMessage,
  parseServerMessage,
  type ServerMessage,
} from "@trivia/shared";

export type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

/** Milliseconds to wait before trying to reconnect after the socket drops. */
const RECONNECT_DELAY_MS = 2000;

/**
 * Work out which server to talk to. A `?server=` query parameter wins, then the
 * VITE_SERVER_URL build setting, otherwise the same machine that served the page.
 */
export function resolveServerUrl(location: { hostname: string; protocol: string; search: string }, envUrl?: string): string {
  const fromQuery = new URLSearchParams(location.search).get("server");
  if (fromQuery) return fromQuery;
  if (envUrl) return envUrl;
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.hostname}:${DEFAULT_SERVER_PORT}`;
}

export function statusText(state: ConnectionState, detail?: string): string {
  switch (state) {
    case "connecting":
      return "Connecting to server…";
    case "connected":
      return "Connected to server";
    case "disconnected":
      return "Disconnected — retrying…";
    case "error":
      return detail ? `Server error: ${detail}` : "Server error";
  }
}

export interface ConnectionCallbacks {
  onState(state: ConnectionState, detail?: string): void;
  onMessage?(message: ServerMessage): void;
}

/** Keeps a WebSocket to the relay server open, reconnecting when it drops. */
export class ServerConnection {
  private socket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly url: string,
    private readonly callbacks: ConnectionCallbacks,
    private readonly reconnectDelayMs = RECONNECT_DELAY_MS,
  ) {}

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  private open(): void {
    this.callbacks.onState("connecting");
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      socket.send(encodeMessage({ type: "hello", role: "player", protocolVersion: PROTOCOL_VERSION }));
    });

    socket.addEventListener("message", (event) => {
      const result = parseServerMessage(String(event.data));
      if (!result.ok) {
        console.warn("Ignoring bad message from server:", result.error);
        return;
      }
      const message = result.message;
      if (message.type === "welcome") this.callbacks.onState("connected");
      if (message.type === "error") this.callbacks.onState("error", message.message);
      this.callbacks.onMessage?.(message);
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.stopped) return;
      this.callbacks.onState("disconnected");
      this.retryTimer = setTimeout(() => this.open(), this.reconnectDelayMs);
    });
  }
}
