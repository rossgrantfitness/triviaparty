class_name HostUI
extends CanvasLayer
## Everything drawn flat on the TV: room code, questions, answers, standings.
## Built in code from the server's state; the 3D stage sits behind it.

signal start_pressed
signal pause_pressed
signal skip_pressed
signal play_again_pressed
signal kick_pressed(player_id: String)

const BASE_FONT_SIZE: int = 32

var join_url: String = ""
## The game's website, where phones type the room code (packaged game only; empty in development).
var website_url: String = ""

var _root: Control = Control.new()
var _content: VBoxContainer = VBoxContainer.new()
var _header: HBoxContainer = HBoxContainer.new()
var _join_label: Label = null
var _counter_label: Label = null
var _timer: TimerBar = TimerBar.new()
var _controls: HBoxContainer = HBoxContainer.new()
var _overlay: PanelContainer = PanelContainer.new()
var _overlay_label: Label = null
var _toast: PanelContainer = PanelContainer.new()
var _toast_label: Label = null
var _status_label: Label = null
var _players_panel: PanelContainer = PanelContainer.new()
var _players_list: VBoxContainer = VBoxContainer.new()
var _pause_button: Button = null
var _skip_button: Button = null

var _game: Dictionary = {}
var _rendered_key: String = ""
var _timer_deadline_ms: float = 0.0
var _timer_duration_ms: float = 1.0
var _toast_left: float = 0.0
var _screen_identity: String = ""
var _last_tick_second: int = -1
## Effects layer on top of everything: stamps and confetti.
var _fx: Control = Control.new()


func _ready() -> void:
	layer = 1
	var theme: Theme = Theme.new()
	theme.default_font = Look.font()
	theme.default_font_size = BASE_FONT_SIZE
	theme.set_color("font_color", "Label", Look.BLACK)
	_root.theme = theme
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)

	var margin: MarginContainer = MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side: String in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + side, 64)
	margin.add_theme_constant_override("margin_top", 36)
	margin.add_theme_constant_override("margin_bottom", 36)
	_root.add_child(margin)

	var column: VBoxContainer = VBoxContainer.new()
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.clip_contents = true
	column.add_theme_constant_override("separation", 18)
	margin.add_child(column)

	# Header: how to join (left), question counter (right), timer underneath.
	_header.add_theme_constant_override("separation", 14)
	column.add_child(_header)
	_join_label = _label("", 26, Look.WHITE)
	_header.add_child(_pill(_join_label, Look.BLACK))
	var spacer: Control = Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_header.add_child(spacer)
	_counter_label = _label("", 26, Look.WHITE)
	_header.add_child(_pill(_counter_label, Look.STEEL_DARK))
	_controls.add_theme_constant_override("separation", 8)
	_header.add_child(_controls)
	_timer.custom_minimum_size = Vector2(0, 22)
	column.add_child(_timer)

	_content.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_content.add_theme_constant_override("separation", 22)
	_content.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(_content)

	# Footer: connection status (left), host buttons (right).
	var footer: HBoxContainer = HBoxContainer.new()
	footer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(footer)
	# Only shown while something is wrong, so it never covers the name plates.
	_status_label = _label("Connecting to server…", 26, Look.ORANGE)
	_status_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_status_label.size_flags_vertical = Control.SIZE_SHRINK_END
	footer.add_child(_status_label)
	_pause_button = _button("Pause  [Space]", Look.STEEL_DARK, 21)
	_pause_button.pressed.connect(func() -> void: pause_pressed.emit())
	_controls.add_child(_pause_button)
	_skip_button = _button("Next  [N]", Look.STEEL_DARK, 21)
	_skip_button.pressed.connect(func() -> void: skip_pressed.emit())
	_controls.add_child(_skip_button)
	var players_button: Button = _button("Players  [Tab]", Look.BLACK, 21)
	players_button.pressed.connect(toggle_players_panel)
	_controls.add_child(players_button)

	_build_players_panel()
	_build_overlay()
	_build_toast()
	_fx.set_anchors_preset(Control.PRESET_FULL_RECT)
	_fx.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(_fx)


func _process(delta: float) -> void:
	var timer: Variant = _game.get("timer")
	if typeof(timer) == TYPE_DICTIONARY and _timer.visible:
		var remaining: float = float(timer.get("remainingMs", 0.0)) if bool(_game.get("paused", false)) else maxf(0.0, _timer_deadline_ms - Time.get_ticks_msec())
		_timer.set_progress(remaining / _timer_duration_ms, remaining)
		# The last five seconds tick, a little higher each second.
		var second: int = ceili(remaining / 1000.0)
		if remaining > 0.0 and remaining < 5000.0 and second != _last_tick_second and not bool(_game.get("paused", false)):
			_last_tick_second = second
			Sfx.play("tick_urgent", 1.0 + (5 - second) * 0.05, 0.0)
			Juice.punch(_timer, 0.04)
	if _toast_left > 0.0:
		_toast_left -= delta
		_toast.visible = _toast_left > 0.0


func set_connection_status(text: String, ok: bool) -> void:
	_status_label.text = text
	_status_label.visible = not ok
	_update_overlay()


func show_toast(text: String) -> void:
	_toast_label.text = text
	_toast.visible = true
	_toast_left = 4.0


func toggle_players_panel() -> void:
	_players_panel.visible = not _players_panel.visible
	_refresh_players_panel()


func is_players_panel_open() -> bool:
	return _players_panel.visible


