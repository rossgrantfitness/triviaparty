class_name ContentLoader
extends RefCounted
## Loads gameplay rules and question packs from disk.
##
## Question packs live in the repo's content/questions folder (outside the Godot
## project, so writers never touch Godot files). Exported builds will bundle a
## copy under res://content/questions; that folder is checked first.

const RULES_PATH: String = "res://config/game_rules.json"
const BUNDLED_QUESTIONS_DIR: String = "res://content/questions"


static func load_rules(path: String = RULES_PATH) -> Dictionary:
	var data: Variant = _read_json(path)
	if typeof(data) != TYPE_DICTIONARY:
		push_warning("Could not read %s; the server will use its default rules." % path)
		return {}
	return data


## Folder holding the question pack .json files.
static func questions_dir() -> String:
	if DirAccess.dir_exists_absolute(BUNDLED_QUESTIONS_DIR):
		return BUNDLED_QUESTIONS_DIR
	return ProjectSettings.globalize_path("res://").path_join("../content/questions").simplify_path()


## Every question from every pack in the folder. Bad packs are skipped with a warning.
static func load_questions(dir_path: String = "") -> Array:
	var folder: String = dir_path if not dir_path.is_empty() else questions_dir()
	var questions: Array = []
	var dir: DirAccess = DirAccess.open(folder)
	if dir == null:
		push_warning("No question folder at %s." % folder)
		return questions
	var files: PackedStringArray = dir.get_files()
	files.sort()
	for file_name: String in files:
		if not file_name.ends_with(".json"):
			continue
		var pack: Variant = _read_json(folder.path_join(file_name))
		if typeof(pack) != TYPE_DICTIONARY or typeof(pack.get("questions")) != TYPE_ARRAY:
			push_warning("Skipping %s: not a question pack." % file_name)
			continue
		for question: Variant in pack["questions"]:
			if typeof(question) == TYPE_DICTIONARY:
				questions.append(question)
	return questions


## Category ids present in a list of questions, sorted.
static func categories(questions: Array) -> PackedStringArray:
	var seen: Dictionary = {}
	for question: Dictionary in questions:
		seen[str(question.get("category", ""))] = true
	var result: PackedStringArray = PackedStringArray(seen.keys())
	result.sort()
	return result


static func _read_json(path: String) -> Variant:
	var text: String = FileAccess.get_file_as_string(path)
	if text.is_empty():
		return null
	var json: JSON = JSON.new()
	if json.parse(text) != OK:
		push_warning("%s line %d: %s" % [path, json.get_error_line(), json.get_error_message()])
		return null
	return json.data
