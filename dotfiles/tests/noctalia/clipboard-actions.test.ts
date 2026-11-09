import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(
  new URL("../../dot_config/noctalia/plugins/clipboard-actions/actions.ts", import.meta.url),
);
const HELPER_PATH = fileURLToPath(
  new URL(
    "../../dot_config/noctalia/plugins/clipboard-actions/executable_actions",
    import.meta.url,
  ),
);

type Call = {
  command: string;
  args: string[];
  input?: string;
  file?: string;
  bytes?: string;
  mode?: number;
  directoryMode?: number;
  snapshot?: SnapshotView;
};

type SnapshotView = {
  mime: string;
  description: string;
  text?: string;
  imagePath?: string;
  truncated: boolean;
  actions: { id: string; label: string }[];
};

type ClipboardFixture = {
  root: string;
  copied: string;
  run(extraEnv?: NodeJS.ProcessEnv, args?: string[]): SpawnSyncReturns<string>;
  calls(): Promise<Call[]>;
  assertClean(): Promise<void>;
};

// All external commands are replaced: no GUI, real clipboard, or network access.
const FAKE_COMMAND = `
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const env = process.env;
const call = { command, args };
const fails = env.FAIL_COMMAND === command && (!env.FAIL_ARG || args.includes(env.FAIL_ARG));
let status = fails ? Number(env.FAIL_CODE || 7) : 0;
if (command === "wl-paste") {
  if (args[0] === "--list-types") process.stdout.write(env.TYPES + "\\n");
  else process.stdout.write(readFileSync(env.CLIPBOARD));
} else if (command === "noctalia" && args[1] === "panel-open") {
  const directory = args[3];
  call.snapshot = JSON.parse(readFileSync(path.join(directory, "snapshot.json"), "utf8"));
  call.file = path.join(directory, "snapshot.json");
  call.mode = statSync(call.file).mode & 0o777;
  call.directoryMode = statSync(directory).mode & 0o777;
  if (env.REPLACEMENT) writeFileSync(env.CLIPBOARD, env.REPLACEMENT);
} else if (command === "zenity") {
  if (env.DESTINATION) process.stdout.write(env.DESTINATION + "\\n");
  else status = 1;
} else if (command === "wl-copy") {
  writeFileSync(env.COPIED, readFileSync(0));
} else if (command === "jq") {
  call.input = readFileSync(0, "utf8");
  process.stdout.write(env.FORMATTED_JSON || call.input);
} else if ((command === "noctalia" && args[0] === "msg")
    || (command === "xterm" && args.includes("nvim"))) {
  const file = command === "noctalia" ? args[2] : args.at(-1);
  call.file = file;
  call.bytes = readFileSync(file).toString("base64");
  call.mode = statSync(file).mode & 0o777;
  call.directoryMode = statSync(path.dirname(file)).mode & 0o777;
}
appendFileSync(env.CALLS, JSON.stringify(call) + "\\n");
if (fails) process.stderr.write("simulated failure");
else if (env.WARNING_COMMAND === command) process.stderr.write("toolkit warning");
process.exit(status);
`;

