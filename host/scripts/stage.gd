class_name Stage
extends Node3D
## The 3D studio: backdrop, podiums and one animal per player.
## Lays out up to 16 seats (two rows past 8) and sets each animal's mood per phase.

## Seat spacing and rows. Numbers you may want to tune are kept together here.
const MAX_ROW: int = 8
const SEAT_SPACING: float = 1.45
const BACK_ROW_Z: float = -1.3
const BACK_ROW_LIFT: float = 0.4
## Two rows of animals are shrunk so they stay below the question panel.
const TWO_ROW_SCALE: float = 0.72
const WINNER_SCALE: float = 1.3
const CAMERA_MOVE_SECONDS: float = 0.9

## How fast the sun rays behind the stage turn (radians per second).
const RAY_SPIN: float = 0.12

## What each emote "says" in its speech bubble (same as EMOTE_INFO in shared/src/protocol.ts).
const EMOTE_TEXT: Dictionary = {
	"laugh": "ワハハ", "wow": "ワオ!", "love": "♥♥♥", "boo": "ブー!",
	"clap": "パチパチ", "think": "ムムム…", "taunt": "ベー!", "cry": "シクシク",
}

var _seats: Dictionary = {}  # player id -> Seat
var _avatars: Dictionary = {}  # player id -> strokes, kept until the seat exists
var _rays: Node3D = null
var _camera: Camera3D = null
var _camera_tween: Tween = null
var _last_points_key: String = ""


func _ready() -> void:
	_build_studio()


## Add, remove and arrange seats to match the server's player list.
func sync_players(players: Array, phase: String = "") -> void:
	var present: Dictionary = {}
	for player: Dictionary in players:
		var id: String = str(player.get("id", ""))
		present[id] = true
		var seat: Seat = _seats.get(id)
		if seat == null:
			seat = Seat.new()
			add_child(seat)
			_seats[id] = seat
			seat.character.pop()
			if _avatars.has(id):
				seat.set_avatar(_avatars[id])
		seat.set_player(player)
	for id: String in _seats.keys():
		if not present.has(id):
			var gone: Seat = _seats[id]
			_seats.erase(id)
			gone.queue_free()
	_layout(players, phase)


## Moods, badges and camera for the current phase.
func apply_state(game: Dictionary) -> void:
	var phase: String = str(game.get("phase", "lobby"))
	var round: Dictionary = game.get("round") if typeof(game.get("round")) == TYPE_DICTIONARY else {}
	var kind: String = str(round.get("kind", ""))
	var step: String = str(round.get("step", ""))
	var reveal: Dictionary = round.get("reveal") if typeof(round.get("reveal")) == TYPE_DICTIONARY else {}

	# Float everyone's points once per scoring moment (not again on every update).
	var number: Variant = round.get("drawingNumber") if kind == "drawing" else round.get("questionNumber")
	var points_key: String = "%s:%s:%s:%s" % [str(game.get("roundIndex", 0)), kind, step, str(number)]
	var scoring: bool = phase == "round" and step in ["reveal", "steal_reveal"]
	if kind == "drawing" and step == "reveal":
		# Drawings score when the real title is finally shown.
		scoring = int(reveal.get("shown", 0)) >= (reveal.get("items", []) as Array).size()
	var show_points: bool = scoring and points_key != _last_points_key
	if show_points:
		_last_points_key = points_key

	for player: Dictionary in game.get("players", []):
		var id: String = str(player.get("id", ""))
		var seat: Seat = _seats.get(id)
		if seat == null:
			continue
		seat.hide_badge()
		var character: ChibiCharacter = seat.character
		if phase == "round":
			_apply_round_mood(seat, player, kind, step, round, reveal)
		elif phase == "game_over":
			if int(player.get("rank", 0)) == 1:
				character.set_mood(ChibiCharacter.Mood.WINNER)
				seat.show_badge("★", Look.ORANGE)
			else:
				character.set_mood(ChibiCharacter.Mood.CLAPPING)
		elif phase == "scoreboard" and int(player.get("rank", 0)) == 1:
			character.set_mood(ChibiCharacter.Mood.CORRECT)
		else:
			character.set_mood(ChibiCharacter.Mood.IDLE)
		var points: int = int(player.get("lastPoints", 0))
		if show_points and points != 0:
			seat.float_text(Look.signed_points(points), Look.GOOD if points > 0 else Look.ORANGE)
		if not bool(player.get("connected", true)):
			seat.show_badge("zZ", Look.MUTED)

	if phase == "lobby":
		_move_camera(Vector3(0, 2.75, 12.5), Vector3(0, 2.35, 0))
	elif phase == "game_over":
		_move_camera(Vector3(0, 2.6, 10.5), Vector3(0, 2.2, 1.4))
	elif phase == "round" and ((kind == "drawing" and step != "drawing") or (kind == "drawoff" and step != "drawing")):
		# The drawing fills the screen: the audience sits small along the bottom.
		_move_camera(Vector3(0, 2.0, 24.0), Vector3(0, 6.2, 0))
	elif phase == "intro":
		_move_camera(Vector3(0, 2.75, 12.5), Vector3(0, 2.35, 0))
	else:
		_move_camera(Vector3(0, 3.18, 12.5), Vector3(0, 2.78, 0))


