class_name DrawingCanvas
extends Control
## Shows a player's drawing. Strokes come from the phones as {c: color, w: width,
## p: [x, y, x, y, ...]} with coordinates 0..1000 on a square canvas.

const UNITS: float = 1000.0

var strokes: Array = []:
	set(value):
		strokes = value
		queue_redraw()


func _init(drawing: Array = [], side: float = 560.0) -> void:
	strokes = drawing
	custom_minimum_size = Vector2(side, side)
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _draw() -> void:
	var side: float = minf(size.x, size.y)
	var origin: Vector2 = (size - Vector2(side, side)) / 2.0
	var frame: StyleBoxFlat = Look.panel(Look.PAPER, 28, 0)
	frame.border_color = Look.BLACK
	frame.set_border_width_all(6)
	draw_style_box(frame, Rect2(origin, Vector2(side, side)))
	var scale: float = side / UNITS
	for stroke: Variant in strokes:
		if typeof(stroke) != TYPE_DICTIONARY:
			continue
		var points: Array = stroke.get("p", [])
		if points.size() < 2:
			continue
		var color: Color = Look.PEN_COLORS[clampi(int(stroke.get("c", 0)), 0, Look.PEN_COLORS.size() - 1)]
		var width: float = Look.PEN_WIDTHS[clampi(int(stroke.get("w", 1)), 0, Look.PEN_WIDTHS.size() - 1)] * scale
		var line: PackedVector2Array = PackedVector2Array()
		for i: int in range(0, points.size() - 1, 2):
			line.append(origin + Vector2(float(points[i]), float(points[i + 1])) * scale)
		if line.size() == 1:
			draw_circle(line[0], width / 2.0, color)
			continue
		draw_polyline(line, color, width, true)
		# Round caps and joins, like the phone pen.
		for point: Vector2 in line:
			draw_circle(point, width / 2.0, color)
