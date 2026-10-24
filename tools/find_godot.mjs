// Finds the Godot program (shared by run_host.mjs and build_windows.mjs).
// Order: the GODOT environment variable, a path in .godot-path at the repo root
// (one line, not committed), godot / godot4 on PATH, then common install locations.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function onPath(command) {
  const finder = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(finder, [command], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).find((line) => line.trim()) ?? null;
}

/** Godot executables inside a folder, newest version first (console builds first on Windows). */
function godotsIn(dir) {
  if (!existsSync(dir)) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && /godot/i.test(entry.name)) {
      found.push(...godotsIn(full));
    } else if (/^godot.*\.exe$/i.test(entry.name)) {
      found.push(full);
    } else if (/^godot_v4.*(x86_64|arm64)$/i.test(entry.name)) {
      found.push(full);
    }
  }
  return found.sort((a, b) => {
    const consoleFirst = Number(/console/i.test(b)) - Number(/console/i.test(a));
    return consoleFirst || b.localeCompare(a, undefined, { numeric: true });
  });
}

export function findGodot() {
  if (process.env.GODOT && existsSync(process.env.GODOT)) return process.env.GODOT;

  const pathFile = join(repoRoot, ".godot-path");
  if (existsSync(pathFile)) {
    const fromFile = readFileSync(pathFile, "utf8").trim().replace(/^"|"$/g, "");
    if (fromFile && existsSync(fromFile)) return fromFile;
    console.warn(`.godot-path points to "${fromFile}", which does not exist.`);
  }

  for (const command of ["godot", "godot4", "Godot"]) {
    const found = onPath(command);
    if (found) return found;
  }

  const home = homedir();
  const candidates = [
    "/Applications/Godot.app/Contents/MacOS/Godot",
    join(home, "Applications/Godot.app/Contents/MacOS/Godot"),
  ];
  const searchDirs = [
    join(home, "Godot"),
    join(home, "Desktop"),
    join(home, "Downloads"),
    join(home, "AppData", "Local", "Programs"),
    "C:\\Godot",
    "C:\\Program Files",
    "C:\\Program Files\\Godot",
    join(home, ".local", "bin"),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  for (const dir of searchDirs) {
    const [first] = godotsIn(dir);
    if (first) return first;
  }
  return null;
}
