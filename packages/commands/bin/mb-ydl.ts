import { spawnSync } from "node:child_process";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { parseJsonWithSchema } from "@accel-os/shared/json";
import { Type } from "typebox";

const usage = `Usage:
  mb-ydl <video-url>

Interactively download one video or its audio into the current directory.
Choose an audio language when multiple tracks are available.
`;

const YtDlpFormatSchema = Type.Object(
  {
    format_id: Type.String(),
    height: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    vcodec: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    acodec: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    filesize: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    filesize_approx: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    tbr: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    vbr: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    abr: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    language: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    language_preference: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    format_note: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: true },
);

const YtDlpMetadataSchema = Type.Intersect([
  Type.Object(
    {
      title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      duration: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      _type: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    },
    { additionalProperties: true },
  ),
  Type.Union([
    Type.Object({ formats: Type.Array(YtDlpFormatSchema) }, { additionalProperties: true }),
    YtDlpFormatSchema,
  ]),
]);

type Size = { bytes: number; approximate: boolean };

type Format = {
  id: string;
  height: number | undefined;
  video: boolean;
  audio: boolean;
  size: Size | undefined;
  videoBitrate: number | undefined;
  audioBitrate: number | undefined;
  language: string | undefined;
  languagePreference: number | undefined;
  formatNote: string | undefined;
};

export type LanguageChoice = {
  id: string;
  label: string;
  preference: number | undefined;
};

export type Metadata = {
  title: string;
  isPlaylist: boolean;
  formats: Format[];
};

export type VideoChoice = {
  id: string;
  label: string;
  format: string;
  height: number | undefined;
  size?: Size | undefined;
};

export type AudioChoice = {
  id: string;
  label: string;
  format: string;
  audioFormat?: "mp3" | "m4a" | "opus";
  size?: Size | undefined;
};

type ParsedArgs = { help: true } | { help: false; url: string };

const outputTemplate = "%(playlist_index|)s%(playlist_index& - |)s%(title)s.%(ext)s";

export function parseYdlArgs(args: readonly string[]): ParsedArgs {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: { help: { type: "boolean", short: "h" } },
  });

  if (parsed.values.help === true) return { help: true };

  const [url, extra] = parsed.positionals;
  if (url === undefined || extra !== undefined) {
    throw new Error("Expected exactly one video URL");
  }

  return { help: false, url };
}

export function parseMetadata(text: string): Metadata {
  const raw = parseJsonWithSchema(text, YtDlpMetadataSchema, "yt-dlp metadata");
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
      language: nonEmptyString(format.language),
      languagePreference: format.language_preference ?? undefined,
      formatNote: nonEmptyString(format.format_note),
    })),
  };
}

export function buildLanguageChoices(metadata: Metadata): LanguageChoice[] {
  const choices = new Map<string, LanguageChoice>();
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  for (const format of metadata.formats) {
    if (!format.audio) continue;
    const id = audioLanguageId(format);
    const current = choices.get(id);
    if (current !== undefined) {
      if (compareOptionalNumbers(format.languagePreference, current.preference) > 0) {
        current.preference = format.languagePreference;
      }
      continue;
    }
    const language = format.language?.replace(/-desc$/iu, "");
    let label = "Unknown language";
    if (language !== undefined) {
      try {
        label = `${names.of(language) ?? language} (${language})`;
      } catch {
        label = language;
      }
    }
    if (isDescriptiveAudio(format)) label += " (audio description)";
    choices.set(id, { id, label, preference: format.languagePreference });
  }
  return [...choices.values()].sort(
    (left, right) =>
      compareOptionalNumbers(right.preference, left.preference) ||
      left.label.localeCompare(right.label),
  );
}

export function filterAudioLanguage(metadata: Metadata, language: LanguageChoice): Metadata {
  return {
    ...metadata,
    // Keep video-only streams, but never let a muxed stream bypass the selected language.
    formats: metadata.formats.filter(
      (format) => !format.audio || audioLanguageId(format) === language.id,
    ),
  };
}

