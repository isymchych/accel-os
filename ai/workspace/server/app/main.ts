import { startWorkspaceServer } from "./server.ts";

try {
  const workspaceServer = startWorkspaceServer();

  void workspaceServer.ready
    .then(({ address, port }) => {
      console.log(`AI workspace listening on http://${address}:${port}`);
    })
    .catch((error: unknown) => {
      console.error(`AI workspace failed to start: ${formatError(error)}`);
      process.exitCode = 1;
    });

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    void workspaceServer.close().catch((error: unknown) => {
      console.error(`AI workspace failed to shut down cleanly: ${formatError(error)}`);
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (error) {
  console.error(`AI workspace failed to start: ${formatError(error)}`);
  process.exitCode = 1;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
