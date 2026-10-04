extends GutTest

var _connection: ServerConnection


func before_each() -> void:
	_connection = ServerConnection.new()
	add_child_autofree(_connection)


func test_status_text_says_connected_to_server() -> void:
	assert_eq(ServerConnection.status_text(ServerConnection.State.CONNECTED), "Connected to server")


func test_status_text_includes_error_detail() -> void:
	assert_eq(ServerConnection.status_text(ServerConnection.State.ERROR, "boom"), "Server error: boom")


func test_loads_network_config() -> void:
	_connection.load_config("res://config/network.json")
	assert_true(_connection.server_url.begins_with("ws"), "server_url should be a WebSocket URL")
	assert_gt(_connection.reconnect_delay_seconds, 0.0)


func test_missing_config_keeps_defaults() -> void:
	_connection.server_url = "ws://example:1"
	_connection.load_config("res://config/does_not_exist.json")
	assert_eq(_connection.server_url, "ws://example:1")


func test_welcome_message_marks_connected() -> void:
	watch_signals(_connection)
	_connection._handle_raw('{"type":"welcome","connectionId":"abc","role":"host","protocolVersion":1}')
	assert_eq(_connection.state, ServerConnection.State.CONNECTED)
	assert_eq(_connection.connection_id, "abc")
	assert_signal_emitted(_connection, "state_changed")
	assert_signal_emitted(_connection, "message_received")


func test_error_message_marks_error() -> void:
	_connection._handle_raw('{"type":"error","code":"protocol_mismatch","message":"too old"}')
	assert_eq(_connection.state, ServerConnection.State.ERROR)
