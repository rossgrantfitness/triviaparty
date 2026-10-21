class_name Cues
extends RefCounted
## Watches each new state from the server and fires the matching sounds and effects:
## the jingle at intros, a click for every locked-in answer, "ピンポーン!" when someone's
## right, coins flying on a steal, confetti for the winner. One place for all the game feel.

var _ui: HostUI
var _stage: Stage
var _prev: Dictionary = {}


func _init(ui: HostUI, stage: Stage) -> void:
	_ui = ui
	_stage = stage


func on_state(game: Dictionary) -> void:
	var prev: Dictionary = _prev
	_prev = game
	if prev.is_empty():
		Sfx.play("logo", 1.0, 0.0)
		return
	var phase: String = str(game.get("phase", ""))
	var prev_phase: String = str(prev.get("phase", ""))
	var round: Dictionary = _dict(game.get("round"))
	var prev_round: Dictionary = _dict(prev.get("round"))
	var step: String = str(round.get("step", ""))
	var prev_step: String = str(prev_round.get("step", ""))
	var number: int = int(round.get("questionNumber", round.get("drawingNumber", 0)))
	var prev_number: int = int(prev_round.get("questionNumber", prev_round.get("drawingNumber", 0)))

	# Pause and resume.
	if bool(game.get("paused", false)) != bool(prev.get("paused", false)):
		Sfx.play("pause" if bool(game.get("paused", false)) else "resume", 1.0, 0.0)

	# People arriving and acting.
	var players: Array = game.get("players", [])
	var prev_players: Array = prev.get("players", [])
	if players.size() > prev_players.size():
		Sfx.play("join")
	var acted: int = _count_acted(players)
	if acted > _count_acted(prev_players) and step == prev_step and number == prev_number:
		# Each lock-in clicks a little higher, so the room hears the pressure build.
		Sfx.play("lock", 1.0 + 0.04 * acted, 0.02)

	# Session phases.
	if phase != prev_phase:
		match phase:
			"intro":
				Sfx.play("intro", 1.0, 0.0)
				_ui.stamp("ドン!", Look.ORANGE, Vector2(-1, -1), 160)
			"scoreboard":
				Sfx.play("scoreboard", 1.0, 0.0)
			"game_over":
				Sfx.play("winner", 1.0, 0.0)
				_ui.stamp("やったー!", Look.ORANGE, Vector2(-1, -1), 150)
				_ui.confetti(Vector2(-1, -1), 220)
				_ui.confetti(Vector2(300, 700), 90)
				_ui.confetti(Vector2(1620, 700), 90)
			"lobby":
				if prev_phase == "game_over":
					Sfx.play("logo", 1.0, 0.0)
		return

	if phase != "round":
		return
	var kind: String = str(round.get("kind", ""))
	var new_step: bool = step != prev_step or number != prev_number
	if new_step:
		_on_step(kind, step, round, players)
	if kind == "drawing" and step == "reveal":
		_on_drawing_reveal_progress(round, prev_round if prev_step == "reveal" and number == prev_number else {})


func _on_step(kind: String, step: String, round: Dictionary, players: Array) -> void:
	match step:
		"vote", "question", "drawing", "lying", "picking", "voting":
			Sfx.play("whoosh", 1.0, 0.05)
		"wager":
			Sfx.play("wager", 1.0, 0.0)
		"reveal":
			match kind:
				"closest":
					Sfx.play("reveal", 1.0, 0.0)
					var results: Array = _dict(round.get("reveal")).get("results", [])
					var bullseye: bool = results.any(func(r: Dictionary) -> bool: return r.get("distance") != null and float(r.get("distance")) == 0.0)
					_later(0.4, func() -> void:
						Sfx.play("points")
						if bullseye:
							_ui.stamp("ドンピシャ!", Look.ORANGE)
							_ui.confetti()
					)
				"drawing":
					pass  # Steps through item by item, see _on_drawing_reveal_progress.
				"drawoff":
					Sfx.play("reveal", 1.0, 0.0)
					_later(0.45, func() -> void:
						Sfx.play("correct", 1.0, 0.0)
						_ui.stamp("ブラボー!", Look.ORANGE)
						_ui.confetti(Vector2(-1, -1), 150)
					)
				_:
					_quiz_reveal(round)
		"steal_reveal":
			_steal_reveal(round)


func _quiz_reveal(round: Dictionary) -> void:
	var reveal: Dictionary = _dict(round.get("reveal"))
	var correct: int = int(reveal.get("correctIndex", -1))
	var anyone_right: bool = false
	for choice: Variant in _dict(reveal.get("answers")).values():
		if choice != null and int(choice) == correct:
			anyone_right = true
	Sfx.play("reveal", 1.0, 0.0)
	_later(0.4, func() -> void:
		if anyone_right:
			Sfx.play("correct", 1.0, 0.0)
			_ui.stamp("ピンポーン!", Look.ORANGE)
			if str(round.get("kind", "")) == "final":
				_ui.confetti()
		else:
			Sfx.play("wrong", 1.0, 0.0)
			_ui.stamp("ブブー", Look.RED)
			_ui.shake(10.0)
	)


func _steal_reveal(round: Dictionary) -> void:
	var steals: Array = round.get("steals", []) if typeof(round.get("steals")) == TYPE_ARRAY else []
	var delay: float = 0.0
	for steal: Dictionary in steals:
		var thief: String = str(steal.get("thief", ""))
		var victim: String = str(steal.get("victim", ""))
		var amount: int = int(steal.get("amount", 0))
		_later(delay, func() -> void:
			Sfx.play("steal")
			_stage.play_steal(thief, victim, amount)
			if amount > 0:
				_ui.shake(18.0)
		)
		delay += 0.5
	if not steals.is_empty():
		_ui.stamp("ヌスミ!", Look.RED)


func _on_drawing_reveal_progress(round: Dictionary, prev_round: Dictionary) -> void:
	var reveal: Dictionary = _dict(round.get("reveal"))
	var shown: int = int(reveal.get("shown", 0))
	var prev_shown: int = int(_dict(prev_round.get("reveal")).get("shown", 0))
	if shown == prev_shown:
		return
	var items: Array = reveal.get("items", [])
	var item: Dictionary = items[shown - 1] if shown - 1 < items.size() and shown > 0 else {}
	if bool(item.get("truth", false)):
		Sfx.play("reveal", 1.0, 0.0)
		var spotted: bool = not (item.get("pickers", []) as Array).is_empty()
		_later(0.35, func() -> void:
			if spotted:
				Sfx.play("correct", 1.0, 0.0)
				_ui.stamp("ピンポーン!", Look.ORANGE)
			else:
				Sfx.play("wrong", 1.0, 0.0)
				_ui.stamp("ダマされた!", Look.RED)
		)
	else:
		# A fake title that fooled people: a cheeky pluck, higher the more it fooled.
		Sfx.play("vote", 1.0 + 0.05 * (item.get("pickers", []) as Array).size())


func _later(seconds: float, action: Callable) -> void:
	if seconds <= 0.0:
		action.call()
		return
	_ui.get_tree().create_timer(seconds).timeout.connect(action)


static func _count_acted(players: Array) -> int:
	var n: int = 0
	for p: Dictionary in players:
		if bool(p.get("hasActed", false)):
			n += 1
	return n


static func _dict(value: Variant) -> Dictionary:
	return value if typeof(value) == TYPE_DICTIONARY else {}
