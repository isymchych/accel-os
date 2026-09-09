import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  actionForExitCode,
  extensionForMime,
  parseHistoryList,
  parseSelection,
  serializeMenuRow,
} from "./mb-clipboard.ts";

const SCRIPT_PATH = fileURLToPath(new URL("./mb-clipboard.ts", import.meta.url));

test("actionForExitCode preserves fuzzel custom actions", () => {
  assert.equal(actionForExitCode(0), "copy");
  assert.equal(actionForExitCode(10), "save");
  assert.equal(actionForExitCode(11), "delete");
  assert.equal(actionForExitCode(12), "next-mode");
  assert.equal(actionForExitCode(13), "previous-mode");
  assert.equal(actionForExitCode(1), null);
  assert.equal(actionForExitCode(null), null);
});

test("serializeMenuRow emits fuzzel text and icon metadata exactly", () => {
  assert.equal(serializeMenuRow("h:42", "hello"), "h:42\thello\n");
  assert.equal(
    serializeMenuRow("h:7", "image", "/cache/7.svg"),
    "h:7\timage\0icon\x1f/cache/7.svg\n",
  );
});

test("parseHistoryList validates IDs and detects image previews case-insensitively", () => {
  assert.deepEqual(
    parseHistoryList(
      [
        "12\thello\tworld",
        "invalid\tignored",
        "13\tBINARY DATA payload",
        "14\tBiNaRy image/PNG data",
        "missing separator",
      ].join("\n"),
    ),
    [
      {
        id: "12",
        preview: "hello world",
        imageExtension: null,
      },
      {
        id: "13",
        preview: "BINARY DATA payload",
        imageExtension: null,
      },
      {
        id: "14",
        preview: "BiNaRy image/PNG data",
        imageExtension: "png",
      },
    ],
  );
});

test("parseSelection accepts only valid current menu tokens", () => {
  const templates = ["/templates/first", "/templates/second"];
  const emojis = ["😀", "👍"];

  assert.deepEqual(parseSelection("h:42", templates, emojis), { kind: "history", id: "42" });
  assert.deepEqual(parseSelection("t:1", templates, emojis), {
    kind: "template",
    path: "/templates/second",
  });
  assert.deepEqual(parseSelection("e:1", templates, emojis), { kind: "emoji", value: "👍" });
  assert.equal(parseSelection("t:2", templates, emojis), null);
  assert.equal(parseSelection("e:2", templates, emojis), null);
  assert.equal(parseSelection("t:-1", templates, emojis), null);
  assert.equal(parseSelection("t:9007199254740992", templates, emojis), null);
  assert.equal(parseSelection("h:not-an-id", templates, emojis), null);
  assert.equal(parseSelection("other:1", templates, emojis), null);
});

test("extensionForMime uses canonical mappings and binary fallback", () => {
  assert.equal(extensionForMime("text/plain"), "txt");
  assert.equal(extensionForMime("application/xml"), "xml");
  assert.equal(extensionForMime("image/jpeg"), "jpg");
  assert.equal(extensionForMime("application/unknown"), "bin");
});

