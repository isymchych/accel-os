import assert from "node:assert/strict";
import test from "node:test";

import { createLongResponseNotification } from "./notify.ts";

test("createLongResponseNotification uses last user and assistant previews", () => {
  const notification = createLongResponseNotification(
    [
      { role: "user", content: "first prompt" },
      { role: "assistant", content: [{ type: "text", text: "first answer" }] },
      { role: "user", content: "second prompt with\nextra whitespace" },
      { role: "assistant", content: [{ type: "text", text: "second answer" }] },
    ],
    "⏱ 3.5s · 42 tok/s · 150 tokens",
  );

  assert.deepEqual(notification, {
    title: "second prompt with extra whitespace",
    body: "second answer · ⏱ 3.5s · 42 tok/s · 150 tokens",
  });
});

test("createLongResponseNotification falls back when assistant preview is missing", () => {
  const notification = createLongResponseNotification(
    [{ role: "user", content: "prompt;\u001b\u0007" }],
    "⏱ 3.5s",
  );

  assert.deepEqual(notification, {
    title: "prompt",
    body: "Ready for input · ⏱ 3.5s",
  });
});

test("createLongResponseNotification truncates long previews", () => {
  const notification = createLongResponseNotification(
    [
      { role: "user", content: "u".repeat(100) },
      { role: "assistant", content: [{ type: "text", text: "a".repeat(200) }] },
    ],
    "⏱ 9.9s",
  );

  assert.equal(notification.title.length, 80);
  assert.match(notification.title, /…$/u);
  assert.equal(notification.body.length, 160);
  assert.match(notification.body, /…$/u);
});