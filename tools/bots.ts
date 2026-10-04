// Fake players for testing without friends (manifest Phase 1).
//
//   npm run bots -- ABCD            15 bots join room ABCD
//   npm run bots -- ABCD 5          5 bots
//   npm run bots -- --host 3        no TV needed: create a room, wait for 3 players
//                                   (bots + real phones), then start a game
//
// Options:
//   --server ws://host:8787   which relay server (default ws://localhost:8787)
//   --fast                    answer within a second (for quick load tests)
//   --churn                   bots randomly drop and rejoin, to test reconnects
//   --quiet                   less logging

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import {
  ANIMALS,
  DEFAULT_SERVER_PORT,
  PROTOCOL_VERSION,
  QuestionPackSchema,
  type ClientMessage,
  type Question,
  type ServerMessage,
  type StateMessage,
} from "@trivia/shared";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !(args[i - 1] ?? "").match(/^--(server|host)$/));

const serverUrl = option("--server") ?? `ws://localhost:${DEFAULT_SERVER_PORT}`;
const fast = flag("--fast");
const churn = flag("--churn");
const quiet = flag("--quiet");
const hostMode = flag("--host");

const NAMES = ["Mochi", "Pocky", "Yuzu", "Sora", "Kiki", "Taro", "Hana", "Riku", "Nori", "Momo", "Kuma", "Ume", "Aoi", "Ren", "Suki", "Tama"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;
const log = (...parts: unknown[]) => {
  if (!quiet) console.log(...parts);
};

function connect(role: "host" | "player", onMessage: (m: ServerMessage, send: (m: ClientMessage) => void) => void): Promise<WebSocket> {
  return new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(serverUrl);
    const send = (m: ClientMessage) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(m));
    socket.on("open", () => {
      send({ type: "hello", role, protocolVersion: PROTOCOL_VERSION });
      resolveSocket(socket);
    });
    socket.on("error", reject);
    socket.on("message", (data) => onMessage(JSON.parse(data.toString()) as ServerMessage, send));
  });
}

/** One fake phone. Votes and answers at random with human-ish delays. */
async function runBot(code: string, index: number): Promise<void> {
  const name = `${NAMES[index % NAMES.length]}${index >= NAMES.length ? index : ""}`.slice(0, 12);
  const animal = pick(ANIMALS);
  let token: string | undefined;
  let lastKey = "";

  const play = async (state: StateMessage, send: (m: ClientMessage) => void) => {
    const key = `${state.phase}:${state.questionNumber}`;
    if (key === lastKey || state.paused) return;
    if (state.phase === "category_vote" && !state.you?.vote && state.vote) {
      lastKey = key;
      await sleep(fast ? Math.random() * 300 : 800 + Math.random() * 3000);
      send({ type: "vote", category: pick(state.vote.categories).id });
    } else if (state.phase === "question" && state.you?.answer == null && state.question) {
      lastKey = key;
      const window = state.timer?.remainingMs ?? 10_000;
      await sleep(fast ? Math.random() * 800 : Math.min(window * 0.9, 1500 + Math.random() * window * 0.7));
      send({ type: "answer", choice: Math.floor(Math.random() * state.question.choices.length) });
    }
  };

  const join = async (): Promise<WebSocket> =>
    connect("player", (message, send) => {
      if (message.type === "welcome") send({ type: "join", code, name, animal, token });
      else if (message.type === "joined") {
        if (!token) log(`[bot] ${name} joined as ${animal}`);
        token = message.token;
      } else if (message.type === "state") void play(message, send);
      else if (message.type === "error") log(`[bot] ${name}: ${message.message}`);
      else if (message.type === "kicked") log(`[bot] ${name} was kicked`);
    });

  let socket = await join();
  if (!churn) return;
  for (;;) {
    await sleep(10_000 + Math.random() * 30_000);
    log(`[bot] ${name} drops out…`);
    socket.close();
    await sleep(2000 + Math.random() * 6000);
    lastKey = "";
    socket = await join();
    log(`[bot] ${name} is back`);
  }
}

function loadQuestions(): Question[] {
  const dir = join(root, "content", "questions");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => QuestionPackSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))).questions);
}

/** Stand-in for the Godot host: creates a room and starts a game once enough players join. */
async function runFakeHost(waitFor: number): Promise<string> {
  const rules = JSON.parse(readFileSync(join(root, "host", "config", "game_rules.json"), "utf8"));
  const questions = loadQuestions();
  return new Promise((resolveCode) => {
    let started = false;
    let lastPhase = "";
    void connect("host", (message, send) => {
      if (message.type === "welcome") send({ type: "create_room" });
      else if (message.type === "room_created") {
        console.log(`\n  Room code: ${message.code}   (phones: open the phone page and type it)\n`);
        resolveCode(message.code);
      } else if (message.type === "state") {
        if (message.phase !== lastPhase) {
          lastPhase = message.phase;
          const extra = message.phase === "question" ? ` ${message.questionNumber}/${message.questionCount}: ${message.question?.text}` : "";
          log(`[host] ${message.phase}${extra}`);
          if (message.phase === "game_over") {
            const table = [...message.players].sort((a, b) => a.rank - b.rank).map((p) => `  ${p.rank}. ${p.name} ${p.score}`);
            console.log(table.join("\n"));
          }
        }
        if (!started && message.phase === "lobby" && message.players.filter((p) => p.connected).length >= waitFor) {
          started = true;
          log(`[host] ${waitFor} players here, starting`);
          send({ type: "start_game", rules, questions });
        }
      } else if (message.type === "error") console.log(`[host] error: ${message.message}`);
    });
  });
}

async function main(): Promise<void> {
  if (hostMode) {
    const waitFor = Number(option("--host") ?? 1);
    const code = await runFakeHost(Number.isFinite(waitFor) ? waitFor : 1);
    const botCount = Number(positional[0] ?? 0);
    for (let i = 0; i < botCount; i++) void runBot(code, i);
    return;
  }
  const code = positional[0]?.toUpperCase();
  if (!code) {
    console.log("Usage: npm run bots -- <ROOM CODE> [count]   or   npm run bots -- --host <players to wait for> [bots]");
    process.exit(1);
  }
  const count = Math.min(16, Number(positional[1] ?? 15));
  console.log(`Sending ${count} bots to room ${code} on ${serverUrl}`);
  for (let i = 0; i < count; i++) {
    void runBot(code, i);
    await sleep(100);
  }
}

void main();