func show_state(game: Dictionary) -> void:
	_game = game
	var timer: Variant = game.get("timer")
	if typeof(timer) == TYPE_DICTIONARY:
		_timer_duration_ms = maxf(1.0, float(timer.get("durationMs", 1.0)))
		_timer_deadline_ms = Time.get_ticks_msec() + float(timer.get("remainingMs", 0.0))
	var phase: String = str(game.get("phase", "lobby"))
	var round: Dictionary = _round(game)
	var step: String = str(round.get("step", ""))
	_timer.visible = typeof(timer) == TYPE_DICTIONARY and phase == "round" and step in TIMED_STEPS
	_join_label.text = "Join at  %s   ·   Code  %s" % [website_url if not website_url.is_empty() else join_url, str(game.get("code", ""))]
	_header.get_child(0).visible = phase != "lobby"
	_counter_label.get_parent().visible = phase in ["intro", "round", "scoreboard"]
	_counter_label.text = _counter_text(game, round)
	var in_game: bool = phase in ["intro", "round", "scoreboard"]
	_pause_button.visible = in_game
	_skip_button.visible = in_game
	_pause_button.text = "Resume  [Space]" if bool(game.get("paused", false)) else "Pause  [Space]"
	_update_overlay()
	_refresh_players_panel()

	var key: String = _screen_key(game)
	if key == _rendered_key:
		return
	_rendered_key = key
	for child: Node in _content.get_children():
		child.queue_free()
	match phase:
		"lobby":
			_render_lobby(game)
		"intro":
			_render_intro(game)
		"scoreboard":
			_render_standings(game, false)
		"game_over":
			_render_standings(game, true)
		"round":
			match str(round.get("kind", "")):
				"closest":
					_render_closest(game, round)
				"drawing":
					_render_drawing(game, round)
				"drawoff":
					_render_drawoff(game, round)
				_:
					_render_quiz(game, round)
	# A new screen pops in piece by piece; updates to the same screen (someone answered) don't.
	var identity: String = JSON.stringify([phase, game.get("roundIndex"), round.get("kind"), round.get("step"), round.get("questionNumber"), round.get("drawingNumber")])
	if identity != _screen_identity:
		_screen_identity = identity
		Juice.stagger_in(_content)


const TIMED_STEPS: Array[String] = ["vote", "wager", "question", "steal", "drawing", "lying", "picking", "voting"]


static func _round(game: Dictionary) -> Dictionary:
	var round: Variant = game.get("round")
	return round if typeof(round) == TYPE_DICTIONARY else {}


static func _dict(value: Variant) -> Dictionary:
	return value if typeof(value) == TYPE_DICTIONARY else {}


func _counter_text(game: Dictionary, round: Dictionary) -> String:
	var round_text: String = "Round %d of %d" % [int(game.get("roundIndex", 0)) + 1, int(game.get("roundCount", 0))]
	if str(game.get("phase", "")) != "round":
		return round_text
	match str(round.get("kind", "")):
		"drawing":
			if int(round.get("drawingNumber", 0)) > 0:
				return "%s · Drawing %d/%d" % [round_text, int(round.get("drawingNumber", 0)), int(round.get("drawingCount", 0))]
		"final":
			return round_text
		_:
			if int(round.get("questionNumber", 0)) > 0:
				return "%s · Question %d/%d" % [round_text, int(round.get("questionNumber", 0)), int(round.get("questionCount", 0))]
	return round_text


func _screen_key(game: Dictionary) -> String:
	var players: Array = game.get("players", [])
	var acted: int = 0
	for p: Dictionary in players:
		if bool(p.get("hasActed", false)):
			acted += 1
	var round: Dictionary = _round(game)
	var reveal: Dictionary = _dict(round.get("reveal"))
	var question: Dictionary = _dict(round.get("question"))
	return JSON.stringify([
		game.get("phase"), game.get("roundIndex"), game.get("code"), join_url, website_url, players.size(), acted,
		round.get("kind"), round.get("step"), round.get("questionNumber"), round.get("drawingNumber"),
		question.get("id"), round.get("vote"), reveal.get("shown"), settings,
	])


# ---- Lobby and between rounds ----