func _apply_round_mood(seat: Seat, player: Dictionary, kind: String, step: String, round: Dictionary, reveal: Dictionary) -> void:
	var id: String = str(player.get("id", ""))
	var acted: bool = bool(player.get("hasActed", false))
	var character: ChibiCharacter = seat.character
	var waiting_mood: ChibiCharacter.Mood = ChibiCharacter.Mood.LOCKED if acted else ChibiCharacter.Mood.THINKING
	if kind == "drawing":
		var artist: String = str(round.get("artistId", ""))
		match step:
			"drawing":
				var drawing_now: bool = id in (round.get("artistIds", []) as Array)
				character.set_mood(waiting_mood if drawing_now else ChibiCharacter.Mood.IDLE)
				if drawing_now and acted:
					seat.show_badge("✓", Look.STEEL_DARK)
			"lying", "picking":
				if id == artist:
					character.set_mood(ChibiCharacter.Mood.IDLE)
					seat.show_badge("★", Look.ORANGE)
				else:
					character.set_mood(waiting_mood)
					if acted:
						seat.show_badge("✓", Look.STEEL_DARK)
			"reveal":
				var items: Array = reveal.get("items", [])
				var done: bool = int(reveal.get("shown", 0)) >= items.size()
				if id == artist:
					seat.show_badge("★", Look.ORANGE)
				if done:
					var gained: int = int(player.get("lastPoints", 0))
					character.set_mood(ChibiCharacter.Mood.CORRECT if gained > 0 else ChibiCharacter.Mood.WRONG)
				else:
					character.set_mood(ChibiCharacter.Mood.THINKING)
		return
	if kind == "drawoff":
		match step:
			"drawing", "voting":
				character.set_mood(waiting_mood)
				if acted:
					seat.show_badge("✓", Look.STEEL_DARK)
			"reveal":
				var gallery: Array = round.get("gallery", [])
				var place: int = 0
				for i: int in gallery.size():
					if str(gallery[i].get("artistId", "")) == id:
						place = i + 1
				if place == 1 and int(gallery[0].get("votes", 0)) > 0:
					character.set_mood(ChibiCharacter.Mood.WINNER)
					seat.show_badge("★", Look.ORANGE)
				elif place > 0 and int(gallery[place - 1].get("votes", 0)) > 0:
					character.set_mood(ChibiCharacter.Mood.CORRECT)
				else:
					character.set_mood(ChibiCharacter.Mood.IDLE)
		return
	if kind == "closest":
		if step == "reveal":
			var place: int = 0
			for r: Dictionary in reveal.get("results", []):
				if str(r.get("playerId", "")) == id and r.get("place") != null:
					place = int(r.get("place"))
			character.set_mood(ChibiCharacter.Mood.CORRECT if place == 1 else ChibiCharacter.Mood.IDLE if place > 0 and place <= 3 else ChibiCharacter.Mood.WRONG)
			if place > 0:
				seat.show_badge(str(place), Look.ORANGE if place == 1 else Look.STEEL_DARK)
		else:
			character.set_mood(waiting_mood)
			if acted:
				seat.show_badge("✓", Look.STEEL_DARK)
		return
	# Quiz rounds.
	match step:
		"vote", "wager", "question":
			character.set_mood(waiting_mood)
			if acted:
				seat.show_badge("✓", Look.STEEL_DARK)
		"reveal", "steal":
			var choice: Variant = (reveal.get("answers", {}) as Dictionary).get(id)
			var correct: int = int(reveal.get("correctIndex", -1))
			if choice == null:
				character.set_mood(ChibiCharacter.Mood.WRONG)
				seat.show_badge("…", Look.MUTED)
			else:
				var index: int = int(choice)
				character.set_mood(ChibiCharacter.Mood.CORRECT if index == correct else ChibiCharacter.Mood.WRONG)
				seat.show_badge(Look.CHOICE_SHAPES[index % 6], Look.choice_color(index))
		"steal_reveal":
			var mood: ChibiCharacter.Mood = ChibiCharacter.Mood.IDLE
			for steal: Dictionary in round.get("steals", []) if typeof(round.get("steals")) == TYPE_ARRAY else []:
				if str(steal.get("thief", "")) == id:
					mood = ChibiCharacter.Mood.CORRECT
				elif str(steal.get("victim", "")) == id and int(steal.get("amount", 0)) > 0:
					mood = ChibiCharacter.Mood.WRONG
			character.set_mood(mood)
		_:
			character.set_mood(ChibiCharacter.Mood.IDLE)


