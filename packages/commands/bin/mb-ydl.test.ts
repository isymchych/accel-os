import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  buildAudioChoices,
  buildDownloadArgs,
  buildLanguageChoices,
  buildVideoChoices,
  fetchMetadata,
  filterAudioLanguage,
  formatSize,
  parseMetadata,
  parseYdlArgs,
} from "./mb-ydl.ts";

test("fetchMetadata accepts JSON larger than the default subprocess buffer", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "mb-ydl-test-"));
  const originalPath = process.env["PATH"];
  try {
    writeFileSync(
      path.join(directory, "yt-dlp"),
      `#!${process.execPath}
process.stdout.write(JSON.stringify({
  title: "Large metadata",
  formats: [],
  description: "x".repeat(2 * 1024 * 1024)
}));
`,
      { mode: 0o700 },
    );
    process.env["PATH"] = `${directory}${path.delimiter}${originalPath ?? ""}`;

    assert.deepEqual(fetchMetadata("https://example.com/video"), {
      title: "Large metadata",
      isPlaylist: false,
      formats: [],
    });
  } finally {
    if (originalPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = originalPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

const metadata = parseMetadata(
  JSON.stringify({
    title: "Example video",
    duration: 60,
    formats: [
      {
        format_id: "137",
        height: 1080,
        vcodec: "avc1",
        acodec: "none",
        filesize: 100 * 1024 ** 2,
        vbr: 10_000,
      },
      {
        format_id: "399",
        height: 1080,
        vcodec: "av01",
        acodec: "none",
        filesize: 80 * 1024 ** 2,
        vbr: 8_000,
      },
      {
        format_id: "136",
        height: 720,
        vcodec: "avc1",
        acodec: "none",
        filesize_approx: 40 * 1024 ** 2,
        vbr: 4_000,
      },
      { format_id: "140", vcodec: "none", acodec: "mp4a", filesize: 10 * 1024 ** 2, abr: 128 },
      { format_id: "251", vcodec: "none", acodec: "opus", filesize: 8 * 1024 ** 2, abr: 160 },
    ],
  }),
);

test("parseYdlArgs accepts exactly one URL", () => {
  assert.deepEqual(parseYdlArgs(["https://example.com/video"]), {
    help: false,
    url: "https://example.com/video",
  });
  assert.throws(() => parseYdlArgs([]), /Expected exactly one video URL/u);
  assert.throws(() => parseYdlArgs(["first", "second"]), /Expected exactly one video URL/u);
});

test("language selection restricts both modes without losing video-only streams", () => {
  const multilingual = parseMetadata(
    JSON.stringify({
      formats: [
        { format_id: "video", height: 1080, vcodec: "h264", acodec: "none" },
        { format_id: "fr", vcodec: "none", acodec: "opus", language: "fr", abr: 192 },
        {
          format_id: "en-low",
          vcodec: "none",
          acodec: "opus",
          language: "en",
          language_preference: -1,
          abr: 96,
        },
        {
          format_id: "en-best",
          vcodec: "none",
          acodec: "opus",
          language: "en",
          language_preference: 10,
          abr: 128,
        },
        {
          format_id: "fr-muxed",
          height: 1080,
          vcodec: "h264",
          acodec: "aac",
          language: "fr",
          vbr: 10000,
        },
      ],
    }),
  );
  const languages = buildLanguageChoices(multilingual);
  assert.deepEqual(
    languages.map((language) => language.label),
    ["English (en)", "French (fr)"],
  );
  const [english, french] = languages;
  assert.ok(english);
  assert.ok(french);
  const selected = filterAudioLanguage(multilingual, english);
  assert.deepEqual(
    selected.formats.map((format) => format.id),
    ["video", "en-low", "en-best"],
  );
  assert.deepEqual(
    buildVideoChoices(selected).map((choice) => choice.format),
    ["video+en-best"],
  );
  assert.deepEqual(
    buildAudioChoices(selected).map((choice) => choice.format),
    ["en-best", "en-best", "en-best", "en-best"],
  );
  const frenchSelected = filterAudioLanguage(multilingual, french);
  assert.deepEqual(
    buildVideoChoices(frenchSelected).map((choice) => choice.format),
    ["fr-muxed"],
  );
  assert.equal(buildAudioChoices(frenchSelected)[0]?.format, "fr");
  assert.equal(multilingual.formats.length, 5);
});

test("language choices distinguish descriptive audio and unknown languages", () => {
  const tracks = parseMetadata(
    JSON.stringify({
      formats: [
        { format_id: "en", vcodec: "none", language: "en", language_preference: 10 },
        { format_id: "desc", vcodec: "none", language: "en-desc", language_preference: -10 },
        {
          format_id: "desc-note",
          vcodec: "none",
          language: "en",
          format_note: "English descriptive",
        },
        { format_id: "unknown", vcodec: "none", language: null },
        { format_id: "also-unknown", vcodec: "none" },
        { format_id: "invalid-code", vcodec: "none", language: "not_a_language" },
      ],
    }),
  );
  const choices = buildLanguageChoices(tracks);
  assert.equal(choices.length, 4);
  assert.equal(choices[0]?.label, "English (en)");
  const descriptive = choices.find((choice) => choice.label === "English (en) (audio description)");
  const unknown = choices.find((choice) => choice.label === "Unknown language");
  assert.ok(descriptive);
  assert.ok(unknown);
  assert.deepEqual(
    filterAudioLanguage(tracks, descriptive).formats.map((format) => format.id),
    ["desc", "desc-note"],
  );
  assert.deepEqual(
    filterAudioLanguage(tracks, unknown).formats.map((format) => format.id),
    ["unknown", "also-unknown"],
  );
  assert.ok(choices.some((choice) => choice.label === "not_a_language"));
});

test("single-language metadata produces one automatic choice, including top-level formats", () => {
  const single = parseMetadata(
    JSON.stringify({ format_id: "direct", language: "uk", vcodec: "h264", acodec: "aac" }),
  );
  const choices = buildLanguageChoices(single);
  assert.equal(choices.length, 1);
  assert.equal(choices[0]?.label, "Ukrainian (uk)");
  const [language] = choices;
  assert.equal(buildVideoChoices(filterAudioLanguage(single, language))[0]?.format, "direct");
  assert.deepEqual(
    buildLanguageChoices(metadata).map((choice) => choice.label),
    ["Unknown language"],
  );
});

test("parseMetadata accepts a single format stored in top-level fields", () => {
  const singleFormat = parseMetadata(
    JSON.stringify({
      title: "Direct video",
      duration: 60,
      format_id: "0",
      url: "https://example.com/video.mp4",
      height: 720,
      vcodec: "h264",
      acodec: "aac",
      filesize: 20 * 1024 ** 2,
    }),
  );

  assert.equal(singleFormat.title, "Direct video");
  assert.equal(singleFormat.isPlaylist, false);
  assert.deepEqual(buildVideoChoices(singleFormat), [
    {
      id: "video-720",
      label: "720p\t20 MiB",
      format: "0",
      height: 720,
      size: { bytes: 20 * 1024 ** 2, approximate: false },
    },
  ]);
  const [audio] = buildAudioChoices(singleFormat);
  assert.ok(audio);
  assert.deepEqual(buildDownloadArgs(audio), [
    "--no-playlist",
    "-o",
    "%(playlist_index|)s%(playlist_index& - |)s%(title)s.%(ext)s",
    "--format",
    "0",
    "--extract-audio",
  ]);
});

test("buildVideoChoices chooses the best format per resolution and sums audio size", () => {
  assert.deepEqual(buildVideoChoices(metadata), [
    {
      id: "video-1080",
      label: "1080p\t108 MiB",
      format: "137+251",
      height: 1080,
      size: { bytes: 108 * 1024 ** 2, approximate: false },
    },
    {
      id: "video-720",
      label: "720p\t~48 MiB",
      format: "136+251",
      height: 720,
      size: { bytes: 48 * 1024 ** 2, approximate: true },
    },
  ]);
});

for (const height of [undefined, null]) {
  test(`buildVideoChoices keeps direct video with unknown height (${String(height)})`, () => {
    const choices = buildVideoChoices(
      parseMetadata(
        JSON.stringify({
          formats: [{ format_id: "mp4", height, vcodec: null, filesize: 1024 }],
        }),
      ),
    );

    assert.deepEqual(choices, [
      {
        id: "video-unknown",
        label: "Unknown resolution\t1 KiB",
        format: "mp4",
        height: undefined,
        size: { bytes: 1024, approximate: false },
      },
    ]);
    const [choice] = choices;
    assert.ok(choice);
    assert.deepEqual(buildDownloadArgs(choice), [
      "--no-playlist",
      "-o",
      "%(playlist_index|)s%(playlist_index& - |)s%(title)s.%(ext)s",
      "--format",
      "mp4",
    ]);
  });
}

test("buildVideoChoices combines unknown-resolution video with separate audio", () => {
  const choices = buildVideoChoices(
    parseMetadata(
      JSON.stringify({
        formats: [
          { format_id: "video", vcodec: "h264", acodec: "none", filesize: 2048 },
          { format_id: "audio", vcodec: "none", acodec: "aac", filesize: 1024 },
        ],
      }),
    ),
  );

  assert.deepEqual(choices, [
    {
      id: "video-unknown",
      label: "Unknown resolution\t3 KiB",
      format: "video+audio",
      height: undefined,
      size: { bytes: 3072, approximate: false },
    },
  ]);
});

test("buildVideoChoices puts 1080p first and unknown resolution last", () => {
  const choices = buildVideoChoices(
    parseMetadata(
      JSON.stringify({
        formats: [
          { format_id: "unknown", vcodec: "av01", acodec: "none" },
          { format_id: "2160", height: 2160, vcodec: "av01", acodec: "none" },
          { format_id: "1080", height: 1080, vcodec: "av01", acodec: "none" },
          { format_id: "720", height: 720, vcodec: "av01", acodec: "none" },
          { format_id: "audio", vcodec: "none", acodec: "opus" },
        ],
      }),
    ),
  );

  assert.deepEqual(
    choices.map((choice) => choice.height),
    [1080, 2160, 720, undefined],
  );
});

for (const codec of [undefined, null]) {
  test(`unknown codecs (${String(codec)}) keep HLS variants selectable`, () => {
    const hlsMetadata = parseMetadata(
      JSON.stringify({
        formats: [
          { format_id: "hls-720", height: 720, vcodec: codec, acodec: codec },
          {
            format_id: "storyboard",
            height: 1080,
            vcodec: "none",
            acodec: "none",
            tbr: 10_000,
          },
        ],
      }),
    );

    assert.deepEqual(
      buildVideoChoices(hlsMetadata).map((choice) => [choice.height, choice.format]),
      [[720, "hls-720"]],
    );
    assert.deepEqual(
      buildAudioChoices(hlsMetadata).map((choice) => choice.format),
      ["hls-720", "hls-720", "hls-720", "hls-720"],
    );
  });

  test(`unknown codecs (${String(codec)}) preserve explicitly separate streams`, () => {
    const separateMetadata = parseMetadata(
      JSON.stringify({
        formats: [
          { format_id: "video", height: 720, vcodec: codec, acodec: "none" },
          { format_id: "audio", vcodec: "none", acodec: codec },
        ],
      }),
    );

    assert.deepEqual(
      buildVideoChoices(separateMetadata).map((choice) => choice.format),
      ["video+audio"],
    );
    assert.deepEqual(
      buildAudioChoices(separateMetadata).map((choice) => choice.format),
      ["audio", "audio", "audio", "audio"],
    );
  });
}

test("buildAudioChoices shows source sizes for conversions", () => {
  assert.deepEqual(buildAudioChoices(metadata), [
    {
      id: "audio-original",
      label: "Original\t8 MiB",
      format: "251",
      size: { bytes: 8 * 1024 ** 2, approximate: false },
    },
    {
      id: "audio-mp3",
      label: "MP3\t8 MiB source download",
      format: "251",
      audioFormat: "mp3",
      size: { bytes: 8 * 1024 ** 2, approximate: false },
    },
    {
      id: "audio-m4a",
      label: "M4A\t8 MiB source download",
      format: "251",
      audioFormat: "m4a",
      size: { bytes: 8 * 1024 ** 2, approximate: false },
    },
    {
      id: "audio-opus",
      label: "OPUS\t8 MiB source download",
      format: "251",
      audioFormat: "opus",
      size: { bytes: 8 * 1024 ** 2, approximate: false },
    },
  ]);
});

test("buildAudioChoices falls back to combined streams but prefers audio-only sources", () => {
  const combined = parseMetadata(
    JSON.stringify({
      formats: [
        { format_id: "low", height: 720, vcodec: "avc1", acodec: "mp4a", abr: 128 },
        { format_id: "high", height: 1080, vcodec: "avc1", acodec: "mp4a", abr: 192 },
      ],
    }),
  );

  assert.deepEqual(
    buildAudioChoices(combined).map((choice) => [choice.id, choice.format]),
    [
      ["audio-original", "high"],
      ["audio-mp3", "high"],
      ["audio-m4a", "high"],
      ["audio-opus", "high"],
    ],
  );
  assert.deepEqual(
    buildAudioChoices({
      ...metadata,
      formats: [...metadata.formats, ...combined.formats],
    }).map((choice) => choice.format),
    ["251", "251", "251", "251"],
  );
});

test("parseMetadata estimates size from bitrate and duration when yt-dlp omits it", () => {
  const [choice] = buildVideoChoices(
    parseMetadata(
      JSON.stringify({
        duration: 80,
        formats: [
          { format_id: "video", height: 720, vcodec: "avc1", acodec: "none", tbr: 2_000 },
          { format_id: "audio", vcodec: "none", acodec: "opus", abr: 100 },
        ],
      }),
    ),
  );

  assert.ok(choice);
  assert.deepEqual(choice.size, { bytes: 21_000_000, approximate: true });
  assert.equal(choice.label, "720p\t~20 MiB");
});

test("buildDownloadArgs preserves the selected format and conversion", () => {
  const [video] = buildVideoChoices(metadata);
  const audio = buildAudioChoices(metadata).at(1);
  const [originalAudio] = buildAudioChoices(metadata);

  assert.ok(video);
  assert.ok(audio);
  assert.ok(originalAudio);

  assert.deepEqual(buildDownloadArgs(video), [
    "--no-playlist",
    "-o",
    "%(playlist_index|)s%(playlist_index& - |)s%(title)s.%(ext)s",
    "--format",
    "137+251",
  ]);
  assert.deepEqual(buildDownloadArgs(audio), [
    "--no-playlist",
    "-o",
    "%(playlist_index|)s%(playlist_index& - |)s%(title)s.%(ext)s",
    "--format",
    "251",
    "--extract-audio",
    "--audio-format",
    "mp3",
  ]);
  assert.deepEqual(buildDownloadArgs(originalAudio), [
    "--no-playlist",
    "-o",
    "%(playlist_index|)s%(playlist_index& - |)s%(title)s.%(ext)s",
    "--format",
    "251",
    "--extract-audio",
  ]);
});

test("formatSize marks missing and estimated sizes distinctly", () => {
  assert.equal(formatSize(undefined), "unknown");
  assert.equal(formatSize({ bytes: 1_536, approximate: true }), "~1.5 KiB");
});