func _render_lobby(game: Dictionary) -> void:
	var players: Array = game.get("players", [])
	var mode: String = str(settings.get("mode", "party"))
	var title: Label = _label(str(MODE_TITLES.get(mode, "Trivia Party")), 96, Look.ORANGE, true)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_content.add_child(title)

	var row: HBoxContainer = HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 28)
	_content.add_child(row)
	var join_card: VBoxContainer = VBoxContainer.new()
	if not website_url.is_empty():
		join_card.add_child(_label("On your phone, go to", 32, Look.MUTED))
		join_card.add_child(_label(website_url, 52, Look.STEEL_DARK))
		join_card.add_child(_label("and type the room code  →", 32, Look.MUTED))
		join_card.add_child(_label("Same Wi-Fi as this PC  ·  or open %s" % join_url, 22, Look.MUTED))
	else:
		join_card.add_child(_label("On your phone, open", 32, Look.MUTED))
		join_card.add_child(_label(join_url, 52, Look.STEEL_DARK))
		join_card.add_child(_label("Any phone, tablet or laptop with a browser", 24, Look.MUTED))
	row.add_child(_card(join_card, Look.PAPER))
	var code_card: VBoxContainer = VBoxContainer.new()
	code_card.alignment = BoxContainer.ALIGNMENT_CENTER
	var caption: Label = _label("Room code", 32, Look.WHITE)
	caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	code_card.add_child(caption)
	var code: Label = _label(" ".join(str(game.get("code", "····")).split("")), 100, Look.WHITE)
	code.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	code_card.add_child(code)
	row.add_child(_card(code_card, Look.ORANGE))

	# Game settings: mode, length and drawing rounds.
	var modes: HBoxContainer = HBoxContainer.new()
	modes.alignment = BoxContainer.ALIGNMENT_CENTER
	modes.add_theme_constant_override("separation", 12)
	_content.add_child(modes)
	modes.add_child(_label("Mode [G]:", 30, Look.WHITE))
	for m: String in MODES:
		var picked: bool = m == mode
		var mode_button: Button = _button(str(MODE_TITLES[m]), Look.ORANGE if picked else Color(Look.BLACK, 0.35), 28)
		mode_button.pressed.connect(func() -> void: set_mode(m))
		modes.add_child(mode_button)
	var options: HBoxContainer = HBoxContainer.new()
	options.alignment = BoxContainer.ALIGNMENT_CENTER
	options.add_theme_constant_override("separation", 12)
	_content.add_child(options)
	options.add_child(_label("Length [L]:", 30, Look.WHITE))
	for length: String in LENGTHS:
		var chosen: bool = str(settings.get("length", "standard")) == length
		var button: Button = _button(length.capitalize(), Look.BLACK if chosen else Color(Look.BLACK, 0.35), 28)
		button.pressed.connect(func() -> void: set_length(length))
		options.add_child(button)
	var drawing_on: bool = bool(settings.get("drawing", true))
	if mode == "party":
		var draw_button: Button = _button("Drawing rounds [D]: %s" % ("On" if drawing_on else "Off"), Look.STEEL_DARK if drawing_on else Color(Look.BLACK, 0.35), 28)
		draw_button.pressed.connect(toggle_drawing)
		options.add_child(draw_button)
	options.add_child(_label("about %d min" % estimate_minutes(), 28, Look.WHITE))

	var bottom: HBoxContainer = HBoxContainer.new()
	bottom.alignment = BoxContainer.ALIGNMENT_CENTER
	bottom.add_theme_constant_override("separation", 28)
	_content.add_child(bottom)
	var count_text: String = "Waiting for players to join…" if players.is_empty() else "%d player%s ready" % [players.size(), "" if players.size() == 1 else "s"]
	bottom.add_child(_pill(_label(count_text, 34, Look.WHITE), Look.BLACK))
	if not players.is_empty():
		var start: Button = _button("Start game  [Enter]", Look.ORANGE, 38)
		start.pressed.connect(func() -> void: start_pressed.emit())
		bottom.add_child(start)


func _render_intro(game: Dictionary) -> void:
	var box: VBoxContainer = VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 14)
	var number: Label = _label("ROUND %d OF %d" % [int(game.get("roundIndex", 0)) + 1, int(game.get("roundCount", 0))], 36, Look.STEEL_DARK)
	number.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(number)
	var title: Label = _label(str(game.get("roundTitle", "")), 120, Look.ORANGE)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(title)
	var blurb: Label = _label(str(game.get("roundBlurb", "")), 44, Look.BLACK)
	blurb.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	blurb.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	blurb.custom_minimum_size = Vector2(1300, 0)
	box.add_child(blurb)
	var card: PanelContainer = _card(box, Look.PAPER, 40, 48)
	_content.add_child(_centered(card))
	card.pivot_offset = Vector2(700, 160)
	card.scale = Vector2(0.6, 0.6)
	card.create_tween().tween_property(card, "scale", Vector2.ONE, 0.45).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


func _render_standings(game: Dictionary, final: bool) -> void:
	var players: Array = (game.get("players", []) as Array).duplicate()
	players.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return int(a.get("score", 0)) > int(b.get("score", 0)))
	if final and not players.is_empty():
		var winners: Array = players.filter(func(p: Dictionary) -> bool: return int(p.get("rank", 0)) == 1)
		var names: PackedStringArray = PackedStringArray()
		for w: Dictionary in winners:
			names.append(str(w.get("name", "")))
		_content.add_child(_centered(_label("★  %s wins!  ★" % " & ".join(names), 92, Look.ORANGE, true)))
		# Top three in one row, so the winner on stage stays in view.
		var podium: HBoxContainer = HBoxContainer.new()
		podium.alignment = BoxContainer.ALIGNMENT_CENTER
		podium.add_theme_constant_override("separation", 18)
		for p: Dictionary in players.slice(0, 3):
			var rank: int = int(p.get("rank", 0))
			var line: HBoxContainer = HBoxContainer.new()
			line.add_theme_constant_override("separation", 14)
			line.add_child(_label(Look.ordinal(rank), 36, Look.ORANGE if rank == 1 else Look.STEEL_DARK))
			line.add_child(_label(str(p.get("name", "")), 36, Look.BLACK))
			line.add_child(_label(Look.format_points(int(p.get("score", 0))), 36, Look.MUTED))
			podium.add_child(_card(line, Look.PAPER, 18, 14))
		_content.add_child(podium)
		var again: Button = _button("Play again  [Enter]", Look.ORANGE, 34)
		again.pressed.connect(func() -> void: play_again_pressed.emit())
		_content.add_child(_centered(again))
		return
	_content.add_child(_centered(_label("Standings after %s" % str(game.get("roundTitle", "this round")), 64, Look.BLACK, true)))
	var grid: GridContainer = GridContainer.new()
	grid.columns = 2 if players.size() > 4 else 1
	grid.add_theme_constant_override("h_separation", 24)
	grid.add_theme_constant_override("v_separation", 10)
	var holder: CenterContainer = CenterContainer.new()
	holder.add_child(grid)
	_content.add_child(holder)
	for p: Dictionary in players:
		var row: HBoxContainer = HBoxContainer.new()
		row.custom_minimum_size = Vector2(700, 0)
		row.add_theme_constant_override("separation", 18)
		var rank: Label = _label(Look.ordinal(int(p.get("rank", 0))), 36, Look.ORANGE if int(p.get("rank", 0)) == 1 else Look.STEEL_DARK)
		rank.custom_minimum_size = Vector2(90, 0)
		row.add_child(rank)
		var name: Label = _label(str(p.get("name", "")), 36, Look.BLACK if bool(p.get("connected", true)) else Look.MUTED)
		name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(name)
		var gained: int = int(p.get("roundPoints", 0))
		if gained != 0:
			row.add_child(_label(Look.signed_points(gained), 28, Look.GOOD if gained > 0 else Look.ORANGE))
		var score_label: Label = _label(Look.format_points(int(p.get("score", 0))), 36, Look.BLACK)
		row.add_child(score_label)
		Juice.count_up(score_label, int(p.get("score", 0)) - gained, int(p.get("score", 0)), Look.format_points, 1.1)
		grid.add_child(_card(row, Look.PAPER, 18, 12))


