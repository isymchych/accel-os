import { dirname, join, resolve } from "node:path";

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Option, Stream } from "effect";
import type { PlatformError } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { Csv } from "effect/encoding";

import { logEvent, withExecutionLog } from "../lib/execution-log.ts";

const HELP = `Usage: mb-merge-csvs --output FILE [OPTIONS] [FILES_OR_GLOBS...]

Merge UTF-8 CSV pages in natural filename order, keeping one matching header.
Defaults to *.csv in the current directory; excludes the output.
Auto-detects comma, semicolon, or tab; preserves the first input's delimiter
and BOM. Output uses the first input's record separator (LF or CRLF), or LF
if none is detected. Existing output is never overwritten.
Inputs are validated in full, one file at a time; cell contents are never printed.
LF, CRLF, and CR are accepted as record separators, including mixed input.

  -o, --output FILE       Destination CSV
      --delimiter VALUE   Override detection (one UTF-16 code unit, or "tab")
      --newline lf|crlf   Override the output record separator
      --dry-run           List input order only, without reading file contents
  -h, --help              Show this help

Examples:
  mb-merge-csvs -o combined.csv
  mb-merge-csvs -o combined.csv 'goods*.csv'
  mb-merge-csvs --dry-run 'goods*.csv'
  mb-merge-csvs -o combined.csv --delimiter ';'
`;
const DELIMITERS = [",", ";", "\t"];
const collator = new Intl.Collator("en", { numeric: true });

function compareNames(left: string, right: string): number {
  // Browser download copies: goods.csv precedes goods (1).csv.
  const parts = (name: string): [string, bigint] => {
    const match = /^(.*) \((\d+)\)(\.[^./]+)$/u.exec(name);
    return match ? [`${match[1]}${match[3]}`, BigInt(String(match[2]))] : [name, 0n];
  };
  const [leftBase, leftNumber] = parts(left);
  const [rightBase, rightNumber] = parts(right);
  if (leftBase === rightBase && leftNumber !== rightNumber) {
    return leftNumber < rightNumber ? -1 : 1;
  }
  return collator.compare(leftBase, rightBase) || (left < right ? -1 : left > right ? 1 : 0);
}

type Records = readonly [Csv.Row, ...Csv.Row[]];

function detectNewline(text: string): "\n" | "\r\n" {
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === "\r") {
      return text[index + 1] === "\n" ? "\r\n" : "\n";
    } else if (!quoted && character === "\n") {
      return "\n";
    }
  }

  return "\n";
}

function readRecords(
  text: string,
  delimiter: string,
  filename: string,
): Effect.Effect<Records, Error> {
  return Effect.gen(function* () {
    const records = yield* Stream.make(text).pipe(
      Stream.pipeThroughChannel(Csv.decodeString({ delimiter, maxRecordSize: Infinity })),
      Stream.runCollect,
      Effect.mapError(
        (error) =>
          new Error(`${filename}: invalid CSV at line ${error.line}, record ${error.record}`),
      ),
    );
    const [header, ...rows] = records;

    if (header === undefined) {
      return yield* Effect.fail(new Error(`Empty CSV: ${filename}`));
    }

    for (const [index, row] of rows.entries()) {
      if (row.length !== header.length) {
        return yield* Effect.fail(
          new Error(`${filename}: inconsistent field count at record ${index + 2}`),
        );
      }
    }

    return [header, ...rows] as Records;
  });
}

function detect(
  text: string,
  filename: string,
): Effect.Effect<{ delimiter: string; records: Records }, Error> {
  return Effect.gen(function* () {
    const candidates: { delimiter: string; records: Records }[] = [];

    for (const delimiter of DELIMITERS) {
      const result = yield* readRecords(text, delimiter, filename).pipe(Effect.option);

      if (Option.isSome(result) && result.value[0].length > 1) {
        candidates.push({ delimiter, records: result.value });
      }
    }

    const candidate = candidates[0];
    if (candidate === undefined || candidates.length !== 1) {
      return yield* Effect.fail(
        new Error(
          `${filename}: ${candidates.length ? "ambiguous delimiter" : "no consistent delimiter detected (empty, single-column, or invalid CSV)"}; use --delimiter to select the format and diagnose parsing errors`,
        ),
      );
    }

    return candidate;
  });
}

