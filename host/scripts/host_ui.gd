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


func _ready() -> void:
	layer = 1
	var theme: Theme = Theme.new()
	theme.default_font = Look.font()
	theme.default_font_size = BASE_FONT_SIZE
	theme.set_color("font_color", "Label", Look.SUMI)
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
	column.add_theme_constant_override("separation", 18)
	margin.add_child(column)

	# Header: how to join (left), question counter (right), timer underneath.
	_header.add_theme_constant_override("separation", 24)
	column.add_child(_header)
	_join_label = _label("", 30, Look.GOFUN)
	_header.add_child(_pill(_join_label, Look.SUMI))
	var spacer: Control = Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_header.add_child(spacer)
	_counter_label = _label("", 30, Look.GOFUN)
	_header.add_child(_pill(_counter_label, Look.ASAGI_DEEP))
	_controls.add_theme_constant_override("separation", 12)
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
	_status_label = _label("Connecting to server…", 26, Look.SHU)
	_status_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_status_label.size_flags_vertical = Control.SIZE_SHRINK_END
	footer.add_child(_status_label)
	_pause_button = _button("Pause  [Space]", Look.ASAGI_DEEP, 24)
	_pause_button.pressed.connect(func() -> void: pause_pressed.emit())
	_controls.add_child(_pause_button)
	_skip_button = _button("Next  [N]", Look.ASAGI_DEEP, 24)
	_skip_button.pressed.connect(func() -> void: skip_pressed.emit())
	_controls.add_child(_skip_button)
	var players_button: Button = _button("Players  [Tab]", Look.SUMI, 24)
	players_button.pressed.connect(toggle_players_panel)
	_controls.add_child(players_button)

	_build_players_panel()
	_build_overlay()
	_build_toast()


func _process(delta: float) -> void:
	var timer: Variant = _game.get("timer")
	if typeof(timer) == TYPE_DICTIONARY and _timer.visible:
		var remaining: float = float(timer.get("remainingMs", 0.0)) if bool(_game.get("paused", false)) else maxf(0.0, _timer_deadline_ms - Time.get_ticks_msec())
		_timer.set_progress(remaining / _timer_duration_ms, remaining)
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
	_timer.visible = phase in ["category_vote", "question"] and typeof(timer) == TYPE_DICTIONARY
	var code: String = str(game.get("code", ""))
	_join_label.text = "Join at  %s   ·   Code  %s" % [join_url, code]
	_header.get_child(0).visible = phase != "lobby"
	_counter_label.get_parent().visible = phase in ["question", "reveal", "scoreboard"]
	_counter_label.text = "Question %d of %d" % [int(game.get("questionNumber", 0)), int(game.get("questionCount", 0))]
	var in_game: bool = phase in ["category_vote", "question", "reveal", "scoreboard"]
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
		"category_vote":
			_render_vote(game)
		"question", "reveal":
			_render_question(game, phase == "reveal")
		"scoreboard":
			_render_standings(game, false)
		"game_over":
			_render_standings(game, true)


func _screen_key(game: Dictionary) -> String:
	var phase: String = str(game.get("phase", ""))
	var players: Array = game.get("players", [])
	var acted: int = 0
	for p: Dictionary in players:
		if bool(p.get("hasActed", false)):
			acted += 1
	var question: Variant = game.get("question")
	var question_id: String = str(question.get("id", "")) if typeof(question) == TYPE_DICTIONARY else ""
	return JSON.stringify([phase, question_id, game.get("vote"), players.size(), acted, game.get("code"), join_url, phase == "lobby" and players.size()])


# ---- Screens ----

