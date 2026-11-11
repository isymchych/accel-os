import { spawn } from "node:child_process";
import path from "node:path";

const linux = process.platform === "linux";
const env = { ...process.env };
if (linux) delete env["WAYLAND_DISPLAY"];
const args = ["exec", "playwright", "test", ...process.argv.slice(2)];
const child = spawn(
  linux ? "xvfb-run" : "pnpm",
  linux ? ["-a", "-s", "-screen 0 1280x900x24", "pnpm", ...args] : args,
  { cwd: path.resolve(import.meta.dirname, ".."), env, stdio: "inherit" },
);
const terminate = (signal: NodeJS.Signals): void => {
  child.kill(signal);
};
process.once("SIGINT", terminate);
process.once("SIGTERM", terminate);
try {
  await new Promise<void>((resolve, reject) => {
    child.once("error", (error) => {
      reject(
        new Error(
          linux
            ? "Could not start xvfb-run. Install xorg-server-xvfb on Arch Linux."
            : "Could not start pnpm.",
          { cause: error },
        ),
      );
    });
    child.once("exit", (code, signal) => {
      process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
      resolve();
    });
  });
} finally {
  process.removeListener("SIGINT", terminate);
  process.removeListener("SIGTERM", terminate);
}
