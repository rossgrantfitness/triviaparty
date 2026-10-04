extends Node3D
## The host game: 3D stage behind, flat UI in front, both driven by server state.
## Keyboard: Enter start / play again · Space pause · N next · Tab players · F11 fullscreen.

const NETWORK_CONFIG_PATH: String = "res://config/network.json"

var _stage: Stage = Stage.new()
var _ui: HostUI = HostUI.new()
var _questions: Array = []
var _rules: Dictionary = {}
## Testing aid: start automatically once this many players joined (--autostart=N).
var _autostart_players: int = 0


func _ready() -> void:
	add_child(_stage)
	add_child(_ui)
	_ui.join_url = phone_url()
	_rules = ContentLoader.load_rules()
	_questions = ContentLoader.load_questions()
	for arg: String in OS.get_cmdline_user_args():
		if arg.begins_with("--autostart="):
			_autostart_players = int(arg.trim_prefix("--autostart="))
	print("[host] loaded %d questions in %d categories from %s" % [_questions.size(), ContentLoader.categories(_questions).size(), ContentLoader.questions_dir()])

	_ui.start_pressed.connect(_start_game)
	_ui.pause_pressed.connect(_toggle_pause)
	_ui.skip_pressed.connect(func() -> void: Server.send_text(Protocol.skip()))
	_ui.play_again_pressed.connect(func() -> void: Server.send_text(Protocol.back_to_lobby()))
	_ui.kick_pressed.connect(func(id: String) -> void: Server.send_text(Protocol.kick(id)))

	Server.state_changed.connect(_on_server_state_changed)
	Server.game_state_received.connect(_on_game_state)
	Server.server_error.connect(func(_code: String, message: String) -> void: _ui.show_toast(message))
	Server.room_ready.connect(func(code: String) -> void: print("[host] room %s ready, phones join at %s" % [code, phone_url()]))
	_on_server_state_changed(Server.state, "")
	if not Server.game_state.is_empty():
		_on_game_state(Server.game_state)


func _on_server_state_changed(state: ServerConnection.State, detail: String) -> void:
	var text: String = ServerConnection.status_text(state, detail)
	print("[host] ", text)
	_ui.set_connection_status(text, state == ServerConnection.State.CONNECTED)


func _on_game_state(game: Dictionary) -> void:
	var players: Array = game.get("players", [])
	_stage.sync_players(players, str(game.get("phase", "")))
	_stage.apply_state(game)
	_ui.show_state(game)
	if _autostart_players > 0 and str(game.get("phase", "")) == "lobby" and players.size() >= _autostart_players:
		_autostart_players = 0
		_start_game()


func _start_game() -> void:
	if _questions.is_empty():
		_ui.show_toast("No questions found in content/questions.")
		return
	Server.send_text(Protocol.start_game(_rules, _questions))


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
			if phase in ["category_vote", "question", "reveal", "scoreboard"]:
				_toggle_pause()
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
