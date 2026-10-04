import assert from "node:assert/strict";
import test from "node:test";

import {
  createLongResponseNotification,
  notifyForLongResponse,
  notifyForSummary,
} from "./notify.ts";

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

test("notifyForLongResponse queues an unfocused notification after the threshold", () => {
  const notifications = [] as Array<{
    id: string;
    title: string;
    body: string;
  }>;

  notifyForLongResponse({
    elapsedMs: 3_000,
    messages: [{ role: "user", content: "update dotfiles" }],
    summary: "⏱ 3.0s",
    notify: (notification) => {
      notifications.push(notification);
    },
  });
  notifyForLongResponse({
    elapsedMs: 2_999,
    messages: [{ role: "user", content: "skip" }],
    summary: "⏱ 2.9s",
    notify: (notification) => {
      notifications.push(notification);
    },
  });

  assert.equal(notifications.length, 1);
  const notification = notifications[0];
  assert.ok(notification);
  assert.match(notification.id, /^pi-response-/u);
  assert.equal(notification.title, "update dotfiles");
  assert.equal(notification.body, "Ready for input · ⏱ 3.0s");
});

test("notifyForSummary does not expose the summary", () => {
  const notifications = [] as Array<{
    id: string;
    title: string;
    body: string;
  }>;
  const notify = (notification: (typeof notifications)[number]): void => {
    notifications.push(notification);
  };

  notifyForSummary("compaction", "/home/me/accel-os", notify);
  notifyForSummary("branch", "/home/me/accel-os", notify);

  assert.deepEqual(
    notifications.map(({ id, ...notification }) => ({
      ...notification,
      id: id.replace(/.+/u, "id"),
    })),
    [
      {
        id: "id",
        title: "Pi summarization complete",
        body: "accel-os · Context compacted",
      },
      {
        id: "id",
        title: "Pi summarization complete",
        body: "accel-os · Branch summary ready",
      },
    ],
  );
  for (const notification of notifications) {
    assert.match(notification.id, /^pi-summary-/u);
  }
});
