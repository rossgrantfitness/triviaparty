class_name ChibiCharacter
extends Node3D
## One animal on stage. Loads its model, gives it a toon look with an ink outline,
## and animates it in code so any model with "body", "head", "arm_l" and "arm_r"
## nodes works without baked animations.

enum Mood { IDLE, THINKING, LOCKED, CORRECT, WRONG, WINNER, CLAPPING }

const MODEL_DIR: String = "res://assets/characters/"
const ANIMALS: Array[String] = ["dog", "cat", "bunny", "frog"]
## Outline thickness in model units. Animation speeds live here too so they're easy to tune.
const OUTLINE_WIDTH: float = 0.012
const IDLE_SPEED: float = 2.6
const HOP_HEIGHT: float = 0.28

static var _outline_material: StandardMaterial3D = null
static var _model_cache: Dictionary = {}

var animal: String = ""
var mood: Mood = Mood.IDLE

var _model: Node3D = null
var _body: Node3D = null
var _head: Node3D = null
var _arm_l: Node3D = null
var _arm_r: Node3D = null
var _rest: Dictionary = {}
var _time: float = 0.0
var _phase: float = 0.0
var _mood_time: float = 0.0
var _hop: float = 0.0


func _init() -> void:
	_phase = randf() * TAU


func set_animal(new_animal: String) -> void:
	if new_animal == animal and _model != null:
		return
	animal = new_animal if new_animal in ANIMALS else ANIMALS[0]
	if _model != null:
		_model.queue_free()
	_model = _load_model(animal)
	add_child(_model)
	_body = _model.find_child("body", true, false) as Node3D
	_head = _model.find_child("head", true, false) as Node3D
	_arm_l = _model.find_child("arm_l", true, false) as Node3D
	_arm_r = _model.find_child("arm_r", true, false) as Node3D
	_rest.clear()
	for part: Node3D in [_body, _head, _arm_l, _arm_r]:
		if part != null:
			_rest[part] = part.transform
	_apply_toon_look(_model)


func set_mood(new_mood: Mood) -> void:
	if new_mood == mood:
		return
	mood = new_mood
	_mood_time = 0.0
	if new_mood == Mood.LOCKED:
		_hop = 1.0


## A quick hop, e.g. when the player joins.
func pop() -> void:
	_hop = 1.0


func _process(delta: float) -> void:
	if _model == null:
		return
	_time += delta
	_mood_time += delta
	_hop = maxf(0.0, _hop - delta * 3.0)
	var t: float = _time * IDLE_SPEED + _phase

	var lift: float = sin((1.0 - _hop) * PI) * HOP_HEIGHT if _hop > 0.0 else 0.0
	var squash: float = 0.025 * sin(t)
	var head_tilt: float = 0.05 * sin(t * 0.5)
	var head_nod: float = 0.0
	var arm_raise: float = 0.0
	var spin: float = 0.0

	match mood:
		Mood.THINKING:
			head_tilt = 0.2 + 0.04 * sin(t * 0.7)
			arm_raise = 0.3
		Mood.LOCKED:
			head_tilt = 0.05 * sin(t * 0.5)
			squash = 0.035 * sin(t * 1.4)
		Mood.CORRECT:
			lift += absf(sin(_mood_time * 7.0)) * 0.22
			arm_raise = 2.3 + 0.3 * sin(_mood_time * 14.0)
			squash = 0.06 * sin(_mood_time * 14.0)
		Mood.WRONG:
			head_nod = 0.35
			head_tilt = 0.08 * sin(t * 0.3)
			squash = -0.07
			arm_raise = -0.25
		Mood.WINNER:
			lift += absf(sin(_mood_time * 6.0)) * 0.3
			spin = sin(_mood_time * 3.0) * 0.6
			arm_raise = 2.4 + 0.4 * sin(_mood_time * 12.0)
			squash = 0.05 * sin(_mood_time * 12.0)
		Mood.CLAPPING:
			arm_raise = 1.0 + 0.45 * sin(_mood_time * 18.0)
			squash = 0.02 * sin(_mood_time * 9.0)
		_:
			pass

	_model.position.y = lift
	_model.rotation.y = spin
	if _body != null:
		var rest: Transform3D = _rest[_body]
		_body.transform = rest
		_body.scale = rest.basis.get_scale() * Vector3(1.0 - squash * 0.5, 1.0 + squash, 1.0 - squash * 0.5)
	if _head != null:
		var rest_head: Transform3D = _rest[_head]
		_head.transform = rest_head
		_head.rotate_object_local(Vector3.FORWARD, head_tilt)
		_head.rotate_object_local(Vector3.RIGHT, head_nod)
		_head.position.y = rest_head.origin.y + squash * 0.6 - head_nod * 0.08
	for pair: Array in [[_arm_l, 1.0], [_arm_r, -1.0]]:
		var arm: Node3D = pair[0]
		if arm == null:
			continue
		var side: float = pair[1]
		var rest_arm: Transform3D = _rest[arm]
		arm.transform = rest_arm
		arm.rotate_object_local(Vector3.FORWARD, -side * arm_raise * 0.9)
		arm.position.y = rest_arm.origin.y + maxf(0.0, arm_raise) * 0.06


static func _load_model(which: String) -> Node3D:
	if not _model_cache.has(which):
		var path: String = MODEL_DIR + which + ".glb"
		var scene: PackedScene = load(path) as PackedScene
		_model_cache[which] = scene
	var packed: PackedScene = _model_cache[which]
	if packed == null:
		push_warning("Missing character model for %s; showing a placeholder." % which)
		var fallback: MeshInstance3D = MeshInstance3D.new()
		var capsule: CapsuleMesh = CapsuleMesh.new()
		capsule.radius = 0.3
		capsule.height = 1.0
		fallback.mesh = capsule
		fallback.position.y = 0.5
		var holder: Node3D = Node3D.new()
		holder.add_child(fallback)
		return holder
	return packed.instantiate() as Node3D


## Cel shading plus an ink outline on the big shapes, for the anime look.
static func _apply_toon_look(root: Node) -> void:
	if _outline_material == null:
		_outline_material = StandardMaterial3D.new()
		_outline_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_outline_material.cull_mode = BaseMaterial3D.CULL_FRONT
		_outline_material.grow = true
		_outline_material.grow_amount = OUTLINE_WIDTH
		_outline_material.albedo_color = Look.SUMI
	for node: Node in root.find_children("*", "MeshInstance3D", true, false):
		var mesh_instance: MeshInstance3D = node
		if mesh_instance.mesh == null:
			continue
		var size: Vector3 = mesh_instance.mesh.get_aabb().size * mesh_instance.global_basis.get_scale() if mesh_instance.is_inside_tree() else mesh_instance.mesh.get_aabb().size
		var outlined: bool = maxf(size.x, maxf(size.y, size.z)) > 0.14
		for i: int in mesh_instance.mesh.get_surface_count():
			var source: BaseMaterial3D = mesh_instance.mesh.surface_get_material(i) as BaseMaterial3D
			var toon: StandardMaterial3D = StandardMaterial3D.new()
			toon.albedo_color = source.albedo_color if source != null else Look.GOFUN
			toon.diffuse_mode = BaseMaterial3D.DIFFUSE_TOON
			toon.specular_mode = BaseMaterial3D.SPECULAR_TOON
			toon.roughness = source.roughness if source != null else 0.6
			toon.rim_enabled = true
			toon.rim = 0.25
			toon.rim_tint = 0.6
			if outlined:
				toon.next_pass = _outline_material
			mesh_instance.set_surface_override_material(i, toon)
