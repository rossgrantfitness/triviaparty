class_name ServerConnection
extends Node
## Keeps a WebSocket open to the relay server and reconnects when it drops.
## Runs as the "Server" autoload, so every screen can reach it.
## On connect it creates a room, or resumes the same room after a network blip.

signal state_changed(state: State, detail: String)
signal message_received(message: Dictionary)
## A room is ready (new, or resumed after a reconnect).
signal room_ready(code: String)
## A full game state snapshot from the server.
signal game_state_received(game_state: Dictionary)
## The server rejected something (e.g. starting with no players).
signal server_error(code: String, message: String)

enum State { CONNECTING, CONNECTED, DISCONNECTED, ERROR }

const NETWORK_CONFIG_PATH: String = "res://config/network.json"

var state: State = State.DISCONNECTED
var server_url: String = "ws://localhost:8787"
var reconnect_delay_seconds: float = 2.0
var connection_id: String = ""
var room_code: String = ""
var host_token: String = ""
## The latest game state from the server, or empty before the first one arrives.
var game_state: Dictionary = {}

var _socket: WebSocketPeer = null
var _was_open: bool = false
var _retry_in: float = 0.0
var _running: bool = false


func _ready() -> void:
	load_config(NETWORK_CONFIG_PATH)
	_apply_command_line()
	if not _is_running_tests():
		start()


func load_config(path: String) -> void:
	var text: String = FileAccess.get_file_as_string(path)
	if text.is_empty():
		push_warning("Could not read %s; using default server settings." % path)
		return
	var json: JSON = JSON.new()
	if json.parse(text) != OK or typeof(json.data) != TYPE_DICTIONARY:
		push_warning("%s is not a JSON object; using default server settings." % path)
		return
	var config: Dictionary = json.data
	server_url = str(config.get("server_url", server_url))
	reconnect_delay_seconds = float(config.get("reconnect_delay_seconds", reconnect_delay_seconds))


func start() -> void:
	_running = true
	_open()


func stop() -> void:
	_running = false
	if _socket != null:
		_socket.close()
	_socket = null
	_set_state(State.DISCONNECTED)


## Send a message built with Protocol. Returns false if not connected.
func send_text(text: String) -> bool:
	if _socket == null or _socket.get_ready_state() != WebSocketPeer.STATE_OPEN:
		return false
	return _socket.send_text(text) == OK


static func status_text(for_state: State, detail: String = "") -> String:
	match for_state:
		State.CONNECTING:
			return "Connecting to server…"
		State.CONNECTED:
			return "Connected to server"
		State.DISCONNECTED:
			return "Disconnected — retrying…"
		State.ERROR:
			return "Server error: %s" % detail if not detail.is_empty() else "Server error"
	return ""


func _process(delta: float) -> void:
	if not _running:
		return
	if _socket == null:
		_retry_in -= delta
		if _retry_in <= 0.0:
			_open()
		return

	_socket.poll()
	var ready_state: WebSocketPeer.State = _socket.get_ready_state()
	if ready_state == WebSocketPeer.STATE_OPEN:
		if not _was_open:
			_was_open = true
			_socket.send_text(Protocol.hello())
		while _socket != null and _socket.get_available_packet_count() > 0:
			_handle_raw(_socket.get_packet().get_string_from_utf8())
	elif ready_state == WebSocketPeer.STATE_CLOSED:
		_drop_and_retry()


func _open() -> void:
	_set_state(State.CONNECTING)
	_socket = WebSocketPeer.new()
	# Question packs can be large; allow big outgoing messages.
	_socket.outbound_buffer_size = 4 * 1024 * 1024
	_socket.inbound_buffer_size = 1024 * 1024
	_was_open = false
	var err: Error = _socket.connect_to_url(server_url)
	if err != OK:
		push_warning("Could not start connecting to %s (error %d)." % [server_url, err])
		_drop_and_retry()


func _drop_and_retry() -> void:
	_socket = null
	connection_id = ""
	_retry_in = reconnect_delay_seconds
	_set_state(State.DISCONNECTED)


func _handle_raw(raw: String) -> void:
	var message: Dictionary = Protocol.parse(raw)
	if message.is_empty():
		push_warning("Ignoring bad message from server: %s" % raw)
		return
	match message["type"]:
		"welcome":
			connection_id = str(message.get("connectionId", ""))
			_set_state(State.CONNECTED)
			# Keep the same room (and everyone's seats) across a network blip.
			if room_code.is_empty():
				send_text(Protocol.create_room())
			else:
				send_text(Protocol.resume_room(room_code, host_token))
		"room_created":
			room_code = str(message.get("code", ""))
			host_token = str(message.get("hostToken", ""))
			room_ready.emit(room_code)
		"state":
			game_state = message
			game_state_received.emit(message)
		"error":
			var code: String = str(message.get("code", ""))
			var text: String = str(message.get("message", ""))
			if code == "room_not_found" and not room_code.is_empty():
				# Our room expired while we were away: start a fresh one.
				room_code = ""
				host_token = ""
				game_state = {}
				send_text(Protocol.create_room())
			elif code == "protocol_mismatch":
				_set_state(State.ERROR, text)
			server_error.emit(code, text)
	message_received.emit(message)


func _set_state(new_state: State, detail: String = "") -> void:
	if new_state == state and detail.is_empty():
		return
	state = new_state
	state_changed.emit(state, detail)


## Lets you point the host at another server without editing files:
##   godot --path host -- --server=ws://192.168.1.20:8787
func _apply_command_line() -> void:
	for arg: String in OS.get_cmdline_user_args():
		if arg.begins_with("--server="):
			server_url = arg.trim_prefix("--server=")


func _is_running_tests() -> bool:
	for arg: String in OS.get_cmdline_args():
		if arg.ends_with("gut_cmdln.gd"):
			return true
	return false
