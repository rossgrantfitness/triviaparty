# Progress

Last updated: 2026-10-04

## Current phase: Phase 0 — Setup

### Done

- [x] Manifest saved as `docs/MANIFEST.md`
- [x] Folder structure from manifest section 4, plus `CLAUDE.md`
- [x] Relay server (`server/`): WebSocket + `/health`, answers `hello` with `welcome`
- [x] Phone page (`client/`): connects, shows "Connected to server", reconnects automatically
- [x] Godot host (`host/`): blank 1920×1080 screen that shows "Connected to server", reconnects automatically
- [x] `npm run dev` starts server + phone page + Godot host together
- [x] Test setups: Vitest (21 tests) and GUT 9.7.1 for Godot (11 tests)
- [x] Verified with Godot 4.7.2: host connects to the server, and reconnects if the server starts later
- [x] First commit

### Waiting on the creative director (Phase 0 "You do")

- [ ] Install Godot 4.7 (standard build), Node.js 22 LTS or newer, Git, a text editor
- [ ] Install Claude Code
- [ ] GitHub repository (exists: rossgrantfitness/triviaparty)
- [ ] Install Blender, plus Krita or Aseprite
- [ ] Decide the working title and the first 4 animals
- [ ] Run `npm run dev` on your PC and confirm both the Godot window and phone page say "Connected to server" (this completes Phase 0)

### Next up (Phase 1 — Networking prototype)

1. Relay server rooms: 4-letter codes without confusable letters, player tracking, 16-player cap
2. Server game state machine: Lobby → Category Vote → Question → Reveal → Scoreboard → Game Over
3. Phone join screen (code + name) and waiting screen

## Known bugs

None yet.

## Notes and decisions

- Godot version: 4.7 (latest stable when the project started). GUT 9.7.1 is the matching test addon.
- Dev server port 8787, phone page port 5173. The phone page connects to port 8787 on whatever machine served it, so phones on the same Wi-Fi work by opening `http://<your PC's IP>:5173`.
- The host reads its server address from `host/config/network.json`.
- Commit Godot's `.uid` and `.import` files next to scripts and assets; Godot uses them to keep references stable.
