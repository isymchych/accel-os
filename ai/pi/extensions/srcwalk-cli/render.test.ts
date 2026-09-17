import assert from "node:assert/strict";
import test from "node:test";

import type { Theme } from "@earendil-works/pi-coding-agent";

import { formatSrcwalkPath, renderSrcwalkCall } from "./render.ts";

const theme = {
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
} as unknown as Theme;

interface RenderContext {
  state: object;
  lastComponent: undefined;
  invalidate: () => void;
  expanded: boolean;
  isError: boolean;
  executionStarted: boolean;
  cwd: string;
}

function context(): RenderContext {
  return {
    state: {},
    lastComponent: undefined,
    invalidate(): void {},
    expanded: false,
    isError: false,
    executionStarted: false,
    cwd: "/repo",
  };
}

test("formats external checkout paths relative to the session cwd", () => {
  assert.equal(formatSrcwalkPath("/tmp/untrusted/repo", "/repo"), "../tmp/untrusted/repo");
});

test("renders a compact tool call", () => {
  const rendered = renderSrcwalkCall("srcwalk_read", "src/auth.ts:40", theme, context());
  assert.equal(rendered.render(200).join("\n").trimEnd(), "  srcwalk_read src/auth.ts:40");
});
