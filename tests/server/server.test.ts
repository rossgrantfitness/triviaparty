import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { PROTOCOL_VERSION, parseServerMessage, type ServerMessage } from "@trivia/shared";
import { startServer, type RunningServer } from "../../server/src/server";

let server: RunningServer;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  server = await startServer({ port: 0, quiet: true });
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await server.close();
});

async function connect(): Promise<WebSocket> {
  const socket = new WebSocket(`ws://localhost:${server.port}`);
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

function nextMessage(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      const result = parseServerMessage(data.toString());
      if (result.ok) resolve(result.message);
      else reject(new Error(result.error));
    });
  });
}

describe("relay server", () => {
  it("welcomes a host", async () => {
    const socket = await connect();
    const reply = nextMessage(socket);
    socket.send(JSON.stringify({ type: "hello", role: "host", protocolVersion: PROTOCOL_VERSION }));
    const message = await reply;
    expect(message.type).toBe("welcome");
    expect(message.type === "welcome" && message.role).toBe("host");
    expect(server.connectionCount()).toBe(1);
  });

  it("gives each connection its own id", async () => {
    const ids: string[] = [];
    for (const role of ["host", "player", "player"]) {
      const socket = await connect();
      const reply = nextMessage(socket);
      socket.send(JSON.stringify({ type: "hello", role, protocolVersion: PROTOCOL_VERSION }));
      const message = await reply;
      if (message.type === "welcome") ids.push(message.connectionId);
    }
    expect(new Set(ids).size).toBe(3);
    expect(server.connectionCount()).toBe(3);
  });

  it("answers garbage with an error instead of crashing", async () => {
    const socket = await connect();
    const reply = nextMessage(socket);
    socket.send("this is not json");
    expect(await reply).toMatchObject({ type: "error", code: "bad_message" });
  });

  it("rejects an old protocol version", async () => {
    const socket = await connect();
    const reply = nextMessage(socket);
    socket.send(JSON.stringify({ type: "hello", role: "player", protocolVersion: PROTOCOL_VERSION + 99 }));
    expect(await reply).toMatchObject({ type: "error", code: "protocol_mismatch" });
    expect(server.connectionCount()).toBe(0);
  });

  it("forgets a client that disconnects", async () => {
    const socket = await connect();
    const reply = nextMessage(socket);
    socket.send(JSON.stringify({ type: "hello", role: "player", protocolVersion: PROTOCOL_VERSION }));
    await reply;
    const closed = new Promise((resolve) => socket.once("close", resolve));
    socket.close();
    await closed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.connectionCount()).toBe(0);
  });

  it("serves a health check", async () => {
    const res = await fetch(`http://localhost:${server.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, protocolVersion: PROTOCOL_VERSION });
  });
});
