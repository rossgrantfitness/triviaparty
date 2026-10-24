import { createWriteStream } from "node:fs";
import { networkInterfaces } from "node:os";
import { DEFAULT_SERVER_PORT, pickLanAddress } from "@trivia/shared";
import { startServer } from "./server";

// Options: --phone-dir=<folder> serves the built phone page (the packaged game does this).
// TRIVIA_LAN_ADDRESS overrides which network address the room code points to.
// --log-file=<path> also writes the log to a file (the packaged game has no console).
function arg(name: string): string | null {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
}
const phoneDir = arg("phone-dir");
// --parent-pid=<pid>: quit when that program (the TV game that started us) is gone.
const parentPid = Number(arg("parent-pid") ?? 0);
const logFile = arg("log-file");
if (logFile) {
  const out = createWriteStream(logFile, { flags: "w" });
  for (const level of ["log", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...items: unknown[]) => {
      out.write(`${new Date().toISOString()} ${items.map(String).join(" ")}\n`);
      original(...items);
    };
  }
}
const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);

/** Adapters that aren't the home Wi-Fi or Ethernet (virtual machines, WSL, Docker, VPNs). */
const VIRTUAL_ADAPTER = /virtual|vmware|vbox|vethernet|wsl|docker|hyper-v|loopback|tailscale|zerotier|vpn|utun|tun\d|tap\d|br-|veth/i;

function lanAddress(): string | null {
  if (process.env.TRIVIA_LAN_ADDRESS) return process.env.TRIVIA_LAN_ADDRESS;
  const preferred: string[] = [];
  const others: string[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      (VIRTUAL_ADAPTER.test(name) ? others : preferred).push(entry.address);
    }
  }
  return pickLanAddress(preferred) ?? pickLanAddress(others);
}

const lan = lanAddress();
const server = await startServer({ port, lanAddress: lan, phoneDir });
console.log(`Relay server listening on port ${server.port}`);
console.log(`  WebSocket: ws://localhost:${server.port}`);
console.log(`  Health:    http://localhost:${server.port}/health`);
if (phoneDir) console.log(`  Phones:    http://${lan ?? "localhost"}:${server.port}`);

function shutdown(): void {
  void server.close().then(() => process.exit(0));
}
if (parentPid > 0) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      console.log("The game closed; stopping the server.");
      shutdown();
    }
  }, 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
