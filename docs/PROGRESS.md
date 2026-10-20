# Progress

Last updated: 2026-10-20

## Where we are: the full game is playable

Ross asked for "Drawful 2 and Papa's Quiz combined": fun, colorful trivia (never
over-the-top quirky) plus drawing rounds, with any browser as a controller.
That is now built end to end: TV (Godot), phones (any browser), server, content.

### The game

A session is a plan of rounds (host picks Short / Standard / Long, drawing on/off):

| Round | What happens |
|---|---|
| Quiz Time | Vote for a category, then answer fast. Speed bonus. |
| Doodle Duel | Artists draw a secret prompt on their phones. For each drawing, everyone else writes a fake title, then picks the real one. Points for spotting the truth, for the artist, and for fooling people. |
| High Roller | See the category, bet your points, then answer. |
| Closest Guess | Type a number; nearest guesses score, shown on a number line. |
| Sticky Fingers | Right answers steal points from a player they choose. |
| Final Showdown | One hard question; everyone bets as much as they dare. |

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

### Waiting on the creative director

- [ ] Play a real game with friends (any phones, same Wi-Fi) and tell me what was fun, what dragged, what confused people
- [ ] Verify the questions (each has a Wikipedia link; all are unverified drafts) and the drawing prompts
- [ ] Tune pacing in `host/config/game_rules.json` (or tell me and I'll change it)
- [ ] Working title, animals 5–8, swap the placeholder animal models when you have art

### Next up (suggested)

1. Fixes from your first real playtest
2. Host the server online so phones on mobile data can join (manifest section 12)
3. F1 debug menu on the TV; question validator script and review page (manifest Phase 3)
4. Audio: music, sound effects, host voice lines (manifest Phase 5)

## Known issues

- With 9+ players, back-row name plates are partly hidden behind front-row animals.
- Emoji in names and fake titles are removed (the TV font has no emoji).
- The TV shows the join address `http://<PC's Wi-Fi address>:5173`. If it picks the wrong network adapter, set `phone_url` in `host/config/network.json`.
- Question packs load from `content/` next to the Godot project; exported builds will need them bundled (Steam build work).
- Couldn't download models from OpenGameArt in the cloud session (blocked), so the animals are generated placeholders.
- Fake titles are free text from players; there's no profanity filter yet (release checklist item).

## Notes and decisions

- **Tone change (Ross, 2026-10-20):** questions and answers are fun, funny, colorful and interesting, but never as quirky as Jackbox. Drawing prompts are normal things with a humorous twist, always drawable. This updates the manifest's "tension over jokes" pillar: the stakes still come from mechanics (wagers, steals, speed, the final bet).
- Godot 4.7 with the Compatibility renderer. GUT 9.7.1. Protocol version 3.
- Dev server port 8787, phone page port 5173.
- `min_players` is 1 for testing; the manifest's v1 target is 3–16. Doodle Duel works best with 3+.
- Commit Godot's `.uid` and `.import` files next to scripts and assets.
