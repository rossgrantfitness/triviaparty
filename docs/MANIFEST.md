# Trivia Party Game — Project Manifest

Oct 4, 2026 · @Ross Grant

## 1. Project overview

We are building a high-stakes party trivia game for Steam: up to 16 players join from their phones with a room code, pick a cute 3D animal, vote on a category, and play about 15 minutes of serious trivia. The next phase ends with a playable vertical slice that real groups can test.

Working title: TBD (placeholder: "Trivia Party").

### Design pillars

- **Tension over jokes.** Questions are sincere and stakes come from mechanics (wagers, speed, steals, comebacks), not forced humor.
- **Host control.** The host chooses categories, question count, difficulty and session length.
- **Content that grows.** Questions are data, never code, so the library can expand forever, including via Steam Workshop.
- **Cute and readable.** Kawaii 3D animals with big, clear reactions; every screen readable from a couch.

### v1 scope (Steam Early Access target)

- 3–16 players on phones/browsers, one Steam host PC on the TV
- Character + name select, category vote, 15-minute session with 3–4 round types
- 2,000+ fact-checked questions across 10–12 categories
- 8 animal characters, one studio stage
- Workshop question packs (voice packs follow after v1)

Not in v1: online matchmaking with strangers, character movement gameplay, mobile app store versions, custom voice packs, streamer audience mode.

## 2. Team roles and workflow

The artist owns vision, art, and playtesting; Claude Code owns all code, tooling, and builds. Every task flows through a short loop: plan, build, playtest, report, adjust.

| Role | Owner | Responsibilities |
|---|---|---|
| Creative director + artist | You | Vision, characters, stage, UI art, final calls on fun, playtesting, Steam account |
| Engineer + technical PM | Claude Code | All code, tools, build scripts, test suites, bug fixes, keeping docs current |
| Content writer + fact-checker | You, assisted by Claude | Question drafting (Claude), verification and approval (you) |
| Playtesters | Friends and family | Weekly play sessions, feedback form |

### Session workflow with Claude Code

1. Start every session with: "Read CLAUDE.md and docs/PROGRESS.md, then tell me where we are."
2. Pick one task from the current phase checklist. Keep tasks small enough to finish in one session.
3. Claude Code builds it, runs the automated tests, and tells you exactly how to try it.
4. You play it and report in plain words: what you did, what you expected, what happened. Screenshots help.
5. Claude Code fixes, then updates docs/PROGRESS.md and commits to git with a clear message.

### Rules that keep a non-coder in control

- Every change is committed to git, so any mistake can be rolled back.
- Claude Code never deletes assets in /art without asking.
- Tunable numbers (timers, points, animation speeds) live in config files or an in-game debug menu, never buried in code, so you can adjust them yourself.

## 3. Tech stack and architecture

Three programs talk through one cloud relay server, which owns all game state; this is the same model Jackbox-style games use, and it avoids home-network connection problems.

At game start the host sends that session's question set (official plus any Workshop packs) to the server, which then runs timers, checks answers, and pushes each screen to the TV and phones.

| Part | Technology | Why |
|---|---|---|
| Host game | Godot 4, GDScript | Free, text-based project files Claude Code can edit, good 3D, mature Steam plugin (GodotSteam) |
| Phone client | TypeScript web app (Vite), plain HTML/CSS | Works in any phone browser, no app install |
| Relay server | Node.js + TypeScript, WebSockets | Lightweight, cheap to host, shares message types with the phone client |
| Content | JSON question packs + JSON Schema | Human-readable, easy to validate, Workshop-friendly |
| Art | Blender (3D), Krita or Aseprite (UI), exported as .glb and .png | Free tools, formats Godot imports directly |
| Version control | Git + GitHub (private repo) | Every change can be undone |

## 4. Repository structure and conventions

One git repository (a monorepo) holds all three programs plus content, art, and docs, so Claude Code always sees the whole project.

