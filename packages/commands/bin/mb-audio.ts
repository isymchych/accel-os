import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { getErrorMessage } from "@accel-os/shared/guards";

import { runBestEffort, runCommand } from "../lib/command.ts";

type AudioDevice = "speakers" | "mic";
type AudioAction = "status" | "mute" | "unmute" | "toggle" | "up" | "down";

export type AudioArgs =
  | { help: true }
  | {
      help: false;
      notify: boolean;
      device: AudioDevice;
      action: AudioAction;
    };

const usage = `Usage:
  mb-audio [--notify|-n] speakers <status|mute|unmute|toggle|up|down>
  mb-audio [--notify|-n] mic <status|mute|unmute|toggle>

Options:
  -n, --notify  Show a desktop notification with the resulting state
  -h, --help    Show this help
`;

export function parseAudioArgs(args: readonly string[]): AudioArgs {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      notify: { type: "boolean", short: "n" },
    },
  });

  if (parsed.values.help === true) return { help: true };

  const [device, action, extra] = parsed.positionals;
  if (extra !== undefined || (device !== "speakers" && device !== "mic")) {
    throw new Error("Expected an audio device and action");
  }
  if (!isAudioAction(action) || (device === "mic" && (action === "up" || action === "down"))) {
    throw new Error(`Invalid ${device} action: ${action ?? ""}`);
  }

  return { help: false, notify: parsed.values.notify === true, device, action };
}

export function parseMuteStatus(output: string): boolean {
  const match = /^Mute:\s+(yes|no)\s*$/mu.exec(output);
  if (match?.[1] === "yes") {
    return true;
  }
  if (match?.[1] === "no") {
    return false;
  }
  throw new Error("Could not parse pactl mute status");
}

export function parseVolume(output: string): number {
  const match = /(\d+)%/u.exec(output);
  const volume = Number(match?.[1]);
  if (!Number.isSafeInteger(volume)) {
    throw new Error("Could not parse pactl volume");
  }
  return volume;
}

function main(): void {
  const args = parseAudioArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  applyAction(args.device, args.action);
  const message = getStatus(args.device);
  process.stdout.write(`${message}\n`);

  if (args.notify) {
    runBestEffort("notify-send", ["-u", "low", message]);
  }
}

function applyAction(device: AudioDevice, action: AudioAction): void {
  if (action === "status") {
    return;
  }

  const kind = device === "speakers" ? "sink" : "source";
  const target = device === "speakers" ? "@DEFAULT_SINK@" : "@DEFAULT_SOURCE@";

  if (action === "up" || action === "down") {
    runCommand("pactl", [`set-${kind}-volume`, target, action === "up" ? "+5%" : "-5%"]);
    return;
  }

  const mute = action === "mute" ? "1" : action === "unmute" ? "0" : "toggle";
  runCommand("pactl", [`set-${kind}-mute`, target, mute]);
}

function getStatus(device: AudioDevice): string {
  const kind = device === "speakers" ? "sink" : "source";
  const target = device === "speakers" ? "@DEFAULT_SINK@" : "@DEFAULT_SOURCE@";
  const muted = parseMuteStatus(runCommand("pactl", [`get-${kind}-mute`, target]));

  if (device === "mic") {
    return `Microphone is ${muted ? "muted" : "unmuted"}`;
  }

  const volume = parseVolume(runCommand("pactl", ["get-sink-volume", target]));
  return `Speakers are ${muted ? "muted" : "unmuted"}\nVolume ${String(volume)}%`;
}

function isAudioAction(value: string | undefined): value is AudioAction {
  return (
    value === "status" ||
    value === "mute" ||
    value === "unmute" ||
    value === "toggle" ||
    value === "up" ||
    value === "down"
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${getErrorMessage(error)}\n${usage}`);
    process.exitCode = 1;
  }
}
