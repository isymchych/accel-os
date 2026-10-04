import assert from "node:assert/strict";
import test from "node:test";

import { createKittyNotificationEscapeSequence, sendUnfocusedKittyNotification } from "./notify.ts";

const notification = {
  id: "pi-notification-test",
  title: "Pi; needs\ninput\u001b",
  body: "project; is waiting\u0007",
} as const;

test("Kitty notifications use unfocused delivery, named sound and encoded text", () => {
  assert.equal(
    createKittyNotificationEscapeSequence(notification),
    "\x1b]99;i=pi-notification-test:o=unfocused:s=bWItcGktY29tcGxldGU=:e=1:d=0;UGkgbmVlZHMgaW5wdXQ=\x1b\\" +
      "\x1b]99;i=pi-notification-test:p=body:e=1;cHJvamVjdCBpcyB3YWl0aW5n\x1b\\",
  );
});

test("Kitty notifications require a TTY and Kitty window", () => {
  let writes = 0;
  const output = {
    isTTY: true,
    write: (): void => {
      writes += 1;
    },
  };

  assert.equal(sendUnfocusedKittyNotification(notification, {}, output), false);
  assert.equal(
    sendUnfocusedKittyNotification(notification, { KITTY_WINDOW_ID: "" }, output),
    false,
  );
  assert.equal(
    sendUnfocusedKittyNotification(notification, { KITTY_WINDOW_ID: "1" }, output),
    true,
  );
  assert.equal(writes, 1);
  assert.equal(
    sendUnfocusedKittyNotification(
      notification,
      { KITTY_WINDOW_ID: "1" },
      { ...output, isTTY: false },
    ),
    false,
  );
  assert.equal(writes, 1);
});