# ---- Quiz rounds ----

func _render_quiz(game: Dictionary, round: Dictionary) -> void:
	match str(round.get("step", "")):
		"vote":
			_render_vote(game, round)
		"wager":
			_render_wager(game, round)
		"question", "reveal", "steal":
			_render_question(game, round)
		"steal_reveal":
			_render_steal_reveal(game, round)


func _render_vote(game: Dictionary, round: Dictionary) -> void:
	_content.add_child(_centered(_label("Vote for the next category!", 72, Look.BLACK, true)))
	var row: HBoxContainer = HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 28)
	_content.add_child(row)
	var categories: Array = _dict(round.get("vote")).get("categories", [])
	for i: int in categories.size():
		var category: Dictionary = categories[i]
		var box: VBoxContainer = VBoxContainer.new()
		box.custom_minimum_size = Vector2(420, 0)
		var name: Label = _label(str(category.get("name", "")), 52, Look.WHITE)
		name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		box.add_child(name)
		var votes: int = int(category.get("votes", 0))
		var count: Label = _label("%d vote%s" % [votes, "" if votes == 1 else "s"], 40, Look.WHITE)
		count.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		count.modulate.a = 0.85
		box.add_child(count)
		row.add_child(_card(box, Look.STEEL_DARK if i % 2 == 0 else Look.BLACK))
	_content.add_child(_centered(_label(_acted_text(game, "voted"), 32, Look.BLACK)))


func _render_wager(game: Dictionary, round: Dictionary) -> void:
	var final: bool = str(round.get("kind", "")) == "final"
	var box: VBoxContainer = VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	var heading: Label = _label("THE FINAL QUESTION IS ABOUT" if final else "THE NEXT QUESTION IS ABOUT", 32, Look.STEEL_DARK)
	heading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(heading)
	var category: Label = _label(str(_dict(round.get("category")).get("name", "")), 110, Look.ORANGE)
	category.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(category)
	var ask: Label = _label("Place your bets on your phones!" if not final else "Bet as much as you dare. Last place can still win!", 44, Look.BLACK)
	ask.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(ask)
	_content.add_child(_centered(_card(box, Look.PAPER, 36, 40)))
	_content.add_child(_centered(_label(_acted_text(game, "bets in"), 32, Look.BLACK)))


