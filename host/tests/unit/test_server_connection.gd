extends GutTest

var _connection: ServerConnection


func before_each() -> void:
	_connection = ServerConnection.new()
	add_child_autofree(_connection)


func test_status_text_says_connected_to_server() -> void:
	assert_eq(ServerConnection.status_text(ServerConnection.State.CONNECTED), "Connected to server")


func test_loads_network_config() -> void:
	_connection.load_config("res://config/network.json")
	assert_true(_connection.server_url.begins_with("ws"), "server_url should be a WebSocket URL")
	assert_gt(_connection.reconnect_delay_seconds, 0.0)


func test_missing_config_keeps_defaults() -> void:
	_connection.server_url = "ws://example:1"
	_connection.load_config("res://config/does_not_exist.json")
	assert_eq(_connection.server_url, "ws://example:1")


func test_welcome_marks_connected() -> void:
	watch_signals(_connection)
	_connection._handle_raw('{"type":"welcome","connectionId":"abc","role":"host","protocolVersion":2}')
	assert_eq(_connection.state, ServerConnection.State.CONNECTED)
	assert_eq(_connection.connection_id, "abc")
	assert_signal_emitted(_connection, "state_changed")


func test_room_created_remembers_code_and_token_for_resuming() -> void:
	watch_signals(_connection)
	_connection._handle_raw('{"type":"room_created","code":"WXYZ","hostToken":"t0k"}')
	assert_eq(_connection.room_code, "WXYZ")
	assert_eq(_connection.host_token, "t0k")
	assert_signal_emitted_with_parameters(_connection, "room_ready", ["WXYZ"])


func test_state_is_stored_and_announced() -> void:
	watch_signals(_connection)
	_connection._handle_raw('{"type":"state","phase":"lobby","players":[]}')
	assert_eq(_connection.game_state.get("phase"), "lobby")
	assert_signal_emitted(_connection, "game_state_received")


func test_expired_room_is_forgotten() -> void:
	_connection.room_code = "WXYZ"
	_connection.host_token = "t0k"
	_connection._handle_raw('{"type":"error","code":"room_not_found","message":"gone"}')
	assert_eq(_connection.room_code, "")


func test_protocol_mismatch_marks_error() -> void:
	_connection._handle_raw('{"type":"error","code":"protocol_mismatch","message":"too old"}')
	assert_eq(_connection.state, ServerConnection.State.ERROR)


func test_other_errors_do_not_break_the_connection() -> void:
	_connection._handle_raw('{"type":"welcome","connectionId":"abc","role":"host","protocolVersion":2}')
	_connection._handle_raw('{"type":"error","code":"not_enough_players","message":"need more"}')
	assert_eq(_connection.state, ServerConnection.State.CONNECTED)
