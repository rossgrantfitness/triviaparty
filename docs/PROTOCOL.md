# Network protocol

Every message is a JSON object sent as one WebSocket text frame, with a string
`type` field. The source of truth is `shared/src/protocol.ts` (messages and views)
and `shared/src/game.ts` (questions, prompts, strokes, rules); the Godot host
mirrors what it sends in `host/scripts/protocol.gd`. Change them together and bump
`PROTOCOL_VERSION` when an old client could no longer understand a message.

- Protocol version: **4**
- Dev server: `ws://<machine>:8787` (the same port serves `GET /health`)
- The server owns all game state. Host and phones only send inputs and draw the
  `state` snapshots they receive.

## Connection flow

**Host (TV):**
1. Open socket → `hello {role: "host"}` → `welcome`.
2. `create_room` → `room_created {code, hostToken, phoneUrl}` + `state`.
   If the server knows the PC's home-network address, the room code spells it
   (`shared/src/join_code.ts`): 4 letters for 192.168.x.x, 5 for 172.16–31.x.x,
   6 for 10.x.x.x. The website (`docs/index.html`) decodes it and sends the phone
   to `http://<address>:8787/?room=<code>`. `phoneUrl` is that address when the
   server serves the phone page itself (the packaged game), else null.
3. After a network drop: `hello` again, then `resume_room {code, hostToken}`.
   Same room, same players. If the room expired (`error room_not_found`), the
   host creates a new one.
4. `start_game` sends this session's rules, settings, questions and drawing prompts.

**Phone (any browser):**
1. Open socket → `hello {role: "player"}` → `welcome`.
2. `join {code, name, animal, accessory}` → `joined {playerId, token}` + `state`.
3. The phone stores `token` (localStorage). After a reload or a locked screen it
   sends `join` with the token and gets the same seat and score back.
4. Optionally `avatar {strokes}`: a self-portrait. The server forwards it to the
   host as `avatar {playerId, strokes}` (and re-sends every portrait when the
   host reconnects). Phones can redraw it any time.

Every change in a room sends a fresh `state` to the host and to each phone.

## Session flow

```
lobby ─start_game→ intro (round 1) → round → scoreboard → intro (round 2) → … → game_over
game_over ─back_to_lobby→ lobby
```

The rounds come from `modes[settings.mode][settings.length]` in the rules, minus
rounds the content or settings can't support (no drawing prompts or drawing
turned off → no Doodle Duel or Draw-Off; no closest-guess questions → no Closest
Guess). Modes: `party` (Trivia Party, everything), `doodle` (Doodle Party, only
drawing rounds; ignores the drawing switch), `memes` (Meme Mode). Meme Mode only
uses questions whose category starts with `meme_`; the other modes never do.

| Round kind | Title on screen | Steps (`round.step`) |
|---|---|---|
| `classic` | Quiz Time | `vote` → (`question` → `reveal`) × N |
| `wager` | High Roller | `vote` → (`wager` → `question` → `reveal`) × N |
| `steal` | Sticky Fingers | `vote` → (`question` → `reveal` → `steal` → `steal_reveal`) × N |
| `final` | Final Showdown | `wager` → `question` → `reveal` (one of the hardest questions) |
| `closest` | Closest Guess | (`question` → `reveal`) × N |
| `drawing` | Doodle Duel | `drawing` → (`lying` → `picking` → `reveal`) per drawing |
| `drawoff` | Draw-Off | `drawing` → `voting` → `reveal` (everyone draws the same prompt) |

Steps end when their timer runs out, or early when every connected player has
acted (`end_phase_when_everyone_acted`). The host's **Next** (`skip`) ends the
current step now.

### Scoring

