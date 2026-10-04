import "@fontsource/m-plus-rounded-1c/latin-700.css";
import "@fontsource/m-plus-rounded-1c/latin-800.css";
import {
  ANIMALS,
  MAX_NAME_LENGTH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type Animal,
  type PlayerView,
  type ServerMessage,
  type StateMessage,
} from "@trivia/shared";
import { ServerConnection, resolveServerUrl, statusText } from "./connection";
import { CHOICE_LABELS, formatPoints, ordinal, screenFor, type AppState, type Screen } from "./screens";
import { forgetToken, loadSession, saveSession, type SavedSession } from "./session";

const $ = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`index.html is missing ${selector}`);
  return el;
};

const appEl = $<HTMLElement>("#app");
const topEl = $<HTMLElement>("#top");
const timerEl = $<HTMLElement>("#timer");
const timerFill = $<HTMLElement>("#timer-fill");
const overlayEl = $<HTMLElement>("#overlay");
const toastEl = $<HTMLElement>("#toast");
const statusEl = $<HTMLParagraphElement>("#status");

const app: AppState = { connection: "connecting", joined: false, kicked: false, game: null };
let session: SavedSession | null = loadSession();
let renderedKey = "";
let timerDeadline = 0;
let timerDuration = 1;

// A room code in the link (from the TV) wins over the remembered one.
const linkCode = new URLSearchParams(location.search).get("room")?.toUpperCase() ?? null;
if (linkCode && session && session.code !== linkCode) session = { ...session, code: linkCode, token: null };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function portrait(animal: Animal): string {
  return `/animals/${animal}.png`;
}

function showToast(message: string): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout((showToast as { timer?: number }).timer);
  (showToast as { timer?: number }).timer = window.setTimeout(() => (toastEl.hidden = true), 3500);
}

function me(): PlayerView | undefined {
  return app.game?.players.find((p) => p.id === app.game?.you?.playerId);
}

// ---- Connection ----

const connection = new ServerConnection(resolveServerUrl(window.location, import.meta.env.VITE_SERVER_URL), {
  onState(state, detail) {
    app.connection = state;
    statusEl.dataset.state = state;
    statusEl.textContent = statusText(state, detail);
    render();
  },
  onWelcome() {
    // Rejoin our seat automatically after a reload, a locked phone or a network blip.
    if (session?.token && !app.kicked) sendJoin(session);
  },
  onMessage: handleMessage,
});

function sendJoin(s: SavedSession): void {
  connection.send({ type: "join", code: s.code, name: s.name, animal: s.animal, token: s.token ?? undefined });
}

function handleMessage(message: ServerMessage): void {
  switch (message.type) {
    case "joined":
      app.joined = true;
      app.kicked = false;
      if (session) {
        session = { ...session, code: message.code, token: message.token };
        saveSession(session);
      }
      break;
    case "state":
      app.game = message;
      timerDuration = message.timer?.durationMs ?? 1;
      timerDeadline = message.timer ? performance.now() + message.timer.remainingMs : 0;
      break;
    case "kicked":
      app.kicked = true;
      app.joined = false;
      app.game = null;
      forgetToken();
      session = loadSession();
      break;
    case "error":
      if (message.code === "room_not_found") {
        app.joined = false;
        app.game = null;
        forgetToken();
        session = loadSession();
      }
      if (message.code !== "protocol_mismatch") showToast(message.message);
      break;
    default:
      break;
  }
  render();
}

// When the phone wakes up, reconnect straight away instead of waiting for the retry timer.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") connection.reconnectNow();
});

// ---- Rendering ----

function screenKey(screen: Screen, game: StateMessage | null): string {
  // Re-render when anything a screen shows changes; the join screen keeps its inputs.
  if (screen.kind === "join" || screen.kind === "connecting" || screen.kind === "kicked") return screen.kind;
  return JSON.stringify([screen, game?.phase, game?.question?.id, game?.vote, game?.players.map((p) => [p.name, p.connected, p.score, p.hasActed])]);
}

