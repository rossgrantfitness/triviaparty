# Progress

Last updated: 2026-10-04

## Current phase: Phase 1 — Networking prototype (playable, waiting on real-phone testing)

### Phase 0 — Setup: done

Folder structure, CLAUDE.md, server + phone page + Godot host each run, `npm run dev`
starts everything, Vitest + GUT set up. Ross confirmed "Connected to server" on his PC.

### Phase 1 — done in this session

- [x] Relay server rooms: 4-letter codes without I/O (and no rude words), player tracking, 16-player cap
- [x] Server state machine: Lobby → Category Vote → Question → Reveal → Scoreboard → Game Over → back to Lobby
- [x] Server-side timers, answer checking and speed-bonus scoring; the answer is only sent at the reveal
- [x] Phone: join (code, name, animal), waiting screen, vote, answer buttons, "answer locked", reveal, standings, final result
- [x] Godot host: lobby with code and join address, vote, question with countdown, reveal, standings, winner screen
- [x] Reconnect: a phone that reloads or locks rejoins the same seat with the same score (token in localStorage); the TV resumes its room after a network blip and the game auto-pauses while it's gone
- [x] Host controls: start (Enter), pause (Space), skip (N), remove player (Tab panel), play again
- [x] Bot players: `npm run bots -- ABCD 15` (also `--fast`, `--churn`, and `--host` to run without the TV)
- [x] 50 sample questions in 5 categories (`content/questions/sample_*.json`), not yet verified
- [x] Palette: asagi-shu everywhere (TV and phone); M PLUS Rounded 1c font
- [x] Placeholder chibi animals: dog (shiba), cat (calico), bunny, frog, built by `tools/art/make_chibi_animals.py`, animated in code (idle, thinking, locked-in hop, cheer, slump, winner dance, clapping)
- [x] Tests: 73 TypeScript (Vitest), 28 Godot (GUT)
- [x] Verified here: Godot host + 5 bots + a browser phone played full games; 12-player two-row layout; 16-player cap

### Added after Ross couldn't get it running

- [x] Double-click launchers `start_game.bat` (Windows) and `start_game.command` (Mac); on Windows a file picker asks for Godot once and remembers it

### Waiting on the creative director

- [ ] Play it on your PC with 2–4 real phones on home Wi-Fi (see "How to play a test game" in README.md)
- [ ] Try one phone on mobile data — this needs the server on the internet (not set up yet; see Next up)
- [ ] Report anything confusing on the phone screens or the TV
- [ ] Verify the 50 sample questions (each has a Wikipedia source link) — they are drafts until you do
- [ ] Look at the placeholder animals and tell me what to change (or swap in models you like; see docs/ART_SPECS.md)
- [ ] Decide the working title and animals 5–8

Phase 1 is done when: 1 host + 15 bots + your phone complete 10 questions with correct
scoring, and a phone that locks mid-game rejoins with its score intact.
(Both pass in automated runs here; it needs your real-device check.)

### Next up

1. Real-device fixes from your playtest
2. Host the relay server online (needed for phones on mobile data; manifest section 12)
3. Phase 2: round types as modules (Wager, Closest guess, Steal, Final showdown), host settings screen, F1 debug menu

## Known issues

- Back-row name plates are partly hidden behind front-row animals when there are 9+ players.
- Emoji in player names are removed (the TV font has no emoji).
- The TV shows the join address `http://<PC's Wi-Fi address>:5173`. If it picks the wrong network adapter, set `phone_url` in `host/config/network.json`.
- Question packs load from `content/questions/` next to the Godot project. Exported builds will need them copied in (Phase 3/Steam build work).
- Couldn't download models from OpenGameArt in the cloud session (blocked), so the animals are generated placeholders.

## Notes and decisions

- Godot 4.7 with the Compatibility renderer (runs on more PCs, suits the flat toon look). GUT 9.7.1.
- Dev server port 8787, phone page port 5173. `npm run dev` exposes the phone page on your Wi-Fi.
- Tunable numbers: `host/config/game_rules.json` (timers, points, questions per game, min/max players). `min_players` is 1 for testing; the manifest's v1 target is 3–16.
- Each category vote picks a block of `questions_per_category` (5) questions; 10 questions = 2 votes.
- Commit Godot's `.uid` and `.import` files next to scripts and assets; Godot uses them to keep references stable.
