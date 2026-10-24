# Progress

Last updated: 2026-10-24

## Where we are: a double-click Windows game with a join website

- **The game:** `docs/download/TriviaParty-Windows.zip` (built by `npm run build:windows`).
  Unzip, double-click `TriviaParty.exe`. It starts its own server; no Node or Godot install needed.
- **The website:** https://rossgrantfitness.github.io/triviaparty (GitHub Pages from the
  `docs/` folder). Phones type the room code there and get sent to the game PC.
- How the code works: the room code is the PC's Wi-Fi address scrambled into letters
  (`shared/src/join_code.ts`), so the website needs no server of its own. Phones must be
  on the same Wi-Fi as the PC.

## The full game is playable

Ross asked for "Drawful 2 and Papa's Quiz combined": fun, colorful trivia (never
over-the-top quirky) plus drawing rounds, with any browser as a controller.
That is now built end to end: TV (Godot), phones (any browser), server, content.

### Three game modes (press G in the lobby)

| Mode | What it is |
|---|---|
| Trivia Party | The full mix below: quiz, doodles, bets, closest guess, steals, final bet |
| Doodle Party | Only drawing: Doodle Duel and the new Draw-Off, back to back |
| Meme Mode | Name that meme, where it started, what year: quiz, closest-year guesses, steals, bets |

### The game

A session is a plan of rounds (host picks mode, Short / Standard / Long, drawing on/off):

| Round | What happens |
|---|---|
| Quiz Time | Vote for a category, then answer fast. Speed bonus. |
| Doodle Duel | Artists draw a secret prompt on their phones. For each drawing, everyone else writes a fake title, then picks the real one. Points for spotting the truth, for the artist, and for fooling people. |
| High Roller | See the category, bet your points, then answer. |
| Closest Guess | Type a number; nearest guesses score, shown on a number line. |
| Sticky Fingers | Right answers steal points from a player they choose. |
| Final Showdown | One hard question; everyone bets as much as they dare. |
| Draw-Off | Everyone draws the same prompt, the gallery goes up on the TV, everyone votes for their favorite (not their own). |

Standard game: Quiz Time, Doodle Duel, Closest Guess, Sticky Fingers, Doodle Duel,
Final Showdown (about 18 minutes). Short is about 10, Long about 24.

### Done

- [x] Phase 0 setup and Phase 1 networking (rooms, codes, reconnect, kick, pause, 16-player cap, bots)
- [x] Round system: each round type is its own module (`server/src/rounds/`), new types plug in
- [x] Six round types above, with all timers and points in `host/config/game_rules.json`
- [x] Session flow: round intro cards, standings between rounds (with points gained this round), winner screen
- [x] Host settings in the lobby: game length (L), drawing rounds on/off (D), time estimate
- [x] Phones: screens for every step, touch drawing pad (10 pens from the palette, 4 sizes, undo, clear), wager slider, number guesses, steal picker
- [x] TV: every step, drawings rendered from the phones' strokes, closest-guess number line, Doodle Duel reveal (fakes first, truth last), animals react (think, lock in, cheer, slump, get robbed, ★ for the artist)
- [x] Fair turns: with lots of players only `drawings_per_round` people draw per Doodle Duel, rotating
- [x] The TV remembers recently used questions and prefers fresh ones next game
- [x] Content: 172 multiple-choice questions in all 12 categories (with fun facts), 36 closest-guess numbers, 148 drawing prompts, 50 house lies
- [x] Double-click launchers (`start_game.bat`, `start_game.command`)
- [x] Tests: 87 TypeScript + 36 Godot; full games played here with the real TV, bots and a browser phone (4 and 9 players)
- [x] Game modes: Trivia Party, Doodle Party (all drawing), Meme Mode (G in the lobby, or `--mode=` on the command line)
- [x] Draw-Off round: same prompt for everyone, gallery vote, winner bonus
- [x] Meme content: 38 "name that meme", 24 "where it started", 8 + 22 "what year" (text descriptions, no meme images)
- [x] New palette: orange, yellow, reddish, steel, grey, black, white (TV and phones)
- [x] Sound identity: one signature four-note jingle (G C E A), and every sound (taps, lock-ins, right, wrong, steal, winner) built from the same bright bell family so the game has a recognisable "voice". Synthesized by `tools/audio/make_sfx.py`; TV and phones both play them; M mutes the TV, a speaker button mutes the phone
- [x] Juice: pop-ins and staggered entrances, screen shake on wrong answers and steals, count-up scores, confetti, big onomatopoeia stamps (ピンポーン! ブブー ヌスミ! ブラボー! やったー!), urgent ticking in the last seconds, phone buzz and confetti
- [x] Avatars: pick a hat on the phone (party hat, headband, bow, crown, top hat, flower, glasses), and draw a self-portrait that hangs on a little sign by your podium
- [x] Emotes: 8 emote buttons on every phone (laugh, wow, love, boo, clap, think, taunt, cry); the animal acts it out with a speech bubble on the TV
- [x] Playful steals: coins fly from the victim to the thief, the victim slumps, cheeky lines on the phones ("YOINK!", "pockets empty")
- [x] Tests: 97 TypeScript + 42 Godot; Doodle Party, Meme Mode and steal-heavy games played here with the real TV and bots
- [x] Packaged Windows game (`npm run build:windows`): TriviaParty.exe starts the bundled server (Node), which also serves the phone page; content/ sits next to the exe so packs can be edited
- [x] Website on GitHub Pages (`docs/index.html`): type the room code → sent to the game PC; download button for the Windows zip
- [x] Room codes spell the PC's home-network address; the TV shows the website and the code
- [x] Tests: 106 TypeScript + 42 Godot; the packaged game tested here (Linux copy of the same package): starts its server, website → code → join works, server stops when the game closes