function merge(
  inputs: string[],
  destination: string,
  override: string | undefined,
  newlineOverride: "\n" | "\r\n" | undefined,
): Effect.Effect<void, Error | PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const temporary = yield* fs.makeTempDirectoryScoped({
      directory: dirname(destination),
      prefix: ".mb-merge-csvs-",
    });
    const staged = join(temporary, "merged.csv");
    let header: Csv.Row | undefined;
    let delimiter: string | undefined;
    let newline = newlineOverride ?? "\n";
    let rows = 0;

    for (const file of inputs) {
      const bytes = yield* fs
        .readFile(file)
        .pipe(Effect.mapError(() => new Error(`Could not read UTF-8 input: ${file}`)));
      const text = yield* Effect.try({
        try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
        catch: () => new Error(`Could not read UTF-8 input: ${file}`),
      });
      const parsed =
        override === undefined
          ? yield* detect(text, file)
          : { delimiter: override, records: yield* readRecords(text, override, file) };
      const currentHeader = parsed.records[0];

      if (delimiter !== undefined && delimiter !== parsed.delimiter) {
        yield* Effect.fail(new Error(`Conflicting delimiter: ${file}`));
      }
      if (
        header !== undefined &&
        (header.length !== currentHeader.length ||
          header.some((field, index) => field !== currentHeader[index]))
      ) {
        yield* Effect.fail(new Error(`Header mismatch: ${file}`));
      }

      const first = header === undefined;
      if (first && newlineOverride === undefined) newline = detectNewline(text);
      delimiter = parsed.delimiter;
      header = currentHeader;
      rows += parsed.records.length - 1;
      const encoded = yield* Stream.fromIterable(
        first ? parsed.records : parsed.records.slice(1),
      ).pipe(
        Stream.pipeThroughChannel(Csv.encodeString({ delimiter, newline })),
        Stream.runCollect,
      );
      const bom = first && text.startsWith("\uFEFF") ? "\uFEFF" : "";

      yield* fs.writeFileString(staged, bom + encoded.join(""), { flag: first ? "wx" : "a" });
    }

    // A hard link publishes the complete file atomically and refuses any existing target.
    yield* fs.link(staged, destination);
    yield* logEvent("merge_completed", { destination, input_count: inputs.length, rows });
    yield* Console.log(`Created ${destination}: ${inputs.length} files, ${rows} data rows.`);
  }).pipe(Effect.scoped);
}

const command = Command.make(
  "mb-merge-csvs",
  {
    output: Flag.String("output").pipe(Flag.withAlias("o"), Flag.optional),
    delimiter: Flag.String("delimiter").pipe(Flag.optional),
    newline: Flag.Literals("newline", ["lf", "crlf"]).pipe(Flag.optional),
    dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)),
    patterns: Argument.String("files-or-globs").pipe(Argument.variadic()),
  },
  ({
    output: outputOption,
    delimiter: delimiterOption,
    newline: newlineOption,
    dryRun,
    patterns,
  }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const outputValue = Option.getOrUndefined(outputOption);
      const delimiterValue = Option.getOrUndefined(delimiterOption);
      const newline = Option.getOrUndefined(
        newlineOption.pipe(Option.map((value) => (value === "lf" ? "\n" : "\r\n"))),
      );

      if (!outputValue && !dryRun) {
        yield* Effect.fail(new Error("Specify --output FILE (or --dry-run). See --help."));
      }

      const override = delimiterValue === "tab" ? "\t" : delimiterValue;
      if (override !== undefined && (override.length !== 1 || /["\r\n\uFEFF]/u.test(override))) {
        yield* Effect.fail(
          new Error(
            "--delimiter must be one UTF-16 code unit other than a quote, newline, or BOM.",
          ),
        );
      }

      const output = outputValue === undefined ? undefined : resolve(outputValue);
      const files = new Set<string>();
      for (const pattern of patterns.length ? patterns : ["*.csv"]) {
        const found = yield* fs.glob(pattern);
        const matches: string[] = [];

        for (const file of found) {
          if ((yield* fs.stat(file)).type === "File") matches.push(file);
        }

        if (matches.length === 0) {
          yield* Effect.fail(new Error(`No files match: ${pattern}`));
        }
        for (const file of matches) {
          if (resolve(file) !== output) files.add(resolve(file));
        }
      }

      const inputs = [...files].sort(compareNames);
      if (inputs.length === 0) yield* Effect.fail(new Error("No input CSV files."));

      for (const file of inputs) yield* Console.log(file);
      if (dryRun) return;
      if (output === undefined) {
        yield* Effect.fail(new Error("Specify --output FILE."));
      } else {
        yield* merge(inputs, output, override, newline);
      }
    }),
).pipe(Command.withDescription(HELP));

NodeRuntime.runMain(
  withExecutionLog(
    "mb-merge-csvs",
    command.pipe(
      Command.run({ version: "1.0.0" }),
      Effect.tapError((error) =>
        Console.error(error instanceof Error ? error.message : String(error)),
      ),
    ),
  ).pipe(Effect.provide(NodeServices.layer)),
);
