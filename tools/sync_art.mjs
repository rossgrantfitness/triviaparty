#!/usr/bin/env node
// Copies finished art from art/export/ into the places the game and phone page load it from.
//
//   npm run sync-art
//
//   art/export/<animal>/<animal>.glb           -> host/assets/characters/<animal>.glb
//   art/export/<animal>/<animal>_portrait.png  -> client/public/animals/<animal>.png
//   art/export/audio/sfx_*.wav                  -> host/assets/sfx/, client/public/sfx/
//
// Never deletes anything in art/.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exportDir = join(root, "art", "export");
const hostDir = join(root, "host", "assets", "characters");
const phoneDir = join(root, "client", "public", "animals");
mkdirSync(hostDir, { recursive: true });
mkdirSync(phoneDir, { recursive: true });

let copied = 0;
for (const entry of readdirSync(exportDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const name = entry.name;
  const glb = join(exportDir, name, `${name}.glb`);
  const portrait = join(exportDir, name, `${name}_portrait.png`);
  if (existsSync(glb)) {
    copyFileSync(glb, join(hostDir, `${name}.glb`));
    console.log(`model    ${name}.glb -> host/assets/characters/`);
    copied++;
  }
  if (existsSync(portrait)) {
    copyFileSync(portrait, join(phoneDir, `${name}.png`));
    console.log(`portrait ${name}_portrait.png -> client/public/animals/${name}.png`);
    copied++;
  }
}
// Sound effects: art/export/audio/sfx_*.wav -> host/assets/sfx/ and client/public/sfx/
const audioDir = join(exportDir, "audio");
if (existsSync(audioDir)) {
  const hostSfx = join(root, "host", "assets", "sfx");
  const phoneSfx = join(root, "client", "public", "sfx");
  mkdirSync(hostSfx, { recursive: true });
  mkdirSync(phoneSfx, { recursive: true });
  for (const file of readdirSync(audioDir).filter((f) => f.startsWith("sfx_") && f.endsWith(".wav"))) {
    copyFileSync(join(audioDir, file), join(hostSfx, file));
    copyFileSync(join(audioDir, file), join(phoneSfx, file));
    copied++;
  }
  console.log(`sounds   art/export/audio/sfx_*.wav -> host/assets/sfx/ and client/public/sfx/`);
}
console.log(copied ? `Copied ${copied} file(s).` : "Nothing to copy: art/export has no <name>/<name>.glb files yet.");
