import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_DESTINATION,
  discoverAudiobookFolders,
  manifestsEqual,
  manifestStats,
  parseAdbPushSummary,
  parseArgs,
  posixQuote,
  validateFolderName,
} from "./sync_audiobooks.ts";

test("parseArgs accepts explicit folders", () => {
  assert.deepEqual(parseArgs(["/books", "One", "Two"]), {
    sourceDir: "/books",
    folders: ["One", "Two"],
    allAudiobooks: false,
    destination: DEFAULT_DESTINATION,
    replaceExisting: false,
  });
});

test("parseArgs accepts --all-audiobooks and custom destination", () => {
  assert.deepEqual(parseArgs(["--destination", "/sdcard/Books", "--all-audiobooks", "/books"]), {
    sourceDir: "/books",
    folders: [],
    allAudiobooks: true,
    destination: "/sdcard/Books",
    replaceExisting: false,
  });
});

test("parseArgs accepts --replace-existing", () => {
  assert.deepEqual(parseArgs(["--replace-existing", "/books", "Book"]), {
    sourceDir: "/books",
    folders: ["Book"],
    allAudiobooks: false,
    destination: DEFAULT_DESTINATION,
    replaceExisting: true,
  });
});

test("posixQuote preserves spaces, unicode, and single quotes", () => {
  assert.equal(posixQuote("/sdcard/Audiobooks/Джо's book"), "'/sdcard/Audiobooks/Джо'\\''s book'");
});

test("parseAdbPushSummary extracts stable adb summary values", () => {
  assert.deepEqual(
    parseAdbPushSummary(
      "Book",
      "Book/: 42 files pushed, 0 skipped. 25.4 MB/s (1064916912 bytes in 40.035s)",
    ),
    {
      folder: "Book",
      output: "Book/: 42 files pushed, 0 skipped. 25.4 MB/s (1064916912 bytes in 40.035s)",
      filesPushed: 42,
      bytes: 1_064_916_912,
      durationSeconds: 40.035,
    },
  );
});

test("manifestsEqual compares exact relative paths and byte sizes", () => {
  assert.equal(
    manifestsEqual(
      [
        { path: "02.mp3", bytes: 20 },
        { path: "01.mp3", bytes: 10 },
      ],
      [
        { path: "01.mp3", bytes: 10 },
        { path: "renamed.mp3", bytes: 20 },
      ],
    ),
    false,
  );
  assert.equal(
    manifestsEqual(
      [
        { path: "01.mp3", bytes: 10 },
        { path: "02.mp3", bytes: 20 },
      ],
      [
        { path: "01.mp3", bytes: 10 },
        { path: "02.mp3", bytes: 20 },
      ],
    ),
    true,
  );
});

test("manifestStats keeps readable aggregate totals", () => {
  assert.deepEqual(
    manifestStats([
      { path: "01.mp3", bytes: 10 },
      { path: "02.mp3", bytes: 20 },
    ]),
    { files: 2, bytes: 30 },
  );
});

test("validateFolderName allows only direct child names", () => {
  validateFolderName("Book: Part 1");
  const originalExit = process.exit.bind(process);
  const originalError = console.error.bind(console);
  try {
    process.exit = (code?: string | number | null): never => {
      throw new Error(`process.exit ${String(code)}`);
    };
    console.error = (): void => {};
    assert.throws(() => validateFolderName("../Book"), /process\.exit 64/);
  } finally {
    process.exit = originalExit;
    console.error = originalError;
  }
});

test("discoverAudiobookFolders returns direct folders containing nested audio files", async () => {
  const root = join(tmpdir(), `adb-audiobook-sync-${process.pid}-${Date.now()}`);
  await mkdir(join(root, "Book A", "Disc 1"), { recursive: true });
  await mkdir(join(root, "Book B"), { recursive: true });
  await mkdir(join(root, "Movie"), { recursive: true });
  await writeFile(join(root, "Book A", "Disc 1", "chapter.MP3"), "audio");
  await writeFile(join(root, "Book B", "cover.jpg"), "image");
  await writeFile(join(root, "Movie", "video.mkv"), "video");

  try {
    assert.deepEqual(await discoverAudiobookFolders(root), ["Book A"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