### Waiting on the creative director

- [ ] Play a real game with friends (any phones, same Wi-Fi) and tell me what was fun, what dragged, what confused people
- [ ] Verify the questions (each has a Wikipedia link; all are unverified drafts) and the drawing prompts
- [ ] Listen to the sounds and tell me which ones you love or hate (they're placeholders made by code, easy to redo)
- [ ] Check the meme questions too (dates and first appearances are drafts)
- [ ] Tune pacing in `host/config/game_rules.json` (or tell me and I'll change it)
- [ ] Working title, animals 5–8, swap the placeholder animal models when you have art

### Next up (suggested)

1. Fixes from your first real playtest
2. Host the server online so phones on mobile data can join (manifest section 12)
3. F1 debug menu on the TV; question validator script and review page (manifest Phase 3)
4. Audio: background music and host voice lines (sound effects are in; music isn't)
5. Meme Mode with real meme pictures (needs image rights checked first, so text-only for now)

## Known issues

- Windows asks twice on first run: SmartScreen ("More info → Run anyway", the exe isn't signed) and the firewall (click Allow, or phones can't connect).
- The Windows build hasn't been run on a real Windows PC by me (only the Linux copy of the same package); Ross's first run is the real test.
- Phones must be on the same Wi-Fi as the PC (guest networks that isolate devices won't work). Playing over the internet needs an online server (manifest section 12).
- The zip is committed to git (about 74 MB per build). Move it to GitHub Releases once builds settle.

- With 9+ players, back-row name plates are partly hidden behind front-row animals.
- Emoji in names and fake titles are removed (the TV font has no emoji).
- The TV shows the join address `http://<PC's Wi-Fi address>:5173`. If it picks the wrong network adapter, set `phone_url` in `host/config/network.json`.
- Question packs load from `content/` next to the Godot project; exported builds will need them bundled (Steam build work).
- Couldn't download models from OpenGameArt in the cloud session (blocked), so the animals are generated placeholders.
- Fake titles are free text from players; there's no profanity filter yet (release checklist item).

## Notes and decisions

- **Tone change (Ross, 2026-10-20):** questions and answers are fun, funny, colorful and interesting, but never as quirky as Jackbox. Drawing prompts are normal things with a humorous twist, always drawable. This updates the manifest's "tension over jokes" pillar: the stakes still come from mechanics (wagers, steals, speed, the final bet).
- Godot 4.7 with the Compatibility renderer. GUT 9.7.1. Protocol version 4.
- Dev server port 8787, phone page port 5173.
- `min_players` is 1 for testing; the manifest's v1 target is 3–16. Doodle Duel works best with 3+.
- Commit Godot's `.uid` and `.import` files next to scripts and assets.
- **Sound philosophy (Ross, 2026-10-21):** like great Japanese products, the game should have one iconic, memorable sound that makes it a pleasure to use. So there's a signature jingle, and every other sound is a short piece of the same family (same bell tone, same key), never a random mix of stock effects.
- Meme Mode questions use `meme_` category ids; Meme Mode only uses those, the other modes never do.
- Hats and portraits are cosmetic only and never affect scoring. Emotes are rate-limited (`emote_cooldown_seconds`).
