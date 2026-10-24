import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve as resolvePath, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  encodeJoinCode,
  ROOM_CODE_LENGTH,
  encodeMessage,
  parseClientMessage,
  type ClientMessage,
  type ClientRole,
  type ErrorCode,
  type ServerMessage,
} from "@trivia/shared";
import { Room } from "./room";

export interface ServerOptions {
  /** Port to listen on. 0 picks a free port (used by tests). */
  port: number;
  /** Silence connection logs (used by tests). */
  quiet?: boolean;
  /** How long a room survives with no host connected. */
  hostlessRoomTtlMs?: number;
  /** Random source for room codes and shuffles (tests pass a seeded one). */
  rng?: () => number;
  /**
   * This PC's home-network address. The first room's code then spells it, so the
   * website can send phones here (see shared/src/join_code.ts).
   */
  lanAddress?: string | null;
  /** Serve the built phone page from this folder (the packaged game does). */
  phoneDir?: string | null;
}

export interface RunningServer {
  port: number;
  /** Number of clients that have completed the hello handshake. */
  connectionCount(): number;
  roomCount(): number;
  close(): Promise<void>;
}

interface Connection {
  id: string;
  role: ClientRole;
  socket: WebSocket;
  room: Room | null;
  /** Set for players once they have joined a room. */
  playerId: string | null;
}

/** Words we never want shown as a room code. */
const BLOCKED_CODES = new Set(["ANAL", "ANUS", "ARSE", "CUNT", "DAMN", "DICK", "FUCK", "FUKK", "HELL", "JERK", "NAZI", "PAKI", "PISS", "POOP", "PUSY", "SHAT", "SHIT", "SLUT", "TWAT", "WANK", "WHRE"]);