function isDescriptiveAudio(format: Format): boolean {
  // Extractors may identify description tracks through a language suffix or a format note.
  return (
    /-desc$/iu.test(format.language ?? "") ||
    /\b(?:audio description|descriptive)\b/iu.test(format.formatNote ?? "")
  );
}

function audioLanguageId(format: Format): string {
  return JSON.stringify([
    format.language?.replace(/-desc$/iu, "") ?? null,
    isDescriptiveAudio(format),
  ]);
}

export function buildVideoChoices(metadata: Metadata): VideoChoice[] {
  const audio = pickBestAudio(metadata.formats);
  const bestByHeight = new Map<number | undefined, Format>();

  for (const format of metadata.formats) {
    if (!format.video || (!format.audio && audio === undefined)) {
      continue;
    }

    const current = bestByHeight.get(format.height);
    if (current === undefined || compareVideoFormats(format, current) > 0) {
      bestByHeight.set(format.height, format);
    }
  }

  return [...bestByHeight.entries()]
    .sort(([left], [right]) => compareResolutionChoices(left, right))
    .map(([height, video]) => {
      const format = video.audio ? video.id : `${video.id}+${audio?.id ?? ""}`;
      const size = video.audio ? video.size : addSizes(video.size, audio?.size);
      return {
        id: `video-${height ?? "unknown"}`,
        label: `${formatResolution(height)}\t${formatSize(size)}`,
        format,
        height,
        size,
      };
    });
}

export function buildAudioChoices(metadata: Metadata): AudioChoice[] {
  const audio =
    pickBestAudio(metadata.formats) ??
    metadata.formats
      .filter((format) => format.audio)
      .sort(compareAudioFormats)
      .at(-1);
  if (audio === undefined) return [];

  return [
    {
      id: "audio-original",
      label: `Original\t${formatSize(audio.size)}`,
      format: audio.id,
      size: audio.size,
    },
    ...(["mp3", "m4a", "opus"] as const).map((audioFormat) => ({
      id: `audio-${audioFormat}`,
      label: `${audioFormat.toUpperCase()}\t${formatSize(audio.size)} source download`,
      format: audio.id,
      audioFormat,
      size: audio.size,
    })),
  ];
}

export function formatSize(size: Size | undefined): string {
  if (size === undefined) return "unknown";

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = size.bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const digits = value >= 10 || unit === 0 || Number.isInteger(value) ? 0 : 1;
  return `${size.approximate ? "~" : ""}${value.toFixed(digits)} ${units[unit]}`;
}