## A player's self-portrait, shown on a little sign by their podium.
func set_avatar(player_id: String, strokes: Array) -> void:
	_avatars[player_id] = strokes
	var seat: Seat = _seats.get(player_id)
	if seat != null:
		seat.set_avatar(strokes)


## Speech bubble and a little act-out for an emote.
func show_emote(player_id: String, emote: String) -> void:
	var seat: Seat = _seats.get(player_id)
	if seat == null:
		return
	seat.character.act(emote)
	seat.bubble(str(EMOTE_TEXT.get(emote, "!")))


## Coins fly from the victim to the thief.
func play_steal(thief_id: String, victim_id: String, amount: int) -> void:
	var thief: Seat = _seats.get(thief_id)
	var victim: Seat = _seats.get(victim_id)
	if thief == null or victim == null:
		return
	victim.bubble("シュッ!" if amount > 0 else "スカッ")
	if amount <= 0:
		return
	victim.character.set_mood(ChibiCharacter.Mood.WRONG)
	thief.character.set_mood(ChibiCharacter.Mood.CORRECT)
	var start: Vector3 = victim.global_position + Vector3(0, 1.6 * victim.scale.y, 0)
	var finish: Vector3 = thief.global_position + Vector3(0, 1.6 * thief.scale.y, 0)
	var coins: int = clampi(amount / 100, 3, 10)
	for i: int in coins:
		var coin: MeshInstance3D = MeshInstance3D.new()
		var disc: CylinderMesh = CylinderMesh.new()
		disc.top_radius = 0.12
		disc.bottom_radius = 0.12
		disc.height = 0.03
		coin.mesh = disc
		coin.material_override = _toon(Look.YELLOW)
		coin.rotation_degrees = Vector3(90, 0, 0)
		add_child(coin)
		coin.global_position = start
		coin.visible = false
		var tween: Tween = coin.create_tween()
		tween.tween_interval(i * 0.07)
		tween.tween_callback(func() -> void: coin.visible = true)
		tween.tween_method(_move_coin.bind(coin, start, finish), 0.0, 1.0, 0.7).set_trans(Tween.TRANS_SINE)
		tween.tween_callback(coin.queue_free)


