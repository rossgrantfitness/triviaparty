extends GutTest

var _stage: Stage


func before_each() -> void:
	_stage = Stage.new()
	add_child_autofree(_stage)


func _players(count: int) -> Array:
	var players: Array = []
	for i: int in count:
		players.append({"id": "p%d" % i, "name": "P%d" % i, "animal": ChibiCharacter.ANIMALS[i % 4], "connected": true, "score": 0, "rank": 1})
	return players


func test_adds_a_seat_per_player() -> void:
	_stage.sync_players(_players(5))
	assert_eq(_stage.seat_count(), 5)


func test_removes_seats_for_players_who_left() -> void:
	_stage.sync_players(_players(5))
	_stage.sync_players(_players(2))
	assert_eq(_stage.seat_count(), 2)


func test_handles_a_full_room() -> void:
	_stage.sync_players(_players(16))
	assert_eq(_stage.seat_count(), 16)


func test_character_loads_each_animal_with_named_parts() -> void:
	for animal: String in ChibiCharacter.ANIMALS:
		var character: ChibiCharacter = ChibiCharacter.new()
		add_child_autofree(character)
		character.set_animal(animal)
		assert_not_null(character.find_child("head", true, false), "%s has a head" % animal)
		assert_not_null(character.find_child("body", true, false), "%s has a body" % animal)


func test_every_accessory_builds_on_every_animal() -> void:
	for accessory: String in ["none", "party_hat", "headband", "bow", "crown", "top_hat", "flower", "glasses"]:
		var character: ChibiCharacter = ChibiCharacter.new()
		add_child_autofree(character)
		character.set_animal(ChibiCharacter.ANIMALS[0])
		character.set_accessory(accessory)
		if accessory != "none":
			assert_not_null(character.find_child("accessory_" + accessory, true, false), accessory)


func test_avatars_emotes_and_steals_do_not_break_seats() -> void:
	var players: Array = _players(3)
	players[1]["score"] = 900
	_stage.sync_players(players)
	_stage.set_avatar("p0", [{"c": 0, "w": 1, "p": [0, 0, 500, 500, 1000, 0]}])
	for emote: String in ["laugh", "wow", "love", "boo", "clap", "think", "taunt", "cry"]:
		_stage.show_emote("p0", emote)
	_stage.play_steal("p0", "p1", 300)
	_stage.play_steal("p2", "p0", 0)
	_stage.show_emote("nobody", "laugh")
	assert_eq(_stage.seat_count(), 3)
