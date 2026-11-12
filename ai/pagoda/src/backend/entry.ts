import { realpath } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { startBackend, type Backend } from "./server.ts";

const { values } = parseArgs({
  options: {
    cwd: { type: "string" },
    port: { type: "string", default: "4317" },
    dev: { type: "boolean", default: false },
  },
});
const accelOs = process.env["ACCEL_OS"];
if (!accelOs) throw new Error("ACCEL_OS must identify the existing Pi configuration");
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid backend port");
const cwd = await realpath(values.cwd ?? process.env["AI_CWD"] ?? process.cwd());
const agentDir = path.join(accelOs, "ai/pi");
const sessionDir = path.join(agentDir, "sessions");
const shutdown = new AbortController();
let backend: Backend | undefined;
let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  shutdown.abort();
  void backend
    ?.close()
    .catch((error: unknown) => {
      console.error("Backend shutdown failed:", error);
      process.exitCode = 1;
    })
    .finally(() => {
      if (process.connected) process.disconnect();
    });
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("disconnect", stop);
backend = await startBackend({
  pi: {
    cwd,
    agentDir,
    // The workspace replaces this with its selected profile before acquisition.
    profileDir: agentDir,
    sessionDir,
    sharedDir: path.join(accelOs, "ai"),
  },
  port,
  stateFile: path.join(accelOs, "ai/pi/pagoda-state.json"),
  settingsFile: path.join(accelOs, "ai/pi/pagoda-settings.json"),
  accountConfigDir: path.join(accelOs, "ai/pi"),
  signal: shutdown.signal,
  ...(values.dev
    ? { developmentOrigin: "http://127.0.0.1:5173" as const }
    : { clientDirectory: path.resolve(import.meta.dirname, "../../client") }),
});
// This fragment is a local connection credential. Never put it in HTTP paths,
// query strings, analytics, or application logs. It is printed only for the user.
if (process.send) {
  process.send({ type: "ready", url: backend.connectionUrl });
} else {
  console.log(`Pagoda connection URL: ${backend.connectionUrl}`);
  console.log("Keep this terminal open. Stop it to end active Pi work.");
}