func _move_coin(t: float, coin: MeshInstance3D, start: Vector3, finish: Vector3) -> void:
	var p: Vector3 = start.lerp(finish, t)
	p.y += sin(t * PI) * 1.6
	coin.global_position = p
	coin.rotation.y = t * TAU * 2.0


## Seats in seat order, with screen-friendly world positions (for the UI to aim effects).
func seat_position(player_id: String) -> Vector3:
	var seat: Seat = _seats.get(player_id)
	return seat.global_position if seat != null else Vector3.ZERO


func camera() -> Camera3D:
	return _camera


func seat_count() -> int:
	return _seats.size()


func _layout(players: Array, phase: String) -> void:
	var winner_placed: bool = false
	var count: int = players.size()
	var front: int = count if count <= MAX_ROW else ceili(count / 2.0)
	var size: float = 1.0 if count <= MAX_ROW else TWO_ROW_SCALE
	var spacing: float = SEAT_SPACING * size
	for i: int in count:
		var seat: Seat = _seats.get(str(players[i].get("id", "")))
		if seat == null:
			continue
		var in_front: bool = i < front
		var row_size: int = front if in_front else count - front
		var slot: int = i if in_front else i - front
		var x: float = (slot - (row_size - 1) / 2.0) * spacing
		if not in_front:
			x += spacing * 0.5 * (1 if row_size == front else 0)
		var target: Vector3 = Vector3(x, 0.0, 0.0 if in_front else BACK_ROW_Z * size)
		seat.scale = Vector3.ONE * size
		seat.set_tall(not in_front)
		# The winner steps forward to centre stage.
		if phase == "game_over" and int(players[i].get("rank", 0)) == 1 and not winner_placed:
			winner_placed = true
			target = Vector3(0, 0, 1.4)
			seat.set_tall(false)
			seat.scale = Vector3.ONE * WINNER_SCALE
		if seat.position == Vector3.ZERO and not seat.placed:
			seat.position = target
			seat.placed = true
		else:
			var tween: Tween = seat.create_tween()
			tween.tween_property(seat, "position", target, 0.45).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


func _move_camera(to: Vector3, look: Vector3) -> void:
	if _camera == null:
		return
	var target: Transform3D = Transform3D(Basis.IDENTITY, to).looking_at(look, Vector3.UP)
	if _camera.global_transform.is_equal_approx(target):
		return
	if _camera_tween != null:
		_camera_tween.kill()
	_camera_tween = create_tween()
	_camera_tween.tween_property(_camera, "global_transform", target, CAMERA_MOVE_SECONDS).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)


