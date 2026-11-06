import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

import { getErrorMessage } from "@accel-os/shared/guards";
import { parseJsonWithSchema } from "@accel-os/shared/json";
import { Type } from "typebox";

type Clipboard = {
  mime: string;
  bytes: Buffer;
  extension: string;
  text?: string;
};

type Action = {
  id: string;
  label: string;
  run(): void;
};

const PANEL_ID = "accel-os/clipboard-actions:actions";
const SNAPSHOT_SCHEMA = Type.Object(
  {
    mime: Type.String(),
    description: Type.String(),
    text: Type.Optional(Type.String()),
    imagePath: Type.Optional(Type.String()),
    truncated: Type.Boolean(),
    actions: Type.Array(Type.Object({ id: Type.String(), label: Type.String() })),
  },
  { additionalProperties: false },
);

const IMAGE_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/bmp", "bmp"],
  ["image/tiff", "tiff"],
  ["image/svg+xml", "svg"],
  ["image/avif", "avif"],
]);

function invoke(command: string, args: string[], input?: Buffer | string): Buffer;
function invoke(
  command: string,
  args: string[],
  input: Buffer | string | undefined,
  cancellation: "exit-1",
): Buffer | undefined;
function invoke(
  command: string,
  args: string[],
  input?: Buffer | string,
  cancellation?: "exit-1",
): Buffer | undefined {
  const result = spawnSync(command, args, {
    ...(input === undefined ? {} : { input }),
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status === 1 && cancellation === "exit-1") return undefined;
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.signal ?? result.status}): ${result.stderr.toString().trim()}`,
    );
  }
  return result.stdout;
}

function outputLine(bytes: Buffer | undefined): string | undefined {
  const line = bytes?.toString().replace(/\r?\n$/u, "");
  return line === "" ? undefined : line;
}

function captureClipboard(): Clipboard {
  const types = invoke("wl-paste", ["--list-types"]).toString().trim().split(/\r?\n/u);
  const image = [...IMAGE_EXTENSIONS.keys()].find((type) => types.includes(type));
  const textType =
    types.find((type) => /^text\/plain;\s*charset=utf-8$/iu.test(type)) ??
    types.find((type) => type === "text/plain" || type === "UTF8_STRING");
  const type = image ?? textType;
  if (type === undefined)
    throw new Error("Clipboard is empty or has no supported image/plain text.");

  return clipboardFromBytes(type, invoke("wl-paste", ["--no-newline", "--type", type]));
}

function clipboardFromBytes(mime: string, bytes: Buffer): Clipboard {
  if (bytes.length === 0) throw new Error("Clipboard is empty.");
  const extension = IMAGE_EXTENSIONS.get(mime);
  if (extension !== undefined) {
    return { mime, bytes, extension };
  }
  if (
    mime !== "text/plain" &&
    mime !== "UTF8_STRING" &&
    !/^text\/plain;\s*charset=utf-8$/iu.test(mime)
  ) {
    throw new Error("Unsupported clipboard MIME type.");
  }
  return {
    mime,
    bytes,
    extension: "txt",
    text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  };
}

function snapshotRoot(): string {
  return path.resolve(process.env["XDG_RUNTIME_DIR"] || tmpdir());
}

function snapshotExists(directory: string): boolean {
  // Internal CLI arguments must never turn cleanup into arbitrary recursive deletion.
  if (
    path.dirname(directory) !== snapshotRoot() ||
    !/^mb-clipboard-actions-[A-Za-z0-9]{6}$/u.test(path.basename(directory))
  ) {
    throw new Error("Invalid clipboard snapshot directory.");
  }
  const info = lstatSync(directory, { throwIfNoEntry: false });
  if (info === undefined) return false;
  const permissions = info.mode % 0o1000;
  if (!info.isDirectory() || info.uid !== process.getuid?.() || permissions !== 0o700) {
    throw new Error("Clipboard snapshot must be an owner-only directory.");
  }
  return true;
}

function discardSnapshot(directory: string): void {
  if (snapshotExists(directory)) rmSync(directory, { recursive: true, force: true });
}

function saveAs(clipboard: Clipboard): void {
  const destination = outputLine(
    invoke(
      "zenity",
      [
        "--file-selection",
        "--save",
        "--confirm-overwrite",
        "--title=Save clipboard",
        `--filename=${path.join(homedir(), `clipboard.${clipboard.extension}`)}`,
      ],
      undefined,
      "exit-1",
    ),
  );
  if (destination !== undefined) {
    writeFileSync(destination, clipboard.bytes, { mode: 0o600 });
  }
}

function parseWebUrl(text: string): URL | undefined {
  const candidate = text.trim();
  if (/\s/u.test(candidate)) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function actionsFor(clipboard: Clipboard, file: string): Action[] {
  const actions: Action[] = [];
  const text = clipboard.text;
  if (text === undefined) {
    actions.push({
      id: "annotate",
      label: "Annotate",
      run: () => {
        // Noctalia 5.4.1 loads the pixels before acknowledging this IPC request.
        invoke("noctalia", ["msg", "annotate", file]);
      },
    });
  } else {
    const url = parseWebUrl(text);
    if (url !== undefined) {
      const host = url.hostname.toLowerCase();
      if (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")) {
        actions.push({
          id: "download",
          label: "Download…",
          run: () => {
            const directory = outputLine(
              invoke(
                "zenity",
                [
                  "--file-selection",
                  "--directory",
                  "--title=Download destination",
                  `--filename=${homedir()}/`,
                ],
                undefined,
                "exit-1",
              ),
            );
            if (directory !== undefined) {
              invoke("xterm", ["run", "--cwd", directory, "--", "mb-ydl", url.href]);
            }
          },
        });
      }
      actions.push({
        id: "browse",
        label: "Open in browser",
        run: () => {
          invoke("xdg-open", [url.href]);
        },
      });
    }
    let isJson = false;
    try {
      // Any JSON value is eligible; formatting below uses the original bytes,
      // not JS numbers, so large integers and precise decimals are not rounded.
      parseJsonWithSchema(text, Type.Unknown(), "Clipboard JSON");
      isJson = true;
    } catch {
      // Ordinary text is not JSON; it still gets the generic text actions.
    }
    if (isJson) {
      actions.push({
        id: "format-json",
        label: "Pretty-print → clipboard",
        run: () => {
          const json = invoke("jq", ["--indent", "2", "."], clipboard.bytes);
          invoke("wl-copy", ["--type", "text/plain"], json);
        },
      });
    }
    actions.push({
      id: "edit",
      label: "Open in editor",
      run: () => {
        // The configured xterm/kitty backend waits until nvim exits.
        invoke("xterm", ["run", "--", "nvim", "--", file]);
      },
    });
  }
  actions.push({ id: "save", label: "Save as…", run: () => saveAs(clipboard) });
  return actions;
}

function openPanel(): void {
  const clipboard = captureClipboard();
  const directory = mkdtempSync(path.join(snapshotRoot(), "mb-clipboard-actions-"));
  try {
    const file = path.join(directory, `clipboard.${clipboard.extension}`);
    writeFileSync(file, clipboard.bytes, { mode: 0o600 });
    const preview = clipboard.text?.slice(0, 4096).toWellFormed();
    const snapshot = {
      mime: clipboard.mime,
      description: `${clipboard.mime} · ${clipboard.bytes.length.toLocaleString("en-US")} bytes`,
      ...(preview === undefined ? { imagePath: file } : { text: preview }),
      truncated: clipboard.text !== undefined && clipboard.text.length > 4096,
      actions: actionsFor(clipboard, file).map(({ id, label }) => ({ id, label })),
    };
    writeFileSync(path.join(directory, "snapshot.json"), JSON.stringify(snapshot), { mode: 0o600 });
    invoke("noctalia", ["msg", "panel-open", PANEL_ID, directory]);
    // The panel now owns the snapshot, until it closes or hands it to `run`.
  } catch (error) {
    discardSnapshot(directory);
    throw error;
  }
}

function runAction(directory: string, id: string): void {
  if (!snapshotExists(directory)) throw new Error("Clipboard snapshot no longer exists.");
  try {
    const snapshot = parseJsonWithSchema(
      readFileSync(path.join(directory, "snapshot.json"), "utf8"),
      SNAPSHOT_SCHEMA,
      "Clipboard snapshot",
    );
    const extension = IMAGE_EXTENSIONS.get(snapshot.mime) ?? "txt";
    const file = path.join(directory, `clipboard.${extension}`);
    const clipboard = clipboardFromBytes(snapshot.mime, readFileSync(file));
    const action = actionsFor(clipboard, file).find((entry) => entry.id === id);
    if (action === undefined) throw new Error("Select one of the offered clipboard actions.");
    action.run();
  } finally {
    discardSnapshot(directory);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    openPanel();
  } else if (args.length === 3 && args[0] === "run") {
    runAction(args[1] ?? "", args[2] ?? "");
  } else if (args.length === 2 && args[0] === "discard") {
    discardSnapshot(args[1] ?? "");
  } else {
    throw new Error("Usage: mb-clipboard-actions");
  }
}

try {
  main();
} catch (error) {
  const message = getErrorMessage(error);
  console.error(message);
  spawnSync("notify-send", [
    "--app-name=Clipboard actions",
    "--",
    "Clipboard action failed",
    message,
  ]);
  process.exitCode = 1;
}
