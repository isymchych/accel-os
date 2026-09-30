import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { getErrorMessage } from "@accel-os/shared/guards";
import { parseJsonWithSchema } from "@accel-os/shared/json";
import { Type } from "typebox";

import { runBestEffort, runCommand } from "../lib/command.ts";

type TouchpadAction = "status" | "on" | "off" | "toggle";

export type TouchpadArgs =
  | { help: true }
  | {
      help: false;
      notify: boolean;
      action: TouchpadAction;
    };

const SwayInputsSchema = Type.Array(
  Type.Object(
    {
      type: Type.Optional(Type.String()),
      libinput: Type.Optional(
        Type.Object(
          {
            send_events: Type.Optional(Type.String()),
          },
          { additionalProperties: true },
        ),
      ),
    },
    { additionalProperties: true },
  ),
);

const usage = `Usage:
  mb-touchpad [--notify|-n] <status|on|off|toggle>

Options:
  -n, --notify  Show a desktop notification with the resulting state
  -h, --help    Show this help
`;

export function parseTouchpadArgs(args: readonly string[]): TouchpadArgs {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      notify: { type: "boolean", short: "n" },
    },
  });

  if (parsed.values.help === true) return { help: true };

  const [action, extra] = parsed.positionals;
  if (extra !== undefined || !isTouchpadAction(action)) {
    throw new Error(`Invalid touchpad action: ${action ?? ""}`);
  }

  return { help: false, notify: parsed.values.notify === true, action };
}

export function parseTouchpadEnabled(output: string): boolean {
  const inputs = parseJsonWithSchema(output, SwayInputsSchema, "sway input list");
  const touchpad = inputs.find((input) => input.type === "touchpad");
  if (touchpad === undefined) {
    throw new Error("Could not find a touchpad");
  }

  const sendEvents = touchpad.libinput?.send_events;
  if (sendEvents === undefined) {
    throw new Error("Touchpad send_events state is missing or invalid");
  }

  return sendEvents === "enabled";
}

function main(): void {
  const args = parseTouchpadArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  applyAction(args.action);
  const enabled = parseTouchpadEnabled(runCommand("swaymsg", ["-t", "get_inputs", "-r"]));
  const message = `Touchpad is ${enabled ? "enabled" : "disabled"}`;
  process.stdout.write(`${message}\n`);

  if (args.notify) {
    runBestEffort("notify-send", ["-u", "low", message]);
  }
}

function applyAction(action: TouchpadAction): void {
  if (action === "status") {
    return;
  }

  const state =
    action === "on"
      ? ["enabled"]
      : action === "off"
        ? ["disabled"]
        : ["toggle", "enabled", "disabled"];
  runCommand("swaymsg", ["input", "type:touchpad", "events", ...state]);
}

function isTouchpadAction(value: string | undefined): value is TouchpadAction {
  return value === "status" || value === "on" || value === "off" || value === "toggle";
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${getErrorMessage(error)}\n${usage}`);
    process.exitCode = 1;
  }
}
