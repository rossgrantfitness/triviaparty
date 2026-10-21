class_name Juice
extends RefCounted
## Game-feel helpers for the TV: pop-ins, staggered entrances, shakes, count-ups,
## confetti and big onomatopoeia stamps ("ピンポーン!"). Timings are kept here so
## they're easy to tune.

const POP_SECONDS: float = 0.32
const STAGGER_SECONDS: float = 0.06
const CONFETTI_COLORS: Array[Color] = [Look.ORANGE, Look.YELLOW, Look.RED, Look.STEEL, Look.WHITE, Look.BLACK]

static var _confetti_texture: Texture2D = null


## Scale a control up from small with a little overshoot.
static func pop_in(item: CanvasItem, delay: float = 0.0, from_scale: float = 0.55) -> void:
	if item is Control:
		var control: Control = item
		control.pivot_offset = control.size / 2.0
		control.resized.connect(func() -> void: control.pivot_offset = control.size / 2.0)
	item.set("scale", Vector2(from_scale, from_scale))
	item.modulate.a = 0.0
	var tween: Tween = item.create_tween()
	tween.tween_interval(delay)
	tween.tween_property(item, "modulate:a", 1.0, POP_SECONDS * 0.5)
	tween.parallel().tween_property(item, "scale", Vector2.ONE, POP_SECONDS).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


## Pop in every child of a container, one after another.
static func stagger_in(parent: Node, step: float = STAGGER_SECONDS, start: float = 0.0) -> void:
	var i: int = 0
	for child: Node in parent.get_children():
		if child is CanvasItem and not child.is_queued_for_deletion():
			pop_in(child, start + i * step)
			i += 1


## A quick "boing" on something already on screen.
static func punch(item: CanvasItem, amount: float = 0.12) -> void:
	if item is Control:
		(item as Control).pivot_offset = (item as Control).size / 2.0
	var tween: Tween = item.create_tween()
	tween.tween_property(item, "scale", Vector2.ONE * (1.0 + amount), 0.08).set_trans(Tween.TRANS_SINE)
	tween.tween_property(item, "scale", Vector2.ONE, 0.25).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


## Shake a control (the whole UI) for a moment.
static func shake(control: Control, strength: float = 14.0, seconds: float = 0.4) -> void:
	var origin: Vector2 = control.position
	var tween: Tween = control.create_tween()
	var steps: int = 8
	for i: int in steps:
		var falloff: float = 1.0 - float(i) / steps
		tween.tween_property(control, "position", origin + Vector2(randf_range(-1, 1), randf_range(-1, 1)) * strength * falloff, seconds / steps)
	tween.tween_property(control, "position", origin, 0.05)


## Count a label's number up (or down) to a value.
static func count_up(label: Label, from: int, to: int, format: Callable, seconds: float = 0.8) -> void:
	if from == to:
		label.text = format.call(to)
		return
	label.text = format.call(from)
	var tween: Tween = label.create_tween()
	tween.tween_method(func(v: float) -> void: label.text = format.call(roundi(v)), float(from), float(to), seconds).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)


## A big onomatopoeia stamp that slams in, wobbles and floats away.
static func stamp(parent: Control, text: String, color: Color, at: Vector2, size: int = 120) -> void:
	var label: Label = Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", color)
	label.add_theme_color_override("font_outline_color", Look.WHITE)
	label.add_theme_constant_override("outline_size", maxi(12, size / 6))
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(label)
	label.reset_size()
	label.position = at - label.size / 2.0
	label.pivot_offset = label.size / 2.0
	label.rotation = deg_to_rad(randf_range(-12, -4))
	label.scale = Vector2(2.4, 2.4)
	label.modulate.a = 0.0
	var tween: Tween = label.create_tween()
	tween.tween_property(label, "scale", Vector2.ONE, 0.22).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tween.parallel().tween_property(label, "modulate:a", 1.0, 0.1)
	tween.tween_interval(0.55)
	tween.tween_property(label, "position:y", -50.0, 0.45).as_relative()
	tween.parallel().tween_property(label, "modulate:a", 0.0, 0.45)
	tween.tween_callback(label.queue_free)


## A burst of confetti from a point.
static func confetti(parent: Node, at: Vector2, amount: int = 90, spread: float = 180.0) -> void:
	var particles: CPUParticles2D = CPUParticles2D.new()
	particles.position = at
	particles.amount = amount
	particles.one_shot = true
	particles.explosiveness = 0.92
	particles.lifetime = 2.2
	particles.texture = _confetti_piece()
	particles.direction = Vector2.UP
	particles.spread = spread
	particles.gravity = Vector2(0, 900)
	particles.initial_velocity_min = 450.0
	particles.initial_velocity_max = 1000.0
	particles.angular_velocity_min = -540.0
	particles.angular_velocity_max = 540.0
	particles.angle_min = 0.0
	particles.angle_max = 360.0
	particles.scale_amount_min = 0.7
	particles.scale_amount_max = 1.4
	particles.damping_min = 40.0
	particles.damping_max = 120.0
	var ramp: Gradient = Gradient.new()
	var offsets: PackedFloat32Array = PackedFloat32Array()
	var colors: PackedColorArray = PackedColorArray()
	# Two stops per color so each piece gets one solid color, not a blend.
	for i: int in CONFETTI_COLORS.size():
		offsets.append(float(i) / CONFETTI_COLORS.size())
		offsets.append((float(i) + 0.999) / CONFETTI_COLORS.size())
		colors.append(CONFETTI_COLORS[i])
		colors.append(CONFETTI_COLORS[i])
	ramp.offsets = offsets
	ramp.colors = colors
	particles.color_initial_ramp = ramp
	parent.add_child(particles)
	particles.emitting = true
	particles.finished.connect(particles.queue_free)


static func _confetti_piece() -> Texture2D:
	if _confetti_texture == null:
		var image: Image = Image.create(10, 16, false, Image.FORMAT_RGBA8)
		image.fill(Color.WHITE)
		_confetti_texture = ImageTexture.create_from_image(image)
	return _confetti_texture
