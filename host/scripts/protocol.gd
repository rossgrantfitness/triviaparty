class_name Protocol
extends RefCounted
## Network messages the host sends and receives.
## Mirrors shared/src/protocol.ts; keep both and docs/PROTOCOL.md in sync.

const PROTOCOL_VERSION: int = 1


## First message the host sends after the socket opens.
static func hello() -> String:
	return JSON.stringify({
		"type": "hello",
		"role": "host",
		"protocolVersion": PROTOCOL_VERSION,
	})


## Parse a raw server message. Returns an empty Dictionary when the text is
## not a JSON object with a string "type".
static func parse(raw: String) -> Dictionary:
	var data: Variant = JSON.parse_string(raw)
	if typeof(data) != TYPE_DICTIONARY:
		return {}
	var message: Dictionary = data
	if typeof(message.get("type")) != TYPE_STRING:
		return {}
	return message
