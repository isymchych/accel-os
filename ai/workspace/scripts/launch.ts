import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    dev: { type: "boolean", default: false },
    cwd: { type: "string" },
    "profile-dir": { type: "string" },
    "code-navigation": { type: "string" },
  },
});
const source = path.resolve(import.meta.dirname, "..");
try {
  await access(path.join(source, "dist/main/electron/entry.js"));
} catch {
  throw new Error('Build the desktop app first: pnpm --dir "$ACCEL_OS/ai/workspace" run build');
}
const executable: unknown = createRequire(import.meta.url)("electron");
if (typeof executable !== "string") throw new Error("Could not locate the Electron binary");
const server = values.dev
  ? await (
      await import("vite")
    ).createServer({
      configFile: path.join(source, "vite.config.ts"),
    })
  : undefined;
try {
  const args = [
    source,
    "--node",
    process.execPath,
    "--cwd",
    values.cwd ?? process.env["AI_CWD"] ?? process.cwd(),
  ];
  for (const name of ["profile-dir", "code-navigation"] as const) {
    const value = values[name];
    if (value !== undefined) args.push(`--${name}`, value);
  }
  if (server) {
    await server.listen();
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error("Vite did not expose a loopback development URL");
    args.push("--dev-url", url);
    console.log(
      "Renderer updates are live. Restart this command after main/preload/Pi integration edits.",
    );
  }
  const env = {
    ...process.env,
    ACCEL_OS: process.env["ACCEL_OS"] ?? path.resolve(source, "../.."),
  };
  Reflect.deleteProperty(env, "ELECTRON_RUN_AS_NODE");
  const child = spawn(executable, args, { cwd: source, env, stdio: "inherit" });
  const terminate = (): void => {
    child.kill("SIGTERM");
  };
  process.once("SIGINT", terminate);
  process.once("SIGTERM", terminate);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`Electron exited (${signal ?? code ?? "unknown"})`));
      });
    });
  } finally {
    process.removeListener("SIGINT", terminate);
    process.removeListener("SIGTERM", terminate);
  }
} finally {
  await server?.close();
}
