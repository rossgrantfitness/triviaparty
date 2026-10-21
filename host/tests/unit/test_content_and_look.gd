extends GutTest


func test_loads_the_sample_question_packs() -> void:
	var questions: Array = ContentLoader.load_questions()
	assert_gte(questions.size(), 50)
	assert_gte(ContentLoader.categories(questions).size(), 3)


func test_every_multiple_choice_question_has_a_valid_answer() -> void:
	for question: Dictionary in ContentLoader.load_questions():
		if question.get("type") != "multiple_choice":
			continue
		var choices: Array = question.get("choices", [])
		assert_between(int(question.get("answer", -1)), 0, choices.size() - 1, str(question.get("id")))


func test_loads_the_drawing_pack() -> void:
	var pack: Dictionary = ContentLoader.load_drawing_pack()
	assert_gte((pack["prompts"] as Array).size(), 100)
	assert_gte((pack["decoys"] as Array).size(), 30)


func test_format_number_for_closest_guess() -> void:
	assert_eq(Look.format_number(1969, "year"), "1969")
	assert_eq(Look.format_number(384400, "km"), "384,400 km")
	assert_eq(Look.format_number(42.195, "km"), "42.195 km")
	assert_eq(Look.format_number(29.5, "days"), "29.5 days")
	assert_eq(Look.signed_points(-300), "-300")
	assert_eq(Look.signed_points(1200), "+1,200")


func test_loads_rules() -> void:
	var rules: Dictionary = ContentLoader.load_rules()
	assert_true(rules.has("question_seconds"))


func test_missing_question_folder_gives_empty_list() -> void:
	assert_eq(ContentLoader.load_questions("res://no_such_folder").size(), 0)


func test_format_points_adds_commas() -> void:
	assert_eq(Look.format_points(0), "0")
	assert_eq(Look.format_points(1375), "1,375")
	assert_eq(Look.format_points(1234567), "1,234,567")


func test_ordinals() -> void:
	assert_eq(Look.ordinal(1), "1st")
	assert_eq(Look.ordinal(2), "2nd")
	assert_eq(Look.ordinal(3), "3rd")
	assert_eq(Look.ordinal(11), "11th")
	assert_eq(Look.ordinal(22), "22nd")


func test_phone_url_uses_the_dev_port() -> void:
	assert_string_ends_with(load("res://scripts/main.gd").phone_url(), ":5173")


func test_every_mode_has_a_plan_for_every_length() -> void:
	var rules: Dictionary = ContentLoader.load_rules()
	var modes: Dictionary = rules.get("modes", {})
	for mode: String in ["party", "doodle", "memes"]:
		for length: String in ["short", "standard", "long"]:
			var plan: Array = modes.get(mode, {}).get(length, [])
			assert_gt(plan.size(), 0, "%s %s" % [mode, length])


func test_the_sound_set_is_there() -> void:
	for sound: String in ["logo", "intro", "correct", "wrong", "lock", "steal", "winner", "tick"]:
		assert_true(FileAccess.file_exists("res://assets/sfx/sfx_%s.wav" % sound), sound)
