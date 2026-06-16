import assert from "node:assert/strict";
import test from "node:test";

import { createLineReader, parseDarkmanMode } from "./index.ts";

test("parseDarkmanMode accepts only darkman light and dark modes", () => {
  assert.equal(parseDarkmanMode("light"), "light");
  assert.equal(parseDarkmanMode("dark"), "dark");
  assert.equal(parseDarkmanMode(" light\n"), "light");
  assert.equal(parseDarkmanMode("darkman: light"), undefined);
  assert.equal(parseDarkmanMode(""), undefined);
});

test("createLineReader emits complete lines across chunks", () => {
  const lines: string[] = [];
  const reader = createLineReader((line) => lines.push(line));

  reader.push("li");
  reader.push("ght\ndark\nlig");
  assert.deepEqual(lines, ["light", "dark"]);

  reader.push("ht");
  assert.deepEqual(lines, ["light", "dark"]);

  reader.flush();
  assert.deepEqual(lines, ["light", "dark", "light"]);
});
