class_name LocalServer
extends RefCounted
## Starts the relay server that ships next to the packaged game, so one
## double-click runs everything. Layout next to TriviaParty.exe:
##   server/node.exe (node on Mac/Linux), server/server.mjs, server/phone/ (the phone page)
## In the editor and in development (npm run dev) nothing is bundled, so this does nothing.

const SERVER_FOLDER: String = "server"

static var _pid: int = -1


## True while the bundled server this game started is running.
static func is_running() -> bool:
	return _pid > 0


## The folder holding the bundled server, or "" when there isn't one.
static func bundled_folder() -> String:
	if OS.has_feature("editor"):
		return ""
	var folder: String = OS.get_executable_path().get_base_dir().path_join(SERVER_FOLDER)
	return folder if FileAccess.file_exists(folder.path_join("server.mjs")) else ""


## Start the bundled server if there is one. Returns true if it was started.
## If another copy is already running on the port, the new one exits by itself
## and the game simply connects to the running one.
static func start() -> bool:
	var folder: String = bundled_folder()
	if folder.is_empty() or _pid > 0:
		return false
	var node: String = folder.path_join("node.exe" if OS.get_name() == "Windows" else "node")
	if not FileAccess.file_exists(node):
		push_warning("Bundled server found but no Node program at %s." % node)
		return false
	var args: PackedStringArray = [
		folder.path_join("server.mjs"),
		"--phone-dir=" + folder.path_join("phone"),
		"--log-file=" + OS.get_user_data_dir().path_join("server.log"),
		# The server quits by itself when this game closes, even after a crash.
		"--parent-pid=%d" % OS.get_process_id(),
	]
	_pid = OS.create_process(node, args, false)
	if _pid <= 0:
		push_warning("Could not start the game server (%s)." % node)
		return false
	print("[host] started the game server (process %d)" % _pid)
	return true


## Stop the server this game started (called when the game closes).
static func stop() -> void:
	if _pid > 0:
		OS.kill(_pid)
		_pid = -1
