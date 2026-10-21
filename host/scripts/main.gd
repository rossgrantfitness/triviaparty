extends Node3D
## The host game: 3D stage behind, flat UI in front, both driven by server state.
## Keyboard: Enter start / play again · Space pause · N next · Tab players · F11 fullscreen.
## In the lobby: G changes game mode, L game length, D drawing rounds on or off. M mutes sound.

const NETWORK_CONFIG_PATH: String = "res://config/network.json"
## Questions seen in recent games, so the next game prefers fresh ones.
const RECENT_PATH: String = "user://recent_questions.json"
const RECENT_LIMIT: int = 400
## Only skip recent questions while at least this many fresh ones remain.
const MIN_FRESH_QUESTIONS: int = 60

var _stage: Stage = Stage.new()
var _ui: HostUI = HostUI.new()
var _questions: Array = []
var _rules: Dictionary = {}
var _drawing_pack: Dictionary = {}
var _recent: Array = []
var _cues: Cues = null
## Testing aid: start automatically once this many players joined (--autostart=N).
var _autostart_players: int = 0


func _ready() -> void:
	add_child(_stage)
	add_child(_ui)
	_cues = Cues.new(_ui, _stage)
	_ui.join_url = phone_url()
	_rules = ContentLoader.load_rules()
	_questions = ContentLoader.load_questions()
	_drawing_pack = ContentLoader.load_drawing_pack()
	_recent = _load_recent()
	_ui.rules = _rules
	for arg: String in OS.get_cmdline_user_args():
		if arg.begins_with("--autostart="):
			_autostart_players = int(arg.trim_prefix("--autostart="))
		elif arg.begins_with("--length="):
			_ui.settings["length"] = arg.trim_prefix("--length=")
		elif arg.begins_with("--mode="):
			_ui.settings["mode"] = arg.trim_prefix("--mode=")
	print("[host] loaded %d questions in %d categories and %d drawing prompts from %s" % [_questions.size(), ContentLoader.categories(_questions).size(), (_drawing_pack.get("prompts", []) as Array).size(), ContentLoader.questions_dir()])

	_ui.start_pressed.connect(_start_game)
	_ui.pause_pressed.connect(_toggle_pause)
	_ui.skip_pressed.connect(func() -> void: Server.send_text(Protocol.skip()))
	_ui.play_again_pressed.connect(func() -> void: Server.send_text(Protocol.back_to_lobby()))
	_ui.kick_pressed.connect(func(id: String) -> void: Server.send_text(Protocol.kick(id)))

	Server.state_changed.connect(_on_server_state_changed)
	Server.game_state_received.connect(_on_game_state)
	Server.server_error.connect(func(_code: String, message: String) -> void: _ui.show_toast(message))
	Server.avatar_received.connect(func(id: String, strokes: Array) -> void: _stage.set_avatar(id, strokes))
	Server.emote_received.connect(_on_emote)
	for id: Variant in Server.avatars:
		_stage.set_avatar(str(id), Server.avatars[id])
	Server.room_ready.connect(func(code: String) -> void: print("[host] room %s ready, phones join at %s" % [code, phone_url()]))
	_on_server_state_changed(Server.state, "")
	if not Server.game_state.is_empty():
		_on_game_state(Server.game_state)


func _on_server_state_changed(state: ServerConnection.State, detail: String) -> void:
	var text: String = ServerConnection.status_text(state, detail)
	print("[host] ", text)
	_ui.set_connection_status(text, state == ServerConnection.State.CONNECTED)


func _on_game_state(game: Dictionary) -> void:
	_remember_question(game)
	var players: Array = game.get("players", [])
	_stage.sync_players(players, str(game.get("phase", "")))
	_stage.apply_state(game)
	_ui.show_state(game)
	_cues.on_state(game)
	if _autostart_players > 0 and str(game.get("phase", "")) == "lobby" and players.size() >= _autostart_players:
		_autostart_players = 0
		_start_game()


func _on_emote(player_id: String, emote: String) -> void:
	_stage.show_emote(player_id, emote)
	Sfx.play("emote", randf_range(0.85, 1.2), 0.0, -4.0)