async function createFixture(
  t: test.TestContext,
  bytes: Buffer | string,
  types = "text/plain",
): Promise<ClipboardFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "noctalia-clipboard-actions-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const clipboard = path.join(root, "clipboard");
  const callsFile = path.join(root, "calls");
  const copied = path.join(root, "copied");
  await writeFile(clipboard, bytes);
  await writeFile(callsFile, "");
  for (const command of [
    "wl-paste",
    "wl-copy",
    "noctalia",
    "zenity",
    "xterm",
    "xdg-open",
    "notify-send",
    "jq",
  ]) {
    const file = path.join(root, command);
    await writeFile(file, `#!${process.execPath}\n${FAKE_COMMAND}`);
    await chmod(file, 0o755);
  }
  const env = {
    ...process.env,
    HOME: root,
    XDG_RUNTIME_DIR: root,
    PATH: `${root}:${process.env["PATH"] ?? ""}`,
    CLIPBOARD: clipboard,
    TYPES: types,
    CALLS: callsFile,
    COPIED: copied,
  };
  return {
    root,
    copied,
    run: (extraEnv: NodeJS.ProcessEnv = {}, args: string[] = []): SpawnSyncReturns<string> => {
      const run = (argv: string[]): SpawnSyncReturns<string> =>
        spawnSync(process.execPath, [SCRIPT_PATH, ...argv], {
          env: { ...env, ...extraEnv },
          encoding: "utf8",
          timeout: 10000,
        });
      const opened = run(args);
      if (opened.status !== 0 || args.length > 0 || extraEnv["KEEP_PANEL"] === "1") return opened;
      const calls = readFileSync(callsFile, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Call);
      const panel = calls.findLast((call) => call.args[1] === "panel-open");
      assert.ok(panel);
      const directory = panel.args[3] ?? "";
      const choice = extraEnv["CHOICE"];
      if (!choice) return run(["discard", directory]);
      const id = panel.snapshot?.actions.find((action) => action.label === choice)?.id ?? choice;
      return run(["run", directory, id]);
    },
    calls: async (): Promise<Call[]> =>
      (await readFile(callsFile, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Call),
    assertClean: async (): Promise<void> => {
      assert.deepEqual(
        (await readdir(root)).filter((name) => name.startsWith("noctalia-clipboard-actions-")),
        [],
      );
    },
  };
}

test("save preserves the captured text, including trailing newlines, after the clipboard changes", async (t) => {
  const text = "original ' $(touch nope)\n\n";
  const fixture = await createFixture(t, text);
  const destination = path.join(fixture.root, "saved file ");
  const result = fixture.run({
    CHOICE: "Save as…",
    DESTINATION: destination,
    REPLACEMENT: "changed",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(destination, "utf8"), text);
  const calls = await fixture.calls();
  assert.deepEqual(calls.find((call) => call.command === "noctalia")?.snapshot, {
    mime: "text/plain",
    description: "text/plain · 26 bytes",
    text,
    truncated: false,
    actions: [
      { id: "edit", label: "Open in editor" },
      { id: "save", label: "Save as…" },
    ],
  });
  assert.deepEqual(
    calls.filter((call) => call.command === "wl-paste").map((call) => call.args),
    [["--list-types"], ["--no-newline", "--type", "text/plain"]],
  );
  assert.ok(calls.find((call) => call.command === "zenity")?.args.includes("--confirm-overwrite"));
});

test("images take precedence over text representations and save byte-for-byte", async (t) => {
  const bytes = Buffer.from([137, 80, 78, 71, 0, 255, 13, 10]);
  const fixture = await createFixture(t, bytes, "text/plain\nimage/jpeg\nimage/png");
  const destination = path.join(fixture.root, "saved.png");
  const result = fixture.run({ CHOICE: "Save as…", DESTINATION: destination });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readFile(destination), bytes);
  const calls = await fixture.calls();
  const snapshot = calls.find((call) => call.command === "noctalia")?.snapshot;
  assert.ok(snapshot);
  assert.deepEqual(snapshot.actions, [
    { id: "annotate", label: "Annotate" },
    { id: "save", label: "Save as…" },
  ]);
  assert.equal(snapshot.text, undefined);
  assert.ok(snapshot.imagePath?.endsWith("/clipboard.png"));
  assert.deepEqual(calls[1]?.args, ["--no-newline", "--type", "image/png"]);
  assert.ok(
    calls
      .find((call) => call.command === "zenity")
      ?.args.some((arg) => arg.endsWith("/clipboard.png")),
  );
});

test("annotation receives a private snapshot that is removed after Noctalia acknowledges it", async (t) => {
  const bytes = Buffer.from([0, 255, 42]);
  const fixture = await createFixture(t, bytes, "image/jpeg");
  const result = fixture.run({ CHOICE: "Annotate", REPLACEMENT: "changed" });
  assert.equal(result.status, 0, result.stderr);
  const call = (await fixture.calls()).find(
    (entry) => entry.command === "noctalia" && entry.args[1] === "annotate",
  );
  assert.ok(call);
  assert.equal(call.bytes, bytes.toString("base64"));
  assert.equal(call.mode, 0o600);
  assert.equal(call.directoryMode, 0o700);
  assert.ok(call.file?.endsWith(".jpg"));
  assert.deepEqual(call.args, ["msg", "annotate", call.file]);
  await fixture.assertClean();
});