func _render_lobby(game: Dictionary) -> void:
	var players: Array = game.get("players", [])
	var title: Label = _label("Trivia Party", 104, Look.SHU)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_color_override("font_outline_color", Look.PAPER)
	title.add_theme_constant_override("outline_size", 24)
	_content.add_child(title)

	var row: HBoxContainer = HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 28)
	_content.add_child(row)

	var join_card: VBoxContainer = VBoxContainer.new()
	join_card.add_child(_label("On your phone, open", 34, Look.MUTED))
	var url: Label = _label(join_url, 54, Look.ASAGI_DEEP)
	join_card.add_child(url)
	join_card.add_child(_label("Same Wi-Fi as this TV", 26, Look.MUTED))
	row.add_child(_card(join_card, Look.PAPER))

	var code_card: VBoxContainer = VBoxContainer.new()
	code_card.alignment = BoxContainer.ALIGNMENT_CENTER
	var caption: Label = _label("Room code", 34, Look.GOFUN)
	caption.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	code_card.add_child(caption)
	var code: Label = _label(" ".join(str(game.get("code", "····")).split("")), 104, Look.GOFUN)
	code.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	code_card.add_child(code)
	row.add_child(_card(code_card, Look.SHU))

	var bottom: HBoxContainer = HBoxContainer.new()
	bottom.alignment = BoxContainer.ALIGNMENT_CENTER
	bottom.add_theme_constant_override("separation", 28)
	_content.add_child(bottom)
	var count_text: String = "Waiting for players to join…" if players.is_empty() else "%d player%s ready" % [players.size(), "" if players.size() == 1 else "s"]
	bottom.add_child(_pill(_label(count_text, 36, Look.GOFUN), Look.SUMI))
	if not players.is_empty():
		var start: Button = _button("Start game  [Enter]", Look.SHU, 40)
		start.pressed.connect(func() -> void: start_pressed.emit())
		bottom.add_child(start)


func _render_vote(game: Dictionary) -> void:
	_content.add_child(_centered(_label("Vote for the next category!", 72, Look.SUMI, true)))
	_content.add_child(_centered(_label("Tap a category on your phone", 34, Look.SUMI)))
	var row: HBoxContainer = HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 28)
	_content.add_child(row)
	var vote: Dictionary = game.get("vote") if typeof(game.get("vote")) == TYPE_DICTIONARY else {}
	var categories: Array = vote.get("categories", [])
	for i: int in categories.size():
		var category: Dictionary = categories[i]
		var box: VBoxContainer = VBoxContainer.new()
		box.custom_minimum_size = Vector2(420, 0)
		var name: Label = _label(str(category.get("name", "")), 52, Look.GOFUN)
		name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		box.add_child(name)
		var votes: int = int(category.get("votes", 0))
		var count: Label = _label("%d vote%s" % [votes, "" if votes == 1 else "s"], 40, Look.GOFUN)
		count.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		count.modulate.a = 0.85
		box.add_child(count)
		row.add_child(_card(box, Look.ASAGI_DEEP if i % 2 == 0 else Look.SUMI))
	_content.add_child(_centered(_label(_acted_text(game, "voted"), 32, Look.SUMI)))


func _render_question(game: Dictionary, revealed: bool) -> void:
	var question: Dictionary = game.get("question") if typeof(game.get("question")) == TYPE_DICTIONARY else {}
	var reveal: Dictionary = game.get("reveal") if typeof(game.get("reveal")) == TYPE_DICTIONARY else {}
	var correct: int = int(reveal.get("correctIndex", -1))
	var picks: Dictionary = {}
	for choice: Variant in reveal.get("answers", {}).values():
		if choice != null:
			picks[int(choice)] = int(picks.get(int(choice), 0)) + 1

	var card: VBoxContainer = VBoxContainer.new()
	card.add_theme_constant_override("separation", 6)
	var category: Label = _label(str(question.get("categoryName", "")).to_upper(), 30, Look.ASAGI_DEEP)
	category.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	card.add_child(category)
	var text: Label = _label(str(question.get("text", "")), 62, Look.SUMI)
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
		var tag: Label = _label(Look.choice_tag(i), 40, Look.GOFUN)
		tag.modulate.a = 0.85
		tile_row.add_child(tag)
		var answer: Label = _label(str(choices[i]), 46, Look.GOFUN)
		answer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		answer.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		tile_row.add_child(answer)
		if revealed:
			var count: int = int(picks.get(i, 0))
			if i == correct:
				tile_row.add_child(_label("✓", 52, Look.GOFUN))
			if count > 0:
				tile_row.add_child(_label("×%d" % count, 36, Look.GOFUN))
		var tile: PanelContainer = _card(tile_row, Look.choice_color(i), 22, 22)
		tile.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		if revealed and i != correct:
			tile.modulate.a = 0.28
		grid.add_child(tile)
		if revealed and i == correct:
			tile.pivot_offset = Vector2(400, 40)
			var pulse: Tween = tile.create_tween()
			pulse.tween_property(tile, "scale", Vector2(1.04, 1.04), 0.18).set_trans(Tween.TRANS_BACK)
			pulse.tween_property(tile, "scale", Vector2.ONE, 0.2)
	if not revealed:
		_content.add_child(_centered(_label(_acted_text(game, "locked in"), 32, Look.SUMI)))