func _render_question(game: Dictionary, round: Dictionary) -> void:
	var step: String = str(round.get("step", ""))
	var revealed: bool = step == "reveal" or step == "steal"
	var question: Dictionary = _dict(round.get("question"))
	var reveal: Dictionary = _dict(round.get("reveal"))
	var correct: int = int(reveal.get("correctIndex", -1))
	var picks: Dictionary = {}
	for choice: Variant in _dict(reveal.get("answers")).values():
		if choice != null:
			picks[int(choice)] = int(picks.get(int(choice), 0)) + 1

	var card: VBoxContainer = VBoxContainer.new()
	card.add_theme_constant_override("separation", 6)
	var category: Label = _label(str(question.get("categoryName", "")).to_upper(), 30, Look.STEEL_DARK)
	category.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	card.add_child(category)
	var text: Label = _label(str(question.get("text", "")), 58, Look.BLACK)
	text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	card.add_child(text)
	_content.add_child(_card(card, Look.PAPER))

	var grid: GridContainer = GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 20)
	grid.add_theme_constant_override("v_separation", 16)
	_content.add_child(grid)
	var choices: Array = question.get("choices", [])
	for i: int in choices.size():
		var tile_row: HBoxContainer = HBoxContainer.new()
		tile_row.add_theme_constant_override("separation", 18)
		var tag: Label = _label(Look.choice_tag(i), 40, Look.WHITE)
		tag.modulate.a = 0.85
		tile_row.add_child(tag)
		var answer: Label = _label(str(choices[i]), 44, Look.WHITE)
		answer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		answer.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		tile_row.add_child(answer)
		if revealed:
			if i == correct:
				tile_row.add_child(_label("✓", 52, Look.WHITE))
			if int(picks.get(i, 0)) > 0:
				tile_row.add_child(_label("×%d" % int(picks.get(i, 0)), 36, Look.WHITE))
		var tile: PanelContainer = _card(tile_row, Look.choice_color(i), 22, 22)
		tile.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		if revealed and i != correct:
			tile.modulate.a = 0.28
		grid.add_child(tile)
		if revealed and i == correct and step == "reveal":
			tile.pivot_offset = Vector2(400, 40)
			var pulse: Tween = tile.create_tween()
			pulse.tween_property(tile, "scale", Vector2(1.04, 1.04), 0.18).set_trans(Tween.TRANS_BACK)
			pulse.tween_property(tile, "scale", Vector2.ONE, 0.2)
	if step == "question":
		_content.add_child(_centered(_label(_acted_text(game, "locked in"), 32, Look.BLACK)))
	elif step == "steal":
		var thieves: PackedStringArray = PackedStringArray()
		for p: Dictionary in game.get("players", []):
			if _dict(reveal.get("answers")).get(str(p.get("id", ""))) == correct:
				thieves.append(str(p.get("name", "")))
		_content.add_child(_centered(_pill(_label("Sticky fingers!  %s: pick who to steal from on your phone" % ", ".join(thieves), 34, Look.WHITE), Look.ORANGE)))
	elif str(reveal.get("fact", "")) != "" and reveal.get("fact") != null:
		_content.add_child(_centered(_pill(_label("Fun fact:  " + str(reveal.get("fact")), 30, Look.BLACK), Look.PAPER)))


func _render_steal_reveal(game: Dictionary, round: Dictionary) -> void:
	_content.add_child(_centered(_label("Sticky fingers!", 80, Look.ORANGE, true)))
	var list: VBoxContainer = VBoxContainer.new()
	list.add_theme_constant_override("separation", 12)
	var steals: Array = round.get("steals", []) if typeof(round.get("steals")) == TYPE_ARRAY else []
	if steals.is_empty():
		list.add_child(_label("Nobody got robbed this time.", 40, Look.BLACK))
	for s: Dictionary in steals:
		var amount: int = int(s.get("amount", 0))
		var text: String = "%s stole %s from %s!" % [_name(game, str(s.get("thief", ""))), Look.format_points(amount), _name(game, str(s.get("victim", "")))] if amount > 0 else "%s tried to rob %s, but their pockets were empty!" % [_name(game, str(s.get("thief", ""))), _name(game, str(s.get("victim", "")))]
		list.add_child(_card(_label(text, 40, Look.BLACK), Look.PAPER, 20, 18))
	_content.add_child(_centered(list))


# ---- Closest guess ----

func _render_closest(game: Dictionary, round: Dictionary) -> void:
	var question: Dictionary = _dict(round.get("question"))
	var unit: String = str(question.get("unit", "")) if question.get("unit") != null else ""
	var card: VBoxContainer = VBoxContainer.new()
	var category: Label = _label(str(question.get("categoryName", "")).to_upper() + "  ·  CLOSEST GUESS", 30, Look.STEEL_DARK)
	category.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	card.add_child(category)
	var text: Label = _label(str(question.get("text", "")), 58, Look.BLACK)
	text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	card.add_child(text)
	_content.add_child(_card(card, Look.PAPER))
	if str(round.get("step", "")) != "reveal":
		_content.add_child(_centered(_pill(_label("Type your best guess on your phone. Closest wins!", 38, Look.WHITE), Look.STEEL_DARK)))
		_content.add_child(_centered(_label(_acted_text(game, "guessed"), 32, Look.BLACK)))
		return
	var reveal: Dictionary = _dict(round.get("reveal"))
	var answer: float = float(reveal.get("answer", 0))
	var line: NumberLine = NumberLine.new()
	line.answer = answer
	line.unit = unit
	var top: PackedStringArray = PackedStringArray()
	for r: Dictionary in reveal.get("results", []):
		if r.get("guess") == null:
			continue
		line.guesses.append({"name": _name(game, str(r.get("playerId", ""))), "value": float(r.get("guess")), "place": int(r.get("place", 0))})
		if int(r.get("points", 0)) > 0:
			top.append("%s %s %s" % [Look.ordinal(int(r.get("place", 0))), _name(game, str(r.get("playerId", ""))), Look.signed_points(int(r.get("points", 0)))])
	var row: HBoxContainer = HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 20)
	row.add_child(_pill(_label("Answer:  %s" % Look.format_number(answer, unit), 50, Look.WHITE), Look.GOOD))
	if not top.is_empty():
		row.add_child(_pill(_label("   ".join(top.slice(0, 3)), 30, Look.BLACK), Look.PAPER))
	_content.add_child(row)
	if reveal.get("fact") != null and str(reveal.get("fact")) != "":
		_content.add_child(_centered(_label("Fun fact:  " + str(reveal.get("fact")), 28, Look.BLACK)))
	_content.add_child(line)


# ---- Doodle Duel ----

