#!/bin/bash
# Double-click this file to play Trivia Party on a Mac.
# It installs what's needed the first time, then starts the server,
# the phone page and the Godot game window. Close this window to stop.
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed yet."
  echo "  Download the LTS version from https://nodejs.org, install it, then double-click start_game again."
  open https://nodejs.org/
  read -r -p "Press Enter to close."
  exit 1
fi

echo "  Getting things ready (the first time takes a minute)..."
if ! npm install --no-audit --no-fund --loglevel=error; then
  echo "  Setup failed. Take a screenshot of this window and send it to Claude."
  read -r -p "Press Enter to close."
  exit 1
fi

echo "  Starting the game. Keep this window open while you play; close it to stop."
(sleep 8; open http://localhost:5173) &
npm run dev
