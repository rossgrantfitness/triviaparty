extends GutTest


func test_loads_the_sample_question_packs() -> void:
	var questions: Array = ContentLoader.load_questions()
	assert_gte(questions.size(), 50)
	assert_gte(ContentLoader.categories(questions).size(), 3)


func test_every_question_has_choices_and_a_valid_answer() -> void:
	for question: Dictionary in ContentLoader.load_questions():
		var choices: Array = question.get("choices", [])
		assert_between(int(question.get("answer", -1)), 0, choices.size() - 1, str(question.get("id")))


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