test("text editor consumes the snapshot before cleanup, including on command failure", async (t) => {
  for (const failure of [false, true]) {
    const fixture = await createFixture(t, "hello\n");
    const result = fixture.run({
      CHOICE: "Open in editor",
      ...(failure ? { FAIL_COMMAND: "xterm" } : {}),
    });
    assert.equal(result.status, failure ? 1 : 0, result.stderr);
    const call = (await fixture.calls()).find((entry) => entry.command === "xterm");
    assert.ok(call);
    assert.deepEqual(call.args, ["run", "--", "nvim", "--", call.file]);
    assert.equal(call.bytes, Buffer.from("hello\n").toString("base64"));
    await fixture.assertClean();
  }
});

test("YouTube actions are additive and delegate interactive download choices to mb-ydl", async (t) => {
  const url = "https://www.youtube.com/watch?v=example&feature=share";
  const fixture = await createFixture(t, ` ${url}\n`);
  const destination = path.join(fixture.root, "download folder");
  const result = fixture.run({ CHOICE: "Download…", DESTINATION: destination });
  assert.equal(result.status, 0, result.stderr);
  const calls = await fixture.calls();
  assert.deepEqual(
    calls
      .find((call) => call.command === "noctalia")
      ?.snapshot?.actions.map((action) => action.label),
    ["Download…", "Open in browser", "Open in editor", "Save as…"],
  );
  assert.deepEqual(calls.find((call) => call.command === "xterm")?.args, [
    "run",
    "--cwd",
    destination,
    "--",
    "mb-ydl",
    url,
  ]);
});

test("URL matching rejects embedded links and lookalike hosts; browser URLs are single arguments", async (t) => {
  for (const [text, download, browser] of [
    ["https://youtu.be/example", true, true],
    ["https://music.youtube.com/watch?v=example", true, true],
    ["https://youtube.com.example.org/watch?v=example", false, true],
    ["https://youtube.com@evil.example/watch", false, true],
    ["some text https://youtu.be/example", false, false],
    ["https://youtu.be/example\nmore text", false, false],
    ["file:///etc/passwd", false, false],
    ["https://example.org/?q=$(touch%20nope)&x='quoted'", false, true],
  ] as const) {
    const fixture = await createFixture(t, text);
    const result = fixture.run(browser ? { CHOICE: "Open in browser" } : {});
    assert.equal(result.status, 0, result.stderr);
    const calls = await fixture.calls();
    const actions = calls.find((call) => call.command === "noctalia")?.snapshot?.actions ?? [];
    assert.equal(
      actions.some((action) => action.id === "download"),
      download,
      text,
    );
    assert.equal(
      actions.some((action) => action.id === "browse"),
      browser,
      text,
    );
    if (browser) {
      assert.deepEqual(calls.find((call) => call.command === "xdg-open")?.args, [
        new URL(text).href,
      ]);
    }
  }
});