```
trivia-party/
  CLAUDE.md              # standing instructions for Claude Code (copy this manifest's key rules here)
  docs/
    MANIFEST.md          # this document, exported to Markdown
    PROGRESS.md          # current phase, done/next, known bugs
    PROTOCOL.md          # every network message and its fields
    ART_SPECS.md         # sizes, formats, naming for art
  host/                  # Godot 4 project (the Steam game on the TV)
  client/                # phone web app (TypeScript + Vite)
  server/                # relay server (Node.js + TypeScript)
  shared/                # message types shared by client and server
  content/
    questions/           # question packs as JSON, one file per category
    schema/              # JSON Schema that every pack must pass
  art/
    source/              # your Blender/Krita/Aseprite working files
    export/              # finished exports the game imports
  tools/                 # validators, bot players, build scripts
  tests/                 # automated tests
```

### Conventions for Claude Code

- Languages: GDScript with static types in host/, TypeScript in client/, server/, and shared/.
- The server is the single source of truth for game state; host and phones only display it and send inputs.
- Every network message is defined once in shared/ and documented in docs/PROTOCOL.md.
- Gameplay numbers live in config files (host/config/game_rules.json), never hard-coded.
- File names: lowercase with underscores (fox_idle.glb, science_general.json).
- Each task ends with tests passing, PROGRESS.md updated, and a git commit.
- When unsure about a design choice, ask the creative director instead of guessing.

## 5. Phase 0: Setup (about 1 week)

Goal: a working environment where Claude Code can create, run, and commit all three programs.

### You do

- [ ] Install Godot 4 (standard build), Node.js LTS, Git, and VS Code or any text editor
- [ ] Install Claude Code and confirm it runs in a terminal
- [ ] Create a free GitHub account and a private repository named trivia-party
- [ ] Install Blender (3D), plus Krita or Aseprite (2D/UI)
- [ ] Decide on the working title and the first 4 animals

### Claude Code does

- [ ] Create the folder structure in section 4 and an initial CLAUDE.md
- [ ] Scaffold an empty Godot host project, Vite client, and Node server that each run with one command
- [ ] Add a root script so npm run dev starts the server and client together
- [ ] Add automated test setups (Vitest for TypeScript, GUT for Godot)
- [ ] Write docs/PROGRESS.md and make the first commit

Done when: you can type one command, see a blank Godot window and a blank phone page, and both say "connected to server."

## 6. Phase 1: Networking prototype (2–3 weeks)

Goal: prove the riskiest part first. Phones join a room by code and play one ugly but complete round of multiple-choice trivia, with placeholder art.

### Claude Code tasks

- [ ] Relay server: create room, return a 4-letter code (no confusable letters like O/0, I/1), track players, enforce a 16-player cap
- [ ] Server game state machine: Lobby → Category Vote → Question → Reveal → Scoreboard → Game Over
- [ ] Server-side timers and answer checking; phones never receive the correct answer before the reveal
- [ ] Phone client: join screen (code + name), waiting screen, answer buttons, "answer locked" feedback
- [ ] Host (Godot): lobby showing code and joined names, question screen with countdown, reveal, scoreboard
- [ ] Reconnect: a player whose phone locks rejoins the same seat with the same score (session token stored on the phone)
- [ ] Host controls: start game, kick player, pause
- [ ] Bot players script in tools/ that joins 15 fake players and answers randomly, for testing without friends
- [ ] Load questions from one sample JSON pack of 50 questions

### You do

- [ ] Play it with 2–4 real phones on home Wi-Fi and on mobile data
- [ ] Report anything confusing on the phone screens

Done when: 1 host plus 15 bots plus your own phone complete 10 questions with correct scoring, and a phone that locks mid-game rejoins with its score intact.

## 7. Phase 2: Core game loop, rounds, and scoring (4–6 weeks)

Goal: a full 15-minute session that feels tense and fair, still using placeholder art.

Session flow: character + name select → host settings → category vote → Round 1 → Round 2 → Round 3 → Final round → winner ceremony.

