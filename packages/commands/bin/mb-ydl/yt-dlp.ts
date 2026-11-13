import process from "node:process";

import { Cause, Effect, Exit, Schema, Stream } from "effect";
import type { PlatformError } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { logEvent } from "../../lib/execution-log.ts";
import type { DownloadChoice, Metadata, Size } from "./formats.ts";

const optionalString = Schema.optionalKey(Schema.NullOr(Schema.String));
const optionalNumber = Schema.optionalKey(Schema.NullOr(Schema.Number));
const formatFields = {
  format_id: Schema.String,
  height: optionalNumber,
  vcodec: optionalString,
  acodec: optionalString,
  filesize: optionalNumber,
  filesize_approx: optionalNumber,
  tbr: optionalNumber,
  vbr: optionalNumber,
  abr: optionalNumber,
  language: optionalString,
  language_preference: optionalNumber,
  format_note: optionalString,
};
const metadataFields = { title: optionalString, duration: optionalNumber, _type: optionalString };
const YtDlpMetadataSchema = Schema.Union([
  Schema.Struct({ ...metadataFields, formats: Schema.Array(Schema.Struct(formatFields)) }),
  Schema.Struct({ ...metadataFields, ...formatFields }),
]);

const outputTemplate = "%(playlist_index|)s%(playlist_index& - |)s%(title)s.%(ext)s";

type YtDlpOperation<A> = Effect.Effect<
  A,
  Error | PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner
>;

export function parseMetadata(text: string): Metadata {
  const raw = Schema.decodeUnknownSync(YtDlpMetadataSchema)(JSON.parse(text));
  const { _type: metadataType } = raw;
  const duration = positiveNumber(raw.duration);
  // Single-format results store the format fields directly on the metadata object.
  const formats = "formats" in raw ? raw.formats : [raw];

  return {
    title: nonEmptyString(raw.title) ?? "Unknown title",
    isPlaylist: metadataType === "playlist",
    formats: formats.map((format) => ({
      id: format.format_id,
      height: positiveInteger(format.height),
      // Only "none" rules out a stream; missing codecs are unknown in yt-dlp metadata.
      video: format.vcodec !== "none",
      audio: format.acodec !== "none",
      size: getFormatSize(
        format.filesize,
        format.filesize_approx,
        format.tbr ?? format.vbr ?? format.abr,
        duration,
      ),
      videoBitrate: positiveNumber(format.vbr) ?? positiveNumber(format.tbr),
      audioBitrate: positiveNumber(format.abr) ?? positiveNumber(format.tbr),
      language: nonEmptyString(format.language)?.replace(/-desc$/iu, ""),
      languagePreference: format.language_preference ?? undefined,
      // Extractors use either a language suffix or a format note for description tracks.
      descriptiveAudio:
        /-desc$/iu.test(format.language ?? "") ||
        /\b(?:audio description|descriptive)\b/iu.test(format.format_note ?? ""),
    })),
  };
}

export function buildDownloadArgs(choice: DownloadChoice): string[] {
  const args = ["--no-playlist", "-o", outputTemplate, "--format", choice.format];
  if (choice.kind === "audio") {
    args.push("--extract-audio");
    if (choice.audioFormat !== undefined) args.push("--audio-format", choice.audioFormat);
  }
  return args;
}

export const fetchMetadata = (url: string): YtDlpOperation<Metadata> =>
  Effect.gen(function* () {
    const output = yield* runYtDlp(
      "metadata",
      [
        "--no-playlist",
        "--skip-download",
        "--dump-single-json",
        "--compat-options",
        "manifest-filesize-approx",
        url,
      ],
      { url },
    );
    const metadata = yield* Effect.try(() => parseMetadata(output));
    yield* logEvent("metadata_parsed", {
      title: metadata.title,
      format_count: metadata.formats.length,
      is_playlist: metadata.isPlaylist,
    });
    return metadata;
  });

export const downloadMedia = (url: string, choice: DownloadChoice): YtDlpOperation<void> =>
  runYtDlp("download", [...buildDownloadArgs(choice), url], {
    url,
    format: choice.format,
    output_template: outputTemplate,
  }).pipe(Effect.asVoid);

// Both operations own the same lifecycle; only metadata captures stdout.
function runYtDlp(
  stage: "metadata" | "download",
  args: string[],
  fields: Record<string, unknown>,
): YtDlpOperation<string> {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const start = performance.now();
    yield* logEvent(`${stage}_started`);
    const result = yield* Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make("yt-dlp", args, {
          stdin: stage === "metadata" ? "ignore" : "inherit",
          stdout: stage === "metadata" ? "pipe" : "inherit",
          stderr: "pipe",
        }),
      );
      const [output] = yield* Effect.all(
        [
          stage === "metadata"
            ? Stream.runFold(
                Stream.decodeText(child.stdout),
                () => "",
                (text, chunk) => text + chunk,
              )
            : Effect.succeed(""),
          child.stderr.pipe(
            Stream.tap((chunk) =>
              Effect.sync(() => {
                process.stderr.write(chunk);
              }),
            ),
            Stream.decodeText(),
            // Retain diagnostics as they arrive, including when the process is interrupted.
            Stream.runForEach((stderr) => logEvent("yt_dlp_stderr", { stderr })),
          ),
        ],
        { concurrency: "unbounded" },
      );
      const code = yield* child.exitCode;
      return { output, code };
    }).pipe(
      Effect.onExit((exit) =>
        logEvent(`${stage}_finished`, {
          duration_ms: Math.round(performance.now() - start),
          ...(Exit.isSuccess(exit)
            ? { exit_code: exit.value.code, outcome: exit.value.code === 0 ? "success" : "failure" }
            : Exit.hasInterrupts(exit)
              ? { outcome: "cancelled" }
              : { outcome: "failure", error: Cause.pretty(exit.cause) }),
        }),
      ),
    );
    if (result.code !== 0) {
      return yield* Effect.fail(new Error(`yt-dlp exited with status ${result.code}`));
    }
    return result.output;
  }).pipe(Effect.annotateLogs({ ...fields, stage }), Effect.scoped);
}

function getFormatSize(
  exact: number | null | undefined,
  approximate: number | null | undefined,
  bitrateKbps: number | null | undefined,
  duration: number | undefined,
): Size | undefined {
  const exactBytes = positiveNumber(exact);
  if (exactBytes !== undefined) return { bytes: exactBytes, approximate: false };

  const approximateBytes = positiveNumber(approximate);
  if (approximateBytes !== undefined) return { bytes: approximateBytes, approximate: true };

  const bitrate = positiveNumber(bitrateKbps);
  if (bitrate === undefined || duration === undefined) return undefined;
  return { bytes: (bitrate * 1000 * duration) / 8, approximate: true };
}

function positiveInteger(value: number | null | undefined): number | undefined {
  const number = positiveNumber(value);
  return number !== undefined && Number.isInteger(number) ? number : undefined;
}

function positiveNumber(value: number | null | undefined): number | undefined {
  return value !== null && value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function nonEmptyString(value: string | null | undefined): string | undefined {
  return value !== null && value !== undefined && value !== "" ? value : undefined;
}
