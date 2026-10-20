class_name Look
extends RefCounted
## Colors, fonts and answer symbols shared by every host screen.
## Palette: asagi-shu (colorcombinations.org/palettes/asagi-shu).

const ASAGI: Color = Color("6b9bb0")
const ASAGI_DEEP: Color = Color("3f6e82")
const SHU: Color = Color("d8453a")
const GOFUN: Color = Color("f4eee0")
const SUMI: Color = Color("2b2b2b")
const PAPER: Color = Color("fffaf0")
const MUTED: Color = Color("6f6a60")
const GOOD: Color = Color("3f8f5f")

## Answer slots: same colors, letters and shapes as the phones.
const CHOICE_COLORS: Array[Color] = [SHU, ASAGI_DEEP, SUMI, ASAGI, SHU, ASAGI_DEEP]
const CHOICE_LETTERS: Array[String] = ["A", "B", "C", "D", "E", "F"]
const CHOICE_SHAPES: Array[String] = ["▲", "●", "■", "◆", "★", "▲"]

## Pen colors and widths for drawings; same order as PEN_COLORS / PEN_WIDTHS in shared/src/game.ts.
const PEN_COLORS: Array[Color] = [
	Color("2b2b2b"), Color("d8453a"), Color("6b9bb0"), Color("3f6e82"), Color("f4eee0"),
	Color("e8a33d"), Color("7db58c"), Color("f0948a"), Color("8c6a4f"), Color("9b7cc4"),
]
const PEN_WIDTHS: Array[float] = [6.0, 14.0, 28.0, 60.0]

const FONT_PATH: String = "res://assets/fonts/mplus_rounded_800.woff2"
## The Latin font file has no ▲●■◆✓★, so those come from these extra slices of the same font.
const SYMBOL_FONT_PATHS: Array[String] = [
	"res://assets/fonts/mplus_rounded_symbols_60.woff2",
	"res://assets/fonts/mplus_rounded_symbols_95.woff2",
	"res://assets/fonts/mplus_rounded_symbols_97.woff2",
	"res://assets/fonts/mplus_rounded_symbols_102.woff2",
	"res://assets/fonts/mplus_rounded_symbols_105.woff2",
	"res://assets/fonts/mplus_rounded_symbols_108.woff2",
]

static var _font: Font = null


static func font() -> Font:
	if _font != null:
		return _font
	var main: FontFile = load(FONT_PATH)
	var fallbacks: Array[Font] = []
	for path: String in SYMBOL_FONT_PATHS:
		var extra: FontFile = load(path)
		if extra != null:
			fallbacks.append(extra)
	main.fallbacks = fallbacks
	_font = main
	return _font


static func choice_color(index: int) -> Color:
	return CHOICE_COLORS[index % CHOICE_COLORS.size()]


static func choice_tag(index: int) -> String:
	return "%s %s" % [CHOICE_SHAPES[index % CHOICE_SHAPES.size()], CHOICE_LETTERS[index % CHOICE_LETTERS.size()]]


static func format_points(value: int) -> String:
	var digits: String = str(absi(value))
	var out: String = ""
	while digits.length() > 3:
		out = "," + digits.substr(digits.length() - 3) + out
		digits = digits.substr(0, digits.length() - 3)
	return ("-" if value < 0 else "") + digits + out


static func signed_points(value: int) -> String:
	return ("+" if value > 0 else "") + format_points(value)


## Numbers for Closest Guess: years stay plain (1969), others get commas and a unit.
static func format_number(value: float, unit: String = "") -> String:
	var text: String
	if unit == "year":
		return str(int(value))
	if is_equal_approx(value, roundf(value)):
		text = format_points(int(value))
	else:
		text = format_points(int(value)) + ("%.3f" % absf(value - float(int(value)))).substr(1).rstrip("0")
	return text + (" " + unit if not unit.is_empty() else "")


static func ordinal(n: int) -> String:
	var tens: int = n % 100
	if tens >= 11 and tens <= 13:
		return "%dth" % n
	match n % 10:
		1:
			return "%dst" % n
		2:
			return "%dnd" % n
		3:
			return "%drd" % n
	return "%dth" % n


## A rounded panel style.
static func panel(color: Color, radius: int = 28, padding: int = 28) -> StyleBoxFlat:
	var box: StyleBoxFlat = StyleBoxFlat.new()
	box.bg_color = color
	box.set_corner_radius_all(radius)
	box.set_content_margin_all(padding)
	box.anti_aliasing = true
	return box
