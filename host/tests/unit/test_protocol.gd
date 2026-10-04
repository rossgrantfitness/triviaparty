extends GutTest


func test_hello_announces_host_role_and_version() -> void:
	var data: Dictionary = JSON.parse_string(Protocol.hello())
	assert_eq(data["type"], "hello")
	assert_eq(data["role"], "host")
	assert_eq(int(data["protocolVersion"]), Protocol.PROTOCOL_VERSION)


func test_parse_accepts_welcome() -> void:
	var message: Dictionary = Protocol.parse('{"type":"welcome","connectionId":"abc","role":"host","protocolVersion":1}')
	assert_eq(message.get("type"), "welcome")
	assert_eq(message.get("connectionId"), "abc")


func test_parse_rejects_non_json() -> void:
	assert_true(Protocol.parse("not json").is_empty())


func test_parse_rejects_array() -> void:
	assert_true(Protocol.parse("[1, 2, 3]").is_empty())


func test_parse_rejects_missing_type() -> void:
	assert_true(Protocol.parse('{"role":"host"}').is_empty())
