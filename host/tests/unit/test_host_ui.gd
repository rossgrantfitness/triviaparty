extends GutTest
## Feeds the TV screens a state for every round step and checks nothing breaks.

var _ui: HostUI


func before_each() -> void:
	_ui = HostUI.new()
	add_child_autofree(_ui)


func _game(phase: String, round: Variant = null) -> Dictionary:
	return {
		"type": "state", "code": "ABCD", "phase": phase, "paused": false, "hostConnected": true,
		"players": [
			{"id": "a", "name": "Ana", "animal": "cat", "seat": 1, "score": 1500, "connected": true, "hasActed": true, "lastPoints": 500, "roundPoints": 500, "rank": 1},
			{"id": "b", "name": "Ben", "animal": "frog", "seat": 2, "score": 0, "connected": true, "hasActed": false, "lastPoints": 0, "roundPoints": 0, "rank": 2},
		],
		"timer": {"durationMs": 20000, "remainingMs": 10000},
		"roundIndex": 1, "roundCount": 6, "roundKind": "classic", "roundTitle": "Quiz Time", "roundBlurb": "Answer fast!",
		"round": round, "you": null,
	}


func _question() -> Dictionary:
	return {"id": "q1", "category": "science", "categoryName": "Science", "difficulty": 2, "text": "Which planet is closest to the Sun?", "choices": ["Venus", "Mars", "Mercury", "Earth"]}


func _quiz(step: String, kind: String = "classic") -> Dictionary:
	return {
		"kind": kind, "step": step, "questionNumber": 1, "questionCount": 5,
		"category": {"id": "science", "name": "Science"},
		"vote": {"categories": [{"id": "science", "name": "Science", "votes": 1}]} if step == "vote" else null,
		"question": _question() if step in ["question", "reveal", "steal"] else null,
		"reveal": {"correctIndex": 2, "answers": {"a": 2, "b": 0}, "fact": "It's tiny."} if step in ["reveal", "steal", "steal_reveal"] else null,
		"wagers": null,
		"steals": [{"thief": "a", "victim": "b", "amount": 0}] if step == "steal_reveal" else null,
		"me": null,
	}


func _content_count() -> int:
	# Children are freed at the end of the frame; count only the live ones.
	return _ui._content.get_children().filter(func(n: Node) -> bool: return not n.is_queued_for_deletion()).size()


func test_lobby_intro_and_standings_render() -> void:
	for phase: String in ["lobby", "intro", "scoreboard", "game_over"]:
		_ui.show_state(_game(phase))
		assert_gt(_content_count(), 0, phase)


func test_every_quiz_step_renders() -> void:
	for step: String in ["vote", "wager", "question", "reveal", "steal", "steal_reveal"]:
		_ui.show_state(_game("round", _quiz(step, "steal" if step.begins_with("steal") else "wager" if step == "wager" else "classic")))
		assert_gt(_content_count(), 0, step)


func test_closest_guess_renders_question_and_reveal() -> void:
	var round: Dictionary = {
		"kind": "closest", "step": "question", "questionNumber": 1, "questionCount": 3,
		"question": {"id": "n1", "category": "history", "categoryName": "History", "text": "When?", "unit": "year"},
		"reveal": null, "me": null,
	}
	_ui.show_state(_game("round", round))
	assert_gt(_content_count(), 0)
	round["step"] = "reveal"
	round["reveal"] = {"answer": 1969, "fact": null, "results": [
		{"playerId": "a", "guess": 1970, "distance": 1, "place": 1, "points": 1000},
		{"playerId": "b", "guess": null, "distance": null, "place": null, "points": 0},
	]}
	_ui.show_state(_game("round", round))
	assert_gt(_content_count(), 0)


func test_every_drawing_step_renders() -> void:
	var strokes: Array = [{"c": 1, "w": 2, "p": [100, 100, 900, 900]}]
	var round: Dictionary = {
		"kind": "drawing", "step": "drawing", "drawingNumber": 0, "drawingCount": 2, "artistIds": ["a", "b"],
		"artistId": null, "strokes": null, "options": null, "reveal": null, "me": null,
	}
	_ui.show_state(_game("round", round))
	assert_gt(_content_count(), 0, "drawing")
	round.merge({"step": "lying", "drawingNumber": 1, "artistId": "a", "strokes": strokes}, true)
	_ui.show_state(_game("round", round))
	assert_gt(_content_count(), 0, "lying")
	round.merge({"step": "picking", "options": [{"id": "o1", "text": "A cat"}, {"id": "o2", "text": "A dog"}]}, true)
	_ui.show_state(_game("round", round))
	assert_gt(_content_count(), 0, "picking")
	round.merge({"step": "reveal", "reveal": {"shown": 2, "items": [
		{"optionId": "o2", "text": "A dog", "truth": false, "authors": ["b"], "pickers": []},
		{"optionId": "o1", "text": "A cat", "truth": true, "authors": [], "pickers": ["b"]},
	]}}, true)
	_ui.show_state(_game("round", round))
	assert_gt(_content_count(), 0, "reveal")


func test_lobby_settings_cycle_and_estimate_time() -> void:
	_ui.rules = ContentLoader.load_rules()
	_ui.show_state(_game("lobby"))
	var short: int = 0
	_ui.set_length("short")
	short = _ui.estimate_minutes()
	_ui.set_length("long")
	assert_gt(_ui.estimate_minutes(), short)
	_ui.cycle_length()
	assert_eq(_ui.settings["length"], "short")
	_ui.toggle_drawing()
	assert_false(_ui.settings["drawing"])


func test_drawing_canvas_takes_strokes() -> void:
	var canvas: DrawingCanvas = DrawingCanvas.new([{"c": 0, "w": 1, "p": [0, 0, 1000, 1000]}], 300.0)
	add_child_autofree(canvas)
	assert_eq(canvas.strokes.size(), 1)
	assert_eq(canvas.custom_minimum_size, Vector2(300, 300))