export function generateRoomCode(taken: (code: string) => boolean, rng: () => number = Math.random): string {
  for (;;) {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[Math.floor(rng() * ROOM_CODE_ALPHABET.length)];
    }
    if (!taken(code) && !BLOCKED_CODES.has(code)) return code;
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

/** Serve a file from the built phone page; unknown paths get index.html. */
async function servePhonePage(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
  const file = normalize(join(root, path));
  const inside = file === root || file.startsWith(root + sep);
  const target = inside && extname(file) ? file : join(root, "index.html");
  try {
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
      // The page itself must never be cached, so an updated game always serves its own page.
      "cache-control": target.endsWith("index.html") ? "no-store" : "max-age=3600",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);
  const rng = options.rng ?? Math.random;
  const hostlessTtl = options.hostlessRoomTtlMs ?? 10 * 60 * 1000;
  const lanCode = options.lanAddress ? encodeJoinCode(options.lanAddress) : null;
  const phoneDir = options.phoneDir ? resolvePath(options.phoneDir) : null;
  let phoneUrl: string | null = null;
  const connections = new Map<WebSocket, Connection>();
  const rooms = new Map<string, Room>();
  const hostlessTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(encodeMessage(message));
  };
  const sendError = (socket: WebSocket, code: ErrorCode, message: string) => send(socket, { type: "error", code, message });

  function broadcast(room: Room): void {
    for (const conn of connections.values()) {
      if (conn.room !== room) continue;
      if (conn.role === "host") send(conn.socket, room.snapshotFor(null));
      else if (conn.playerId) send(conn.socket, room.snapshotFor(conn.playerId));
    }
  }

  function hostConnectionFor(room: Room): Connection | undefined {
    return [...connections.values()].find((c) => c.role === "host" && c.room === room);
  }

  function closeRoom(room: Room): void {
    room.dispose();
    rooms.delete(room.code);
    clearTimeout(hostlessTimers.get(room.code));
    hostlessTimers.delete(room.code);
    for (const conn of connections.values()) {
      if (conn.room !== room) continue;
      conn.room = null;
      conn.playerId = null;
      sendError(conn.socket, "room_not_found", "This room has closed.");
    }
    log(`[room] ${room.code} closed`);
  }

  function attachHost(conn: Connection, room: Room): void {
    // Only one host screen per room; a newer one replaces the old one.
    const previous = hostConnectionFor(room);
    if (previous && previous !== conn) {
      previous.room = null;
      previous.socket.close();
    }
    conn.room = room;
    clearTimeout(hostlessTimers.get(room.code));
    hostlessTimers.delete(room.code);
    room.setHostConnected(true);
    send(conn.socket, { type: "room_created", code: room.code, hostToken: room.hostToken, phoneUrl });
    for (const avatar of room.avatars()) send(conn.socket, { type: "avatar", ...avatar });
    send(conn.socket, room.snapshotFor(null));
  }

  function handleHost(conn: Connection, message: ClientMessage): void {
    const { socket } = conn;
    if (message.type === "create_room") {
      if (conn.room) closeRoom(conn.room);
      let room!: Room;
      const code = lanCode && !rooms.has(lanCode) ? lanCode : generateRoomCode((c) => rooms.has(c), rng);
      room = new Room(code, () => broadcast(room), rng);
      rooms.set(code, room);
      log(`[room] ${code} created`);
      attachHost(conn, room);
      return;
    }
    if (message.type === "resume_room") {
      const room = rooms.get(message.code);
      if (!room || room.hostToken !== message.hostToken) {
        sendError(socket, "room_not_found", "That room has closed. Starting a new one.");
        return;
      }
      log(`[room] ${room.code} host reconnected`);
      attachHost(conn, room);
      return;
    }

    const room = conn.room;
    if (!room) {
      sendError(socket, "not_allowed", "Create a room first.");
      return;
    }
    switch (message.type) {
      case "start_game": {
        const result = room.start(message);
        if (!result.ok) sendError(socket, result.code, result.message);
        else log(`[room] ${room.code} game started with ${room.playerCount} players`);
        break;
      }
      case "kick": {
        const kicked = [...connections.values()].filter((c) => c.room === room && c.playerId === message.playerId);
        if (room.kick(message.playerId)) {
          for (const c of kicked) {
            c.room = null;
            c.playerId = null;
            send(c.socket, { type: "kicked" });
          }
        }
        break;
      }
      case "set_paused":
        room.setPaused(message.paused);
        break;
      case "skip":
        room.skip();
        break;
      case "back_to_lobby":
        room.backToLobby();
        break;
      default:
        sendError(socket, "not_allowed", `Hosts can't send '${message.type}'.`);
    }
  }

  function handlePlayer(conn: Connection, message: ClientMessage): void {
    const { socket } = conn;
    if (message.type === "join") {
      const room = rooms.get(message.code);
      if (!room) {
        sendError(socket, "room_not_found", `No room with code ${message.code}. Check the TV.`);
        return;
      }
      const result = room.join(message.name, message.animal, message.token, message.accessory);
      if (!result.ok) {
        sendError(socket, result.code, result.message);
        return;
      }
      const player = result.value;
      // If this seat was open on another phone/tab, that one loses it.
      for (const other of connections.values()) {
        if (other !== conn && other.room === room && other.playerId === player.id) {
          other.room = null;
          other.playerId = null;
          other.socket.close();
        }
      }
      conn.room = room;
      conn.playerId = player.id;
      log(`[room] ${room.code} ${player.name} joined as ${player.animal} (seat ${player.seat})`);
      send(socket, { type: "joined", code: room.code, playerId: player.id, token: player.token });
      send(socket, room.snapshotFor(player.id));
      return;
    }

    const room = conn.room;
    if (!room || !conn.playerId) {
      sendError(socket, "not_allowed", "Join a room first.");
      return;
    }
    switch (message.type) {
      case "avatar": {
        room.setAvatar(conn.playerId, message.strokes);
        const host = hostConnectionFor(room);
        if (host) send(host.socket, { type: "avatar", playerId: conn.playerId, strokes: message.strokes });
        return;
      }
      case "emote": {
        // Too fast? Quietly drop it: emotes are just for fun.
        if (!room.allowEmote(conn.playerId)) return;
        const host = hostConnectionFor(room);
        if (host) send(host.socket, { type: "emote", playerId: conn.playerId, emote: message.emote });
        return;
      }
      case "vote_drawing":
      case "vote":
      case "answer":
      case "wager":
      case "guess":
      case "steal":
      case "drawing":
      case "lie":
      case "pick": {
        const result = room.input(conn.playerId, message);
        if (!result.ok) sendError(socket, result.code, result.message);
        return;
      }
      default:
        sendError(socket, "not_allowed", `Players can't send '${message.type}'.`);
        return;
    }
  }

  const http: Server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ ok: true, protocolVersion: PROTOCOL_VERSION, connections: connections.size, rooms: rooms.size }),
      );
      return;
    }
    if (phoneDir && (req.method === "GET" || req.method === "HEAD")) {
      void servePhonePage(phoneDir, req, res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });

  const wss = new WebSocketServer({ server: http, maxPayload: 2 * 1024 * 1024 });

  wss.on("connection", (socket) => {
    let conn: Connection | null = null;

    socket.on("message", (data) => {
      const result = parseClientMessage(data.toString());
      if (!result.ok) {
        sendError(socket, "bad_message", result.error);
        return;
      }
      const message = result.message;

      if (message.type === "hello") {
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          sendError(
            socket,
            "protocol_mismatch",
            `Server speaks protocol ${PROTOCOL_VERSION}, this app sent ${message.protocolVersion}. Refresh or update.`,
          );
          return;
        }
        conn = conn ?? { id: randomUUID(), role: message.role, socket, room: null, playerId: null };
        conn.role = message.role;
        connections.set(socket, conn);
        log(`[connect] ${conn.role} ${conn.id.slice(0, 8)} (${connections.size} connected)`);
        send(socket, { type: "welcome", connectionId: conn.id, role: conn.role, protocolVersion: PROTOCOL_VERSION });
        return;
      }

      if (!conn) {
        sendError(socket, "not_allowed", "Say hello first.");
        return;
      }
      if (conn.role === "host") handleHost(conn, message);
      else handlePlayer(conn, message);
    });

    socket.on("close", () => {
      if (!conn) return;
      connections.delete(socket);
      log(`[disconnect] ${conn.role} ${conn.id.slice(0, 8)} (${connections.size} connected)`);
      const room = conn.room;
      if (!room || !rooms.has(room.code)) return;
      if (conn.role === "host") {
        room.setHostConnected(false);
        hostlessTimers.set(
          room.code,
          setTimeout(() => closeRoom(room), hostlessTtl),
        );
      } else if (conn.playerId) {
        room.setPlayerConnected(conn.playerId, false);
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, () => resolve());
  });
  const port = (http.address() as AddressInfo).port;
  phoneUrl = phoneDir && options.lanAddress ? `http://${options.lanAddress}:${port}` : null;

  return {
    port,
    connectionCount: () => connections.size,
    roomCount: () => rooms.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const room of [...rooms.values()]) closeRoom(room);
        for (const client of wss.clients) client.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
