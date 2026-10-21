"""Synthesizes the game's sound set: one signature jingle and a family of UI sounds.

Sound identity (the Japanese product-design idea that a great product has a great,
iconic sound that makes it a pleasure to use):
  * One signature motif, "pa-pa-pa-PAAN": G5 C6 E6 -> A6. It plays at the logo and
    round intros, and returns at the winner fanfare. Every other sound borrows its notes.
  * One timbre family: a soft FM bell (bright attack, quick shimmer, gentle tail),
    a wooden tick and a little pop. Short, round, never harsh.
  * Every action answers instantly and pleasantly: join, lock in, correct, wrong,
    steal, points, countdown.

Run with any Python that has numpy (for example Blender's: tools/art uses it too):
    python tools/audio/make_sfx.py
Writes 48 kHz masters to art/source/audio/ and game copies to art/export/audio/.
Then run `npm run sync-art` to copy them into the TV and phone projects.
"""

import os
import wave

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RATE = 48000
RNG = np.random.default_rng(7)


def note(name: str) -> float:
    """'A4' -> 440 Hz."""
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    semitone = names[name[0]] + (1 if "#" in name else 0)
    octave = int(name[-1])
    midi = 12 * (octave + 1) + semitone
    return 440.0 * 2 ** ((midi - 69) / 12)


def t_axis(seconds: float) -> np.ndarray:
    return np.arange(int(seconds * RATE)) / RATE


def envelope(t: np.ndarray, attack: float, decay: float) -> np.ndarray:
    env = np.exp(-t * decay)
    if attack > 0:
        env *= np.clip(t / attack, 0, 1)
    return env


def bell(freq: float, seconds: float = 0.6, decay: float = 7.0, brightness: float = 2.2, ratio: float = 3.5) -> np.ndarray:
    """The signature timbre: FM bell with a fast-fading bright edge."""
    t = t_axis(seconds)
    index = brightness * np.exp(-t * decay * 2.2)
    sig = np.sin(2 * np.pi * freq * t + index * np.sin(2 * np.pi * freq * ratio * t))
    sig += 0.25 * np.sin(2 * np.pi * freq * 2 * t) * np.exp(-t * decay * 1.6)
    return sig * envelope(t, 0.002, decay)


def pluck(freq: float, seconds: float = 0.35, decay: float = 9.0) -> np.ndarray:
    """Soft marimba-like pluck: fundamental plus a quickly fading 4th harmonic."""
    t = t_axis(seconds)
    sig = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 4 * t) * np.exp(-t * 30)
    return sig * envelope(t, 0.001, decay)


def wood(freq: float = 1400.0, seconds: float = 0.08) -> np.ndarray:
    """A crisp wooden tick."""
    t = t_axis(seconds)
    tone = np.sin(2 * np.pi * freq * t) * np.exp(-t * 70)
    click = RNG.standard_normal(len(t)) * np.exp(-t * 400) * 0.3
    return tone + click


def pop(start: float = 900.0, end: float = 300.0, seconds: float = 0.09) -> np.ndarray:
    """A bubbly 'pop': a fast downward sine sweep."""
    t = t_axis(seconds)
    freq = start * (end / start) ** (t / seconds)
    phase = 2 * np.pi * np.cumsum(freq) / RATE
    return np.sin(phase) * envelope(t, 0.001, 30)


def sweep(start: float, end: float, seconds: float, decay: float = 4.0) -> np.ndarray:
    t = t_axis(seconds)
    freq = start * (end / start) ** (t / seconds)
    phase = 2 * np.pi * np.cumsum(freq) / RATE
    return (np.sin(phase) + 0.2 * np.sin(2 * phase)) * envelope(t, 0.005, decay)


def noise_whoosh(seconds: float = 0.35, rise: bool = True) -> np.ndarray:
    """Filtered noise that swells and fades, for panels sliding in."""
    t = t_axis(seconds)
    raw = RNG.standard_normal(len(t))
    out = np.zeros_like(raw)
    y = 0.0
    for i, x in enumerate(raw):
        # One-pole low-pass whose cutoff sweeps up (or down).
        frac = i / len(raw)
        cutoff = 0.02 + 0.25 * (frac if rise else 1 - frac)
        y += cutoff * (x - y)
        out[i] = y
    shape = np.sin(np.pi * np.clip(t / seconds, 0, 1)) ** 2
    return out * shape


