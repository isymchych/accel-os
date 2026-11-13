import process from "node:process";
import { pathToFileURL } from "node:url";

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Terminal } from "effect";
import type { PlatformError } from "effect";
import { Argument, Command, Prompt } from "effect/cli";
import type { ChildProcessSpawner } from "effect/process";

import { logEvent, withExecutionLog } from "../../lib/execution-log.ts";
import {
  buildAudioChoices,
  buildLanguageChoices,
  buildVideoChoices,
  filterAudioLanguage,
  formatResolution,
  formatSize,
} from "./formats.ts";
import type { DownloadChoice, LanguageChoice, Metadata } from "./formats.ts";
import { downloadMedia, fetchMetadata } from "./yt-dlp.ts";

const usage = `Usage:
  mb-ydl <video-url>

Interactively download one video or its audio into the current directory.
Choose an audio language when multiple tracks are available.
`;

type Selection = { language: LanguageChoice; choice: DownloadChoice };

function selectChoice<T extends { label: string }>(
  message: string,
  choices: readonly T[],
): Effect.Effect<T, Error | Terminal.QuitError, Prompt.Environment> {
  if (choices.length === 0)
    return Effect.fail(new Error(`No ${message.toLowerCase()} choices are available`));
  return Prompt.run(
    Prompt.Select({
      message,
      choices: choices.map((choice) => ({ title: choice.label, value: choice })),
    }),
  );
}

function chooseDownload(
  metadata: Metadata,
): Effect.Effect<Selection, Error | Terminal.QuitError, Prompt.Environment> {
  return Effect.gen(function* () {
    const mode = yield* selectChoice("Download", [
      { id: "video", label: "Video + audio" },
      { id: "audio", label: "Audio only" },
    ]);
    const languages = buildLanguageChoices(metadata);
    const language =
      languages.length === 1 && languages[0] !== undefined
        ? languages[0]
        : yield* selectChoice("Audio language", languages);
    const selected = filterAudioLanguage(metadata, language);
    const choice =
      mode.id === "video"
        ? yield* selectChoice("Resolution", buildVideoChoices(selected))
        : yield* selectChoice("Audio output", buildAudioChoices(selected));
    return { language, choice };
  });
}

function showSelection(
  metadata: Metadata,
  language: LanguageChoice,
  choice: DownloadChoice,
): Effect.Effect<void> {
  const description =
    choice.kind === "video"
      ? `Video + audio, ${formatResolution(choice.height)}`
      : `Audio only, ${choice.audioFormat?.toUpperCase() ?? "original"}`;
  const sourceSize = choice.kind === "audio" && choice.audioFormat !== undefined;
  return Effect.gen(function* () {
    yield* logEvent("selection_finished", {
      title: metadata.title,
      mode: choice.kind,
      language: language.label,
      format: choice.format,
      ...(choice.kind === "video"
        ? { resolution: formatResolution(choice.height) }
        : { audio_format: choice.audioFormat ?? "original" }),
      ...(choice.size === undefined
        ? {}
        : { size_bytes: Math.round(choice.size.bytes), size_approximate: choice.size.approximate }),
    });
    yield* Console.log(
      `\nReady to download:\n  Title:   ${metadata.title}\n  Language: ${language.label}\n  Format:  ${description}\n  Size:    ${formatSize(choice.size)}${sourceSize ? " source download" : ""}`,
    );
  });
}

const download = (
  url: string,
): Effect.Effect<
  void,
  Error | PlatformError.PlatformError,
  Prompt.Environment | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    yield* logEvent("request_received");
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return yield* Effect.fail(new Error("mb-ydl requires an interactive terminal"));
    }

    yield* Console.log("Fetching video details...");
    const metadata = yield* fetchMetadata(url);
    if (metadata.isPlaylist)
      return yield* Effect.fail(new Error("Expected a single video, not a playlist"));

    const { language, choice } = yield* chooseDownload(metadata);
    yield* showSelection(metadata, language, choice);
    if (!(yield* Prompt.run(Prompt.Confirm({ message: "Proceed?", initial: true })))) {
      return yield* logEvent("request_cancelled", { outcome: "cancelled", reason: "declined" });
    }
    return yield* downloadMedia(url, choice);
  }).pipe(
    Effect.catchIf(Terminal.isQuitError, () =>
      logEvent("request_cancelled", { outcome: "cancelled", reason: "quit" }),
    ),
    Effect.annotateLogs({ url }),
  );

const command = Command.make("mb-ydl", { url: Argument.String("video-url") }, ({ url }) =>
  download(url),
).pipe(Command.withDescription(usage));

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  NodeRuntime.runMain(
    withExecutionLog("mb-ydl", command.pipe(Command.run({ version: "1.0.0" }))).pipe(
      Effect.provide(NodeServices.layer),
    ),
  );
}
