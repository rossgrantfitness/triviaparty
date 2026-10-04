import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SERVER_PORT } from "@trivia/shared";
import { ServerConnection, resolveServerUrl, statusText, type ConnectionState } from "../../client/src/connection";
import { startServer, type RunningServer } from "../../server/src/server";

describe("resolveServerUrl", () => {
  const page = { hostname: "192.168.1.20", protocol: "http:", search: "" };

  it("defaults to the machine that served the page", () => {
    expect(resolveServerUrl(page)).toBe(`ws://192.168.1.20:${DEFAULT_SERVER_PORT}`);
  });

  it("uses wss on https pages", () => {
    expect(resolveServerUrl({ ...page, protocol: "https:" })).toBe(`wss://192.168.1.20:${DEFAULT_SERVER_PORT}`);
  });

  it("prefers the build setting over the default", () => {
    expect(resolveServerUrl(page, "wss://relay.example.com")).toBe("wss://relay.example.com");
  });

  it("prefers ?server= over everything", () => {
    expect(resolveServerUrl({ ...page, search: "?server=ws://10.0.0.5:9000" }, "wss://relay.example.com")).toBe(
      "ws://10.0.0.5:9000",
    );
  });
});

describe("statusText", () => {
  it("says connected to server once welcomed", () => {
    expect(statusText("connected")).toBe("Connected to server");
  });
});

describe("ServerConnection (against a real server)", () => {
  let server: RunningServer | null = null;
  let connection: ServerConnection | null = null;

  afterEach(async () => {
    connection?.stop();
    await server?.close();
    server = null;
  });

  function waitForState(states: ConnectionState[], wanted: ConnectionState): Promise<void> {
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (states.includes(wanted)) {
          clearInterval(timer);
          resolve();
        }
      }, 10);
    });
  }

  it("reaches connected, then reconnects after the server restarts", async () => {
    server = await startServer({ port: 0, quiet: true });
    const port = server.port;
    const states: ConnectionState[] = [];
    connection = new ServerConnection(`ws://localhost:${port}`, { onState: (s) => states.push(s) }, 50);
    connection.start();

    await waitForState(states, "connected");
    expect(states).toEqual(["connecting", "connected"]);

    await server.close();
    await waitForState(states, "disconnected");

    states.length = 0;
    server = await startServer({ port, quiet: true });
    await waitForState(states, "connected");
    expect(states.at(-1)).toBe("connected");
  });
});