test("templates are read directly from the repository", async () => {
  const fixture = await createFixture();
  try {
    const templatesDir = fileURLToPath(
      new URL("../assets/mb-clipboard/templates/", import.meta.url),
    );
    const templateNames = (await readdir(templatesDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
    const templateName = "task-template.md";
    const templateIndex = templateNames.indexOf(templateName);
    assert.notEqual(templateIndex, -1);
    const templatePath = path.join(templatesDir, templateName);
    const template = await readFile(templatePath);

    const result = await runClipboard({
      ...fixture.env,
      FUZZEL_SELECTION: `t:${templateIndex}`,
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      await readFile(fixture.menuCapture, "utf8"),
      templateNames.map((name, index) => `t:${index}\t${name}\n`).join(""),
    );
    assert.deepEqual(await readFile(fixture.copyCapture), template);
  } finally {
    await fixture.cleanup();
  }
});

test("history copy streams exact binary bytes through cliphist and wl-copy", async () => {
  const fixture = await createFixture();
  try {
    const payload = Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xff, 0x0a, 0x41]);
    await writeFile(fixture.decodeFile, payload);
    await writeFile(fixture.historyFile, "42\tHello world\n");

    const result = await runClipboard(fixture.env);

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(await readFile(fixture.copyCapture), payload);
    assert.equal(await readFile(fixture.menuCapture, "utf8"), "h:42\tHello world\n");
  } finally {
    await fixture.cleanup();
  }
});

test("copy exits unsuccessfully when wl-copy fails", async () => {
  const fixture = await createFixture({ WL_COPY_CODE: "7" });
  try {
    await writeFile(fixture.decodeFile, "payload");
    await writeFile(fixture.historyFile, "42\tHello world\n");

    const result = await runClipboard(fixture.env);

    assert.equal(result.code, 1);
  } finally {
    await fixture.cleanup();
  }
});

test("save keeps the selected token from fuzzel custom exit 10", async () => {
  const fixture = await createFixture({ FUZZEL_CODE: "10" });
  try {
    const payload = Buffer.from([0x00, 0xff, 0x41]);
    await writeFile(fixture.decodeFile, payload);
    await writeFile(fixture.historyFile, "42\tHello world\n");

    const result = await runClipboard(fixture.env);

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(await readFile(fixture.saveDestination), payload);
    assert.equal(
      await readFile(path.join(fixture.cacheHome, "mb-clipboard", "last-save-dir"), "utf8"),
      `${path.dirname(fixture.saveDestination)}\n`,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("image menu generation creates escaped reusable previews and removes stale thumbnails", async () => {
  const fixture = await createFixture({
    FUZZEL_CODE: "1",
    XDG_CACHE_HOME_NAME: 'cache&"quoted',
  });
  try {
    await writeFile(fixture.decodeFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(fixture.historyFile, "7\tBiNaRy image/PNG data\n");
    const thumbnailDir = path.join(fixture.cacheHome, "mb-clipboard", "thumbnails");
    await mkdir(thumbnailDir, { recursive: true });
    await writeFile(path.join(thumbnailDir, "999.png"), "stale");

    const firstRun = await runClipboard(fixture.env);
    assert.equal(firstRun.code, 0, firstRun.stderr);

    const thumbnail = path.join(thumbnailDir, "7.png");
    const previewIcon = path.join(thumbnailDir, "7.svg");
    assert.deepEqual(await readFile(thumbnail), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await assert.rejects(readFile(path.join(thumbnailDir, "999.png")), { code: "ENOENT" });

    const svg = await readFile(previewIcon, "utf8");
    assert.match(svg, /cache&amp;&quot;quoted/u);
    const menu = await readFile(fixture.menuCapture);
    assert.ok(menu.includes(Buffer.from(`h:7\tBiNaRy image/PNG data\0icon\x1f${previewIcon}\n`)));

    const secondRun = await runClipboard({ ...fixture.env, DECODE_FAIL: "1" });
    assert.equal(secondRun.code, 0, secondRun.stderr);
    assert.deepEqual(await readFile(thumbnail), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  } finally {
    await fixture.cleanup();
  }
});

type Fixture = {
  root: string;
  cacheHome: string;
  historyFile: string;
  decodeFile: string;
  menuCapture: string;
  copyCapture: string;
  saveDestination: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
};

async function createFixture(overrides: Readonly<Record<string, string>> = {}): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "mb-clipboard-test-"));
  const binDir = path.join(root, "bin");
  const home = path.join(root, "home");
  const configHome = path.join(home, ".config");
  const cacheHome = path.join(root, overrides["XDG_CACHE_HOME_NAME"] ?? "cache");
  const historyFile = path.join(root, "history");
  const decodeFile = path.join(root, "decode");
  const menuCapture = path.join(root, "menu");
  const copyCapture = path.join(root, "copied");
  const saveDestination = path.join(home, "Downloads", "saved.bin");

  await Promise.all([
    mkdir(binDir, { recursive: true }),
    mkdir(path.dirname(saveDestination), { recursive: true }),
  ]);

  await Promise.all([
    writeExecutable(
      path.join(binDir, "cliphist"),
      `case "\${1:-}" in
  list) cat "$HISTORY_FILE" ;;
  decode) cat >/dev/null; if [[ "\${DECODE_FAIL:-0}" == 1 ]]; then exit 1; fi; cat "$DECODE_FILE" ;;
  delete) cat >/dev/null ;;
  *) exit 2 ;;
esac`,
    ),
    writeExecutable(
      path.join(binDir, "fuzzel"),
      `cat >"$MENU_CAPTURE"
printf '%s\\n' "\${FUZZEL_SELECTION:-h:42}"
exit "\${FUZZEL_CODE:-0}"`,
    ),
    writeExecutable(
      path.join(binDir, "wl-copy"),
      `cat >"$COPY_CAPTURE"
exit "\${WL_COPY_CODE:-0}"`,
    ),
    writeExecutable(path.join(binDir, "file"), `printf 'application/octet-stream\\n'`),
    writeExecutable(
      path.join(binDir, "zenity"),
      `case " $* " in
  *' --file-selection '*) printf '%s\\n' "$SAVE_DESTINATION" ;;
  *) exit "\${ZENITY_CODE:-0}" ;;
esac`,
    ),
    writeExecutable(path.join(binDir, "notify-send"), "exit 0"),
  ]);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
    HOME: home,
    XDG_CONFIG_HOME: configHome,
    XDG_CACHE_HOME: cacheHome,
    HISTORY_FILE: historyFile,
    DECODE_FILE: decodeFile,
    MENU_CAPTURE: menuCapture,
    COPY_CAPTURE: copyCapture,
    SAVE_DESTINATION: saveDestination,
    FUZZEL_CODE: "0",
    ...overrides,
  };
  delete env["XDG_CACHE_HOME_NAME"];

  return {
    root,
    cacheHome,
    historyFile,
    decodeFile,
    menuCapture,
    copyCapture,
    saveDestination,
    env,
    cleanup: async () => rm(root, { recursive: true, force: true }),
  };
}

async function writeExecutable(filePath: string, body: string): Promise<void> {
  await writeFile(filePath, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  await chmod(filePath, 0o755);
}

async function runClipboard(
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stderr: string }> {
  const child = spawn(process.execPath, [SCRIPT_PATH], {
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  const stderrChunks: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ code, stderr: Buffer.concat(stderrChunks).toString("utf8") });
    });
  });
}