func _render_drawing(game: Dictionary, round: Dictionary) -> void:
	var step: String = str(round.get("step", ""))
	if step == "drawing":
		_content.add_child(_centered(_label("Grab your phones and draw!", 80, Look.ORANGE, true)))
		_content.add_child(_centered(_label("Each artist has a secret prompt. Draw it so others can guess it.", 38, Look.BLACK)))
		var names: PackedStringArray = PackedStringArray()
		for id: Variant in round.get("artistIds", []):
			var done: bool = false
			for p: Dictionary in game.get("players", []):
				if str(p.get("id", "")) == str(id):
					done = bool(p.get("hasActed", false))
			names.append(("✓ " if done else "") + _name(game, str(id)))
		_content.add_child(_centered(_pill(_label("Artists:  " + "   ".join(names), 34, Look.WHITE), Look.STEEL_DARK)))
		if (round.get("artistIds", []) as Array).size() < (game.get("players", []) as Array).size():
			_content.add_child(_centered(_label("Everyone else: you're judging this round!", 30, Look.BLACK)))
		return

	var row: HBoxContainer = HBoxContainer.new()
	row.add_theme_constant_override("separation", 40)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	_content.add_child(row)
	var art_column: VBoxContainer = VBoxContainer.new()
	art_column.add_theme_constant_override("separation", 8)
	art_column.add_child(DrawingCanvas.new(round.get("strokes", []) if typeof(round.get("strokes")) == TYPE_ARRAY else [], 600.0))
	var by: Label = _label("by %s" % _name(game, str(round.get("artistId", ""))), 30, Look.BLACK)
	by.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	art_column.add_child(by)
	row.add_child(art_column)

	var side: VBoxContainer = VBoxContainer.new()
	side.add_theme_constant_override("separation", 14)
	side.custom_minimum_size = Vector2(900, 0)
	row.add_child(side)
	match step:
		"lying":
			side.add_child(_label("What is this?", 72, Look.ORANGE, true))
			var ask: Label = _label("Write a fake title on your phone. Make it believable: you score when people fall for it!", 40, Look.BLACK)
			ask.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			side.add_child(ask)
			side.add_child(_label(_acted_text(game, "fakes written", str(round.get("artistId", ""))), 32, Look.BLACK))
		"picking":
			side.add_child(_label("Which one is real?", 64, Look.ORANGE, true))
			var options: Array = round.get("options", [])
			var many: bool = options.size() > 5
			var grid: GridContainer = GridContainer.new()
			grid.columns = 2 if many else 1
			grid.add_theme_constant_override("h_separation", 12)
			grid.add_theme_constant_override("v_separation", 10)
			for option: Dictionary in options:
				var text: Label = _label(str(option.get("text", "")), 30 if many else 38, Look.BLACK)
				text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
				text.custom_minimum_size = Vector2(400 if many else 820, 0)
				grid.add_child(_card(text, Look.PAPER, 18, 12 if many else 16))
			side.add_child(grid)
			side.add_child(_label(_acted_text(game, "picked", str(round.get("artistId", ""))), 30, Look.BLACK))
		"reveal":
			_render_drawing_reveal(game, round, side)


func _render_drawing_reveal(game: Dictionary, round: Dictionary, side: VBoxContainer) -> void:
	var reveal: Dictionary = _dict(round.get("reveal"))
	var items: Array = reveal.get("items", [])
	var shown: int = int(reveal.get("shown", 0))
	var compact: bool = items.size() > 5
	for i: int in mini(shown, items.size()):
		var item: Dictionary = items[i]
		var truth: bool = bool(item.get("truth", false))
		var box: VBoxContainer = VBoxContainer.new()
		box.add_theme_constant_override("separation", 4)
		box.add_child(_label(("THE TRUTH:  " if truth else "") + "“%s”" % str(item.get("text", "")), 32 if compact else 40, Look.WHITE if truth else Look.BLACK))
		var pickers: PackedStringArray = PackedStringArray()
		for id: Variant in item.get("pickers", []):
			pickers.append(_name(game, str(id)))
		var authors: PackedStringArray = PackedStringArray()
		for id: Variant in item.get("authors", []):
			authors.append(_name(game, str(id)))
		var who: String
		if truth:
			who = ("Spotted by " + ", ".join(pickers)) if not pickers.is_empty() else "Nobody spotted it!"
		else:
			who = "%s fell for %s" % [", ".join(pickers), ("%s's fake" % " & ".join(authors)) if not authors.is_empty() else "a house lie"]
		box.add_child(_label(who, 22 if compact else 28, Look.WHITE if truth else Look.MUTED))
		var card: PanelContainer = _card(box, Look.ORANGE if truth else Look.PAPER, 18, 10 if compact else 16)
		side.add_child(card)
		if i == shown - 1:
			card.modulate.a = 0.0
			card.create_tween().tween_property(card, "modulate:a", 1.0, 0.3)


func _acted_text(game: Dictionary, verb: String, except_id: String = "") -> String:
	var acted: int = 0
	var here: int = 0
	for p: Dictionary in game.get("players", []):
		if str(p.get("id", "")) == except_id:
			continue
		if bool(p.get("connected", true)):
			here += 1
		if bool(p.get("hasActed", false)):
			acted += 1
	return "%d of %d %s" % [acted, here, verb]


func _name(game: Dictionary, id: String) -> String:
	for p: Dictionary in game.get("players", []):
		if str(p.get("id", "")) == id:
			return str(p.get("name", ""))
	return "Someone"


# ---- Draw-Off ----

