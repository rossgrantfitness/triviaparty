#!/usr/bin/env node
// Finds Godot and runs the host project.
//
//   npm run host                 open the host game window
//   npm run host -- --editor     open the project in the Godot editor
//   npm run test:host            run the GUT tests headless
//
// Godot is found by, in order: the GODOT environment variable, a path written
// in the file .godot-path at the repo root (one line, not committed), the
// commands godot / godot4 on PATH, then common install locations.

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findGodot } from "./find_godot.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostDir = join(repoRoot, "host");
const args = process.argv.slice(2);
const testMode = args.includes("--test");
const editorMode = args.includes("--editor");
const passThrough = args.filter((a) => a !== "--test" && a !== "--editor");

function run(godot, godotArgs) {
  const result = spawnSync(godot, godotArgs, { stdio: "inherit" });
  if (result.error) {
    console.error(`Could not start Godot at ${godot}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

/** On Windows, show a normal "open file" window so you can point at Godot once. */
function askForGodot() {
  if (process.platform !== "win32" || testMode) return null;
  console.log("Couldn't find Godot by itself. A window will open: pick your Godot program (Godot_v4...exe).");
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$d = New-Object System.Windows.Forms.OpenFileDialog",
    "$d.Title = 'Find your Godot program (Godot_v4...exe)'",
    "$d.Filter = 'Godot program|Godot*.exe|Any program|*.exe'",
    "$d.InitialDirectory = [Environment]::GetFolderPath('UserProfile')",
    "if ($d.ShowDialog() -eq 'OK') { $d.FileName }",
  ].join("; ");
  const result = spawnSync("powershell", ["-NoProfile", "-STA", "-Command", script], { encoding: "utf8" });
  const picked = (result.stdout ?? "").trim();
  if (!picked || !existsSync(picked)) return null;
  // Remember it so you never have to pick again.
  writeFileSync(join(repoRoot, ".godot-path"), picked + "\n");
  console.log(`Saved. Using Godot at ${picked}`);
  return picked;
}

const godot = findGodot() ?? askForGodot();
if (!godot) {
  console.log(
    [
      "",
      "Godot was not found, so the host window was not opened.",
      "The server and phone page still work without it.",
      "",
      "To fix: create a file named .godot-path in the trivia-party folder containing",
      "the full path to your Godot program, for example:",
      "  C:\\Users\\you\\Godot\\Godot_v4.7.2-stable_win64.exe",
      "  /Applications/Godot.app/Contents/MacOS/Godot",
      "",
    ].join("\n"),
  );
  process.exit(testMode ? 1 : 0);
}

console.log(`Using Godot: ${godot}`);

if (testMode) {
  // Import first so class names and resources are registered, then run GUT.
  const importStatus = run(godot, ["--headless", "--path", hostDir, "--import"]);
  if (importStatus !== 0) process.exit(importStatus);
  process.exit(run(godot, ["--headless", "--path", hostDir, "-s", "res://addons/gut/gut_cmdln.gd", "-gexit", ...passThrough]));
}

// First run on this computer: let Godot import the models, fonts and icons before
// starting the game, otherwise it can't load them.
if (!editorMode && !existsSync(join(hostDir, ".godot", "imported"))) {
  console.log("First run: importing art into Godot (one time only)…");
  run(godot, ["--headless", "--path", hostDir, "--import"]);
}

const modeArgs = editorMode ? ["--editor"] : [];
process.exit(run(godot, ["--path", hostDir, ...modeArgs, ...passThrough]));
