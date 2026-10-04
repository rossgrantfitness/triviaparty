# Trivia Party (working title)

A high-stakes party trivia game for Steam. Players join from their phones; the
Godot host runs on the TV. See `docs/MANIFEST.md` for the full plan and
`docs/PROGRESS.md` for where things stand.

## Quick start

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

## Tests

```sh
npm test            # TypeScript tests
npm run test:host   # Godot tests (headless)
npm run typecheck
```