func _render_drawoff(game: Dictionary, round: Dictionary) -> void:
	var step: String = str(round.get("step", ""))
	var prompt: String = str(round.get("prompt", ""))
	if step == "drawing":
		_content.add_child(_centered(_label("Draw-Off!", 100, Look.ORANGE, true)))
		_content.add_child(_centered(_label("Everyone draws:", 40, Look.WHITE)))
		_content.add_child(_centered(_card(_label("“%s”" % prompt, 64, Look.BLACK), Look.PAPER, 30, 30)))
		_content.add_child(_centered(_label(_acted_text(game, "finished"), 34, Look.WHITE)))
		return
	var gallery: Array = round.get("gallery", [])
	var reveal: bool = step == "reveal"
	_content.add_child(_centered(_label(("The winner is…" if reveal else "Vote for your favorite!  “%s”" % prompt), 52, Look.ORANGE, true)))
	var grid: GridContainer = GridContainer.new()
	var count: int = gallery.size()
	grid.columns = 2 if count <= 2 else 3 if count <= 6 else 4 if count <= 8 else 6
	grid.add_theme_constant_override("h_separation", 18)
	grid.add_theme_constant_override("v_separation", 14)
	var side: float = 380.0 if count <= 3 else 300.0 if count <= 6 else 250.0 if count <= 8 else 190.0
	for i: int in count:
		var entry: Dictionary = gallery[i]
		var frame: VBoxContainer = VBoxContainer.new()
		frame.add_theme_constant_override("separation", 4)
		frame.add_child(DrawingCanvas.new(entry.get("strokes", []) if typeof(entry.get("strokes")) == TYPE_ARRAY else [], side))
		var caption: String = "#%d" % int(entry.get("number", i + 1))
		if reveal:
			var votes: int = int(entry.get("votes", 0))
			caption = "%s  ·  %s  ·  %d vote%s" % [caption, _name(game, str(entry.get("artistId", ""))), votes, "" if votes == 1 else "s"]
		var label: Label = _label(caption, 26 if reveal else 34, Look.WHITE)
		label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		frame.add_child(label)
		var card: PanelContainer = _card(frame, (Look.ORANGE if reveal and i == 0 and int(entry.get("votes", 0)) > 0 else Look.STEEL_DARK), 22, 10)
		grid.add_child(card)
	_content.add_child(_centered(grid))
	if not reveal:
		_content.add_child(_centered(_label(_acted_text(game, "voted") + "  ·  vote by number on your phone", 30, Look.WHITE)))


# ---- Effects ----

## A big onomatopoeia stamp ("ピンポーン!") at a spot on screen (center by default).
func stamp(text: String, color: Color = Look.ORANGE, at: Vector2 = Vector2(-1, -1), size: int = 140) -> void:
	var spot: Vector2 = at if at.x >= 0.0 else get_viewport().get_visible_rect().size * Vector2(0.5, 0.42)
	Juice.stamp(_fx, text, color, spot, size)


func confetti(at: Vector2 = Vector2(-1, -1), amount: int = 120) -> void:
	var spot: Vector2 = at if at.x >= 0.0 else get_viewport().get_visible_rect().size * Vector2(0.5, 0.55)
	Juice.confetti(_fx, spot, amount)


func shake(strength: float = 16.0) -> void:
	Juice.shake(_root, strength)


# ---- Settings ----

const LENGTHS: Array[String] = ["short", "standard", "long"]
## Rough minutes per round type, for the lobby's time estimate.
const ROUND_MINUTES: Dictionary = {"classic": 3.0, "wager": 2.0, "closest": 2.0, "steal": 3.0, "drawing": 6.0, "drawoff": 3.0, "final": 1.5}

var settings: Dictionary = {"mode": "party", "length": "standard", "drawing": true, "categories": []}

const MODES: Array[String] = ["party", "doodle", "memes"]
const MODE_TITLES: Dictionary = {"party": "Trivia Party", "doodle": "Doodle Party", "memes": "Meme Mode"}
var rules: Dictionary = {}

signal settings_changed


func set_length(length: String) -> void:
	settings["length"] = length
	settings_changed.emit()
	show_state(_game)


func set_mode(mode: String) -> void:
	settings["mode"] = mode
	settings_changed.emit()
	_rendered_key = ""
	show_state(_game)


func cycle_mode() -> void:
	var i: int = MODES.find(str(settings.get("mode", "party")))
	set_mode(MODES[(i + 1) % MODES.size()])


func cycle_length() -> void:
	var i: int = LENGTHS.find(str(settings.get("length", "standard")))
	set_length(LENGTHS[(i + 1) % LENGTHS.size()])


func toggle_drawing() -> void:
	settings["drawing"] = not bool(settings.get("drawing", true))
	settings_changed.emit()
	show_state(_game)


func estimate_minutes() -> int:
	var mode: String = str(settings.get("mode", "party"))
	var plans: Dictionary = _dict(_dict(rules.get("modes")).get(mode))
	var plan: Array = plans.get(str(settings.get("length", "standard")), [])
	var total: float = 0.0
	for kind: Variant in plan:
		if str(kind) in ["drawing", "drawoff"] and mode == "party" and not bool(settings.get("drawing", true)):
			continue
		total += float(ROUND_MINUTES.get(str(kind), 2.0))
	return maxi(1, roundi(total))


# ---- Overlay, toast, players panel ----

func _build_overlay() -> void:
	_overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	var style: StyleBoxFlat = StyleBoxFlat.new()
	style.bg_color = Color(Look.BLACK, 0.8)
	_overlay.add_theme_stylebox_override("panel", style)
	_overlay_label = _label("", 64, Look.WHITE)
	_overlay_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_overlay_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_overlay.add_child(_overlay_label)
	_overlay.visible = false
	_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(_overlay)