function render(): void {
  const screen = screenFor(app);
  const game = app.game;
  renderTop(screen);
  renderOverlay(game);
  timerEl.hidden = !(game?.timer && (screen.kind === "vote" || screen.kind === "voted" || screen.kind === "question" || screen.kind === "locked"));

  const key = screenKey(screen, game);
  if (key === renderedKey) return;
  renderedKey = key;

  switch (screen.kind) {
    case "connecting":
      appEl.innerHTML = `<div class="center"><h2>Connecting…</h2><p class="muted">Make sure you're on the same Wi-Fi as the TV.</p></div>`;
      break;
    case "join":
      renderJoin();
      break;
    case "kicked":
      appEl.innerHTML = `<div class="center"><h2>You were removed from the room</h2><p class="muted">Ask the host if this was a mistake.</p><button class="primary" id="again">Join again</button></div>`;
      $<HTMLButtonElement>("#again").onclick = () => {
        app.kicked = false;
        renderedKey = "";
        render();
      };
      break;
    case "lobby":
      renderLobby(game!);
      break;
    case "vote":
      renderVote(game!);
      break;
    case "voted":
      appEl.innerHTML = `<div class="center"><p class="muted">You voted for</p><h1>${escapeHtml(screen.category)}</h1><p class="muted">Waiting for everyone else…</p>${voteTally(game!)}</div>`;
      break;
    case "question":
      renderQuestion(game!);
      break;
    case "locked": {
      const label = CHOICE_LABELS[screen.choice];
      const text = game!.question?.choices[screen.choice] ?? "";
      appEl.innerHTML = `<div class="center"><p class="muted">Answer locked in</p>
        <div class="locked-badge c${screen.choice}">${label?.shape ?? ""}<small>${label?.letter ?? ""}</small></div>
        <h2>${escapeHtml(text)}</h2><p class="muted">Eyes on the TV!</p></div>`;
      break;
    }
    case "reveal":
      renderReveal(game!, screen);
      break;
    case "scoreboard":
    case "game_over":
      renderStanding(game!, screen.kind === "game_over");
      break;
  }
}

function renderTop(screen: Screen): void {
  const player = me();
  if (!player || screen.kind === "join" || screen.kind === "kicked") {
    topEl.innerHTML = "";
    return;
  }
  topEl.innerHTML = `<div class="me"><img src="${portrait(player.animal)}" alt=""><span>${escapeHtml(player.name)}</span></div>
    <span class="code">${escapeHtml(app.game?.code ?? "")}</span>
    <span class="score">${formatPoints(player.score)}</span>`;
}

function renderOverlay(game: StateMessage | null): void {
  if (app.joined && game && !game.hostConnected) {
    overlayEl.innerHTML = `<p>The TV lost its connection</p><p class="muted">Hang tight, it will reconnect…</p>`;
    overlayEl.hidden = false;
  } else if (app.joined && game?.paused) {
    overlayEl.innerHTML = `<p>⏸ Paused</p><p class="muted">The host paused the game.</p>`;
    overlayEl.hidden = false;
  } else if (app.joined && app.connection !== "connected") {
    overlayEl.innerHTML = `<p>Reconnecting…</p><p class="muted">Your seat and score are saved.</p>`;
    overlayEl.hidden = false;
  } else {
    overlayEl.hidden = true;
  }
}

function renderJoin(): void {
  const code = session?.code ?? linkCode ?? "";
  const name = session?.name ?? "";
  let animal: Animal = session?.animal ?? ANIMALS[Math.floor(Math.random() * ANIMALS.length)]!;

  appEl.innerHTML = `
    <div class="brand"><h1>Trivia Party</h1><p class="muted">Join the game on the TV</p></div>
    <label class="field">Room code
      <input id="code" class="code-input" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="${ROOM_CODE_LENGTH}" value="${escapeHtml(code)}" placeholder="ABCD">
    </label>
    <label class="field">Your name
      <input id="name" autocomplete="nickname" maxlength="${MAX_NAME_LENGTH}" value="${escapeHtml(name)}" placeholder="Name">
    </label>
    <div class="field">Pick your animal
      <div class="animals">${ANIMALS.map(
        (a) => `<button type="button" class="animal" data-animal="${a}" aria-pressed="${a === animal}"><img src="${portrait(a)}" alt="">${a}</button>`,
      ).join("")}</div>
    </div>
    <button class="primary" id="join">Join</button>`;

  const codeInput = $<HTMLInputElement>("#code");
  const nameInput = $<HTMLInputElement>("#name");
  const joinButton = $<HTMLButtonElement>("#join");
  const allowed = new RegExp(`[^${ROOM_CODE_ALPHABET}]`, "g");

  const update = () => {
    joinButton.disabled = codeInput.value.length !== ROOM_CODE_LENGTH || nameInput.value.trim() === "";
  };
  codeInput.addEventListener("input", () => {
    // Codes never use I or O (or digits), so anything else is a typo.
    codeInput.value = codeInput.value.toUpperCase().replace(allowed, "");
    if (codeInput.value.length === ROOM_CODE_LENGTH && !nameInput.value) nameInput.focus();
    update();
  });
  nameInput.addEventListener("input", update);
  for (const button of appEl.querySelectorAll<HTMLButtonElement>(".animal")) {
    button.onclick = () => {
      animal = button.dataset.animal as Animal;
      for (const b of appEl.querySelectorAll(".animal")) b.setAttribute("aria-pressed", String(b === button));
    };
  }
  joinButton.onclick = () => {
    session = { code: codeInput.value, name: nameInput.value.trim(), animal, token: null };
    saveSession(session);
    if (!connection.send({ type: "join", code: session.code, name: session.name, animal, token: undefined })) {
      showToast("Not connected yet. Try again in a moment.");
    }
  };
  update();
  if (!code) codeInput.focus();
}

