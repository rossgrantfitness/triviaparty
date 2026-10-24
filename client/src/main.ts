import "@fontsource/m-plus-rounded-1c/latin-700.css";
import "@fontsource/m-plus-rounded-1c/latin-800.css";
import {
  ACCESSORIES,
  ANIMALS,
  EMOTES,
  EMOTE_INFO,
  MAX_AVATAR_STROKES,
  MAX_LIE_LENGTH,
  MAX_NAME_LENGTH,
  PEN_COLORS,
  PEN_WIDTHS,
  ROOM_CODE_ALPHABET,
  MAX_ROOM_CODE_LENGTH,
  ROOM_CODE_LENGTH,
  type Accessory,
  type Animal,
  type ClientMessage,
  type DrawOffView,
  type Stroke,
  type ClosestView,
  type DrawingView,
  type PlayerView,
  type QuizView,
  type ServerMessage,
  type StateMessage,
} from "@trivia/shared";
import { DrawingPad, drawingImage } from "./canvas";
import { confetti, countUp, shake, stamp } from "./juice";
import { isMuted, play, setMuted, unlockAudio, type SoundName } from "./sfx";
import { ServerConnection, resolveServerUrl, statusText } from "./connection";
import {
  CHOICE_LABELS,
  WAGER_STEPS,
  formatPoints,
  ordinal,
  screenFor,
  signedPoints,
  stealLine,
  type AppState,
  type Screen,
} from "./screens";
import { forgetToken, loadSession, saveSession, type SavedSession } from "./session";

const $ = <T extends HTMLElement>(selector: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
};

const appEl = $<HTMLElement>("#app");
const topEl = $<HTMLElement>("#top");
const timerEl = $<HTMLElement>("#timer");
const timerFill = $<HTMLElement>("#timer-fill");
const overlayEl = $<HTMLElement>("#overlay");
const toastEl = $<HTMLElement>("#toast");
const statusEl = $<HTMLParagraphElement>("#status");
const emotesEl = $<HTMLElement>("#emotes");

/** Labels for hats on the join screen. */
const ACCESSORY_LABELS: Record<Accessory, string> = {
  none: "No hat",
  party_hat: "Party hat",
  headband: "Headband",
  bow: "Bow",
  crown: "Crown",
  top_hat: "Top hat",
  flower: "Flower",
  glasses: "Glasses",
};
const ACCESSORY_ICONS: Record<Accessory, string> = {
  none: "✖", party_hat: "🥳", headband: "🎌", bow: "🎀", crown: "👑", top_hat: "🎩", flower: "🌸", glasses: "🕶️",
};
const EMOTE_COOLDOWN_MS = 1300;
let lastEmoteAt = 0;
let lastTickSecond = -1;
let firstJoin = false;

const app: AppState = { connection: "connecting", joined: false, kicked: false, game: null };
let session: SavedSession | null = loadSession();
let renderedKey = "";
let timerDeadline = 0;
let timerDuration = 1;
let pad: DrawingPad | null = null;

// A room code in the link (from the TV) wins over the remembered one.
const linkCode = new URLSearchParams(location.search).get("room")?.toUpperCase() ?? null;
if (linkCode && session && session.code !== linkCode) session = { ...session, code: linkCode, token: null };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function portrait(animal: Animal): string {
  return `/animals/${animal}.png`;
}

let toastTimer = 0;
function showToast(message: string): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 3500);
}

function me(): PlayerView | undefined {
  return app.game?.players.find((p) => p.id === app.game?.you?.playerId);
}

function playerName(id: string): string {
  return app.game?.players.find((p) => p.id === id)?.name ?? "Someone";
}

function send(message: ClientMessage): void {
  if (!connection.send(message)) showToast("Not connected. Hang on a second…");
}

function buzz(ms = 25): void {
  navigator.vibrate?.(ms);
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
    if (session?.token && !app.kicked) {
      connection.send({ type: "join", code: session.code, name: session.name, animal: session.animal, accessory: session.accessory ?? "none", token: session.token });
    }
  },
  onMessage: handleMessage,
});