func _render_standings(game: Dictionary, final: bool) -> void:
	var players: Array = (game.get("players", []) as Array).duplicate()
	players.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return int(a.get("score", 0)) > int(b.get("score", 0)))
	if final and not players.is_empty():
		var winners: Array = players.filter(func(p: Dictionary) -> bool: return int(p.get("rank", 0)) == 1)
		var names: PackedStringArray = PackedStringArray()
		for w: Dictionary in winners:
			names.append(str(w.get("name", "")))
		var title: Label = _label("★  %s wins!  ★" % " & ".join(names) if winners.size() > 0 else "Game over", 92, Look.SHU, true)
		_content.add_child(_centered(title))
		# Top three in one row, so the winner on stage stays in view.
		var podium: HBoxContainer = HBoxContainer.new()
		podium.alignment = BoxContainer.ALIGNMENT_CENTER
		podium.add_theme_constant_override("separation", 18)
		for p: Dictionary in players.slice(0, 3):
			var rank: int = int(p.get("rank", 0))
			var line: HBoxContainer = HBoxContainer.new()
			line.add_theme_constant_override("separation", 14)
			line.add_child(_label(Look.ordinal(rank), 36, Look.SHU if rank == 1 else Look.ASAGI_DEEP))
			line.add_child(_label(str(p.get("name", "")), 36, Look.SUMI))
			line.add_child(_label(Look.format_points(int(p.get("score", 0))), 36, Look.MUTED))
			podium.add_child(_card(line, Look.PAPER, 18, 14))
		_content.add_child(podium)
		var again: Button = _button("Play again  [Enter]", Look.SHU, 34)
		again.pressed.connect(func() -> void: play_again_pressed.emit())
		_content.add_child(_centered(again))
		return
	else:
		_content.add_child(_centered(_label("Standings", 72, Look.SUMI, true)))

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
		var rank: Label = _label(Look.ordinal(int(p.get("rank", 0))), 38, Look.SHU if int(p.get("rank", 0)) == 1 else Look.ASAGI_DEEP)
		rank.custom_minimum_size = Vector2(90, 0)
		row.add_child(rank)
		var name: Label = _label(str(p.get("name", "")), 38, Look.SUMI if bool(p.get("connected", true)) else Look.MUTED)
		name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(name)
		if not final and int(p.get("lastPoints", 0)) > 0:
			row.add_child(_label("+" + Look.format_points(int(p.get("lastPoints", 0))), 30, Look.GOOD))
		row.add_child(_label(Look.format_points(int(p.get("score", 0))), 38, Look.SUMI))
		grid.add_child(_card(row, Look.PAPER, 18, 14))


func _acted_text(game: Dictionary, verb: String) -> String:
	var players: Array = game.get("players", [])
	var acted: int = 0
	var here: int = 0
	for p: Dictionary in players:
		if bool(p.get("connected", true)):
			here += 1
		if bool(p.get("hasActed", false)):
			acted += 1
	return "%d of %d %s" % [acted, here, verb]


# ---- Overlay, toast, players panel ----

func _build_overlay() -> void:
	_overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	var style: StyleBoxFlat = StyleBoxFlat.new()
	style.bg_color = Color(Look.SUMI, 0.8)
	_overlay.add_theme_stylebox_override("panel", style)
	_overlay_label = _label("", 64, Look.GOFUN)
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
	_toast.add_theme_stylebox_override("panel", Look.panel(Look.SHU, 20, 20))
	_toast_label = _label("", 32, Look.GOFUN)
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
	column.add_child(_label("Players", 44, Look.SUMI))
	column.add_child(_label("Remove someone who shouldn't be here.", 22, Look.MUTED))
	_players_list.add_theme_constant_override("separation", 8)
	column.add_child(_players_list)
	var close: Button = _button("Close  [Tab]", Look.SUMI, 24)
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
		var name: Label = _label("%s  (%s)" % [str(p.get("name", "")), str(p.get("animal", ""))], 28, Look.SUMI if bool(p.get("connected", true)) else Look.MUTED)
		name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(name)
		var kick: Button = _button("Remove", Look.SHU, 22)
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
		button.add_theme_color_override(state, Look.GOFUN)
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
		draw_style_box(Look.panel(Color(Look.SUMI, 0.25), int(r), 0), Rect2(Vector2.ZERO, size))
		var fill: Color = Look.SHU if _remaining_ms < 5000.0 else Look.GOFUN
		var width: float = maxf(size.y, size.x * _fraction)
		var box: StyleBoxFlat = Look.panel(fill, int(r), 0)
		draw_style_box(box, Rect2(Vector2.ZERO, Vector2(width, size.y)))
