import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PANEL_PATH = fileURLToPath(
  new URL("../dotfiles/dot_config/noctalia/plugins/clipboard-actions/panel.luau", import.meta.url),
);
const PANEL_SOURCE = readFileSync(PANEL_PATH, "utf8");

// Execute the actual source in Luau with fake native APIs. The standalone VM
// has no dofile/loadfile, so compose each isolated harness from the source file.
const FIXTURES = new URL("./fixtures/noctalia/", import.meta.url);
const HARNESS = readFileSync(new URL("harness.luau", FIXTURES), "utf8");
const STATUS = new URL("../dotfiles/dot_config/noctalia/plugins/desktop-status/", import.meta.url);

function checkLuau(fixture: string, harness: string, source: string): void {
  const scenario = readFileSync(new URL(fixture, FIXTURES), "utf8");
  const directory = mkdtempSync(path.join(tmpdir(), "noctalia-plugin-test-"));
  try {
    const script = path.join(directory, fixture);
    writeFileSync(script, `${harness}\n${source}\n${scenario}`, { mode: 0o600 });
    const result = spawnSync("luau", [script], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function checkPanel(fixture: string): void {
  checkLuau(fixture, HARNESS, `do\n${PANEL_SOURCE}\nend`);
}

function checkStatus(fixture: string, entry?: string): void {
  const harness = readFileSync(new URL("status-harness.luau", FIXTURES), "utf8");
  const poll = readFileSync(new URL("poll.luau", STATUS), "utf8");
  const widget = entry ? readFileSync(new URL(entry, STATUS), "utf8") : "";
  // Keep the real module bodies unchanged. Each require gets its own poll
  // instance, as in Noctalia; scenarios choose when to initialize the widget.
  const source = `
local function loadPoll()
${poll}
end
local function require(name)
  assert(name == "./poll.luau", "Unexpected module: " .. name)
  return loadPoll()
end
local function loadWidget()
${widget}
end
`;
  checkLuau(fixture, harness, source);
}

test(
  "native panel renders plain text and transfers snapshot ownership exactly once",
  {
    skip: process.platform !== "linux" && "Noctalia plugins are Linux-only",
  },
  () => {
    checkPanel("text-ownership.test.luau");
  },
);

test(
  "native panel displays the frozen image path with aspect-preserving fit",
  {
    skip: process.platform !== "linux" && "Noctalia plugins are Linux-only",
  },
  () => {
    checkPanel("image-preview.test.luau");
  },
);

test(
  "native panel discards on dismissal, refresh, and runtime teardown without stale activation",
  {
    skip: process.platform !== "linux" && "Noctalia plugins are Linux-only",
  },
  () => {
    checkPanel("lifecycle.test.luau");
  },
);

test(
  "native panel keeps the snapshot on launch failure and closes invalid previews safely",
  {
    skip: process.platform !== "linux" && "Noctalia plugins are Linux-only",
  },
  () => {
    checkPanel("failure-handling.test.luau");
  },
);

for (const [name, fixture, entry] of [
  [
    "status commands reject failed, timed-out, truncated, and undecodable results",
    "status-command.test.luau",
  ],
  [
    "status polling prevents overlap and reports errors once until recovery",
    "status-poll.test.luau",
  ],
  [
    "Pi status counts only live agents with valid activity and serializes reads",
    "pi-counts.test.luau",
    "pi-agents.luau",
  ],
  [
    "Pi status handles missing state, read failures, recovery, and runtime fallback",
    "pi-errors.test.luau",
    "pi-agents.luau",
  ],
  [
    "failed units combines system and user counts without hiding query failures",
    "failed-units.test.luau",
    "failed-units.luau",
  ],
  [
    "Sway mode hides default, rejects invalid responses, and recovers",
    "sway-mode.test.luau",
    "sway-mode.luau",
  ],
] as const) {
  test(name, { skip: process.platform !== "linux" && "Noctalia plugins are Linux-only" }, () => {
    checkStatus(fixture, entry);
  });
}