function handleMessage(message: ServerMessage): void {
  switch (message.type) {
    case "joined":
      if (!app.joined) play("join");
      app.joined = true;
      app.kicked = false;
      // First time in this room: offer the self-portrait.
      if (firstJoin) {
        app.drawingAvatar = true;
        firstJoin = false;
      }
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
      if (message.code === "too_close" || message.code === "duplicate") renderedKey = ""; // let them type again
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

/** Screens with inputs (drawing, typing) must not be rebuilt by every update, or work is lost. */
const STEADY_SCREENS = new Set<Screen["kind"]>(["join", "connecting", "kicked", "draw", "lie", "guess", "wager", "avatar", "drawoff_draw"]);
/** Screens where the countdown ticks get urgent because you still have to act. */
const ACT_SCREENS = new Set<Screen["kind"]>(["vote", "wager", "question", "steal", "guess", "draw", "lie", "pick", "drawoff_draw", "drawoff_vote"]);
/** No emote bar while drawing or typing: it would get in the way. */
const NO_EMOTE_SCREENS = new Set<Screen["kind"]>(["join", "connecting", "kicked", "draw", "avatar", "drawoff_draw", "lie", "guess"]);

function screenKey(screen: Screen, game: StateMessage | null): string {
  const round = game?.round;
  const roundId = round ? [round.kind, round.step, "questionNumber" in round ? round.questionNumber : "drawingNumber" in round ? round.drawingNumber : 0] : null;
  if (STEADY_SCREENS.has(screen.kind)) return JSON.stringify([screen.kind, game?.roundIndex, roundId]);
  return JSON.stringify([
    screen,
    game?.phase,
    game?.roundIndex,
    roundId,
    round && "vote" in round ? round.vote : null,
    round?.kind === "drawing" ? round.reveal?.shown : null,
    round?.kind === "drawoff" ? round.gallery.length : null,
    game?.players.map((p) => [p.name, p.connected, p.score, p.hasActed]),
  ]);
}

const TIMED_SCREENS = new Set<Screen["kind"]>([
  "drawoff_draw", "drawoff_drawn", "drawoff_vote", "drawoff_voted",
  "vote", "voted", "wager", "wagered", "question", "locked", "steal", "guess", "guessed", "draw", "drawn", "lie", "lied", "pick", "picked", "artist_wait", "judge_wait",
]);

function render(): void {
  const screen = screenFor(app);
  const game = app.game;
  renderTop(screen);
  renderOverlay(game);
  timerEl.hidden = !(game?.timer && TIMED_SCREENS.has(screen.kind));

  emotesEl.hidden = !app.joined || NO_EMOTE_SCREENS.has(screen.kind);

  const key = screenKey(screen, game);
  if (key === renderedKey) return;
  const newScreen = appEl.dataset.screen !== screen.kind;
  renderedKey = key;
  if (screen.kind !== "draw" && screen.kind !== "avatar" && screen.kind !== "drawoff_draw") pad = null;
  appEl.dataset.screen = screen.kind;
  if (newScreen) {
    appEl.classList.remove("enter");
    void appEl.offsetWidth;
    appEl.classList.add("enter");
  }
  window.setTimeout(() => react(screen), 0);

  switch (screen.kind) {
    case "connecting":
      return html(`<div class="center"><h2>Connecting…</h2><p class="muted">Make sure you're online.</p></div>`);
    case "join":
      return renderJoin();
    case "kicked":
      html(`<div class="center"><h2>You were removed from the room</h2><p class="muted">Ask the host if this was a mistake.</p><button class="primary" id="again">Join again</button></div>`);
      $<HTMLButtonElement>("#again").onclick = () => {
        app.kicked = false;
        renderedKey = "";
        render();
      };
      return;
    case "lobby":
      return renderLobby(game!);
    case "avatar":
      return renderAvatar();
    case "intro":
      return renderIntro(game!);
    case "standings":
      return renderStandings(game!, screen.final);
    // Quiz
    case "vote":
      return renderVote(game!.round as QuizView);
    case "voted":
      return waitScreen("You voted for", screen.category, `${actedCount(game!)} voted so far`);
    case "wager":
      return renderWager(game!.round as QuizView);
    case "wagered":
      return waitScreen("Your bet is in", `${formatPoints(screen.amount)} points`, "Fingers crossed…");
    case "question":
      return renderQuestion(game!.round as QuizView);
    case "locked":
      return renderLocked(game!.round as QuizView, screen.choice);
    case "reveal":
      return renderReveal(game!.round as QuizView, screen);
    case "steal":
      return renderSteal(game!);
    case "steal_wait":
      return waitScreen("Sticky fingers!", "The quick and correct are choosing who to rob…", "Hold on to your points");
    case "steal_reveal":
      return renderStealReveal(game!.round as QuizView);
    // Closest
    case "guess":
      return renderGuess(game!.round as ClosestView);
    case "guessed":
      return waitScreen("Your guess", formatNumber(screen.value, (game!.round as ClosestView).question.unit), "Eyes on the TV!");
    case "closest_reveal":
      return renderClosestReveal(game!.round as ClosestView);
    // Drawing
    case "draw":
      return renderPad({
        caption: "Draw this (shh, it's secret!)",
        prompt: screen.prompt,
        done: "I'm done!",
        onDone: (strokes) => send({ type: "drawing", strokes }),
      });
    case "drawn":
      return waitScreen("Masterpiece submitted!", "🎨", "Waiting for the other artists…");
    case "judge_wait":
      return waitScreen("You're a judge this time", "The artists are drawing…", "You'll write fake titles for their drawings next!");
    case "lie":
      return renderLie(game!.round as DrawingView);
    case "lied":
      return waitScreen("Your fake title", `“${screen.text}”`, "Let's see who falls for it…");
    case "artist_wait":
      return renderArtistWait(game!.round as DrawingView);
    case "pick":
      return renderPick(game!.round as DrawingView);
    case "picked":
      return waitScreen("Locked in", "Watch the TV for the truth!", "");
    case "drawing_reveal":
      return renderDrawingReveal(game!.round as DrawingView);
    // Draw-Off
    case "drawoff_draw":
      return renderPad({
        caption: "Draw-Off! Everyone draws this",
        prompt: screen.prompt,
        done: "Hang it in the gallery!",
        onDone: (strokes) => send({ type: "drawing", strokes }),
      });
    case "drawoff_drawn":
      return waitScreen("Framed and hung!", "🖼️", "Waiting for the other artists…");
    case "drawoff_vote":
      return renderDrawOffVote(game!.round as DrawOffView);
    case "drawoff_voted":
      return waitScreen("Vote cast", "Look at the TV!", "Let's see who wins the gallery…");
    case "drawoff_reveal":
      return renderDrawOffReveal(game!.round as DrawOffView);
  }
}

/** Sounds and effects that answer what just appeared on screen. */
let reactedKey = "";
function react(screen: Screen): void {
  const game = app.game;
  const player = me();
  const key = `${screen.kind}:${game?.roundIndex}:${JSON.stringify(screen)}:${game?.round && "questionNumber" in game.round ? game.round.questionNumber : ""}:${game?.round?.kind === "drawing" ? game.round.drawingNumber + ":" + (game.round.reveal?.shown ?? 0) : ""}`;
  if (key === reactedKey) return;
  reactedKey = key;
  const sfx = (name: SoundName) => play(name);
  switch (screen.kind) {
    case "reveal":
      if (screen.correct) {
        sfx("correct");
        confetti();
      } else {
        sfx("wrong");
        shake(appEl);
      }
      break;
    case "closest_reveal": {
      const result = (game?.round as ClosestView | null)?.reveal?.results.find((r) => r.playerId === player?.id);
      if (result?.distance === 0) {
        sfx("correct");
        stamp("BULLSEYE!", "#f47a1f");
        confetti(60);
      } else if (result?.points) {
        sfx("correct");
        confetti(20);
      } else sfx("wrong");
      break;
    }
    case "steal_reveal": {
      const steals = (game?.round as QuizView | null)?.steals ?? [];
      if (steals.some((s) => s.thief === player?.id)) {
        sfx("steal");
        stamp("YOINK!", "#f47a1f");
        confetti(24);
      } else if (steals.some((s) => s.victim === player?.id && s.amount > 0)) {
        sfx("steal");
        stamp("ROBBED!", "#de4a3b");
        shake(appEl);
        buzz(200);
      }
      break;
    }
    case "drawing_reveal": {
      const round = game?.round as DrawingView | null;
      const truthShown = round?.reveal?.items.slice(0, round.reveal.shown).some((i) => i.truth);
      if (truthShown && round?.artistId !== player?.id) {
        const spotted = round?.reveal?.items.find((i) => i.truth)?.pickers.includes(player?.id ?? "");
        if (spotted) {
          sfx("correct");
          confetti(24);
        } else sfx("wrong");
      }
      break;
    }
    case "drawoff_reveal": {
      const round = game?.round as DrawOffView | null;
      const mine = round?.gallery.find((g) => g.artistId === player?.id);
      if (mine && round?.gallery[0]?.id === mine.id && (mine.votes ?? 0) > 0) {
        play("winner");
        confetti(70);
      } else if ((mine?.votes ?? 0) > 0) sfx("points");
      break;
    }
    case "standings":
      if (screen.final && player?.rank === 1) {
        play("winner");
        confetti(90);
      } else if (player?.roundPoints) sfx("points");
      break;
    case "locked":
    case "lied":
    case "picked":
    case "guessed":
    case "drawoff_voted":
      sfx("lock");
      break;
    case "wagered":
      sfx("wager");
      break;
    case "voted":
      sfx("vote");
      break;
    case "drawn":
    case "drawoff_drawn":
      sfx("drawing_done");
      break;
  }
  // Count points up wherever they appear.
  for (const el of appEl.querySelectorAll<HTMLElement>("[data-count]")) {
    const to = Number(el.dataset.count);
    countUp(el, to, (n) => (el.dataset.signed ? signedPoints(n) : formatPoints(n)) + (el.dataset.suffix ?? ""));
  }
}

// ---- Emotes ----

function renderEmotes(): void {
  emotesEl.innerHTML = EMOTES.map(
    (e) => `<button class="emote" data-emote="${e}" aria-label="${EMOTE_INFO[e].label}"><span>${EMOTE_INFO[e].emoji}</span></button>`,
  ).join("");
  for (const button of emotesEl.querySelectorAll<HTMLButtonElement>(".emote")) {
    button.onclick = () => {
      const now = performance.now();
      if (now - lastEmoteAt < EMOTE_COOLDOWN_MS) return;
      lastEmoteAt = now;
      play("emote", 0.9 + Math.random() * 0.3);
      buzz(15);
      button.classList.remove("popped");
      void button.offsetWidth;
      button.classList.add("popped");
      emotesEl.classList.add("cooling");
      window.setTimeout(() => emotesEl.classList.remove("cooling"), EMOTE_COOLDOWN_MS);
      send({ type: "emote", emote: button.dataset.emote as (typeof EMOTES)[number] });
    };
  }
}

function html(markup: string): void {
  appEl.innerHTML = markup;
}

function waitScreen(caption: string, headline: string, footnote: string): void {
  const player = me();
  html(`<div class="center">
    ${player ? `<img class="portrait small bob" src="${portrait(player.animal)}" alt="">` : ""}
    <p class="muted">${escapeHtml(caption)}</p>
    <h1>${escapeHtml(headline)}</h1>
    ${footnote ? `<p class="muted">${escapeHtml(footnote)}</p>` : ""}
  </div>`);
}

function actedCount(game: StateMessage): string {
  return `${game.players.filter((p) => p.hasActed).length} of ${game.players.filter((p) => p.connected).length}`;
}

function formatNumber(value: number, unit: string | null): string {
  const isYear = unit === "year";
  const text = isYear ? String(value) : value.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return unit && !isYear ? `${text} ${unit}` : text;
}

function renderTop(screen: Screen): void {
  const player = me();
  if (!player || screen.kind === "join" || screen.kind === "kicked") {
    topEl.innerHTML = "";
    return;
  }
  const game = app.game!;
  const round = game.phase !== "lobby" && game.roundCount ? `<span class="code">${escapeHtml(game.roundTitle ?? "")}</span>` : `<span class="code">${escapeHtml(game.code)}</span>`;
  topEl.innerHTML = `<div class="me"><img src="${portrait(player.animal)}" alt=""><span>${escapeHtml(player.name)}</span></div>
    ${round}
    <span class="score">${formatPoints(player.score)}</span>
    <button class="mute" id="mute" aria-label="Sound on or off">${isMuted() ? "🔇" : "🔊"}</button>`;
  $<HTMLButtonElement>("#mute").onclick = () => {
    setMuted(!isMuted());
    renderTop(screen);
  };
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

// ---- Lobby, intro, standings ----

function renderJoin(): void {
  const code = session?.code ?? linkCode ?? "";
  const name = session?.name ?? "";
  let animal: Animal = session?.animal ?? ANIMALS[Math.floor(Math.random() * ANIMALS.length)]!;
  let accessory: Accessory = session?.accessory ?? "none";
  html(`
    <div class="brand"><h1>Trivia Party</h1><p class="muted">Join the game on the TV</p></div>
    <label class="field">Room code
      <input id="code" class="code-input" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="${MAX_ROOM_CODE_LENGTH}" value="${escapeHtml(code)}" placeholder="ABCD">
    </label>
    <label class="field">Your name
      <input id="name" autocomplete="nickname" maxlength="${MAX_NAME_LENGTH}" value="${escapeHtml(name)}" placeholder="Name">
    </label>
    <div class="field">Pick your animal
      <div class="animals">${ANIMALS.map(
        (a) => `<button type="button" class="animal" data-animal="${a}" aria-pressed="${a === animal}"><img src="${portrait(a)}" alt="">${a}</button>`,
      ).join("")}</div>
    </div>
    <div class="field">Pick a hat
      <div class="hats">${ACCESSORIES.map(
        (h) => `<button type="button" class="hat" data-hat="${h}" aria-pressed="${h === accessory}" title="${ACCESSORY_LABELS[h]}"><span>${ACCESSORY_ICONS[h]}</span><small>${ACCESSORY_LABELS[h]}</small></button>`,
      ).join("")}</div>
    </div>
    <button class="primary" id="join">Join</button>`);

  const codeInput = $<HTMLInputElement>("#code");
  const nameInput = $<HTMLInputElement>("#name");
  const joinButton = $<HTMLButtonElement>("#join");
  const allowed = new RegExp(`[^${ROOM_CODE_ALPHABET}]`, "g");
  const update = () => {
    joinButton.disabled = codeInput.value.length < ROOM_CODE_LENGTH || nameInput.value.trim() === "";
  };
  codeInput.addEventListener("input", () => {
    // Codes never use I or O (or digits), so anything else is a typo.
    codeInput.value = codeInput.value.toUpperCase().replace(allowed, "");
    if (codeInput.value.length === MAX_ROOM_CODE_LENGTH && !nameInput.value) nameInput.focus();
    update();
  });
  nameInput.addEventListener("input", update);
  for (const button of appEl.querySelectorAll<HTMLButtonElement>(".animal")) {
    button.onclick = () => {
      animal = button.dataset.animal as Animal;
      for (const b of appEl.querySelectorAll(".animal")) b.setAttribute("aria-pressed", String(b === button));
    };
  }
  for (const button of appEl.querySelectorAll<HTMLButtonElement>(".hat")) {
    button.onclick = () => {
      accessory = button.dataset.hat as Accessory;
      for (const b of appEl.querySelectorAll(".hat")) b.setAttribute("aria-pressed", String(b === button));
    };
  }
  joinButton.onclick = () => {
    session = { code: codeInput.value, name: nameInput.value.trim(), animal, accessory, token: null };
    saveSession(session);
    firstJoin = true;
    send({ type: "join", code: session.code, name: session.name, animal, accessory });
  };
  update();
  if (!code) codeInput.focus();
}

function renderLobby(game: StateMessage): void {
  const player = me();
  html(`<div class="center">
    ${player ? `<img class="portrait bob" src="${portrait(player.animal)}" alt="">` : ""}
    <h1>You're in!</h1>
    <p class="muted">Waiting for the host to start the game…</p>
    <p><strong>${game.players.length}</strong> player${game.players.length === 1 ? "" : "s"} here</p>
    <div class="roster">${game.players.map((p) => `<span class="chip${p.connected ? "" : " away"}">${escapeHtml(p.name)}</span>`).join("")}</div>
    <button class="secondary" id="portrait">${player?.hasAvatar ? "Redraw your portrait" : "Draw your portrait"}</button>
  </div>`);
  $<HTMLButtonElement>("#portrait").onclick = () => {
    app.drawingAvatar = true;
    render();
  };
}

function renderAvatar(): void {
  renderPad({
    caption: "Draw yourself! It goes on the TV",
    prompt: "Your self-portrait",
    done: "Looking good!",
    maxStrokes: MAX_AVATAR_STROKES,
    skip: "Skip",
    onDone: (strokes) => {
      send({ type: "avatar", strokes });
      play("drawing_done");
      app.drawingAvatar = false;
      renderedKey = "";
      render();
    },
    onSkip: () => {
      app.drawingAvatar = false;
      renderedKey = "";
      render();
    },
  });
}

function renderIntro(game: StateMessage): void {
  html(`<div class="center intro">
    <p class="muted">Round ${game.roundIndex + 1} of ${game.roundCount}</p>
    <h1 class="round-title">${escapeHtml(game.roundTitle ?? "")}</h1>
    <p class="blurb">${escapeHtml(game.roundBlurb ?? "")}</p>
  </div>`);
}

function renderStandings(game: StateMessage, final: boolean): void {
  const player = me();
  if (!player) return;
  const leader = [...game.players].sort((a, b) => b.score - a.score)[0];
  const behind = leader && leader.id !== player.id ? leader.score - player.score : 0;
  html(`<div class="center">
    <img class="portrait ${final && player.rank === 1 ? "dance" : "bob"}" src="${portrait(player.animal)}" alt="">
    <p class="muted">${final ? "Final result" : `After round ${game.roundIndex + 1} of ${game.roundCount}`}</p>
    <p class="big-number">${ordinal(player.rank)}</p>
    <h2>${final && player.rank === 1 ? "You win! 🏆" : `of ${game.players.length} players`}</h2>
    <p class="points" data-count="${player.score}" data-suffix=" pts">${formatPoints(player.score)} pts</p>
    ${!final && player.roundPoints ? `<p class="muted">${signedPoints(player.roundPoints)} this round</p>` : ""}
    ${behind > 0 ? `<p class="muted">${formatPoints(behind)} behind ${escapeHtml(leader!.name)}</p>` : ""}
    ${final ? `<p class="muted">The host can start a new game from the TV.</p>` : ""}
  </div>`);
}

// ---- Quiz rounds ----

function renderVote(round: QuizView): void {
  html(`<h2>Pick the next category</h2>
    <div class="options">${(round.vote?.categories ?? [])
      .map((c) => `<button class="option" data-id="${escapeHtml(c.id)}"><span>${escapeHtml(c.name)}</span><span class="votes">${c.votes ? `${c.votes} ✓` : ""}</span></button>`)
      .join("")}</div>`);
  for (const button of appEl.querySelectorAll<HTMLButtonElement>(".option")) {
    button.onclick = () => {
      buzz();
      send({ type: "vote", category: button.dataset.id! });
    };
  }
}

function renderWager(round: QuizView): void {
  const max = round.me?.maxWager ?? 0;
  const final = round.kind === "final";
  html(`<p class="category">${escapeHtml(round.category?.name ?? "")}</p>
    <h2>${final ? "Final question! How much do you dare?" : "How much will you bet?"}</h2>
    <p class="muted">Right: win your bet. Wrong: lose it. You can bet up to ${formatPoints(max)}.</p>
    <p class="big-number" id="amount">0</p>
    <input type="range" id="slider" min="0" max="${max}" step="${Math.max(1, Math.round(max / 100))}" value="0" class="slider">
    <div class="wager-steps">${WAGER_STEPS.map((s) => `<button class="secondary" data-f="${s.fraction}">${s.label}</button>`).join("")}</div>
    <button class="primary" id="bet">Place bet</button>`);
  const slider = $<HTMLInputElement>("#slider");
  const amount = $<HTMLElement>("#amount");
  const show = () => (amount.textContent = formatPoints(Number(slider.value)));
  slider.oninput = show;
  for (const button of appEl.querySelectorAll<HTMLButtonElement>("[data-f]")) {
    button.onclick = () => {
      slider.value = String(Math.round(max * Number(button.dataset.f)));
      show();
    };
  }
  $<HTMLButtonElement>("#bet").onclick = () => {
    buzz();
    send({ type: "wager", amount: Number(slider.value) });
  };
}

function renderQuestion(round: QuizView): void {
  const q = round.question;
  if (!q) return;
  html(`<p class="category">${escapeHtml(q.categoryName)} · ${round.questionNumber}/${round.questionCount}</p>
    <p class="question-text">${escapeHtml(q.text)}</p>
    <div class="answers">${q.choices
      .map((c, i) => `<button class="answer c${i}" data-i="${i}"><span class="tag">${CHOICE_LABELS[i]?.shape ?? ""} ${CHOICE_LABELS[i]?.letter ?? ""}</span><span>${escapeHtml(c)}</span></button>`)
      .join("")}</div>`);
  for (const button of appEl.querySelectorAll<HTMLButtonElement>(".answer")) {
    button.onclick = () => {
      buzz(30);
      send({ type: "answer", choice: Number(button.dataset.i) });
    };
  }
}

function renderLocked(round: QuizView, choice: number): void {
  const label = CHOICE_LABELS[choice];
  html(`<div class="center"><p class="muted">Answer locked in</p>
    <div class="locked-badge c${choice}">${label?.shape ?? ""}<small>${label?.letter ?? ""}</small></div>
    <h2>${escapeHtml(round.question?.choices[choice] ?? "")}</h2><p class="muted">Eyes on the TV!</p></div>`);
}

function renderReveal(round: QuizView, screen: Extract<Screen, { kind: "reveal" }>): void {
  const player = me();
  const correct = round.reveal?.correctIndex ?? 0;
  const label = CHOICE_LABELS[correct];
  const points = player?.lastPoints ?? 0;
  const headline = !screen.answered ? "Too slow!" : screen.correct ? "Correct!" : "Not quite";
  html(`<div class="center">
    ${player ? `<img class="portrait small ${screen.correct ? "hop" : "slump"}" src="${portrait(player.animal)}" alt="">` : ""}
    <p class="result ${screen.correct ? "good" : "bad"}">${headline}</p>
    ${points !== 0 ? `<p class="points ${points < 0 ? "lost" : ""}" data-count="${points}" data-signed="1">${signedPoints(points)}</p>` : ""}
    <p class="muted">The answer was</p>
    <h2>${label?.shape ?? ""} ${label?.letter ?? ""}: ${escapeHtml(round.question?.choices[correct] ?? "")}</h2>
    ${round.reveal?.fact ? `<p class="fact">💡 ${escapeHtml(round.reveal.fact)}</p>` : ""}
  </div>`);
}

function renderSteal(game: StateMessage): void {
  const others = game.players.filter((p) => p.id !== game.you?.playerId).sort((a, b) => b.score - a.score);
  html(`<h2>You got it right! Steal from…</h2>
    <p class="muted">Pick someone to take points from.</p>
    <div class="options">${others
      .map((p) => `<button class="option steal" data-id="${p.id}"><span><img class="mini" src="${portrait(p.animal)}" alt=""> ${escapeHtml(p.name)}</span><span class="votes">${formatPoints(p.score)}</span></button>`)
      .join("")}</div>`);
  for (const button of appEl.querySelectorAll<HTMLButtonElement>(".option")) {
    button.onclick = () => {
      buzz(40);
      send({ type: "steal", target: button.dataset.id! });
    };
  }
}

function renderStealReveal(round: QuizView): void {
  const myId = app.game?.you?.playerId;
  const steals = round.steals ?? [];
  const mine = steals.filter((s) => s.thief === myId);
  const robbed = steals.filter((s) => s.victim === myId);
  const seed = round.questionNumber;
  const lines = [
    ...mine.map((s) =>
      s.amount > 0
        ? `${escapeHtml(stealLine("You", playerName(s.victim), seed))} <strong>+${formatPoints(s.amount)}</strong> 😈`
        : `You tried to rob ${escapeHtml(playerName(s.victim))}, but their pockets were empty! 🙃`,
    ),
    ...robbed.filter((s) => s.amount > 0).map((s) => `${escapeHtml(stealLine(playerName(s.thief), "you", seed))} <strong>-${formatPoints(s.amount)}</strong> 😱`),
  ];
  html(`<div class="center">
    <h1>${mine.length ? "Got 'em!" : robbed.length ? "Robbed!" : "Phew!"}</h1>
    ${lines.length ? lines.map((l) => `<p class="steal-line">${l}</p>`).join("") : `<p class="muted">Nobody took your points this time.</p>`}
  </div>`);
}

// ---- Closest guess ----

function renderGuess(round: ClosestView): void {
  const q = round.question;
  const unit = q.unit === "year" ? "" : (q.unit ?? "");
  html(`<p class="category">${escapeHtml(q.categoryName)} · ${round.questionNumber}/${round.questionCount}</p>
    <p class="question-text">${escapeHtml(q.text)}</p>
    <div class="guess-row">
      <input id="guess" class="guess-input" inputmode="decimal" autocomplete="off" placeholder="${q.unit === "year" ? "Year" : "Your guess"}">
      ${unit ? `<span class="unit">${escapeHtml(unit)}</span>` : ""}
    </div>
    <button class="primary" id="send" disabled>Lock it in</button>
    <p class="muted center-text">Closest wins. Being close still scores!</p>`);
  const input = $<HTMLInputElement>("#guess");
  const button = $<HTMLButtonElement>("#send");
  const parse = () => Number(input.value.replace(/,/g, "").trim());
  input.oninput = () => {
    input.value = input.value.replace(/[^0-9.,-]/g, "");
    button.disabled = input.value.trim() === "" || !Number.isFinite(parse());
  };
  const submit = () => {
    if (button.disabled) return;
    buzz();
    send({ type: "guess", value: parse() });
  };
  button.onclick = submit;
  input.onkeydown = (e) => e.key === "Enter" && submit();
  input.focus();
}

function renderClosestReveal(round: ClosestView): void {
  const result = round.reveal?.results.find((r) => r.playerId === app.game?.you?.playerId);
  const unit = round.question.unit;
  const headline = !result || result.guess === null ? "No guess!" : result.distance === 0 ? "Bullseye! 🎯" : result.place === 1 ? "Closest!" : result.points > 0 ? "So close!" : "Way off!";
  html(`<div class="center">
    <p class="muted">The answer was</p>
    <h1>${formatNumber(round.reveal?.answer ?? 0, unit)}</h1>
    <p class="result ${result?.points ? "good" : "bad"}">${headline}</p>
    ${result?.guess != null ? `<p class="muted">You said ${formatNumber(result.guess, unit)}${result.place ? ` · ${ordinal(result.place)} closest` : ""}</p>` : ""}
    ${result?.points ? `<p class="points">${signedPoints(result.points)}</p>` : ""}
    ${round.reveal?.fact ? `<p class="fact">💡 ${escapeHtml(round.reveal.fact)}</p>` : ""}
  </div>`);
}

// ---- Drawing ----

interface PadOptions {
  caption: string;
  prompt: string;
  done: string;
  onDone: (strokes: Stroke[]) => void;
  maxStrokes?: number;
  skip?: string;
  onSkip?: () => void;
}

/** The drawing pad screen, used for Doodle Duel, Draw-Off and self-portraits. */
function renderPad(options: PadOptions): void {
  html(`<p class="category">${escapeHtml(options.caption)}</p>
    <h2 class="prompt">${escapeHtml(options.prompt)}</h2>
    <canvas id="pad" class="pad"></canvas>
    <div class="pens">${PEN_COLORS.map((c, i) => `<button class="pen${i === 0 ? " on" : ""}" data-c="${i}" style="--pen:${c}" aria-label="color ${i + 1}"></button>`).join("")}</div>
    <div class="tools">
      ${PEN_WIDTHS.map((w, i) => `<button class="width${i === 1 ? " on" : ""}" data-w="${i}" aria-label="pen size ${i + 1}"><span style="width:${6 + i * 6}px;height:${6 + i * 6}px"></span></button>`).join("")}
      <button class="secondary small" id="undo">Undo</button>
      <button class="secondary small" id="clear">Clear</button>
    </div>
    <div class="pad-actions">
      ${options.skip ? `<button class="secondary" id="skip">${escapeHtml(options.skip)}</button>` : ""}
      <button class="primary" id="done" disabled>${escapeHtml(options.done)}</button>
    </div>`);
  const canvas = $<HTMLCanvasElement>("#pad");
  const done = $<HTMLButtonElement>("#done");
  pad = new DrawingPad(canvas, () => (done.disabled = pad!.strokes.length === 0), options.maxStrokes);
  for (const b of appEl.querySelectorAll<HTMLButtonElement>(".pen")) {
    b.onclick = () => {
      pad!.color = Number(b.dataset.c);
      for (const x of appEl.querySelectorAll(".pen")) x.classList.toggle("on", x === b);
    };
  }
  for (const b of appEl.querySelectorAll<HTMLButtonElement>(".width")) {
    b.onclick = () => {
      pad!.width = Number(b.dataset.w);
      for (const x of appEl.querySelectorAll(".width")) x.classList.toggle("on", x === b);
    };
  }
  $<HTMLButtonElement>("#undo").onclick = () => pad!.undo();
  $<HTMLButtonElement>("#clear").onclick = () => pad!.clear();
  if (options.onSkip) $<HTMLButtonElement>("#skip").onclick = options.onSkip;
  done.onclick = () => {
    if (!pad || pad.strokes.length === 0) return;
    buzz(40);
    options.onDone(pad.strokes);
  };
}

// Phones rotate and resize: keep the pad sharp.
window.addEventListener("resize", () => pad?.resize());

function drawingBlock(round: DrawingView, size: number): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "drawing-wrap";
  if (round.strokes) wrap.append(drawingImage(round.strokes, size));
  return wrap;
}

function renderLie(round: DrawingView): void {
  const artist = round.artistId ? playerName(round.artistId) : "Someone";
  html(`<p class="category">Drawing ${round.drawingNumber} of ${round.drawingCount} · by ${escapeHtml(artist)}</p>
    <h2>Write a fake title for this drawing</h2>
    <div id="art"></div>
    <input id="lie" class="lie-input" maxlength="${MAX_LIE_LENGTH}" autocomplete="off" placeholder="Something that sounds real…">
    <button class="primary" id="send" disabled>Submit fake title</button>
    <p class="muted center-text">You score when other players pick your fake.</p>`);
  $<HTMLElement>("#art").append(drawingBlock(round, Math.min(window.innerWidth - 32, 300)));
  const input = $<HTMLInputElement>("#lie");
  const button = $<HTMLButtonElement>("#send");
  input.oninput = () => (button.disabled = input.value.trim() === "");
  const submit = () => {
    if (button.disabled) return;
    buzz();
    send({ type: "lie", text: input.value.trim() });
  };
  button.onclick = submit;
  input.onkeydown = (e) => e.key === "Enter" && submit();
}

function renderArtistWait(round: DrawingView): void {
  html(`<div class="center">
    <p class="muted">This one's yours!</p>
    <h1>Look, it's your drawing!</h1>
    <div id="art"></div>
    <p class="muted">${round.step === "lying" ? "The others are writing fake titles…" : "The others are trying to spot your real title…"}</p>
    <p class="muted">You score for everyone who guesses right.</p>
  </div>`);
  $<HTMLElement>("#art").append(drawingBlock(round, Math.min(window.innerWidth - 64, 220)));
}

function renderPick(round: DrawingView): void {
  const mine = round.me?.lie?.toLowerCase();
  html(`<p class="category">Drawing ${round.drawingNumber} of ${round.drawingCount}</p>
    <h2>Which one is the real title?</h2>
    <div class="options">${(round.options ?? [])
      .map((o) => {
        const own = o.text.toLowerCase() === mine;
        return `<button class="option pick${own ? " own" : ""}" data-id="${o.id}" ${own ? "disabled" : ""}><span>${escapeHtml(o.text)}</span>${own ? `<span class="votes">yours</span>` : ""}</button>`;
      })
      .join("")}</div>`);
  for (const button of appEl.querySelectorAll<HTMLButtonElement>(".option:not(.own)")) {
    button.onclick = () => {
      buzz();
      send({ type: "pick", option: button.dataset.id! });
    };
  }
}

function renderDrawingReveal(round: DrawingView): void {
  const myId = app.game?.you?.playerId ?? "";
  const shown = round.reveal?.items.slice(0, round.reveal.shown) ?? [];
  const truth = round.reveal?.items.find((i) => i.truth);
  const truthShown = shown.some((i) => i.truth);
  const fooled = shown.filter((i) => !i.truth && i.authors.includes(myId)).reduce((n, i) => n + i.pickers.length, 0);
  const pickedTruth = truth?.pickers.includes(myId);
  const player = me();
  html(`<div class="center">
    <p class="muted">Watch the TV!</p>
    ${truthShown ? `<p class="muted">The real title was</p><h1>“${escapeHtml(truth!.text)}”</h1>` : `<h1>And the real title is…</h1>`}
    ${truthShown && round.artistId !== myId ? `<p class="result ${pickedTruth ? "good" : "bad"}">${pickedTruth ? "You spotted it!" : "You got fooled!"}</p>` : ""}
    ${fooled ? `<p class="steal-line">Your fake fooled <strong>${fooled}</strong> player${fooled === 1 ? "" : "s"}! 🎭</p>` : ""}
    ${truthShown && player?.lastPoints ? `<p class="points">${signedPoints(player.lastPoints)}</p>` : ""}
  </div>`);
}

// ---- Draw-Off ----

function renderDrawOffVote(round: DrawOffView): void {
  const own = round.me?.ownDrawing;
  html(`<p class="category">Draw-Off · “${escapeHtml(round.prompt)}”</p>
    <h2>Which drawing is the best?</h2>
    <p class="muted">Look at the TV and vote by number. Not your own!</p>
    <div class="gallery-votes">${round.gallery
      .map((g) => `<button class="vote-number${g.id === own ? " own" : ""}" data-id="${g.id}" ${g.id === own ? "disabled" : ""}>#${g.number}${g.id === own ? "<small>yours</small>" : ""}</button>`)
      .join("")}</div>`);
  for (const button of appEl.querySelectorAll<HTMLButtonElement>(".vote-number:not(.own)")) {
    button.onclick = () => {
      buzz();
      send({ type: "vote_drawing", drawing: button.dataset.id! });
    };
  }
}

function renderDrawOffReveal(round: DrawOffView): void {
  const myId = app.game?.you?.playerId;
  const mine = round.gallery.find((g) => g.artistId === myId);
  const place = mine ? round.gallery.indexOf(mine) + 1 : 0;
  const won = mine && place === 1 && (mine.votes ?? 0) > 0;
  const player = me();
  html(`<div class="center">
    ${player ? `<img class="portrait small ${won ? "dance" : "bob"}" src="${portrait(player.animal)}" alt="">` : ""}
    <p class="muted">Draw-Off results</p>
    <h1>${won ? "Best in show! 🏆" : mine ? `${mine.votes ?? 0} vote${mine.votes === 1 ? "" : "s"} for you` : "Nice gallery!"}</h1>
    ${mine ? `<p class="muted">Your drawing came ${ordinal(place)}</p>` : ""}
    ${player?.lastPoints ? `<p class="points" data-count="${player.lastPoints}" data-signed="1">${signedPoints(player.lastPoints)}</p>` : ""}
  </div>`);
}

// ---- Timer bar ----

function tick(): void {
  if (!timerEl.hidden && timerDeadline) {
    const paused = app.game?.paused;
    const remaining = paused ? (app.game?.timer?.remainingMs ?? 0) : Math.max(0, timerDeadline - performance.now());
    timerFill.style.transform = `scaleX(${Math.min(1, remaining / timerDuration)})`;
    const urgent = remaining < 5000 && remaining > 0;
    timerFill.classList.toggle("urgent", urgent);
    // Last five seconds: a tick each second, but only if you still have to act.
    const second = Math.ceil(remaining / 1000);
    if (urgent && !paused && second !== lastTickSecond && ACT_SCREENS.has(screenFor(app).kind)) {
      lastTickSecond = second;
      play("tick_urgent", 1 + (5 - second) * 0.04, 0);
    }
  }
  requestAnimationFrame(tick);
}

// Every tap: unlock sound (browsers need a tap first) and a soft click.
document.addEventListener(
  "pointerdown",
  (e) => {
    unlockAudio();
    const target = e.target as HTMLElement;
    if (target.closest("button:not(:disabled)") && !target.closest(".emote")) play("tap", 1, 0.08);
  },
  { capture: true },
);

renderEmotes();
render();
connection.start();
requestAnimationFrame(tick);
