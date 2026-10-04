class_name Stage
extends Node3D
## The 3D studio: backdrop, podiums and one animal per player.
## Lays out up to 16 seats (two rows past 8) and sets each animal's mood per phase.

## Seat spacing and rows. Numbers you may want to tune are kept together here.
const MAX_ROW: int = 8
const SEAT_SPACING: float = 1.45
const BACK_ROW_Z: float = -1.3
const BACK_ROW_LIFT: float = 0.45
const CAMERA_MOVE_SECONDS: float = 0.9

var _seats: Dictionary = {}  # player id -> Seat
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
	var reveal: Dictionary = game.get("reveal") if typeof(game.get("reveal")) == TYPE_DICTIONARY else {}
	var answers: Dictionary = reveal.get("answers", {})
	var correct: int = int(reveal.get("correctIndex", -1))
	var points_key: String = "%s:%s" % [phase, str(game.get("questionNumber", 0))]
	var show_points: bool = phase == "reveal" and points_key != _last_points_key
	_last_points_key = points_key

	for player: Dictionary in game.get("players", []):
		var seat: Seat = _seats.get(str(player.get("id", "")))
		if seat == null:
			continue
		var acted: bool = bool(player.get("hasActed", false))
		var character: ChibiCharacter = seat.character
		seat.hide_badge()
		match phase:
			"category_vote", "question":
				character.set_mood(ChibiCharacter.Mood.LOCKED if acted else ChibiCharacter.Mood.THINKING)
				if acted:
					seat.show_badge("✓", Look.ASAGI_DEEP)
			"reveal":
				var choice: Variant = answers.get(str(player.get("id", "")))
				if choice == null:
					character.set_mood(ChibiCharacter.Mood.WRONG)
					seat.show_badge("…", Look.MUTED)
				else:
					var index: int = int(choice)
					character.set_mood(ChibiCharacter.Mood.CORRECT if index == correct else ChibiCharacter.Mood.WRONG)
					seat.show_badge(Look.CHOICE_SHAPES[index % 6], Look.choice_color(index))
				if show_points and int(player.get("lastPoints", 0)) > 0:
					seat.float_text("+" + Look.format_points(int(player.get("lastPoints", 0))), Look.GOOD)
			"game_over":
				if int(player.get("rank", 0)) == 1:
					character.set_mood(ChibiCharacter.Mood.WINNER)
					seat.show_badge("★", Look.SHU)
				else:
					character.set_mood(ChibiCharacter.Mood.CLAPPING)
			_:
				character.set_mood(ChibiCharacter.Mood.IDLE)
		if not bool(player.get("connected", true)):
			seat.show_badge("zZ", Look.MUTED)

	match phase:
		"lobby":
			_move_camera(Vector3(0, 2.75, 12.5), Vector3(0, 2.35, 0))
		"game_over":
			_move_camera(Vector3(0, 2.4, 10.5), Vector3(0, 1.95, 0))
		_:
			_move_camera(Vector3(0, 3.55, 12.5), Vector3(0, 3.15, 0))


func seat_count() -> int:
	return _seats.size()


func _layout(players: Array, phase: String) -> void:
	var winner_placed: bool = false
	var count: int = players.size()
	var front: int = count if count <= MAX_ROW else ceili(count / 2.0)
	for i: int in count:
		var seat: Seat = _seats.get(str(players[i].get("id", "")))
		if seat == null:
			continue
		var in_front: bool = i < front
		var row_size: int = front if in_front else count - front
		var slot: int = i if in_front else i - front
		var x: float = (slot - (row_size - 1) / 2.0) * SEAT_SPACING
		if not in_front:
			x += SEAT_SPACING * 0.5 * (1 if row_size == front else 0)
		var target: Vector3 = Vector3(x, 0.0, 0.0 if in_front else BACK_ROW_Z)
		seat.set_tall(not in_front)
		# The winner steps forward to centre stage.
		if phase == "game_over" and int(players[i].get("rank", 0)) == 1 and not winner_placed:
			winner_placed = true
			target = Vector3(0, 0, 1.4)
			seat.set_tall(false)
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
	environment.background_color = Look.ASAGI
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("fff6e6")
	environment.ambient_light_energy = 0.55
	environment.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	env.environment = environment
	add_child(env)

	var sun: DirectionalLight3D = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48, -28, 0)
	sun.light_energy = 1.05
	sun.light_color = Color("fff3e0")
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 30.0
	add_child(sun)

	_camera = Camera3D.new()
	_camera.fov = 30.0
	_camera.current = true
	add_child(_camera)
	_camera.global_transform = Transform3D(Basis.IDENTITY, Vector3(0, 2.75, 12.5)).looking_at(Vector3(0, 2.35, 0), Vector3.UP)

	# Floor and stage edge.
	_add_box(Vector3(60, 0.2, 30), Vector3(0, -0.1, 0), Color("eadfc8"))
	_add_box(Vector3(60, 0.08, 0.25), Vector3(0, 0.0, 2.2), Look.SHU)
	# Backdrop wall in asagi, a big shu sun and soft gofun clouds.
	_add_box(Vector3(60, 24, 0.2), Vector3(0, 6, -5), Look.ASAGI, true)
	var sun_disc: MeshInstance3D = MeshInstance3D.new()
	var disc: CylinderMesh = CylinderMesh.new()
	disc.top_radius = 2.4
	disc.bottom_radius = 2.4
	disc.height = 0.05
	disc.radial_segments = 64
	sun_disc.mesh = disc
	sun_disc.rotation_degrees = Vector3(90, 0, 0)
	sun_disc.position = Vector3(5.2, 5.6, -4.85)
	sun_disc.material_override = _flat(Look.SHU)
	add_child(sun_disc)
	for cloud: Array in [[Vector3(-5.5, 6.2, -4.8), 2.6], [Vector3(-3.2, 5.6, -4.75), 1.8], [Vector3(3.6, 4.5, -4.7), 2.2], [Vector3(6.8, 4.9, -4.75), 1.6]]:
		var capsule: MeshInstance3D = MeshInstance3D.new()
		var shape: CapsuleMesh = CapsuleMesh.new()
		shape.radius = 0.32
		shape.height = cloud[1]
		capsule.mesh = shape
		capsule.rotation_degrees = Vector3(0, 0, 90)
		capsule.scale = Vector3(1, 1, 0.2)
		capsule.position = cloud[0]
		capsule.material_override = _flat(Look.GOFUN)
		add_child(capsule)


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
		rim.material_override = Stage._toon(Look.SHU)
		_podium.add_child(rim)
		rim.position = Vector3(0, 0.15, 0)

		character.position.y = 0.32
		add_child(character)

		_name.font = Look.font()
		_name.font_size = 52
		_name.pixel_size = 0.0042
		_name.modulate = Look.SUMI
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
		_badge_disc.scale = Vector3(1, 1, 0.25)
		_badge_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_badge_disc.material_override = _badge_material
		_badge_disc.position = Vector3(0, 1.75, 0)
		add_child(_badge_disc)
		_badge.font = Look.font()
		_badge.font_size = 64
		_badge.pixel_size = 0.004
		_badge.modulate = Look.GOFUN
		_badge.outline_size = 0
		_badge.position = Vector3(0, 0, 0.9)
		_badge_disc.add_child(_badge)
		hide_badge()

	func set_player(player: Dictionary) -> void:
		character.set_animal(str(player.get("animal", "dog")))
		_name.text = str(player.get("name", ""))
		_name.modulate = Look.SUMI if bool(player.get("connected", true)) else Look.MUTED

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