test("valid JSON can be formatted back to the clipboard without changing ordinary text actions", async (t) => {
  const fixture = await createFixture(
    t,
    '{"items":[1,true],"name":"value"}',
    "text/plain;charset=utf-8\ntext/html",
  );
  const formatted = '{\n  "items": [\n    1,\n    true\n  ],\n  "name": "value"\n}\n';
  const result = fixture.run({
    CHOICE: "Pretty-print → clipboard",
    REPLACEMENT: "changed",
    FORMATTED_JSON: formatted,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(fixture.copied, "utf8"), formatted);
  const calls = await fixture.calls();
  assert.deepEqual(
    calls
      .find((call) => call.command === "noctalia")
      ?.snapshot?.actions.map((action) => action.label),
    ["Pretty-print → clipboard", "Open in editor", "Save as…"],
  );
  assert.deepEqual(calls.find((call) => call.command === "wl-copy")?.args, [
    "--type",
    "text/plain",
  ]);
  assert.equal(
    calls.find((call) => call.command === "jq")?.input,
    '{"items":[1,true],"name":"value"}',
  );
});

test("JSON formatting delegates original numeric literals to jq rather than rounding through JS", async (t) => {
  const text = '{"id":9007199254740993,"decimal":1.234567890123456789}';
  const fixture = await createFixture(t, text);
  const result = fixture.run({ CHOICE: "Pretty-print → clipboard" });
  assert.equal(result.status, 0, result.stderr);
  const jq = (await fixture.calls()).find((call) => call.command === "jq");
  assert.ok(jq);
  assert.equal(jq.input, text);
  assert.deepEqual(jq.args, ["--indent", "2", "."]);
  assert.equal(await readFile(fixture.copied, "utf8"), text);
});

test("closing the panel and cancelling dialogs has no action side effects", async (t) => {
  for (const choice of ["", "Save as…", "Download…"]) {
    const fixture = await createFixture(t, "https://youtu.be/example");
    const result = fixture.run({ CHOICE: choice });
    assert.equal(result.status, 0, result.stderr);
    const commands = (await fixture.calls()).map((call) => call.command);
    assert.deepEqual(commands, ["wl-paste", "wl-paste", "noctalia", ...(choice ? ["zenity"] : [])]);
    await fixture.assertClean();
  }
});

test("action IDs unavailable for the frozen item cannot dispatch commands", async (t) => {
  const fixture = await createFixture(t, "ordinary text");
  const result = fixture.run({ CHOICE: "annotate" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Select one of the offered/);
  assert.deepEqual(
    (await fixture.calls()).map((call) => call.command),
    ["wl-paste", "wl-paste", "noctalia", "notify-send"],
  );
});

test("empty, unsupported, and failed clipboard reads report errors without opening a panel", async (t) => {
  for (const [content, types, env] of [
    ["", "text/plain", {}],
    ["hello", "application/octet-stream", {}],
    ["hello", "text/plain", { FAIL_COMMAND: "wl-paste" }],
  ] as const) {
    const fixture = await createFixture(t, content, types);
    const result = fixture.run(env);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Clipboard is empty|wl-paste failed/);
    assert.ok(!(await fixture.calls()).some((call) => call.command === "noctalia"));
  }
});

test("failed annotation reports the error and still removes its temporary file", async (t) => {
  const fixture = await createFixture(t, "image bytes", "image/png");
  const result = fixture.run({
    CHOICE: "Annotate",
    FAIL_COMMAND: "noctalia",
    FAIL_ARG: "annotate",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /simulated failure/);
  await fixture.assertClean();
});

test("failed panel opening and failed dialogs report errors and clean up snapshots", async (t) => {
  for (const [command, code] of [
    ["noctalia", "1"],
    ["zenity", "255"],
  ]) {
    const fixture = await createFixture(t, "hello");
    const result = fixture.run({
      CHOICE: "Save as…",
      DESTINATION: path.join(fixture.root, "unused"),
      FAIL_COMMAND: command,
      FAIL_CODE: code,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /simulated failure/);
    assert.equal((await fixture.calls()).at(-1)?.command, "notify-send");
    await fixture.assertClean();
  }
});

test("Zenity cancellation tolerates toolkit warnings on stderr", async (t) => {
  const fixture = await createFixture(t, "hello");
  const result = fixture.run({ CHOICE: "Save as…", WARNING_COMMAND: "zenity" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal((await fixture.calls()).at(-1)?.command, "zenity");
});

test("preview truncation never truncates the content passed to actions", async (t) => {
  const text = `First line\n${"x".repeat(8000)}\nLast line\n`;
  const fixture = await createFixture(t, text);
  const destination = path.join(fixture.root, "full-text.txt");
  const result = fixture.run({ CHOICE: "Save as…", DESTINATION: destination });
  assert.equal(result.status, 0, result.stderr);
  const view = (await fixture.calls()).find((call) => call.snapshot !== undefined);
  assert.ok(view?.snapshot);
  assert.equal(view.snapshot.text, text.slice(0, 4096));
  assert.equal(view.snapshot.truncated, true);
  assert.equal(await readFile(destination, "utf8"), text);
  await fixture.assertClean();
});

test("the panel receives an owner-only snapshot and discard is idempotent", async (t) => {
  const fixture = await createFixture(t, "preview this");
  const result = fixture.run({ KEEP_PANEL: "1" });
  assert.equal(result.status, 0, result.stderr);
  const panel = (await fixture.calls()).find((call) => call.snapshot !== undefined);
  assert.ok(panel);
  assert.equal(panel.mode, 0o600);
  assert.equal(panel.directoryMode, 0o700);
  assert.deepEqual(panel.args.slice(0, 3), [
    "msg",
    "panel-open",
    "accel-os/clipboard-actions:actions",
  ]);
  assert.equal(panel.snapshot?.text, "preview this");
  const directory = panel.args[3] ?? "";
  for (let count = 0; count < 2; count += 1) {
    const discarded = fixture.run({}, ["discard", directory]);
    assert.equal(discarded.status, 0, discarded.stderr);
  }
  await fixture.assertClean();
});

test("snapshot cleanup rejects arbitrary directories and symlinks", async (t) => {
  const fixture = await createFixture(t, "hello");
  const kept = path.join(fixture.root, "keep");
  await writeFile(kept, "do not remove");
  const link = path.join(fixture.root, "noctalia-clipboard-actions-ABC123");
  await symlink(fixture.root, link);
  for (const directory of [fixture.root, link]) {
    const result = fixture.run({}, ["discard", directory]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid clipboard snapshot|owner-only directory/);
    assert.equal(await readFile(kept, "utf8"), "do not remove");
  }
});

test("execution revalidates the selected action instead of trusting preview metadata", async (t) => {
  const fixture = await createFixture(t, "not a video link");
  const opened = fixture.run({ KEEP_PANEL: "1" });
  assert.equal(opened.status, 0, opened.stderr);
  const panel = (await fixture.calls()).find((call) => call.snapshot !== undefined);
  assert.ok(panel?.snapshot);
  const directory = panel.args[3] ?? "";
  await writeFile(
    path.join(directory, "snapshot.json"),
    JSON.stringify({
      ...panel.snapshot,
      actions: [{ id: "download", label: "Download…" }],
    }),
  );
  const result = fixture.run({}, ["run", directory, "download"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Select one of the offered/);
  assert.ok(!(await fixture.calls()).some((call) => call.command === "xterm"));
  await fixture.assertClean();
});

test("local helper resolves the Node entrypoint through accel-node", async (t) => {
  const fixture = await createFixture(t, "hello");
  const bin = path.join(fixture.root, "bin");
  await mkdir(bin);
  const accelNode = path.join(bin, "accel-node");
  await writeFile(
    accelNode,
    `#!${process.execPath}
import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status ?? 1);
`,
  );
  await chmod(accelNode, 0o755);
  const destination = path.join(fixture.root, "saved.txt");
  const result = spawnSync("bash", [HELPER_PATH], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      ...process.env,
      HOME: fixture.root,
      ACCEL_OS: fileURLToPath(new URL("../../../", import.meta.url)),
      XDG_RUNTIME_DIR: fixture.root,
      PATH: `${fixture.root}:${process.env["PATH"] ?? ""}`,
      CLIPBOARD: path.join(fixture.root, "clipboard"),
      TYPES: "text/plain",
      CALLS: path.join(fixture.root, "calls"),
      COPIED: fixture.copied,
      CHOICE: "Save as…",
      DESTINATION: destination,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const panel = (await fixture.calls()).find((call) => call.args[1] === "panel-open");
  assert.ok(panel);
  const action = fixture.run({ DESTINATION: destination }, ["run", panel.args[3] ?? "", "save"]);
  assert.equal(action.status, 0, action.stderr);
  assert.equal(await readFile(destination, "utf8"), "hello");
});
