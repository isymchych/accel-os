/** Normalized formats and selection rules for mb-ydl. */
export type Size = { bytes: number; approximate: boolean };

export type Format = {
  id: string;
  height: number | undefined;
  video: boolean;
  audio: boolean;
  size: Size | undefined;
  videoBitrate: number | undefined;
  audioBitrate: number | undefined;
  language: string | undefined;
  languagePreference: number | undefined;
  descriptiveAudio: boolean;
};

export type Metadata = {
  title: string;
  isPlaylist: boolean;
  formats: Format[];
};

export type LanguageChoice = {
  id: string;
  label: string;
  preference: number | undefined;
};

export type VideoChoice = {
  kind: "video";
  id: string;
  label: string;
  format: string;
  height: number | undefined;
  size: Size | undefined;
};

export type AudioChoice = {
  kind: "audio";
  id: string;
  label: string;
  format: string;
  audioFormat?: "mp3" | "m4a" | "opus";
  size: Size | undefined;
};

export type DownloadChoice = VideoChoice | AudioChoice;

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
    let label = "Unknown language";
    if (format.language !== undefined) {
      try {
        label = `${names.of(format.language) ?? format.language} (${format.language})`;
      } catch {
        label = format.language;
      }
    }
    if (format.descriptiveAudio) label += " (audio description)";
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

function audioLanguageId(format: Format): string {
  return JSON.stringify([format.language ?? null, format.descriptiveAudio]);
}

export function buildVideoChoices(metadata: Metadata): VideoChoice[] {
  const audio = pickBestAudio(metadata.formats);
  const bestByHeight = new Map<number | undefined, Format>();

  for (const format of metadata.formats) {
    if (!format.video || (!format.audio && audio === undefined)) continue;

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
        kind: "video",
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
      kind: "audio",
      id: "audio-original",
      label: `Original\t${formatSize(audio.size)}`,
      format: audio.id,
      size: audio.size,
    },
    ...(["mp3", "m4a", "opus"] as const).map((audioFormat) => ({
      kind: "audio" as const,
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

export function formatResolution(height: number | undefined): string {
  return height === undefined ? "Unknown resolution" : `${String(height)}p`;
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
