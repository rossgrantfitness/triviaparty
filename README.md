# Trivia Party (working title)

A party trivia and drawing game for Steam: think Drawful 2 meets Papa's Quiz.
Players join from any phone, tablet or laptop browser with a room code; the Godot
game runs on the TV. Rounds: Quiz Time, Doodle Duel (draw, write fake titles, spot
the real one), Draw-Off (everyone draws the same thing, vote for the best), High
Roller (wagers), Closest Guess, Sticky Fingers (steals) and the Final Showdown.
Three modes: Trivia Party (the mix), Doodle Party (only drawing) and Meme Mode.
Players pick a hat, draw a self-portrait and send emotes from their phone. See `docs/MANIFEST.md` for the full plan and
`docs/PROGRESS.md` for where things stand.

## Easiest way to play (no typing)

1. Install [Node.js](https://nodejs.org/) (the LTS version) and [Godot 4.7](https://godotengine.org/download) (standard version, unzip it anywhere).
2. Windows: double-click **`start_game.bat`** in this folder. Mac: double-click **`start_game.command`**.
3. The first time, if it can't find Godot, a window opens: pick your Godot program (`Godot_v4.7...exe`). It remembers.
4. The Godot game window opens with a room code, and a browser tab shows the phone page. Keep the black window open while you play; close it to stop.

## Quick start (terminal)

You need [Node.js](https://nodejs.org/) 22 or newer and [Godot](https://godotengine.org/download) 4.7 (standard build).

```sh
npm install      # once
npm run dev      # starts the server, the phone page, and the Godot host window
```

- Godot window: shows "Trivia Party" and **Connected to server**.
- Phone page: open http://localhost:5173 on this computer, or `http://<this computer's IP>:5173`
  on a phone on the same Wi-Fi (the IP is printed in the terminal as "Network"). It also says **Connected to server**.

If Godot isn't found, create a file named `.godot-path` in this folder containing the
full path to the Godot program (e.g. `C:\Users\you\Godot\Godot_v4.7.2-stable_win64.exe`).

## Playing a test game

1. `npm run dev`. The TV window shows a room code and an address like `http://192.168.1.20:5173`.
2. On your phone (same Wi-Fi), open that address, type the code and your name, pick an animal, tap **Join**.
3. No friends handy? In a second terminal: `npm run bots -- ABCD 5` (use the code on the TV).
4. Press **Enter** (or click **Start game**) on the TV.

TV keys: **Enter** start / play again · **Space** pause · **N** skip ahead · **Tab** players (remove someone) · **M** sound on/off · **F11** fullscreen.
In the lobby: **G** changes game mode (Trivia Party / Doodle Party / Meme Mode), **L** changes game length (short / standard / long), **D** turns drawing rounds on or off.

Tweak timers and points in `host/config/game_rules.json`, then restart.

## Tests

```sh
npm test            # TypeScript tests
npm run test:host   # Godot tests (headless)
npm run typecheck
```
