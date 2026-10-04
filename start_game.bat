@echo off
rem Double-click this file to play Trivia Party on Windows.
rem It installs what's needed the first time, then starts the server,
rem the phone page and the Godot game window. Close this window to stop.
title Trivia Party
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed yet.
  echo  Your browser will open the Node.js website: download the "LTS" version,
  echo  install it with all the default options, then double-click start_game again.
  echo.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

echo.
echo  Getting things ready (the first time takes a minute)...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo.
  echo  Setup failed. Take a screenshot of this window and send it to Claude.
  pause
  exit /b 1
)

echo.
echo  Starting the game. Keep this window open while you play.
echo  To stop everything, close this window.
echo.
rem Open the phone page on this PC too, so you can see it working.
start "" /min cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:5173"
call npm run dev
echo.
pause