- **Quiz Time / Sticky Fingers:** right answer = `base_points + speed_bonus_max × time left ÷ question time`.
- **Sticky Fingers:** each right answer then takes up to `steal_points` from a chosen player (or the leader if they don't choose).
- **High Roller / Final Showdown:** bet up to your score (or `wager_floor` if you have less); right wins the bet, wrong loses it. Scores never go below 0.
- **Closest Guess:** places by distance (ties share); `closest_points[place-1]`, plus `closest_exact_bonus` for an exact hit.
- **Doodle Duel:** spotting the real title `draw_truth_points`; the artist gets `draw_artist_points` per player who spotted it; a fake title earns `draw_fool_points` per player it fooled.
- **Draw-Off:** each vote for your drawing earns `drawoff_vote_points`; the most-voted drawing (ties share) adds `drawoff_winner_bonus`. You can't vote for your own.

All numbers live in `host/config/game_rules.json`.

## Client → Server

| Type | Who | Fields | Notes |
|---|---|---|---|
| `hello` | both | `role` (`host`/`player`), `protocolVersion` | First message |
| `create_room` | host | | Closes the host's previous room, if any |
| `resume_room` | host | `code`, `hostToken` | |
| `start_game` | host | `rules` (partial), `settings {length, drawing, categories}`, `questions[]`, `prompts[]`, `decoys[]` | Lobby only. Rules are clamped server-side; max 16 players always |
| `kick` | host | `playerId` | Phone receives `kicked` |
| `set_paused` | host | `paused` | Freezes the timer |
| `skip` | host | | Ends the current step now |
| `back_to_lobby` | host | | After game over: keeps players, resets scores |
| `join` | phone | `code` (4–6 letters, no I/O), `name`, `animal` (`dog`/`cat`/`bunny`/`frog`), `accessory` (`none`/`party_hat`/`headband`/`bow`/`crown`/`top_hat`/`flower`/`glasses`, default `none`), `token?` | Name trimmed to 12 chars, emoji removed; duplicates get " 2". Rejoining can change the hat |
| `avatar` | phone | `strokes[]` (≤ `MAX_AVATAR_STROKES` = 150) | Any time; replaces the old portrait |
| `emote` | phone | `emote` (`laugh`/`wow`/`love`/`boo`/`clap`/`think`/`taunt`/`cry`) | Any time; forwarded to the host. Faster than `emote_cooldown_seconds` is quietly dropped |
| `vote` | phone | `category` | `vote` step; can change vote |
| `wager` | phone | `amount` | `wager` step; capped at `me.maxWager`; once |
| `answer` | phone | `choice` (index) | `question` step; first answer is final |
| `steal` | phone | `target` (playerId) | `steal` step, right answers only, not yourself |
| `guess` | phone | `value` (number) | Closest Guess `question` step; once |
| `drawing` | phone | `strokes[]` | Doodle Duel `drawing` step, artists only; once |
| `lie` | phone | `text` (≤ 45 chars) | `lying` step, not the artist. Rejected with `too_close` if it's the real title, `duplicate` if someone wrote it already |
| `pick` | phone | `option` (option id) | `picking` step, not the artist, not your own lie |
| `vote_drawing` | phone | `drawing` (gallery id) | Draw-Off `voting` step, not your own drawing; can change vote |

A stroke is `{c: pen color index, w: pen width index, p: [x, y, x, y, …]}` with
coordinates 0–1000 on a square canvas (`PEN_COLORS`, `PEN_WIDTHS` in `shared/src/game.ts`).

## Server → Client

| Type | Fields |
|---|---|
| `welcome` | `connectionId`, `role`, `protocolVersion` |
| `room_created` | `code`, `hostToken`, `phoneUrl` (host only; null in development) |
| `joined` | `code`, `playerId`, `token` (phone only) |
| `kicked` | — |
| `error` | `code`, `message` (safe to show on screen) |
| `state` | see below |
| `avatar` | `playerId`, `strokes` (host only) |
| `emote` | `playerId`, `emote` (host only) |

Error codes: `bad_message`, `protocol_mismatch`, `room_not_found`, `room_full`,
`not_allowed`, `bad_name`, `not_enough_players`, `no_questions`, `too_close`, `duplicate`.

### `state`

| Field | Notes |
|---|---|
| `code`, `phase`, `paused`, `hostConnected` | `phase`: `lobby` · `intro` · `round` · `scoreboard` · `game_over` |
| `players[]` | `id, name, animal, accessory, hasAvatar, seat, score, connected, hasActed, lastPoints, roundPoints, rank` |
| `timer` | `{durationMs, remainingMs}` or null; count down locally |
| `roundIndex`, `roundCount`, `roundKind`, `roundTitle`, `roundBlurb` | The current (or upcoming, during `intro`) round |
| `round` | The round's view (below), only during `phase: "round"` |
| `you` | `{playerId}` in a phone's own copy, else null |

**Quiz view** (`classic`, `wager`, `steal`, `final`): `step, questionNumber,
questionCount, category, vote {categories[{id, name, votes}]}, question {id,
category, categoryName, difficulty, text, choices}, reveal {correctIndex,
answers{playerId: index|null}, fact}, wagers, steals[{thief, victim, amount}],
me {answer, vote, wager, maxWager, canSteal, stealTarget}`.
The question never includes the answer; `reveal` appears only from the reveal on.

**Closest view:** `step, questionNumber, questionCount, question {id, category,
categoryName, text, unit}, reveal {answer, fact, results[{playerId, guess,
distance, place, points}]}, me {guess}`.

**Drawing view:** `step, drawingNumber, drawingCount, artistIds[], artistId,
strokes, options[{id, text}], reveal {items[{optionId, text, truth, authors[],
pickers[]}], shown}, me {prompt, isArtist, submitted, lie, pick}`.
`me.prompt` is only sent to that artist during `drawing`; the TV never gets
prompts. Options don't say which is real until `reveal`, which steps through
the fakes (fewest pickers first) and ends with the truth (`shown` counts up).

**Draw-Off view:** `step, prompt, gallery[{id, number, strokes, artistId, votes}],
me {submitted, vote, ownDrawing}`. Everyone (TV included) sees the prompt.
`strokes` only go to the TV; phones vote by number while looking at the big
screen. `artistId` and `votes` stay null until `reveal`, where the gallery is
sorted by votes.

## HTTP

`GET /health` → `200 {ok, protocolVersion, connections, rooms}`. For uptime checks.

Started with `--phone-dir=<folder>` (the packaged game), the server also serves
the built phone page from that folder on the same port; unknown paths get
`index.html`. Other server options: `--log-file=<path>`, `--parent-pid=<pid>`
(quit when the TV game is gone), env `PORT`, env `TRIVIA_LAN_ADDRESS` (override
the address the room code spells).
