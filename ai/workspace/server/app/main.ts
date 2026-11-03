import { ReloadClient } from "./reload-client.ts";
import { startWorkspaceServer, type StartedWorkspaceServer } from "./server.ts";

const control = new ReloadClient();
let server: StartedWorkspaceServer | undefined;
let closing = false;

async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  try {
    await server?.close();
  } finally {
    if (process.connected) process.disconnect();
  }
}

process.on("message", (message: unknown) => {
  if (
    typeof message !== "object" ||
    message === null ||
    !("kind" in message) ||
    message.kind !== "listen" ||
    server !== undefined
  )
    return;
  try {
    server = startWorkspaceServer({ control, port: Number(process.env["WORKSPACE_PORT"]) });
    void server.ready
      .then(({ port }) => {
        process.send?.({ kind: "listening", port });
      })
      .catch((error: unknown) => {
        console.error("API child failed to listen.", error);
        process.exitCode = 1;
        void shutdown();
      });
  } catch (error) {
    console.error("API child failed to start.", error);
    process.exitCode = 1;
    void shutdown();
  }
});
process.once("SIGTERM", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown();
});
process.once("disconnect", () => {
  void shutdown();
});
process.send?.({ kind: "prepared" });