export function buildDownloadArgs(choice: VideoChoice | AudioChoice): string[] {
  const args = ["--no-playlist", "-o", outputTemplate, "--format", choice.format];
  if (!("height" in choice)) {
    args.push("--extract-audio");
    if (choice.audioFormat !== undefined) {
      args.push("--audio-format", choice.audioFormat);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseYdlArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("mb-ydl requires an interactive terminal");
  }

  process.stdout.write("Fetching video details...\n");
  const metadata = fetchMetadata(args.url);
  if (metadata.isPlaylist) {
    throw new Error("Expected a single video, not a playlist");
  }

  const mode = selectChoice("Download> ", [
    { id: "video", label: "Video + audio" },
    { id: "audio", label: "Audio only" },
  ]);
  if (mode === undefined) return;

  const languages = buildLanguageChoices(metadata);
  const language =
    languages.length === 1 ? languages[0] : selectChoice("Audio language> ", languages);
  if (language === undefined) return;
  const selectedMetadata = filterAudioLanguage(metadata, language);

  let choice: VideoChoice | AudioChoice;
  if (mode.id === "video") {
    const selected = selectChoice("Resolution> ", buildVideoChoices(selectedMetadata));
    if (selected === undefined) return;
    choice = selected;
  } else {
    const selected = selectChoice("Audio output> ", buildAudioChoices(selectedMetadata));
    if (selected === undefined) return;
    choice = selected;
  }

  process.stdout.write(`\nReady to download:\n  Title:   ${metadata.title}\n`);
  process.stdout.write(`  Language: ${language.label}\n`);
  process.stdout.write(
    "height" in choice
      ? `  Format:  Video + audio, ${formatResolution(choice.height)}\n`
      : `  Format:  Audio only, ${choice.audioFormat?.toUpperCase() ?? "original"}\n`,
  );
  process.stdout.write(
    `  Size:    ${formatSize(choice.size)}${
      !("height" in choice) && choice.audioFormat !== undefined ? " source download" : ""
    }\n`,
  );

  if (!(await confirm("Proceed? [Y/n] "))) return;

  const result = spawnSync("yt-dlp", [...buildDownloadArgs(choice), args.url], {
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`yt-dlp exited with status ${String(result.status)}`);
  }
}

export function fetchMetadata(url: string): Metadata {
  const result = spawnSync(
    "yt-dlp",
    [
      "--no-playlist",
      "--skip-download",
      "--dump-single-json",
      "--compat-options",
      "manifest-filesize-approx",
      url,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      // Full format metadata can exceed Node's default buffer. Keep a 32 MiB ceiling;
      // switch to streamed metadata if real single-video responses exceed it.
      maxBuffer: 32 * 1024 ** 2,
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`yt-dlp exited with status ${String(result.status)}`);
  }
  return parseMetadata(result.stdout);
}

function selectChoice<T extends { id: string; label: string }>(
  prompt: string,
  choices: readonly T[],
): T | undefined {
  if (choices.length === 0) {
    throw new Error(`No ${prompt.slice(0, -2).toLowerCase()} choices are available`);
  }

  const result = spawnSync(
    "fzf",
    [
      "--no-sort",
      "--disabled",
      "--delimiter=\t",
      "--with-nth=2..",
      "--accept-nth=1",
      `--prompt=${prompt}`,
    ],
    {
      encoding: "utf8",
      input: choices.map((choice) => `${choice.id}\t${choice.label}`).join("\n"),
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status === 130) return undefined;
  if (result.status !== 0) {
    throw new Error(`fzf exited with status ${String(result.status)}`);
  }

  const choice = choices.find((candidate) => candidate.id === result.stdout.trim());
  if (choice === undefined) throw new Error("fzf returned an unknown choice");
  return choice;
}

async function confirm(question: string): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(question);
    return answer.trim() === "" || /^y(?:es)?$/iu.test(answer);
  } finally {
    readline.close();
  }
}

function pickBestAudio(formats: readonly Format[]): Format | undefined {
  return formats
    .filter((format) => format.audio && !format.video)
    .sort(compareAudioFormats)
    .at(-1);
}

function compareVideoFormats(left: Format, right: Format): number {
  return (
    compareOptionalNumbers(left.videoBitrate, right.videoBitrate) ||
    compareOptionalNumbers(left.audioBitrate, right.audioBitrate) ||
    left.id.localeCompare(right.id)
  );
}

function compareAudioFormats(left: Format, right: Format): number {
  return (
    compareOptionalNumbers(left.audioBitrate, right.audioBitrate) ||
    compareOptionalNumbers(left.size?.bytes, right.size?.bytes) ||
    left.id.localeCompare(right.id)
  );
}

function compareOptionalNumbers(left: number | undefined, right: number | undefined): number {
  return (left ?? -1) - (right ?? -1);
}

function formatResolution(height: number | undefined): string {
  return height === undefined ? "Unknown resolution" : `${String(height)}p`;
}

function compareResolutionChoices(left: number | undefined, right: number | undefined): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  if (left === 1080 && right !== 1080) return -1;
  if (right === 1080 && left !== 1080) return 1;
  return right - left;
}

function addSizes(left: Size | undefined, right: Size | undefined): Size | undefined {
  if (left === undefined || right === undefined) return undefined;
  return { bytes: left.bytes + right.bytes, approximate: left.approximate || right.approximate };
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
    process.exitCode = 1;
  });
}