def place(*parts: tuple[float, np.ndarray], seconds: float | None = None) -> np.ndarray:
    """Mix sounds placed at start times (seconds)."""
    end = max(start + len(sig) / RATE for start, sig in parts)
    total = int((seconds or end) * RATE) + 1
    mix = np.zeros(total)
    for start, sig in parts:
        i = int(start * RATE)
        n = min(len(sig), total - i)
        mix[i : i + n] += sig[:n]
    return mix


def room(sig: np.ndarray, amount: float = 0.18) -> np.ndarray:
    """A small, warm space so sounds don't feel dry. Three feedback delays."""
    out = np.concatenate([sig, np.zeros(int(0.5 * RATE))])
    wet = np.zeros_like(out)
    for delay_ms, gain in ((37, 0.5), (53, 0.42), (71, 0.36)):
        d = int(RATE * delay_ms / 1000)
        buf = out.copy()
        for i in range(d, len(buf)):
            buf[i] += gain * buf[i - d]
        wet += buf - out
    return out + amount * wet / 3


def finish(sig: np.ndarray, peak: float = 0.85) -> np.ndarray:
    sig = sig - np.mean(sig)
    # Trim the silent end of reverb tails (below -60 dB), keeping a short fade.
    loud = np.nonzero(np.abs(sig) > np.max(np.abs(sig)) * 0.001)[0]
    if len(loud):
        sig = sig[: min(len(sig), loud[-1] + int(0.02 * RATE))]
    fade = min(len(sig), int(0.01 * RATE))
    sig[-fade:] *= np.linspace(1, 0, fade)
    biggest = np.max(np.abs(sig)) or 1.0
    return sig / biggest * peak


# The signature motif: "pa-pa-pa-PAAN".
MOTIF = ["G5", "C6", "E6", "A6"]


def signature(transpose: float = 1.0, last_hold: float = 1.0, gap: float = 0.09) -> np.ndarray:
    parts = []
    for i, name in enumerate(MOTIF):
        is_last = i == len(MOTIF) - 1
        f = note(name) * transpose
        sig = bell(f, 1.4 * last_hold if is_last else 0.4, decay=3.0 if is_last else 9.0)
        if is_last:
            sig = place((0, sig), (0, 0.5 * bell(f * 2, 1.0, decay=4.0, brightness=1.2)))
        parts.append((i * gap, sig * (1.0 if is_last else 0.8)))
        parts.append((i * gap, 0.4 * pluck(f / 2, 0.3)))
    return place(*parts)


