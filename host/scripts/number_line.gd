class_name NumberLine
extends Control
## Closest Guess reveal: a line with the real answer and everyone's guesses on it.

var answer: float = 0.0
var guesses: Array = []  # [{name: String, value: float, place: int}]
var unit: String = ""


func _init() -> void:
	custom_minimum_size = Vector2(0, 230)
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _draw() -> void:
	if guesses.is_empty():
		return
	# Zoom in on the interesting part: way-off guesses get pinned to the edge.
	var distances: Array = []
	for g: Dictionary in guesses:
		distances.append(absf(float(g["value"]) - answer))
	distances.sort()
	var near: float = distances[mini(2, distances.size() - 1)]
	var reach: float = maxf(near * 1.6, maxf(absf(answer) * 0.05, 1.0))
	var lo: float = answer - reach
	var hi: float = answer + reach
	for g: Dictionary in guesses:
		var v: float = float(g["value"])
		if absf(v - answer) <= reach * 1.0001:
			lo = minf(lo, v)
			hi = maxf(hi, v)
	var span: float = hi - lo
	lo -= span * 0.06
	hi += span * 0.06
	var y: float = size.y * 0.55
	var left: float = 60.0
	var right: float = size.x - 60.0
	var x_of: Callable = func(v: float) -> float: return left + (v - lo) / (hi - lo) * (right - left)
	draw_line(Vector2(left, y), Vector2(right, y), Look.SUMI, 8.0, true)
	var font: Font = Look.font()
	# Guesses: little flags above the line, alternating heights so names don't collide.
	# Way-off guesses share one flag at each end of the line.
	var sorted: Array = []
	var off_low: int = 0
	var off_high: int = 0
	for g: Dictionary in guesses:
		var value: float = float(g["value"])
		if value < lo:
			off_low += 1
		elif value > hi:
			off_high += 1
		else:
			sorted.append(g)
	sorted.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a["value"]) < float(b["value"]))
	for i: int in sorted.size():
		var g: Dictionary = sorted[i]
		var x: float = x_of.call(float(g["value"]))
		var top: float = y - 50.0 - (i % 3) * 46.0
		var color: Color = Look.SHU if int(g.get("place", 0)) == 1 else Look.ASAGI_DEEP
		draw_line(Vector2(x, y), Vector2(x, top), color, 4.0, true)
		draw_circle(Vector2(x, y), 12.0, color)
		var text: String = str(g["name"])
		var width: float = font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 26).x
		draw_string(font, Vector2(clampf(x - width / 2.0, 0.0, size.x - width), top - 8.0), text, HORIZONTAL_ALIGNMENT_LEFT, -1, 26, color)
	for side: Array in [[off_low, left, "«  %d way off"], [off_high, right, "%d way off  »"]]:
		if int(side[0]) == 0:
			continue
		var label: String = str(side[2]) % int(side[0])
		var w: float = font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, 24).x
		var sx: float = float(side[1])
		draw_circle(Vector2(sx, y), 10.0, Look.MUTED)
		draw_string(font, Vector2(clampf(sx - w / 2.0, 0.0, size.x - w), y - 24.0), label, HORIZONTAL_ALIGNMENT_LEFT, -1, 24, Look.MUTED)
	# The answer: a big marker below the line.
	var ax: float = x_of.call(answer)
	draw_colored_polygon(PackedVector2Array([Vector2(ax, y + 14), Vector2(ax - 22, y + 50), Vector2(ax + 22, y + 50)]), Look.GOOD)
	var label: String = "Answer"
	var lw: float = font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, 28).x
	draw_string(font, Vector2(clampf(ax - lw / 2.0, 0.0, size.x - lw), y + 86), label, HORIZONTAL_ALIGNMENT_LEFT, -1, 28, Look.GOOD)
