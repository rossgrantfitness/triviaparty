import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  encodeMessage,
  parseClientMessage,
  type ClientRole,
  type ServerMessage,
} from "@trivia/shared";

export interface ServerOptions {
  /** Port to listen on. 0 picks a free port (used by tests). */
  port: number;
  /** Silence connection logs (used by tests). */
  quiet?: boolean;
}

export interface RunningServer {
  port: number;
  /** Number of clients that have completed the hello handshake. */
  connectionCount(): number;
  close(): Promise<void>;
}

interface Connection {
  id: string;
  role: ClientRole;
}

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const log = options.quiet ? () => {} : (msg: string) => console.log(msg);
  const connections = new Map<WebSocket, Connection>();

  const http: Server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, protocolVersion: PROTOCOL_VERSION, connections: connections.size }));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });

  const wss = new WebSocketServer({ server: http });

  wss.on("connection", (socket) => {
    const send = (message: ServerMessage) => socket.send(encodeMessage(message));

    socket.on("message", (data) => {
      const result = parseClientMessage(data.toString());
      if (!result.ok) {
        send({ type: "error", code: "bad_message", message: result.error });
        return;
      }
      const message = result.message;
      switch (message.type) {
        case "hello": {
          if (message.protocolVersion !== PROTOCOL_VERSION) {
            send({
              type: "error",
              code: "protocol_mismatch",
              message: `server speaks protocol ${PROTOCOL_VERSION}, client sent ${message.protocolVersion}`,
            });
            return;
          }
          const existing = connections.get(socket);
          const connection: Connection = { id: existing?.id ?? randomUUID(), role: message.role };
          connections.set(socket, connection);
          log(`[connect] ${connection.role} ${connection.id.slice(0, 8)} (${connections.size} connected)`);
          send({ type: "welcome", connectionId: connection.id, role: connection.role, protocolVersion: PROTOCOL_VERSION });
          break;
        }
      }
    });

    socket.on("close", () => {
      const connection = connections.get(socket);
      if (!connection) return;
      connections.delete(socket);
      log(`[disconnect] ${connection.role} ${connection.id.slice(0, 8)} (${connections.size} connected)`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, () => resolve());
  });

  return {
    port: (http.address() as AddressInfo).port,
    connectionCount: () => connections.size,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