function roster(game: StateMessage): string {
  return `<div class="roster">${game.players
    .map((p) => `<span class="chip${p.connected ? "" : " away"}">${escapeHtml(p.name)}</span>`)
    .join("")}</div>`;
}

function renderLobby(game: StateMessage): void {
  const player = me();
  appEl.innerHTML = `<div class="center">
    ${player ? `<img class="portrait" src="${portrait(player.animal)}" alt="">` : ""}
    <h1>You're in!</h1>
    <p class="muted">Waiting for the host to start the game…</p>
    <p><strong>${game.players.length}</strong> player${game.players.length === 1 ? "" : "s"} here</p>
    ${roster(game)}
  </div>`;
}

function voteTally(game: StateMessage): string {
  const voted = game.players.filter((p) => p.hasActed).length;
  return `<p class="muted">${voted} of ${game.players.filter((p) => p.connected).length} voted</p>`;
}

function renderVote(game: StateMessage): void {
  appEl.innerHTML = `<h2>Pick the next category</h2>
    <div class="options">${(game.vote?.categories ?? [])
      .map((c) => `<button class="option" data-id="${escapeHtml(c.id)}"><span>${escapeHtml(c.name)}</span><span class="votes">${c.votes ? `${c.votes} ✓` : ""}</span></button>`)
      .join("")}</div>${voteTally(game)}`;
  for (const button of appEl.querySelectorAll<HTMLButtonElement>(".option")) {
    button.onclick = () => connection.send({ type: "vote", category: button.dataset.id! });
  }
}

function renderQuestion(game: StateMessage): void {
  const q = game.question;
  if (!q) return;
  appEl.innerHTML = `<p class="category">${escapeHtml(q.categoryName)} · ${game.questionNumber}/${game.questionCount}</p>
    <p class="question-text">${escapeHtml(q.text)}</p>
    <div class="answers">${q.choices
      .map((c, i) => `<button class="answer c${i}" data-i="${i}"><span class="tag">${CHOICE_LABELS[i]?.shape ?? ""} ${CHOICE_LABELS[i]?.letter ?? ""}</span><span>${escapeHtml(c)}</span></button>`)
      .join("")}</div>`;
  for (const button of appEl.querySelectorAll<HTMLButtonElement>(".answer")) {
    button.onclick = () => {
      if (navigator.vibrate) navigator.vibrate(30);
      connection.send({ type: "answer", choice: Number(button.dataset.i) });
    };
  }
}

function renderReveal(game: StateMessage, screen: Extract<Screen, { kind: "reveal" }>): void {
  const player = me();
  const correct = game.reveal?.correctIndex ?? 0;
  const answerText = game.question?.choices[correct] ?? "";
  const label = CHOICE_LABELS[correct];
  const headline = !screen.answered ? "Too slow!" : screen.correct ? "Correct!" : "Not quite";
  appEl.innerHTML = `<div class="center">
    ${player ? `<img class="portrait small" src="${portrait(player.animal)}" alt="">` : ""}
    <p class="result ${screen.correct ? "good" : "bad"}">${headline}</p>
    ${screen.correct ? `<p class="points">+${formatPoints(player?.lastPoints ?? 0)}</p>` : ""}
    <p class="muted">The answer was</p>
    <h2>${label?.shape ?? ""} ${label?.letter ?? ""}: ${escapeHtml(answerText)}</h2>
  </div>`;
}

function renderStanding(game: StateMessage, final: boolean): void {
  const player = me();
  if (!player) return;
  const leader = [...game.players].sort((a, b) => b.score - a.score)[0];
  const behind = leader && leader.id !== player.id ? leader.score - player.score : 0;
  appEl.innerHTML = `<div class="center">
    <img class="portrait" src="${portrait(player.animal)}" alt="">
    <p class="muted">${final ? "Final result" : `After question ${game.questionNumber} of ${game.questionCount}`}</p>
    <p class="big-number">${ordinal(player.rank)}</p>
    <h2>${final && player.rank === 1 ? "You win! 🏆" : `of ${game.players.length} players`}</h2>
    <p class="points">${formatPoints(player.score)} pts</p>
    ${behind > 0 ? `<p class="muted">${formatPoints(behind)} behind ${escapeHtml(leader!.name)}</p>` : ""}
    ${final ? `<p class="muted">The host can start a new game from the TV.</p>` : ""}
  </div>`;
}

// ---- Timer bar ----

function tick(): void {
  if (!timerEl.hidden && timerDeadline) {
    const paused = app.game?.paused;
    const remaining = paused ? (app.game?.timer?.remainingMs ?? 0) : Math.max(0, timerDeadline - performance.now());
    const fraction = Math.min(1, remaining / timerDuration);
    timerFill.style.transform = `scaleX(${fraction})`;
    timerFill.classList.toggle("urgent", remaining < 5000);
  }
  requestAnimationFrame(tick);
}

render();
connection.start();
requestAnimationFrame(tick);
