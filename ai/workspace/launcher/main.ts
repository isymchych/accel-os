import { Type } from "typebox";
import { Value } from "typebox/value";

import { stateDirectory } from "./artifacts.ts";
import { WorkspaceSupervisor } from "./supervisor.ts";

// The source launcher sets the working directory to the workspace.
const source = process.cwd();
const state = stateDirectory(source);
try {
  const port = Number(process.env["WORKSPACE_PORT"] ?? "8787");
  Value.Assert(Type.Integer({ minimum: 1, maximum: 65535 }), port);

  const supervisor = await WorkspaceSupervisor.start({ source, state, port });
  console.log(`AI workspace listening on http://127.0.0.1:${supervisor.port}`);

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void supervisor.close().catch((error: unknown) => {
      console.error("Workspace shutdown failed.", error);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (error) {
  console.error("Workspace startup failed.", error);
  process.exitCode = 1;
}
