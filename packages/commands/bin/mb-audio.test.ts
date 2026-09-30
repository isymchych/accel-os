import assert from "node:assert/strict";
import test from "node:test";

import { parseAudioArgs, parseMuteStatus, parseVolume } from "./mb-audio.ts";

test("parseAudioArgs accepts the existing Sway microphone command", () => {
  assert.deepEqual(parseAudioArgs(["-n", "mic", "toggle"]), {
    help: false,
    notify: true,
    device: "mic",
    action: "toggle",
  });
});

test("parseAudioArgs accepts the notify flag after subcommands", () => {
  assert.deepEqual(parseAudioArgs(["speakers", "up", "--notify"]), {
    help: false,
    notify: true,
    device: "speakers",
    action: "up",
  });
});

test("parseAudioArgs accepts positionals after the standard option separator", () => {
  assert.deepEqual(parseAudioArgs(["--notify", "--", "speakers", "up"]), {
    help: false,
    notify: true,
    device: "speakers",
    action: "up",
  });
});

test("parseAudioArgs rejects speaker-only microphone actions", () => {
  assert.throws(() => parseAudioArgs(["mic", "up"]), /Invalid mic action/u);
});

test("parseMuteStatus parses pactl output", () => {
  assert.equal(parseMuteStatus("Mute: yes\n"), true);
  assert.equal(parseMuteStatus("Mute: no\n"), false);
  assert.throws(() => parseMuteStatus("unknown"), /Could not parse/u);
});

test("parseVolume uses the first channel percentage", () => {
  assert.equal(
    parseVolume(
      "Volume: front-left: 42598 /  65% / -11.24 dB, front-right: 42598 / 65% / -11.24 dB\n",
    ),
    65,
  );
});
