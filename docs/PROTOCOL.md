# Network protocol

Every message is a JSON object sent as one WebSocket text frame, with a string
`type` field. The source of truth is `shared/src/protocol.ts`; the Godot host
mirrors it in `host/scripts/protocol.gd`. Change all three together and bump
`PROTOCOL_VERSION` when an old client could no longer understand a message.

- Protocol version: **1**
- Dev server: `ws://<machine>:8787` (same port serves `GET /health`)

## Connection flow

1. Client opens the WebSocket.
2. Client sends `hello`.
3. Server replies `welcome` (or `error` if the hello is invalid or the version does not match).
4. If the socket closes, the client waits `reconnect_delay_seconds` (2 s) and starts again from step 1.

## Client → Server

### `hello`

Sent by the host and by phones immediately after the socket opens.

| Field | Type | Notes |
|---|---|---|
| `type` | `"hello"` | |
| `role` | `"host"` \| `"player"` | Godot host sends `host`, phones send `player` |
| `protocolVersion` | number | Must equal the server's `PROTOCOL_VERSION` |

```json
{ "type": "hello", "role": "player", "protocolVersion": 1 }
```

## Server → Client

### `welcome`

| Field | Type | Notes |
|---|---|---|
| `type` | `"welcome"` | |
| `connectionId` | string | Random id for this connection (not yet a reconnect token) |
| `role` | `"host"` \| `"player"` | Echo of the role from `hello` |
| `protocolVersion` | number | Server's protocol version |

### `error`

| Field | Type | Notes |
|---|---|---|
| `type` | `"error"` | |
| `code` | `"bad_message"` \| `"protocol_mismatch"` | |
| `message` | string | Human-readable detail, safe to show on screen |

## HTTP

### `GET /health`

Returns `200` with `{ "ok": true, "protocolVersion": 1, "connections": <number> }`.
Used by uptime checks later.
