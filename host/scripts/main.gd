extends Control
## Phase 0 placeholder screen: shows whether the host can reach the server.

@onready var _status_label: Label = %StatusLabel


func _ready() -> void:
	Server.state_changed.connect(_on_server_state_changed)
	_on_server_state_changed(Server.state, "")


func _on_server_state_changed(state: ServerConnection.State, detail: String) -> void:
	_status_label.text = ServerConnection.status_text(state, detail)
	print("[host] ", _status_label.text)
	match state:
		ServerConnection.State.CONNECTED:
			_status_label.modulate = Color("6ee7a8")
		ServerConnection.State.CONNECTING:
			_status_label.modulate = Color("ffd166")
		_:
			_status_label.modulate = Color("ff7a8a")