| Round type | How it works | What makes it high-stakes |
|---|---|---|
| Classic | Multiple choice, 4 options, 20 s | Speed bonus: faster correct answers score more |
| Wager | Bet 0–100% of your points before seeing the question | Leaders can lose everything |
| Closest guess | Type a number (a year, a distance, a count) | Nearest answer wins; nobody is ever fully out |
| Steal | Correct answer lets you take points from a chosen player | Targets the leader, creates rivalry |
| Final showdown | Everyone wagers on one hard question | Last place can still win |

### Claude Code tasks

- [ ] Round system where each round type is its own module, so new types plug in without touching others
- [ ] Host settings screen: categories, questions per round, difficulty mix, session length (default 15 min)
- [ ] Category vote with tie-break and "no repeats this session"
- [ ] Question picker that avoids repeats across sessions (remember recently used question IDs on the host)
- [ ] Scoring rules in game_rules.json: base points, speed curve, wager limits, steal amount
- [ ] Debug menu on the host (F1): skip question, force round type, adjust timers live
- [ ] Unit tests for every scoring rule and the vote tie-break

### You do

- [ ] Two playtests with real groups of 4–8 people
- [ ] After each, fill a short feedback form: Which round was most tense? Which dragged? Any moment of confusion?

Done when: a group of 6+ finishes a full session without help, and at least half say they want another game.

## 8. Phase 3: Question database and content pipeline (ongoing, starts in Phase 2)

Goal: 2,000+ verified questions by launch, and a pipeline that makes adding more routine. Questions are the product; treat accuracy as non-negotiable.

### Question format (one entry in a pack file)

```json
{
  "id": "sci-0042",
  "type": "multiple_choice",
  "category": "science",
  "difficulty": 3,
  "question": "Which planet has the shortest day?",
  "choices": ["Jupiter", "Earth", "Mars", "Saturn"],
  "answer": 0,
  "source": "https://example.org/planet-facts",
  "verified_by": "you",
  "verified_on": "2026-10-20",
  "tags": ["space", "planets"],
  "time_sensitive": false
}
```

Numeric questions use `"type": "closest_guess"` with `"answer": 1969` and `"unit": "year"`. Difficulty runs 1 (easy) to 5 (expert).

### Content pipeline

1. **Draft:** Claude writes batches of 50 questions per category into content/drafts/, each with a source link.
2. **Validate:** `npm run validate-questions` checks format, duplicate IDs, near-duplicate questions, missing sources, and answer positions (correct answers should not cluster on one letter).
3. **Verify:** you check each question against its source, fix or reject it, and mark verified_by and verified_on.
4. **Publish:** only verified questions move into content/questions/. The game refuses to load unverified ones in release builds.
5. **Maintain:** questions flagged time_sensitive (records, "current" facts) are re-checked every 6 months; players can flag a wrong answer from their phone after the reveal.

### Claude Code tasks

- [ ] JSON Schema for packs, plus the validator script
- [ ] Simple local web page in tools/ for reviewing drafts: shows one question at a time with Approve / Edit / Reject buttons
- [ ] Player "report this question" button that logs the question ID for review

Initial categories (proposal): General, Science, History, Geography, Animals and Nature, Food and Drink, Movies and TV, Music, Sports, Video Games, Art and Literature, Language and Words.

Budget for this honestly: verifying 2,000 questions at about 1 minute each is roughly 35 hours of work. Spread it across the whole project.

## 9. Phase 4: Art pipeline and asset specs (runs alongside Phases 2–3)

Goal: replace placeholders with the final kawaii look, starting with one character fully finished end-to-end before making the rest.

### Style guide (decide first, about 1 week)

