class_name SfxPlayer
extends Node
## Plays the game's sound set (assets/sfx/sfx_*.wav). Runs as the "Sfx" autoload.
## The sounds are one family built around the signature jingle; see tools/audio/make_sfx.py.
## Volume and mute live in config/audio.json, and M toggles mute while playing.

const SFX_DIR: String = "res://assets/sfx/"
const AUDIO_CONFIG_PATH: String = "res://config/audio.json"
const VOICES: int = 12

var muted: bool = false
var volume_db: float = 0.0

var _streams: Dictionary = {}
var _players: Array[AudioStreamPlayer] = []
var _next: int = 0


func _ready() -> void:
	_load_config()
	var dir: DirAccess = DirAccess.open(SFX_DIR)
	if dir != null:
		for file: String in dir.get_files():
			if file.begins_with("sfx_") and file.ends_with(".wav"):
				var name: String = file.trim_prefix("sfx_").trim_suffix(".wav")
				_streams[name] = load(SFX_DIR + file)
	for i: int in VOICES:
		var player: AudioStreamPlayer = AudioStreamPlayer.new()
		add_child(player)
		_players.append(player)


## Play a sound by name ("correct", "lock"…). pitch 1.0 = as recorded; variety adds a
## tiny random detune so repeats never sound robotic.
func play(name: String, pitch: float = 1.0, variety: float = 0.03, gain_db: float = 0.0) -> void:
	if muted or not _streams.has(name):
		return
	var player: AudioStreamPlayer = _players[_next]
	_next = (_next + 1) % _players.size()
	player.stream = _streams[name]
	player.pitch_scale = pitch * (1.0 + randf_range(-variety, variety))
	player.volume_db = volume_db + gain_db
	player.play()


func has_sound(name: String) -> bool:
	return _streams.has(name)


func toggle_mute() -> void:
	muted = not muted


func _load_config() -> void:
	var json: JSON = JSON.new()
	if json.parse(FileAccess.get_file_as_string(AUDIO_CONFIG_PATH)) != OK or typeof(json.data) != TYPE_DICTIONARY:
		return
	var config: Dictionary = json.data
	muted = bool(config.get("muted", false))
	volume_db = linear_to_db(clampf(float(config.get("volume", 0.8)), 0.0, 1.0))
