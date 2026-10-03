import assert from "node:assert/strict";
import test from "node:test";

import { buildPiArgs, configurePiEnvironment, resolveExtensionNames } from "./pi-launcher.ts";

test("resolveExtensionNames loads exactly one code navigation backend", () => {
  const shared = resolveExtensionNames("tilth").filter(
    (name) => name !== "tilth-cli" && name !== "srcwalk-cli",
  );

  assert.deepEqual(resolveExtensionNames("tilth"), [...shared, "tilth-cli"]);
  assert.deepEqual(resolveExtensionNames("srcwalk"), [...shared, "srcwalk-cli"]);
});

test("buildPiArgs explicitly loads native MCP and codemode extensions", async () => {
  const args = await buildPiArgs("/repo", "tilth");

  assert.deepEqual(
    args.filter((value) => value.startsWith("builtin:")),
    ["builtin:mcp", "builtin:codemode", "builtin:tool-search"],
  );
  assert.ok(!args.some((value) => value.includes("pi-mcp-adapter")));
});

test("buildPiArgs loads ask-user-question for both navigation backends", async () => {
  for (const backend of ["tilth", "srcwalk"] as const) {
    const args = await buildPiArgs("/repo", backend);
    const index = args.indexOf("/repo/ai/pi/extensions/ask-user-question/index.ts");
    assert.ok(index > 0);
    assert.equal(args[index - 1], "--extension");
  }
});

test("configurePiEnvironment selects the agent Git config for every Pi child", () => {
  const previousCodingAgentDir = process.env["PI_CODING_AGENT_DIR"];
  const previousSessionDir = process.env["PI_CODING_AGENT_SESSION_DIR"];
  const previousGitConfig = process.env["GIT_CONFIG_GLOBAL"];

  try {
    configurePiEnvironment("/repo/ai/pi", "/profiles/account");

    assert.equal(process.env["PI_CODING_AGENT_DIR"], "/profiles/account");
    assert.equal(process.env["PI_CODING_AGENT_SESSION_DIR"], "/repo/ai/pi/sessions");
    assert.equal(process.env["GIT_CONFIG_GLOBAL"], "/repo/ai/pi/gitconfig");
  } finally {
    restoreEnvironment("PI_CODING_AGENT_DIR", previousCodingAgentDir);
    restoreEnvironment("PI_CODING_AGENT_SESSION_DIR", previousSessionDir);
    restoreEnvironment("GIT_CONFIG_GLOBAL", previousGitConfig);
  }
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
    return;
  }
  process.env[name] = value;
}