func _build_studio() -> void:
	var env: WorldEnvironment = WorldEnvironment.new()
	var environment: Environment = Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Look.STEEL
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("fff6e6")
	environment.ambient_light_energy = 0.38
	environment.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	env.environment = environment
	add_child(env)

	var sun: DirectionalLight3D = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48, -28, 0)
	sun.light_energy = 0.72
	sun.light_color = Color("fff3e0")
	sun.shadow_enabled = true
	sun.shadow_opacity = 0.45
	sun.directional_shadow_max_distance = 30.0
	add_child(sun)

	_camera = Camera3D.new()
	_camera.fov = 30.0
	_camera.current = true
	add_child(_camera)
	_camera.global_transform = Transform3D(Basis.IDENTITY, Vector3(0, 2.75, 12.5)).looking_at(Vector3(0, 2.35, 0), Vector3.UP)

	# Floor and stage edge: grey studio floor with a yellow safety stripe.
	_add_box(Vector3(60, 0.2, 30), Vector3(0, -0.1, 0), Color("8a8f95"))
	_add_box(Vector3(60, 0.08, 0.25), Vector3(0, 0.0, 2.2), Look.YELLOW)
	_add_box(Vector3(60, 0.06, 0.12), Vector3(0, 0.0, 2.45), Look.BLACK)
	# Backdrop: steel wall with darker panel seams, a big orange sun with turning rays.
	_add_box(Vector3(60, 24, 0.2), Vector3(0, 6, -5), Look.STEEL, true)
	for y: float in [1.2, 3.4, 7.8, 10.0]:
		_add_box(Vector3(60, 0.08, 0.05), Vector3(0, y, -4.88), Look.STEEL_DARK, true)
	_rays = Node3D.new()
	_rays.position = Vector3(5.2, 5.6, -4.87)
	add_child(_rays)
	for i: int in 12:
		var ray: MeshInstance3D = MeshInstance3D.new()
		var wedge: BoxMesh = BoxMesh.new()
		wedge.size = Vector3(0.55, 9.0, 0.02)
		ray.mesh = wedge
		ray.position = Vector3(0, 0, 0)
		ray.rotation.z = i * PI / 6.0
		var mat: StandardMaterial3D = _flat(Look.YELLOW)
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.albedo_color.a = 0.18
		ray.material_override = mat
		_rays.add_child(ray)
	var sun_disc: MeshInstance3D = MeshInstance3D.new()
	var disc: CylinderMesh = CylinderMesh.new()
	disc.top_radius = 2.4
	disc.bottom_radius = 2.4
	disc.height = 0.05
	disc.radial_segments = 64
	sun_disc.mesh = disc
	sun_disc.rotation_degrees = Vector3(90, 0, 0)
	sun_disc.position = Vector3(5.2, 5.6, -4.85)
	sun_disc.material_override = _flat(Look.ORANGE)
	add_child(sun_disc)
	var ring: MeshInstance3D = MeshInstance3D.new()
	var ring_mesh: CylinderMesh = CylinderMesh.new()
	ring_mesh.top_radius = 1.5
	ring_mesh.bottom_radius = 1.5
	ring_mesh.height = 0.05
	ring_mesh.radial_segments = 64
	ring.mesh = ring_mesh
	ring.rotation_degrees = Vector3(90, 0, 0)
	ring.position = Vector3(5.2, 5.6, -4.8)
	ring.material_override = _flat(Look.YELLOW)
	add_child(ring)
	# Studio light bars instead of clouds.
	for bar: Array in [[Vector3(-5.5, 6.2, -4.8), 2.6], [Vector3(-3.2, 5.6, -4.75), 1.8], [Vector3(3.6, 4.5, -4.7), 2.2], [Vector3(6.8, 4.9, -4.75), 1.6]]:
		var capsule: MeshInstance3D = MeshInstance3D.new()
		var shape: CapsuleMesh = CapsuleMesh.new()
		shape.radius = 0.32
		shape.height = bar[1]
		capsule.mesh = shape
		capsule.rotation_degrees = Vector3(0, 0, 90)
		capsule.scale = Vector3(1, 1, 0.2)
		capsule.position = bar[0]
		capsule.material_override = _flat(Look.GREY_LIGHT)
		add_child(capsule)


func _process(delta: float) -> void:
	if _rays != null:
		_rays.rotation.z += delta * RAY_SPIN


func _add_box(size: Vector3, at: Vector3, color: Color, flat: bool = false) -> void:
	var box: MeshInstance3D = MeshInstance3D.new()
	var mesh: BoxMesh = BoxMesh.new()
	mesh.size = size
	box.mesh = mesh
	box.position = at
	box.material_override = _flat(color) if flat else _toon(color)
	add_child(box)


static func _flat(color: Color) -> StandardMaterial3D:
	var mat: StandardMaterial3D = StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = color
	return mat


