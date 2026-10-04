import { DEFAULT_SERVER_PORT } from "@trivia/shared";
import { startServer } from "./server";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);

const server = await startServer({ port });
console.log(`Relay server listening on port ${server.port}`);
console.log(`  WebSocket: ws://localhost:${server.port}`);
console.log(`  Health:    http://localhost:${server.port}/health`);

function shutdown(): void {
  void server.close().then(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
