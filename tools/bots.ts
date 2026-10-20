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
//   --length short|standard|long, --no-drawing   (with --host) game settings

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import {
  ANIMALS,
  DrawingPackSchema,
  PEN_COLORS,
  DEFAULT_SERVER_PORT,
  PROTOCOL_VERSION,
  QuestionPackSchema,
  type ClientMessage,
  type Question,
  type ServerMessage,
  type StateMessage,
  type Stroke,
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

const FAKE_TITLES = [
  "A potato with dreams", "Grandpa's new hobby", "A very confused lamp", "Breakfast gone wrong",
  "The cat's secret plan", "A duck in a hurry", "Monday morning", "My cousin's wedding",
  "A sandwich with feelings", "The world's worst haircut", "A cloud on a diet", "Dinner with a ghost",
  "A dog's first selfie", "Pizza day at the zoo", "A worried banana", "The fanciest snail",
];

/** A quick doodle: a face in a circle and a squiggle, in random pens. */
function doodle(): Stroke[] {
  const strokes: Stroke[] = [];
  const cx = 300 + Math.floor(Math.random() * 400);
  const cy = 300 + Math.floor(Math.random() * 400);
  const r = 120 + Math.floor(Math.random() * 120);
  const circle: number[] = [];
  for (let a = 0; a <= 32; a++) {
    circle.push(Math.round(cx + Math.cos((a / 32) * Math.PI * 2) * r), Math.round(cy + Math.sin((a / 32) * Math.PI * 2) * r));
  }
  strokes.push({ c: Math.floor(Math.random() * PEN_COLORS.length), w: 1, p: circle.map((v) => Math.max(0, Math.min(1000, v))) });
  for (const dx of [-r / 3, r / 3]) strokes.push({ c: 0, w: 2, p: [Math.round(cx + dx), cy - 30, Math.round(cx + dx), cy - 25] });
  const squiggle: number[] = [];
  for (let i = 0; i < 20; i++) squiggle.push(100 + i * 40, 850 + Math.round(Math.sin(i) * 60));
  strokes.push({ c: 1, w: 1, p: squiggle.map((v) => Math.max(0, Math.min(1000, v))) });
  return strokes;
}

/** One fake phone. Plays every round type at random with human-ish delays. */
async function runBot(code: string, index: number): Promise<void> {
  const name = `${NAMES[index % NAMES.length]}${index >= NAMES.length ? index : ""}`.slice(0, 12);
  const animal = pick(ANIMALS);
  let token: string | undefined;
  let lastKey = "";
  let liesTried = 0;
  const delay = (min: number, spread: number, windowMs?: number) =>
    sleep(fast ? Math.random() * 600 : Math.min((windowMs ?? 30_000) * 0.85, min + Math.random() * spread));

  const play = async (state: StateMessage, send: (m: ClientMessage) => void) => {
    const round = state.round;
    if (state.phase !== "round" || !round || state.paused) return;
    const step = "step" in round ? round.step : "";
    const number = round.kind === "drawing" ? round.drawingNumber : round.questionNumber;
    const key = `${state.roundIndex}:${round.kind}:${step}:${number}`;
    if (key === lastKey) return;
    const windowMs = state.timer?.remainingMs;
    const players = state.players.filter((p) => p.id !== state.you?.playerId);

    if (round.kind === "closest") {
      if (round.step !== "question" || round.me?.guess != null) return;
      lastKey = key;
      await delay(2000, 6000, windowMs);
      const year = /year/i.test(round.question.unit ?? "");
      send({ type: "guess", value: year ? 1850 + Math.floor(Math.random() * 170) : Math.floor(Math.random() * 300) });
      return;
    }

    if (round.kind === "drawing") {
      const me = round.me;
      if (!me) return;
      if (round.step === "drawing" && me.isArtist && !me.submitted) {
        lastKey = key;
        await delay(4000, 8000, windowMs);
        send({ type: "drawing", strokes: doodle() });
      } else if (round.step === "lying" && !me.isArtist && !me.lie) {
        lastKey = key;
        liesTried = 0;
        await delay(2000, 6000, windowMs);
        send({ type: "lie", text: pick(FAKE_TITLES) });
      } else if (round.step === "picking" && !me.isArtist && !me.pick && round.options) {
        lastKey = key;
        await delay(1500, 5000, windowMs);
        const mine = me.lie?.toLowerCase();
        const choices = round.options.filter((o) => o.text.toLowerCase() !== mine);
        if (choices.length) send({ type: "pick", option: pick(choices).id });
      }
      return;
    }

    // Quiz rounds.
    const me = round.me;
    if (round.step === "vote" && round.vote && !me?.vote) {
      lastKey = key;
      await delay(800, 3000, windowMs);
      send({ type: "vote", category: pick(round.vote.categories).id });
    } else if (round.step === "wager" && me && me.wager == null) {
      lastKey = key;
      await delay(1500, 4000, windowMs);
      send({ type: "wager", amount: Math.round(me.maxWager * pick([0, 0.25, 0.5, 1])) });
    } else if (round.step === "question" && round.question && me?.answer == null) {
      lastKey = key;
      await delay(1500, (windowMs ?? 10_000) * 0.7, windowMs);
      send({ type: "answer", choice: Math.floor(Math.random() * round.question.choices.length) });
    } else if (round.step === "steal" && me?.canSteal && !me.stealTarget && players.length) {
      lastKey = key;
      await delay(1000, 3000, windowMs);
      send({ type: "steal", target: pick(players).id });
    }
  };

  const join = async (): Promise<WebSocket> =>
    connect("player", (message, send) => {
      if (message.type === "welcome") send({ type: "join", code, name, animal, token });
      else if (message.type === "joined") {
        if (!token) log(`[bot] ${name} joined as ${animal}`);
        token = message.token;
      } else if (message.type === "state") void play(message, send);
      else if (message.type === "error") {
        // Someone already wrote that fake title (or it was the real one): try another.
        if ((message.code === "duplicate" || message.code === "too_close") && liesTried++ < 5) {
          send({ type: "lie", text: `${pick(FAKE_TITLES)} ${Math.floor(Math.random() * 100)}` });
        } else log(`[bot] ${name}: ${message.message}`);
      } else if (message.type === "kicked") log(`[bot] ${name} was kicked`);
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

function loadDrawingPack() {
  return DrawingPackSchema.parse(JSON.parse(readFileSync(join(root, "content", "drawing", "prompts.json"), "utf8")));
}

/** Stand-in for the Godot host: creates a room and starts a game once enough players join. */
async function runFakeHost(waitFor: number): Promise<string> {
  const rules = JSON.parse(readFileSync(join(root, "host", "config", "game_rules.json"), "utf8"));
  const questions = loadQuestions();
  const drawing = loadDrawingPack();
  const length = (option("--length") ?? "standard") as "short" | "standard" | "long";
  return new Promise((resolveCode) => {
    let started = false;
    let lastKey = "";
    void connect("host", (message, send) => {
      if (message.type === "welcome") send({ type: "create_room" });
      else if (message.type === "room_created") {
        console.log(`\n  Room code: ${message.code}   (phones: open the phone page and type it)\n`);
        resolveCode(message.code);
      } else if (message.type === "state") {
        const round = message.round;
        const step = round && "step" in round ? round.step : "";
        const key = `${message.phase}:${message.roundIndex}:${step}`;
        if (key !== lastKey) {
          lastKey = key;
          const title = message.phase === "intro" ? ` Round ${message.roundIndex + 1}/${message.roundCount}: ${message.roundTitle}` : "";
          log(`[host] ${message.phase}${step ? " · " + step : ""}${title}`);
          if (message.phase === "game_over") {
            const table = [...message.players].sort((a, b) => a.rank - b.rank).map((p) => `  ${p.rank}. ${p.name} ${p.score}`);
            console.log(table.join("\n"));
          }
        }
        if (!started && message.phase === "lobby" && message.players.filter((p) => p.connected).length >= waitFor) {
          started = true;
          log(`[host] ${waitFor} players here, starting a ${length} game`);
          send({
            type: "start_game",
            rules,
            settings: { length, drawing: !flag("--no-drawing"), categories: [] },
            questions,
            prompts: drawing.prompts,
            decoys: drawing.decoys,
          });
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