static func _toon(color: Color) -> StandardMaterial3D:
	var mat: StandardMaterial3D = StandardMaterial3D.new()
	mat.albedo_color = color
	mat.diffuse_mode = BaseMaterial3D.DIFFUSE_TOON
	mat.roughness = 0.9
	return mat


## One player's spot on stage: podium, animal, name plate and a badge above the head.
class Seat:
	extends Node3D

	var character: ChibiCharacter = ChibiCharacter.new()
	var placed: bool = false
	var _podium: MeshInstance3D = MeshInstance3D.new()
	var _name: Label3D = Label3D.new()
	var _badge: Label3D = Label3D.new()
	var _badge_disc: MeshInstance3D = MeshInstance3D.new()
	var _badge_material: StandardMaterial3D = StandardMaterial3D.new()
	var _tall: bool = false

	func _init() -> void:
		var cylinder: CylinderMesh = CylinderMesh.new()
		cylinder.top_radius = 0.5
		cylinder.bottom_radius = 0.55
		cylinder.height = 0.3
		cylinder.radial_segments = 40
		_podium.mesh = cylinder
		_podium.position.y = 0.15
		_podium.material_override = Stage._toon(Look.PAPER)
		add_child(_podium)

		var rim: MeshInstance3D = MeshInstance3D.new()
		var rim_mesh: CylinderMesh = CylinderMesh.new()
		rim_mesh.top_radius = 0.56
		rim_mesh.bottom_radius = 0.56
		rim_mesh.height = 0.05
		rim_mesh.radial_segments = 40
		rim.mesh = rim_mesh
		rim.position.y = 0.3
		rim.material_override = Stage._toon(Look.ORANGE)
		_podium.add_child(rim)
		rim.position = Vector3(0, 0.15, 0)

		character.position.y = 0.32
		add_child(character)

		_name.font = Look.font()
		_name.font_size = 52
		_name.pixel_size = 0.0042
		_name.modulate = Look.BLACK
		_name.outline_modulate = Look.PAPER
		_name.outline_size = 18
		_name.position = Vector3(0, 0.14, 0.58)
		_name.billboard = BaseMaterial3D.BILLBOARD_DISABLED
		_name.width = 300
		_name.autowrap_mode = TextServer.AUTOWRAP_OFF
		add_child(_name)

		var disc_mesh: SphereMesh = SphereMesh.new()
		disc_mesh.radius = 0.2
		disc_mesh.height = 0.4
		_badge_disc.mesh = disc_mesh
		# A gofun ring so every badge color stands out against the backdrop.
		var ring: MeshInstance3D = MeshInstance3D.new()
		var ring_mesh: SphereMesh = SphereMesh.new()
		ring_mesh.radius = 0.235
		ring_mesh.height = 0.47
		ring.mesh = ring_mesh
		ring.position.z = -0.08
		ring.material_override = Stage._flat(Look.WHITE)
		_badge_disc.add_child(ring)
		_badge_disc.scale = Vector3(1, 1, 0.25)
		_badge_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_badge_disc.material_override = _badge_material
		_badge_disc.position = Vector3(0, 1.75, 0)
		add_child(_badge_disc)
		_badge.font = Look.font()
		_badge.font_size = 64
		_badge.pixel_size = 0.004
		_badge.modulate = Look.WHITE
		_badge.outline_size = 0
		_badge.position = Vector3(0, 0, 0.9)
		_badge_disc.add_child(_badge)
		hide_badge()

	func set_player(player: Dictionary) -> void:
		character.set_animal(str(player.get("animal", "dog")))
		character.set_accessory(str(player.get("accessory", "none")))
		_name.text = str(player.get("name", ""))
		_name.modulate = Look.BLACK if bool(player.get("connected", true)) else Look.MUTED

	## Back-row seats stand on taller podiums so they can be seen over the front row.
	func set_tall(tall: bool) -> void:
		if tall == _tall and placed:
			return
		_tall = tall
		var height: float = 0.3 + (Stage.BACK_ROW_LIFT if tall else 0.0)
		_podium.scale.y = height / 0.3
		_podium.position.y = height / 2.0
		character.position.y = height + 0.02
		_name.position.y = height / 2.0 - 0.01
		_badge_disc.position.y = height + 1.45

	func show_badge(text: String, color: Color) -> void:
		_badge.text = text
		_badge_material.albedo_color = color
		if not _badge_disc.visible:
			_badge_disc.visible = true
			_badge_disc.scale = Vector3(0.2, 0.2, 0.05)
			create_tween().tween_property(_badge_disc, "scale", Vector3(1, 1, 0.25), 0.25).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)

	func hide_badge() -> void:
		_badge_disc.visible = false

	var _sign: Node3D = null
	var _sign_canvas: DrawingCanvas = null
	var _sign_viewport: SubViewport = null

	## A little picket sign with the player's self-portrait, beside the podium.
	func set_avatar(strokes: Array) -> void:
		if _sign == null:
			_sign = Node3D.new()
			_sign.position = Vector3(0.62, 0.0, 0.25)
			add_child(_sign)
			var stick: MeshInstance3D = MeshInstance3D.new()
			var stick_mesh: CylinderMesh = CylinderMesh.new()
			stick_mesh.top_radius = 0.02
			stick_mesh.bottom_radius = 0.02
			stick_mesh.height = 0.9
			stick.mesh = stick_mesh
			stick.position.y = 0.45
			stick.material_override = Stage._toon(Look.STEEL_DARK)
			_sign.add_child(stick)
			_sign_viewport = SubViewport.new()
			_sign_viewport.size = Vector2i(256, 256)
			_sign_viewport.transparent_bg = true
			_sign_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
			_sign_canvas = DrawingCanvas.new([], 256.0)
			_sign_canvas.size = Vector2(256, 256)
			_sign_viewport.add_child(_sign_canvas)
			_sign.add_child(_sign_viewport)
			var board: Sprite3D = Sprite3D.new()
			board.texture = _sign_viewport.get_texture()
			board.pixel_size = 0.0018
			board.position.y = 1.05
			board.double_sided = true
			_sign.add_child(board)
		_sign_canvas.strokes = strokes
		_sign_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
		_sign.scale = Vector3(0.2, 0.2, 0.2)
		create_tween().tween_property(_sign, "scale", Vector3.ONE, 0.4).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)

	## A speech bubble that pops above the head and floats away.
	func bubble(text: String) -> void:
		var label: Label3D = Label3D.new()
		label.font = Look.font()
		label.text = text
		label.font_size = 80
		label.pixel_size = 0.0045
		label.modulate = Look.BLACK
		label.outline_modulate = Look.WHITE
		label.outline_size = 28
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.no_depth_test = true
		label.position = Vector3(randf_range(-0.2, 0.2), 2.0, 0.3)
		label.scale = Vector3(0.3, 0.3, 0.3)
		add_child(label)
		var tween: Tween = label.create_tween()
		tween.tween_property(label, "scale", Vector3.ONE, 0.22).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		tween.tween_interval(0.7)
		tween.tween_property(label, "position:y", 2.6, 0.6)
		tween.parallel().tween_property(label, "modulate:a", 0.0, 0.6)
		tween.tween_callback(label.queue_free)

	func float_text(text: String, color: Color) -> void:
		var label: Label3D = Label3D.new()
		label.font = Look.font()
		label.text = text
		label.font_size = 72
		label.pixel_size = 0.004
		label.modulate = color
		label.outline_modulate = Look.PAPER
		label.outline_size = 16
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.position = Vector3(0, 2.15, 0.2)
		add_child(label)
		var tween: Tween = label.create_tween()
		tween.tween_property(label, "position:y", 2.75, 1.6).set_ease(Tween.EASE_OUT)
		tween.parallel().tween_property(label, "modulate:a", 0.0, 1.6).set_delay(0.6)
		tween.tween_callback(label.queue_free)