func _start_game() -> void:
	if _questions.is_empty():
		_ui.show_toast("No questions found in content/questions.")
		return
	Server.send_text(Protocol.start_game(_rules, _ui.settings, _fresh_questions(), _drawing_pack.get("prompts", []), _drawing_pack.get("decoys", [])))


## Leave out questions from recent games, as long as plenty of fresh ones are left.
func _fresh_questions() -> Array:
	var recent: Dictionary = {}
	for id: Variant in _recent:
		recent[str(id)] = true
	var fresh: Array = _questions.filter(func(q: Dictionary) -> bool: return not recent.has(str(q.get("id", ""))))
	if fresh.size() < MIN_FRESH_QUESTIONS:
		_recent.clear()
		return _questions
	return fresh


func _remember_question(game: Dictionary) -> void:
	var round: Variant = game.get("round")
	if typeof(round) != TYPE_DICTIONARY or typeof(round.get("question")) != TYPE_DICTIONARY:
		return
	var id: String = str(round["question"].get("id", ""))
	if id.is_empty() or _recent.has(id):
		return
	_recent.append(id)
	while _recent.size() > RECENT_LIMIT:
		_recent.pop_front()
	var file: FileAccess = FileAccess.open(RECENT_PATH, FileAccess.WRITE)
	if file != null:
		file.store_string(JSON.stringify(_recent))


func _load_recent() -> Array:
	var json: JSON = JSON.new()
	if json.parse(FileAccess.get_file_as_string(RECENT_PATH)) == OK and typeof(json.data) == TYPE_ARRAY:
		return json.data
	return []


func _toggle_pause() -> void:
	Server.send_text(Protocol.set_paused(not bool(Server.game_state.get("paused", false))))


func _unhandled_input(event: InputEvent) -> void:
	var key: InputEventKey = event as InputEventKey
	if key == null or not key.pressed or key.echo:
		return
	var phase: String = str(Server.game_state.get("phase", ""))
	match key.keycode:
		KEY_ENTER, KEY_KP_ENTER:
			if phase == "lobby":
				_start_game()
			elif phase == "game_over":
				Server.send_text(Protocol.back_to_lobby())
		KEY_SPACE, KEY_P:
			if phase in ["intro", "round", "scoreboard"]:
				_toggle_pause()
		KEY_L:
			if phase == "lobby":
				_ui.cycle_length()
		KEY_D:
			if phase == "lobby":
				_ui.toggle_drawing()
		KEY_G:
			if phase == "lobby":
				_ui.cycle_mode()
		KEY_M:
			Sfx.toggle_mute()
			_ui.show_toast("Sound off" if Sfx.muted else "Sound on")
		KEY_N, KEY_RIGHT:
			Server.send_text(Protocol.skip())
		KEY_TAB:
			_ui.toggle_players_panel()
		KEY_ESCAPE:
			if _ui.is_players_panel_open():
				_ui.toggle_players_panel()
		KEY_F11:
			var fullscreen: bool = DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN
			DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED if fullscreen else DisplayServer.WINDOW_MODE_FULLSCREEN)


## The address phones should open: phone_url from config/network.json, or this PC's Wi-Fi address.
static func phone_url() -> String:
	var config: Dictionary = {}
	var json: JSON = JSON.new()
	if json.parse(FileAccess.get_file_as_string(NETWORK_CONFIG_PATH)) == OK and typeof(json.data) == TYPE_DICTIONARY:
		config = json.data
	var configured: String = str(config.get("phone_url", ""))
	if not configured.is_empty():
		return configured
	return "http://%s:%d" % [lan_address(), int(config.get("phone_port", 5173))]


## Best guess at this PC's address on the home network (192.168.x.x and friends).
static func lan_address() -> String:
	var best: String = ""
	var best_score: int = 0
	for address: String in IP.get_local_addresses():
		var score: int = 0
		if address.begins_with("192.168."):
			score = 3
		elif address.begins_with("10."):
			score = 2
		elif address.begins_with("172.") and address.split(".").size() == 4:
			var second: int = int(address.split(".")[1])
			score = 1 if second >= 16 and second <= 31 else 0
		if score > best_score:
			best = address
			best_score = score
	return best if not best.is_empty() else "localhost"
