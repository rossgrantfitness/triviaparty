class_name ServerConnection
extends Node
## Keeps a WebSocket open to the relay server and reconnects when it drops.
## Runs as the "Server" autoload, so every screen can reach it.

signal state_changed(state: State, detail: String)
signal message_received(message: Dictionary)

enum State { CONNECTING, CONNECTED, DISCONNECTED, ERROR }

const NETWORK_CONFIG_PATH: String = "res://config/network.json"

var state: State = State.DISCONNECTED
var server_url: String = "ws://localhost:8787"
var reconnect_delay_seconds: float = 2.0
var connection_id: String = ""

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
	var data: Variant = JSON.parse_string(text)
	if typeof(data) != TYPE_DICTIONARY:
		push_warning("%s is not a JSON object; using default server settings." % path)
		return
	var config: Dictionary = data
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
		while _socket.get_available_packet_count() > 0:
			_handle_raw(_socket.get_packet().get_string_from_utf8())
	elif ready_state == WebSocketPeer.STATE_CLOSED:
		_drop_and_retry()


func _open() -> void:
	_set_state(State.CONNECTING)
	_socket = WebSocketPeer.new()
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
		"error":
			_set_state(State.ERROR, str(message.get("message", "")))
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
