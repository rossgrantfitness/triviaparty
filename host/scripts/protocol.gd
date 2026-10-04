class_name Protocol
extends RefCounted
## Network messages the host sends and receives.
## Mirrors shared/src/protocol.ts; keep both and docs/PROTOCOL.md in sync.

const PROTOCOL_VERSION: int = 2


## First message the host sends after the socket opens.
static func hello() -> String:
	return _encode({"type": "hello", "role": "host", "protocolVersion": PROTOCOL_VERSION})


static func create_room() -> String:
	return _encode({"type": "create_room"})


static func resume_room(code: String, host_token: String) -> String:
	return _encode({"type": "resume_room", "code": code, "hostToken": host_token})


## rules: contents of config/game_rules.json. questions: question dictionaries from content packs.
static func start_game(rules: Dictionary, questions: Array) -> String:
	var clean_rules: Dictionary = {}
	for key: Variant in rules:
		if not str(key).begins_with("_"):
			clean_rules[key] = rules[key]
	return _encode({"type": "start_game", "rules": clean_rules, "questions": questions})


static func kick(player_id: String) -> String:
	return _encode({"type": "kick", "playerId": player_id})


static func set_paused(paused: bool) -> String:
	return _encode({"type": "set_paused", "paused": paused})


static func skip() -> String:
	return _encode({"type": "skip"})


static func back_to_lobby() -> String:
	return _encode({"type": "back_to_lobby"})


## Parse a raw server message. Returns an empty Dictionary when the text is
## not a JSON object with a string "type".
static func parse(raw: String) -> Dictionary:
	# JSON.parse (unlike JSON.parse_string) reports bad input without logging an engine error.
	var json: JSON = JSON.new()
	if json.parse(raw) != OK:
		return {}
	var data: Variant = json.data
	if typeof(data) != TYPE_DICTIONARY:
		return {}
	var message: Dictionary = data
	if typeof(message.get("type")) != TYPE_STRING:
		return {}
	return message


static func _encode(message: Dictionary) -> String:
	return JSON.stringify(message)