- [ ] Mood board: 20–30 reference images for shapes, colors, and lighting
- [ ] Color palette: 1 background family, 8 character accent colors (one per animal, also used on that player's phone screen)
- [ ] One finished test character, imported and animated in-game, before any others are started

### Asset list for v1

| Asset | Count | Spec | Priority |
|---|---|---|---|
| Animal characters | 8 | Blender, under 8,000 triangles, one 1024 px texture, Godot-compatible humanoid-ish rig | 1 (first one early) |
| Character animations | 7 per character | Idle, thinking, answer locked, correct cheer, wrong slump, winner dance, loser clap | 1 |
| Character accessories | 10–20 | Hats or glasses swapped onto any animal | 3 |
| Studio stage | 1 | Podiums for up to 16, big question screen, host area | 2 |
| Host UI (TV) | ~10 screens | 1920×1080 base, scales to 4K; big type readable from a couch | 1 |
| Phone UI | ~8 screens | Portrait 390×844 base, thumb-sized buttons, works in bright rooms | 1 |
| Category icons | 12 | 512 px PNG, simple silhouettes | 2 |
| Capsule art and logo | Steam set | See Steam's current capsule size list | 2 (needed for store page) |

### How art reaches the game

1. Work files stay in art/source/ (Blender .blend, Krita .kra).
2. Export finished assets to art/export/: characters as .glb, images as .png.
3. Tell Claude Code: "New asset in art/export/fox/, please hook it up." It imports, wires animations to game events, and reports what it needs (missing animation, wrong scale).

**16 players on one stage:** if 16 full characters get crowded, Claude Code will show podiums in two rows or scale characters down; decide this with a mock-up early.

**If 3D modeling turns out to be a bottleneck:** fall back to 2D illustrated characters on 3D podiums. The code supports either.

## 10. Phase 5: Audio and voice (3–4 weeks)

Goal: audio that builds tension, with a host voice that sounds good, not cheap. Bad voice acting was a top complaint about Papa's Quiz, so quality beats quantity here.

Approach: the host voice speaks generic lines ("Lock in your answers!", "Final question!", winner calls), not every question. Questions appear as text. This keeps recording small and makes voice packs practical later.

### Asset list

- [ ] 60–100 host voice lines, recorded by one good voice actor (casting sites or a local actor), with 2–3 variants for frequent lines so they don't repeat
- [ ] Music: lobby loop, question loop that intensifies in the last 5 seconds, final round theme, victory sting
- [ ] Sound effects: join, answer locked, timer tick, correct, wrong, wager placed, steal, scoreboard shuffle
- [ ] All music and effects either commissioned or from libraries whose license clearly allows commercial game use; keep a licenses.md with every source

### Claude Code tasks

- [ ] Voice line system: lines referenced by ID (host.final_question.01) so a voice pack is just a folder of files with matching names
- [ ] Audio mixer settings on the host: music, voice, effects volume, and a "voice off" option
- [ ] Music layering so tension rises with the countdown

Voice line file spec: WAV 48 kHz for masters in art/source/audio, exported as OGG for the game, normalized to consistent loudness.

## 11. Testing and QA plan

Testing runs in three layers: automated tests catch logic bugs, bot players catch scale problems, and real groups catch fun problems.

| Layer | Who | When | What it catches |
|---|---|---|---|
| Unit tests | Claude Code | Every change | Scoring, voting, timers, question validation |
| Bot load test | Claude Code script | Before every playtest | 16 players at once, disconnects, rejoins, slow networks |
| Device matrix | You | Each phase end | iPhone Safari, Android Chrome, a tablet, an old phone |
| Group playtests | You + friends | Every 2 weeks from Phase 2 | Confusion, pacing, which rounds are fun |
| Content QA | You | Continuously | Wrong answers, typos, duplicate questions |

### Bug report template (paste to Claude Code)

- What I did:
- What I expected:
- What happened:
- Device and browser:
- Screenshot or video:

### Release checklist (before any public build)

- [ ] All automated tests pass
- [ ] Bot test: 16 players, 3 full sessions, zero crashes
- [ ] Phones on mobile data, not just Wi-Fi
- [ ] A player locking their phone for 60 seconds rejoins correctly
- [ ] Host PC loses internet for 10 seconds: game recovers or shows a clear message
- [ ] Profanity filter on player names works
- [ ] Questions: zero unverified questions in the build

## 12. Steam integration, Workshop, and distribution

The Steam store page should go live as early as Phase 2, because wishlists gathered months before launch drive day-one visibility. Requirements below are from memory and approximate; confirm each against Steamworks documentation when you reach it.

### Steamworks setup (you)

- [ ] Join Steamworks and pay the $100 Steam Direct fee per game (there is a waiting period before a first game can release, so do this early)
- [ ] Complete tax and banking forms
- [ ] Build the store page: capsule art, 5+ screenshots, a trailer, short and long descriptions
- [ ] Publish the "Coming Soon" page and start collecting wishlists

### Steam integration (Claude Code)

- [ ] Add the GodotSteam plugin to the host project
- [ ] Steam overlay, achievements (first win, 10-game streak, perfect round), and rich presence ("Hosting a trivia night")
- [ ] Workshop question packs: in-game uploader that validates a pack against the schema before upload; subscribed packs appear as selectable categories
- [ ] Workshop safety: pack report button, host option "official questions only" for family nights
- [ ] Build script that exports the Windows build (Mac and Linux later) and uploads it with SteamPipe

### Relay server hosting (Claude Code sets up, you own the account)

- [ ] Deploy the server to a cloud host with a free or cheap starter tier and automatic HTTPS
- [ ] Host the phone web client on a static site host under a short memorable domain (players type it on their phones)
- [ ] Health checks and an uptime alert to your email
- [ ] A budget alert on the hosting account

### Distribution plan

1. Closed playtest using a Steam Playtest app (free, invite-only)
2. Steam Next Fest demo: a 15-minute session with 2 categories
3. Early Access launch, then content updates every 4–6 weeks

## 13. Launch and post-launch roadmap

Launch in Early Access with a solid core, then grow through content, which is exactly what the question-as-data design is built for.

### Launch window

- [ ] Final release checklist (section 11) passes
- [ ] Press and creator kit: trailer, screenshots, logo, one-page fact sheet
- [ ] Send keys to party-game and trivia streamers and YouTubers
- [ ] Launch-day watch: server dashboard open, bug report channel (a Discord server) staffed
- [ ] Hotfix plan: Claude Code can patch and you can push a new build within a day

### Post-launch content updates (every 4–6 weeks)

- New question packs (200+ questions per update)
- New animal character or accessories
- New round type, tested in playtests first

### Later features (after Early Access proves demand)

- Custom voice packs on Workshop
- Audience mode for streamers (viewers beyond 16 vote along)
- Light character control in the lobby (phone joystick)
- Localization into other languages (questions need translation and cultural review)
- Console or mobile versions

## 14. Risks, open decisions, and the first Claude Code prompt

### Top risks

| Risk | Impact | Mitigation |
|---|---|---|
| Wrong answers in questions | Players lose trust fast | Source on every question, verification step, in-game report button |
| Question verification takes longer than planned | Launch slips | Start content work in Phase 2; launch with fewer categories rather than unverified ones |
| 3D characters take too long | Art blocks everything | Finish one character first; 2D fallback |
| Relay server goes down | Nobody can play | Uptime alerts, simple restart, clear error screen on the host |
| Server costs grow with players | Ongoing expense | Lightweight server, budget alerts, review costs monthly |
| Scope creep | Never ships | Anything not in section 1's v1 scope goes to section 13's later list |

### Open decisions for you

- [ ] Working title
- [ ] First 8 animals
- [ ] 3D characters vs 2D-on-3D fallback (decide after the first test character)
- [ ] Price point (common for party games: a low-teens USD range; check comparable games)
- [ ] Voice actor budget

### First prompt to give Claude Code (copy and paste)

```
I'm the artist and creative director for a party trivia game; you are the engineer.
Read docs/MANIFEST.md (the project manifest). Then:
1. Create the repository structure from section 4.
2. Write CLAUDE.md summarizing our roles, the session workflow (section 2),
   and the conventions (section 4).
3. Complete the Claude Code tasks in Phase 0 (section 5).
4. Tell me exactly how to run everything and what I should see.
Ask me before making any design decision the manifest doesn't cover.
```

Export this doc to Markdown and save it as docs/MANIFEST.md in the project folder before that first session.
