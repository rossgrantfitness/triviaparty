# CLAUDE.md — standing instructions for Claude Code

Read this file and `docs/PROGRESS.md` at the start of every session, then tell
the creative director where we are. The full plan is in `docs/MANIFEST.md`.

## Project in one paragraph

A high-stakes party trivia game for Steam. Up to 16 players join from their
phones with a room code, pick a cute 3D animal, vote on a category, and play
about 15 minutes of serious trivia. Design pillars: tension over jokes, host
control, content that grows (questions are data, never code), cute and readable
from a couch. Working title: TBD ("Trivia Party" placeholder).

## Roles

| Role | Owner | Responsibilities |
|---|---|---|
| Creative director + artist | Ross (the user) | Vision, characters, stage, UI art, final calls on fun, playtesting, Steam account |
| Engineer + technical PM | Claude Code | All code, tools, build scripts, test suites, bug fixes, keeping docs current |
| Content writer + fact-checker | Ross, assisted by Claude | Claude drafts questions; Ross verifies and approves |
| Playtesters | Friends and family | Weekly play sessions, feedback form |

The creative director is not a programmer. Explain how to try things in plain
steps ("run this command, open this page, you should see…"), never assume they
will read code.

## Session workflow

1. Start: read CLAUDE.md and docs/PROGRESS.md, summarize where we are.
2. Pick one task from the current phase checklist (small enough for one session).
3. Build it, run the automated tests, then say exactly how to try it.
4. The creative director plays it and reports: what they did, what they
   expected, what happened.
5. Fix, update docs/PROGRESS.md, and commit with a clear message.

## Rules that keep a non-coder in control

- Every change is committed to git so anything can be rolled back.
- Never delete anything in `art/` without asking first.
- Tunable numbers (timers, points, animation speeds) live in config files or an
  in-game debug menu, never buried in code.
- When unsure about a design choice, ask the creative director instead of
  guessing. Anything outside v1 scope (manifest section 1) goes on the later
  list (section 13), not into the build.

## Architecture

Three programs talk through one relay server, which owns all game state
(Jackbox-style):

- `host/` — Godot 4.7 project, GDScript. The game on the TV. Displays state, sends host inputs.
- `client/` — phone web app, TypeScript + Vite, plain HTML/CSS. Displays state, sends player inputs.
- `server/` — Node.js + TypeScript relay using WebSockets (`ws`). Single source of truth: timers, answer checking, scoring.
- `shared/` — message types and parsers used by both server and client.

## Conventions

- GDScript with static types in `host/`; TypeScript (strict) in `client/`, `server/`, `shared/`.
- The server is the single source of truth for game state; host and phones only display it and send inputs. Phones never receive a correct answer before the reveal.
- Every network message is defined once in `shared/src/protocol.ts`, documented in `docs/PROTOCOL.md`, and mirrored for Godot in `host/scripts/protocol.gd`. Change all three together.
- Gameplay numbers live in `host/config/game_rules.json`, never hard-coded. The host sends them with `start_game`; the server clamps them.
- Colors and fonts for the TV live in `host/scripts/look.gd`; the phone's are CSS variables in `client/src/style.css`. Both use the asagi-shu palette (see `docs/ART_SPECS.md`).
- Godot uses the Compatibility renderer (runs on more PCs). The host UI is built in code (`host_ui.gd`), the stage in `stage.gd`, characters are animated in code (`chibi_character.gd`).
- File names: lowercase with underscores (`fox_idle.glb`, `science_general.json`). Exception: npm/tooling files that require a fixed name.
- Each task ends with tests passing, `docs/PROGRESS.md` updated, and a git commit.

## Commands

Run from the repo root (needs Node.js 22+; Godot 4.7 for the host).

| Command | What it does |
|---|---|
| `start_game.bat` / `start_game.command` | Double-click launchers for Ross: install, find Godot (file picker on Windows), `npm run dev`, open the phone page |
| `npm install` | Install dependencies (once, and after pulling dependency changes) |
| `npm run dev` | Start server (port 8787) + phone page (port 5173) + Godot host window |
| `npm run host` | Open just the Godot host window (`-- --editor` opens the editor) |
| `npm test` | TypeScript tests (Vitest) |
| `npm run test:host` | Godot tests (GUT, headless) |
| `npm run typecheck` | Type-check all TypeScript |
| `npm run bots -- ABCD 15` | 15 fake players join room ABCD (`--fast`, `--churn` for drop/rejoin) |
| `npm run bots -- --host 3 2` | Fake TV: create a room, 2 bots join, start when 3 players are in |
| `npm run sync-art` | Copy `art/export/<animal>/` models and portraits into the host and phone page |
| `python tools/art/make_chibi_animals.py` | Rebuild the placeholder animals (needs `pip install bpy`) |

Host command-line extras (after `--`): `--server=ws://…` to use another server,
`--autostart=N` to start automatically once N players joined (testing).

Godot is located by `tools/run_host.mjs`: `GODOT` env var, then a `.godot-path`
file at the repo root (untracked), then PATH, then common install folders.

## Tests

- TypeScript tests live in `tests/<package>/*.test.ts` (Vitest, config in `vitest.config.ts`).
- Godot tests live in `host/tests/` (GUT 9.7.1 vendored in `host/addons/gut`, config in `host/.gutconfig.json`). GUT must live inside the Godot project, so these are not in the top-level `tests/`.
- Before every commit: `npm test`, `npm run typecheck`, and `npm run test:host` when Godot is available.

## Folder map

```
CLAUDE.md          this file
docs/              MANIFEST, PROGRESS, PROTOCOL, ART_SPECS
host/              Godot 4 project (config/, scenes/, scripts/, tests/, addons/gut)
client/            phone web app
server/            relay server
shared/            message types shared by client and server
content/questions/ verified question packs (JSON, one file per category)
content/schema/    JSON Schema every pack must pass
art/source/        working files (.blend, .kra) — never delete without asking
art/export/        finished exports the game imports (.glb, .png)
tools/             scripts: host launcher, validators, bot players, build scripts
tests/             TypeScript automated tests
```
