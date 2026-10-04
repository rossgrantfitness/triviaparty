# Network protocol

Every message is a JSON object sent as one WebSocket text frame, with a string
`type` field. The source of truth is `shared/src/protocol.ts` (and
`shared/src/game.ts` for questions and rules); the Godot host mirrors the parts
it uses in `host/scripts/protocol.gd`. Change them together and bump
`PROTOCOL_VERSION` when an old client could no longer understand a message.

- Protocol version: **2**
- Dev server: `ws://<machine>:8787` (the same port serves `GET /health`)
- The server owns all game state. Host and phones only send inputs and draw the
  `state` snapshots they receive.

## Connection flow

**Host (TV):**
1. Open socket → `hello {role: "host"}` → `welcome`.
2. `create_room` → `room_created {code, hostToken}` + `state`.
3. After a network drop: `hello` again, then `resume_room {code, hostToken}`.
   Same room, same players. If the room expired (`error room_not_found`), the
   host creates a new one.
4. `start_game {rules, questions}` sends this session's question set (manifest section 3).

**Phone:**
1. Open socket → `hello {role: "player"}` → `welcome`.
2. `join {code, name, animal}` → `joined {playerId, token}` + `state`.
3. The phone stores `token` (localStorage). After a reload or a locked screen it
   sends `join` with the token and gets the same seat and score back.

Every change in a room sends a fresh `state` to the host and to each phone.

## Client → Server

| Type | Who | Fields | Notes |
|---|---|---|---|
| `hello` | both | `role` (`host`/`player`), `protocolVersion` | First message |
| `create_room` | host | | Closes the host's previous room, if any |
| `resume_room` | host | `code`, `hostToken` | |
| `start_game` | host | `rules` (partial game rules), `questions` (array) | Lobby only. Rules are clamped server-side; max 16 players always |
| `kick` | host | `playerId` | Phone receives `kicked` |
| `set_paused` | host | `paused` | Freezes the timer |
| `skip` | host | | Ends the current timed phase now |
| `back_to_lobby` | host | | After game over: keeps players, resets scores |
| `join` | phone | `code` (4 letters, no I/O), `name`, `animal` (`dog`/`cat`/`bunny`/`frog`), `token?` | Name trimmed to 12 chars; duplicates get " 2" |
| `vote` | phone | `category` (id) | During `category_vote`; can change vote |
| `answer` | phone | `choice` (index) | During `question`; first answer is final |

## Server → Client

| Type | Fields |
|---|---|
| `welcome` | `connectionId`, `role`, `protocolVersion` |
| `room_created` | `code`, `hostToken` (host only) |
| `joined` | `code`, `playerId`, `token` (phone only) |
| `kicked` | — |
| `error` | `code`, `message` (safe to show on screen) |
| `state` | see below |

Error codes: `bad_message`, `protocol_mismatch`, `room_not_found`, `room_full`,
`not_allowed`, `bad_name`, `not_enough_players`, `no_questions`.

### `state`

| Field | Type | Notes |
|---|---|---|
| `code` | string | Room code |
| `phase` | `lobby` · `category_vote` · `question` · `reveal` · `scoreboard` · `game_over` | |
| `paused` | bool | |
| `hostConnected` | bool | Phones show "TV reconnecting" when false (game auto-pauses) |
| `players` | PlayerView[] | Sorted by seat |
| `timer` | `{durationMs, remainingMs}` or null | Count down locally from `remainingMs` |
| `questionNumber`, `questionCount` | number | |
| `vote` | `{categories: [{id, name, votes}], winner}` or null | During `category_vote` |
| `question` | `{id, category, categoryName, difficulty, text, choices}` or null | During `question` and `reveal`. **Never includes the answer** |
| `reveal` | `{correctIndex, answers: {playerId: index or null}}` or null | Only during `reveal` |
| `you` | `{playerId, answer, vote}` or null | Only in a phone's own copy |

PlayerView: `id`, `name`, `animal`, `seat` (from 1), `score`, `connected`,
`hasActed` (voted/answered this phase), `lastPoints` (from the last question),
`rank` (1 = leader, ties share).

## Phases

```
lobby ─start_game→ category_vote ─(timer or everyone voted)→ question
question ─(timer or everyone answered)→ reveal ─timer→ scoreboard ─timer→
    next question in the block │ new category_vote │ game_over
game_over ─back_to_lobby→ lobby
```

Each vote picks a block of `questions_per_category` questions; ties are broken at
random; no question repeats within a game. Scoring (classic round):
`base_points + speed_bonus_max × (time left ÷ question time)` for a correct
answer, 0 otherwise. All numbers come from `host/config/game_rules.json`.

## HTTP

`GET /health` → `200 {ok, protocolVersion, connections, rooms}`. For uptime checks.
