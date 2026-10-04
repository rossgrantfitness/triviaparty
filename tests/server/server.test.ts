import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { PROTOCOL_VERSION, type Question, type ServerMessage, type StateMessage } from "@trivia/shared";
import { generateRoomCode, startServer, type RunningServer } from "../../server/src/server";

let server: RunningServer;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  server = await startServer({ port: 0, quiet: true });
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await server.close();
});

/** A test client that records every message it receives. */
class Client {
  messages: ServerMessage[] = [];
  private waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

  constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      this.messages.push(message);
      this.waiters = this.waiters.filter((w) => {
        if (!w.match(message)) return true;
        w.resolve(message);
        return false;
      });
    });
  }

  send(message: object): void {
    this.socket.send(JSON.stringify(message));
  }

  waitFor<T extends ServerMessage>(match: (m: ServerMessage) => boolean, timeoutMs = 3000): Promise<T> {
    const already = this.messages.find(match);
    if (already) {
      this.messages.splice(this.messages.indexOf(already), 1);
      return Promise.resolve(already as T);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for message")), timeoutMs);
      this.waiters.push({
        match,
        resolve: (m) => {
          clearTimeout(timer);
          this.messages.splice(this.messages.indexOf(m), 1);
          resolve(m as T);
        },
      });
    });
  }

  waitForState(match: (s: StateMessage) => boolean): Promise<StateMessage> {
    return this.waitFor((m) => m.type === "state" && match(m));
  }
}

async function connect(role: "host" | "player"): Promise<Client> {
  const socket = new WebSocket(`ws://localhost:${server.port}`);
  sockets.push(socket);
  const client = new Client(socket);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  client.send({ type: "hello", role, protocolVersion: PROTOCOL_VERSION });
  await client.waitFor((m) => m.type === "welcome");
  return client;
}

async function createRoom(): Promise<{ host: Client; code: string; hostToken: string }> {
  const host = await connect("host");
  host.send({ type: "create_room" });
  const created = await host.waitFor<Extract<ServerMessage, { type: "room_created" }>>((m) => m.type === "room_created");
  return { host, code: created.code, hostToken: created.hostToken };
}

async function joinRoom(code: string, name: string, token?: string) {
  const phone = await connect("player");
  phone.send({ type: "join", code, name, animal: "bunny", token });
  const joined = await phone.waitFor<Extract<ServerMessage, { type: "joined" }>>(
    (m) => m.type === "joined" || m.type === "error",
  );
  return { phone, joined };
}

const QUESTIONS: Question[] = Array.from({ length: 4 }, (_, i) => ({
  id: `q${i}`,
  type: "multiple_choice",
  category: "science",
  difficulty: 1,
  question: `Question ${i}?`,
  choices: ["A", "B", "C", "D"],
  answer: 2,
}));

describe("generateRoomCode", () => {
  it("makes 4 letters with no I or O", () => {
    for (let i = 0; i < 200; i++) expect(generateRoomCode(() => false)).toMatch(/^[A-HJ-NP-Z]{4}$/);
  });
  it("never reuses a code in use", () => {
    let calls = 0;
    const code = generateRoomCode((c) => c === "AAAA" && calls++ < 1, () => 0);
    expect(code).toBe("AAAA");
  });
});

describe("relay server", () => {
  it("creates a room and lets phones join it", async () => {
    const { host, code } = await createRoom();
    expect(code).toMatch(/^[A-Z]{4}$/);
    const { joined } = await joinRoom(code, "Ana");
    expect(joined.type).toBe("joined");
    const state = await host.waitForState((s) => s.players.length === 1);
    expect(state.players[0]!.name).toBe("Ana");
    expect(state.players[0]!.animal).toBe("bunny");
  });

  it("rejects an unknown room code", async () => {
    const { joined } = await joinRoom("ZZZZ", "Ana");
    expect(joined).toMatchObject({ type: "error", code: "room_not_found" });
  });

  it("plays a whole game: vote, answer, reveal with scores, game over", async () => {
    const { host, code } = await createRoom();
    const { phone } = await joinRoom(code, "Ana");
    host.send({
      type: "start_game",
      rules: { questions_per_game: 2, questions_per_category: 2, reveal_seconds: 0.05, scoreboard_seconds: 0.05 },
      questions: QUESTIONS,
    });
    await phone.waitForState((s) => s.phase === "category_vote");
    phone.send({ type: "vote", category: "science" });

    const question = await phone.waitForState((s) => s.phase === "question");
    expect(question.reveal).toBeNull();
    expect(JSON.stringify(question)).not.toContain('"answer":2');
    phone.send({ type: "answer", choice: 2 });

    const reveal = await phone.waitForState((s) => s.phase === "reveal");
    expect(reveal.reveal!.correctIndex).toBe(2);
    expect(reveal.players[0]!.score).toBeGreaterThan(1000);

    await phone.waitForState((s) => s.phase === "question" && s.questionNumber === 2);
    phone.send({ type: "answer", choice: 0 });
    const over = await host.waitForState((s) => s.phase === "game_over");
    expect(over.players[0]!.score).toBeGreaterThan(1000);
    expect(over.players[0]!.score).toBeLessThan(3001);
  });

  it("lets a phone that dropped rejoin its seat with the same score", async () => {
    const { host, code } = await createRoom();
    const first = await joinRoom(code, "Ana");
    if (first.joined.type !== "joined") throw new Error("join failed");
    first.phone.socket.close();
    await host.waitForState((s) => s.players[0]?.connected === false);

    const again = await joinRoom(code, "Someone else", first.joined.token);
    expect(again.joined).toMatchObject({ type: "joined", playerId: first.joined.playerId });
    const state = await host.waitForState((s) => s.players[0]?.connected === true);
    expect(state.players).toHaveLength(1);
    expect(state.players[0]!.name).toBe("Ana");
  });

  it("lets the host kick a player", async () => {
    const { host, code } = await createRoom();
    const { phone, joined } = await joinRoom(code, "Ana");
    if (joined.type !== "joined") throw new Error("join failed");
    host.send({ type: "kick", playerId: joined.playerId });
    await phone.waitFor((m) => m.type === "kicked");
    await host.waitForState((s) => s.players.length === 0);
  });

  it("lets the host resume its room after reconnecting", async () => {
    const { host, code, hostToken } = await createRoom();
    host.socket.close();
    const again = await connect("host");
    again.send({ type: "resume_room", code, hostToken });
    const created = await again.waitFor((m) => m.type === "room_created");
    expect(created).toMatchObject({ code });
  });

  it("stops players from sending host commands", async () => {
    const { code } = await createRoom();
    const { phone } = await joinRoom(code, "Ana");
    phone.send({ type: "skip" });
    expect(await phone.waitFor((m) => m.type === "error")).toMatchObject({ code: "not_allowed" });
  });

  it("answers garbage with an error instead of crashing", async () => {
    const host = await connect("host");
    host.send("not json at all" as unknown as object);
    expect(await host.waitFor((m) => m.type === "error")).toMatchObject({ code: "bad_message" });
  });

  it("serves a health check", async () => {
    const res = await fetch(`http://localhost:${server.port}/health`);
    expect(await res.json()).toMatchObject({ ok: true, protocolVersion: PROTOCOL_VERSION });
  });
});
