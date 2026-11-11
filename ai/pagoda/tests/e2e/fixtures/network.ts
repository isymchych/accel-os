import { once } from "node:events";
import { createServer, request } from "node:http";

interface Network {
  origin: string;
  disconnect(): void;
  reconnect(): void;
  close(): Promise<void>;
}

/** A real local socket fault, without mocking the application API or SSE payloads. */
export async function createNetwork(upstreamOrigin: string): Promise<Network> {
  let offline = false;
  let origin = "";
  const target = new URL(upstreamOrigin);
  const server = createServer((incoming, outgoing) => {
    if (offline) {
      outgoing.writeHead(503).end();
      return;
    }
    const headers = { ...incoming.headers, host: target.host };
    if (headers.origin === origin) headers.origin = upstreamOrigin;
    const upstream = request(
      new URL(incoming.url ?? "/", upstreamOrigin),
      { method: incoming.method, headers },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on("error", () => {
      outgoing.destroy();
    });
    outgoing.on("close", () => {
      upstream.destroy();
    });
    incoming.pipe(upstream);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing proxy address");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    disconnect: () => {
      offline = true;
      server.closeAllConnections();
    },
    reconnect: () => {
      offline = false;
    },
    close: async () => {
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      server.closeAllConnections();
      await closed;
    },
  };
}
