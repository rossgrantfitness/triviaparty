// Builds the double-click Windows game: build/TriviaParty-Windows/ and a zip of it in
// docs/download/ (the website's download button).
//
//   node tools/build_windows.mjs            (or: npm run build:windows)
//
// Needs Godot 4.7 with the 4.7 export templates installed (Editor → Manage Export
// Templates), found the same way as `npm run host`. Downloads Node for Windows once
// into build/cache/.
//
// The folder it makes:
//   TriviaParty.exe, TriviaParty.pck   the TV game
//   content/                           question packs and drawing prompts (editable)
//   server/node.exe, server.mjs        the game server, started by TriviaParty.exe
//   server/phone/                      the phone page the server hands to phones
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { findGodot } from "./find_godot.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NODE_VERSION = "22.22.0";
const out = join(root, "build", "TriviaParty-Windows");
const cache = join(root, "build", "cache");
const zipPath = join(root, "docs", "download", "TriviaParty-Windows.zip");

function run(cmd, args, options = {}) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", cwd: root, ...options });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "server"), { recursive: true });
mkdirSync(cache, { recursive: true });

// 1. Phone page.
run("npm", ["run", "build", "--workspace", "client"], { shell: process.platform === "win32" });
cpSync(join(root, "client", "dist"), join(out, "server", "phone"), { recursive: true });

// 2. Server, bundled into one file.
await build({
  entryPoints: [join(root, "server", "src", "index.ts")],
  outfile: join(out, "server", "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // ws loads these speed-ups if present; it works fine without them.
  external: ["bufferutil", "utf-8-validate"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});

// 3. Node for Windows, to run the server.
const nodeZip = join(cache, `node-v${NODE_VERSION}-win-x64.zip`);
if (!existsSync(nodeZip)) {
  run("curl", ["-fL", "-o", nodeZip, `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`]);
}
run("unzip", ["-o", "-j", nodeZip, `node-v${NODE_VERSION}-win-x64/node.exe`, `node-v${NODE_VERSION}-win-x64/LICENSE`, "-d", join(out, "server")]);

// 4. Content.
cpSync(join(root, "content"), join(out, "content"), { recursive: true });

// 5. The TV game.
const godot = findGodot();
if (!godot) throw new Error("Godot not found (set GODOT or .godot-path).");
const host = join(root, "host");
run(godot, ["--headless", "--path", host, "--import"]);
run(godot, ["--headless", "--path", host, "--export-release", "Windows Desktop", join(out, "TriviaParty.exe")]);
if (!existsSync(join(out, "TriviaParty.exe")) || !existsSync(join(out, "TriviaParty.pck"))) {
  throw new Error("Godot export failed; is the Windows export template for this Godot version installed?");
}

cpSync(join(root, "licenses.md"), join(out, "licenses.md"));
cpSync(join(root, "host", "assets", "fonts", "OFL.txt"), join(out, "OFL.txt"));

// 6. Zip for the website.
mkdirSync(dirname(zipPath), { recursive: true });
rmSync(zipPath, { force: true });
run("zip", ["-r", "-9", "-q", zipPath, "TriviaParty-Windows"], { cwd: join(root, "build") });
const mb = (readFileSync(zipPath).length / 1e6).toFixed(1);
console.log(`\nBuilt ${out}\nZipped ${zipPath} (${mb} MB)`);