func _update_overlay() -> void:
	if Server.state != ServerConnection.State.CONNECTED and Server.room_code != "":
		_overlay_label.text = "Lost the server connection\nReconnecting… everyone keeps their seat"
		_overlay.visible = true
	elif bool(_game.get("paused", false)):
		_overlay_label.text = "⏸  Paused\nPress Space to resume"
		_overlay.visible = true
	else:
		_overlay.visible = false


func _build_toast() -> void:
	_toast.add_theme_stylebox_override("panel", Look.panel(Look.ORANGE, 20, 20))
	_toast_label = _label("", 32, Look.WHITE)
	_toast.add_child(_toast_label)
	_toast.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_toast.position = Vector2(760, 900)
	_toast.visible = false
	_root.add_child(_toast)


func _build_players_panel() -> void:
	_players_panel.add_theme_stylebox_override("panel", Look.panel(Look.PAPER, 24, 28))
	_players_panel.set_anchors_preset(Control.PRESET_CENTER_RIGHT)
	_players_panel.position = Vector2(1320, 140)
	_players_panel.custom_minimum_size = Vector2(540, 0)
	var column: VBoxContainer = VBoxContainer.new()
	column.add_theme_constant_override("separation", 10)
	column.add_child(_label("Players", 44, Look.BLACK))
	column.add_child(_label("Remove someone who shouldn't be here.", 22, Look.MUTED))
	_players_list.add_theme_constant_override("separation", 8)
	column.add_child(_players_list)
	var close: Button = _button("Close  [Tab]", Look.BLACK, 24)
	close.pressed.connect(toggle_players_panel)
	column.add_child(close)
	_players_panel.add_child(column)
	_players_panel.visible = false
	_root.add_child(_players_panel)


func _refresh_players_panel() -> void:
	if not _players_panel.visible:
		return
	for child: Node in _players_list.get_children():
		child.queue_free()
	var players: Array = _game.get("players", [])
	if players.is_empty():
		_players_list.add_child(_label("Nobody has joined yet.", 28, Look.MUTED))
	for p: Dictionary in players:
		var row: HBoxContainer = HBoxContainer.new()
		var name: Label = _label("%s  (%s)" % [str(p.get("name", "")), str(p.get("animal", ""))], 28, Look.BLACK if bool(p.get("connected", true)) else Look.MUTED)
		name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(name)
		var kick: Button = _button("Remove", Look.ORANGE, 22)
		var id: String = str(p.get("id", ""))
		kick.pressed.connect(func() -> void: kick_pressed.emit(id))
		row.add_child(kick)
		_players_list.add_child(row)


# ---- Small builders ----

func _label(text: String, size: int, color: Color, outlined: bool = false) -> Label:
	var label: Label = Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	if outlined:
		label.add_theme_color_override("font_outline_color", Look.PAPER)
		label.add_theme_constant_override("outline_size", 18)
	return label


func _centered(control: Control) -> CenterContainer:
	var center: CenterContainer = CenterContainer.new()
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	center.add_child(control)
	return center


func _card(child: Control, color: Color, radius: int = 28, padding: int = 28) -> PanelContainer:
	var panel: PanelContainer = PanelContainer.new()
	panel.add_theme_stylebox_override("panel", Look.panel(color, radius, padding))
	panel.add_child(child)
	return panel


func _pill(label: Label, color: Color) -> PanelContainer:
	var panel: PanelContainer = PanelContainer.new()
	var style: StyleBoxFlat = Look.panel(color, 999, 14)
	style.content_margin_left = 26
	style.content_margin_right = 26
	panel.add_theme_stylebox_override("panel", style)
	panel.add_child(label)
	return panel


func _button(text: String, color: Color, size: int) -> Button:
	var button: Button = Button.new()
	button.text = text
	button.focus_mode = Control.FOCUS_NONE
	button.add_theme_font_size_override("font_size", size)
	for state: String in ["font_color", "font_hover_color", "font_pressed_color"]:
		button.add_theme_color_override(state, Look.WHITE)
	var normal: StyleBoxFlat = Look.panel(color, 999, 16)
	normal.content_margin_left = 30
	normal.content_margin_right = 30
	var hover: StyleBoxFlat = normal.duplicate()
	hover.bg_color = color.lightened(0.12)
	button.add_theme_stylebox_override("normal", normal)
	button.add_theme_stylebox_override("hover", hover)
	button.add_theme_stylebox_override("pressed", normal)
	return button


## A rounded countdown bar that turns shu red in the last five seconds.
class TimerBar:
	extends Control

	var _fraction: float = 1.0
	var _remaining_ms: float = 0.0

	func set_progress(fraction: float, remaining_ms: float) -> void:
		_fraction = clampf(fraction, 0.0, 1.0)
		_remaining_ms = remaining_ms
		queue_redraw()

	func _draw() -> void:
		var r: float = size.y / 2.0
		draw_style_box(Look.panel(Color(Look.BLACK, 0.25), int(r), 0), Rect2(Vector2.ZERO, size))
		var fill: Color = Look.ORANGE if _remaining_ms < 5000.0 else Look.WHITE
		var width: float = maxf(size.y, size.x * _fraction)
		var box: StyleBoxFlat = Look.panel(fill, int(r), 0)
		draw_style_box(box, Rect2(Vector2.ZERO, Vector2(width, size.y)))
