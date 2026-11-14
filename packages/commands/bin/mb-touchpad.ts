import process from "node:process";
import { pathToFileURL } from "node:url";

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Schema, Stream } from "effect";
import type { PlatformError } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { logEvent, withExecutionLog } from "../lib/execution-log.ts";

type TouchpadAction = "status" | "on" | "off" | "toggle";

const SwayInputsSchema = Schema.Array(
  Schema.Struct({
    type: Schema.optionalKey(Schema.String),
    libinput: Schema.optionalKey(Schema.Struct({ send_events: Schema.optionalKey(Schema.String) })),
  }),
);

export function parseTouchpadEnabled(output: string): boolean {
  const inputs = Schema.decodeUnknownSync(SwayInputsSchema)(JSON.parse(output));
  const touchpad = inputs.find((input) => input.type === "touchpad");

  if (touchpad === undefined) throw new Error("Could not find a touchpad");

  const sendEvents = touchpad.libinput?.send_events;

  if (sendEvents === undefined) throw new Error("Touchpad send_events state is missing or invalid");

  return sendEvents === "enabled";
}

function actionArgs(action: Exclude<TouchpadAction, "status">): string[] {
  const state =
    action === "on"
      ? ["enabled"]
      : action === "off"
        ? ["disabled"]
        : ["toggle", "enabled", "disabled"];

  return ["input", "type:touchpad", "events", ...state];
}

const runTouchpad = (
  action: TouchpadAction,
  notify: boolean,
): Effect.Effect<void, unknown, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    yield* logEvent("action_started", { action, notify });

    if (action !== "status") {
      yield* runSway(actionArgs(action));
    }

    const output = yield* runSway(["-t", "get_inputs", "-r"]);
    const enabled = yield* Effect.try(() => parseTouchpadEnabled(output));
    const message = `Touchpad is ${enabled ? "enabled" : "disabled"}`;

    yield* Console.log(message);
    yield* logEvent("action_finished", { action, enabled });

    if (notify) {
      yield* notifyState(message);
    }
  });

const notifyState = (
  message: string,
): Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    yield* spawner.exitCode(
      ChildProcess.make("notify-send", ["-u", "low", message], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      }),
    );
  }).pipe(Effect.ignore);

const runSway = (
  args: string[],
): Effect.Effect<
  string,
  Error | PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make("swaymsg", args, { stdin: "ignore", stdout: "pipe", stderr: "pipe" }),
    );

    const [output] = yield* Effect.all(
      [
        Stream.runFold(
          Stream.decodeText(child.stdout),
          () => "",
          (text, chunk) => text + chunk,
        ),
        child.stderr.pipe(
          Stream.tap((chunk) =>
            Effect.sync(() => {
              process.stderr.write(chunk);
            }),
          ),
          Stream.decodeText(),
          Stream.runForEach((stderr) => logEvent("swaymsg_stderr", { stderr })),
        ),
      ],
      { concurrency: "unbounded" },
    );

    const code = yield* child.exitCode;

    yield* logEvent("swaymsg_finished", {
      args,
      exit_code: code,
      outcome: code === 0 ? "success" : "failure",
    });

    if (code !== 0) return yield* Effect.fail(new Error(`swaymsg exited with status ${code}`));

    return output;
  }).pipe(Effect.scoped);

const command = Command.make(
  "mb-touchpad",
  {
    action: Argument.ChoiceWithValue("action", [
      ["status", "status"],
      ["on", "on"],
      ["off", "off"],
      ["toggle", "toggle"],
    ]),
    notify: Flag.Boolean("notify").pipe(Flag.withAlias("n"), Flag.withDefault(false)),
  },
  ({ action, notify }) =>
    runTouchpad(action, notify).pipe(
      Effect.tapError((error) =>
        Console.error(error instanceof Error ? error.message : String(error)),
      ),
    ),
).pipe(Command.withDescription("Show or change the touchpad state."));

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  NodeRuntime.runMain(
    withExecutionLog("mb-touchpad", command.pipe(Command.run({ version: "1.0.0" }))).pipe(
      Effect.provide(NodeServices.layer),
    ),
  );
}