def build() -> dict[str, tuple[np.ndarray, float]]:
    """name -> (signal, peak level). Peak levels keep loudness consistent by role."""
    s: dict[str, tuple[np.ndarray, float]] = {}
    s["logo"] = (room(signature(), 0.25), 0.9)
    s["intro"] = (room(place((0, noise_whoosh(0.4)), (0.18, signature(2 ** (5 / 12), 0.7, 0.075))), 0.2), 0.85)
    s["join"] = (room(place((0, pop(700, 1500, 0.06)), (0.04, bell(note("A6"), 0.3, 10)), (0.11, bell(note("C7"), 0.4, 8)))), 0.7)
    s["tap"] = (wood(2000, 0.05), 0.45)
    s["lock"] = (room(place((0, wood(1800, 0.05) * 0.8), (0.005, pop(300, 120, 0.07) * 0.9), (0.02, bell(note("C6"), 0.35, 12) * 0.7)), 0.1), 0.75)
    s["tick"] = (wood(1250, 0.07), 0.45)
    s["tick_urgent"] = (place((0, wood(1700, 0.07)), (0, bell(note("E6"), 0.12, 30) * 0.4)), 0.6)
    s["reveal"] = (room(place((0, noise_whoosh(0.45, rise=True) * 0.6), (0.38, bell(note("C6"), 0.6, 5)), (0.38, bell(note("G6"), 0.6, 5) * 0.6))), 0.8)
    s["correct"] = (room(place((0, bell(note("C6"), 0.3, 10)), (0.07, bell(note("E6"), 0.3, 10)), (0.14, bell(note("A6"), 0.9, 4)), (0.14, bell(note("A7"), 0.6, 6) * 0.3))), 0.8)
    s["wrong"] = (place((0, pluck(note("E4"), 0.25, 12)), (0.13, pluck(note("C4"), 0.45, 7))), 0.6)
    s["points"] = (room(place(*[(i * 0.045, bell(note(n), 0.25, 14) * 0.6) for i, n in enumerate(["E7", "G7", "A7", "C8"])]), 0.15), 0.6)
    s["steal"] = (room(place((0, sweep(2400, 500, 0.28, 6)), (0.24, pop(500, 1400, 0.05)), (0.27, bell(note("G7"), 0.4, 9)), (0.33, bell(note("C8"), 0.4, 9) * 0.7))), 0.75)
    s["wager"] = (place((0, wood(900, 0.06)), (0.06, wood(1100, 0.06)), (0.1, bell(note("G6"), 0.25, 12) * 0.5)), 0.65)
    s["vote"] = (place((0, pluck(note("G6"), 0.2, 15)), (0.05, pluck(note("C7"), 0.25, 12) * 0.7)), 0.55)
    s["whoosh"] = (noise_whoosh(0.3), 0.45)
    s["emote"] = (place((0, pop(500, 1300, 0.07)), (0.06, pop(900, 1600, 0.05) * 0.6)), 0.6)
    s["drawing_done"] = (room(place((0, noise_whoosh(0.18, rise=False) * 0.5), (0.12, bell(note("E6"), 0.3, 10)), (0.18, bell(note("A6"), 0.5, 7)))), 0.7)
    s["scoreboard"] = (room(place(*[(i * 0.06, pluck(note(n), 0.25, 12)) for i, n in enumerate(["C6", "D6", "E6", "G6", "A6", "C7"])])), 0.65)
    s["pause"] = (place((0, bell(note("A5"), 0.4, 8)), (0.12, bell(note("E5"), 0.6, 6))), 0.6)
    s["resume"] = (place((0, bell(note("E5"), 0.4, 8)), (0.12, bell(note("A5"), 0.6, 6))), 0.6)
    winner = place(
        (0, signature(1.0, 1.4)),
        (0.6, bell(note("C6"), 2.0, 2.2) * 0.6),
        (0.6, bell(note("E6"), 2.0, 2.2) * 0.5),
        (0.6, bell(note("G6"), 2.0, 2.2) * 0.5),
        (0.6, bell(note("A6"), 2.0, 2.2) * 0.6),
        *[(0.75 + i * 0.07, bell(note(n), 0.5, 8) * 0.35) for i, n in enumerate(["C7", "E7", "G7", "A7", "C8", "E8"])],
    )
    s["winner"] = (room(winner, 0.3), 0.9)
    return s


def write_wav(path: str, sig: np.ndarray, rate: int) -> None:
    data = (np.clip(sig, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(data.tobytes())


def main() -> None:
    masters = os.path.join(ROOT, "art", "source", "audio")
    export = os.path.join(ROOT, "art", "export", "audio")
    os.makedirs(masters, exist_ok=True)
    os.makedirs(export, exist_ok=True)
    for name, (sig, peak) in build().items():
        sig = finish(sig, peak)
        write_wav(os.path.join(masters, f"{name}.wav"), sig, RATE)
        # Game copy at 44.1 kHz keeps files small; short SFX stay WAV for zero-latency playback.
        n = int(len(sig) * 44100 / RATE)
        resampled = np.interp(np.linspace(0, len(sig) - 1, n), np.arange(len(sig)), sig)
        write_wav(os.path.join(export, f"sfx_{name}.wav"), resampled, 44100)
        print(f"{name:13s} {len(sig) / RATE:.2f}s")


if __name__ == "__main__":
    main()
