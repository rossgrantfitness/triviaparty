extends GutTest


func _decode(text: String) -> Dictionary:
	return JSON.parse_string(text)


func test_hello_announces_host_role_and_version() -> void:
	var data: Dictionary = _decode(Protocol.hello())
	assert_eq(data["type"], "hello")
	assert_eq(data["role"], "host")
	assert_eq(int(data["protocolVersion"]), Protocol.PROTOCOL_VERSION)


func test_resume_room_carries_code_and_token() -> void:
	var data: Dictionary = _decode(Protocol.resume_room("ABCD", "secret"))
	assert_eq(data["type"], "resume_room")
	assert_eq(data["code"], "ABCD")
	assert_eq(data["hostToken"], "secret")


func test_start_game_drops_comment_keys_from_rules() -> void:
	var data: Dictionary = _decode(Protocol.start_game({"_comment": "hi", "question_seconds": 15}, [{"id": "q1"}]))
	assert_false(data["rules"].has("_comment"))
	assert_eq(int(data["rules"]["question_seconds"]), 15)
	assert_eq(data["questions"].size(), 1)


func test_kick_names_the_player() -> void:
	assert_eq(_decode(Protocol.kick("p1"))["playerId"], "p1")


func test_parse_accepts_welcome() -> void:
	var message: Dictionary = Protocol.parse('{"type":"welcome","connectionId":"abc","role":"host","protocolVersion":2}')
	assert_eq(message.get("type"), "welcome")


func test_parse_rejects_non_json() -> void:
	assert_true(Protocol.parse("not json").is_empty())


func test_parse_rejects_array() -> void:
	assert_true(Protocol.parse("[1, 2, 3]").is_empty())


func test_parse_rejects_missing_type() -> void:
	assert_true(Protocol.parse('{"role":"host"}').is_empty())
