// Phone sounds: the same sound family as the TV (files in /sfx), played quietly
// so a room full of phones never gets noisy. Players can mute from the top bar.

const NAMES = [
  "tap", "lock", "correct", "wrong", "points", "steal", "wager", "vote", "join", "emote", "drawing_done", "tick_urgent", "winner",
] as const;
export type SoundName = (typeof NAMES)[number];

const VOLUME = 0.45;
const MUTE_KEY = "trivia_party_muted";

let context: AudioContext | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
let loading: Promise<void> | null = null;

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
  mutedNow = muted;
}

let mutedNow = isMuted();

/** Browsers only allow sound after a tap, so call this from the first tap. */
export function unlockAudio(): void {
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    context = new Ctor();
  }
  if (context.state === "suspended") void context.resume();
  if (!loading) loading = loadAll(context);
}

async function loadAll(ctx: AudioContext): Promise<void> {
  await Promise.all(
    NAMES.map(async (name) => {
      try {
        const response = await fetch(`/sfx/sfx_${name}.wav`);
        buffers.set(name, await ctx.decodeAudioData(await response.arrayBuffer()));
      } catch {
        // Missing sound: stay silent rather than break the game.
      }
    }),
  );
}

/** Play a sound. pitch 1 = normal; small random variety keeps repeats from sounding robotic. */
export function play(name: SoundName, pitch = 1, variety = 0.04): void {
  if (mutedNow || !context) return;
  const buffer = buffers.get(name);
  if (!buffer) return;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = pitch * (1 + (Math.random() * 2 - 1) * variety);
  const gain = context.createGain();
  gain.gain.value = VOLUME;
  source.connect(gain).connect(context.destination);
  source.start();
}
