import {
  globSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { getErrorMessage } from "@accel-os/shared/guards";
import { CsvError } from "csv-parse";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const HELP = `Usage: mb-merge-csvs --output FILE [OPTIONS] [FILES_OR_GLOBS...]

Merge UTF-8 CSV pages in natural filename order, keeping one matching header.
Defaults to *.csv in the current directory; excludes the output.
Auto-detects comma, semicolon, or tab; preserves the first input's delimiter
and BOM. Output uses LF line endings. Existing output is never overwritten.
Inputs are validated in full, one file at a time; cell contents are never printed.

  -o, --output FILE       Destination CSV
      --delimiter VALUE   Override detection (one character, or "tab")
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

type Records = [string[], ...string[][]];

function readRecords(text: string, delimiter: string, filename: string): Records {
  try {
    const records: string[][] = parse(text, { delimiter, bom: true });
    const [header, ...rows] = records;
    if (header === undefined) {
      throw new Error(`Empty CSV: ${filename}`);
    }
    return [header, ...rows];
  } catch (error) {
    if (error instanceof CsvError) {
      // CsvError.message may contain private field values.
      throw new Error(
        `${filename}: ${error.code} at line ${String(error["lines"])}, record ${Number(error["records"]) + 1}`,
        { cause: error },
      );
    }
    throw error;
  }
}

function detect(text: string, filename: string): { delimiter: string; records: Records } {
  const candidates = [];
  for (const delimiter of DELIMITERS) {
    try {
      const records = readRecords(text, delimiter, filename);
      if (records[0].length > 1) {
        candidates.push({ delimiter, records });
      }
    } catch {
      // A candidate must parse the entire file with consistent column counts.
    }
  }
  const candidate = candidates[0];
  if (candidate === undefined || candidates.length !== 1) {
    throw new Error(
      `${filename}: ${candidates.length ? "ambiguous delimiter" : "no consistent delimiter detected (empty, single-column, or invalid CSV)"}; use --delimiter to select the format and diagnose parsing errors`,
    );
  }
  return candidate;
}

function merge(inputs: string[], destination: string, override: string | undefined): void {
  const temporary = mkdtempSync(join(dirname(destination), ".mb-merge-csvs-"));
  const staged = join(temporary, "merged.csv");
  let header: string[] | undefined;
  let delimiter: string | undefined;
  let rows = 0;
  try {
    for (const file of inputs) {
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          readFileSync(file),
        );
      } catch (error) {
        throw new Error(`Could not read UTF-8 input: ${file}`, { cause: error });
      }
      const parsed =
        override === undefined
          ? detect(text, file)
          : { delimiter: override, records: readRecords(text, override, file) };
      const currentHeader = parsed.records[0];
      if (delimiter !== undefined && delimiter !== parsed.delimiter) {
        throw new Error(`Conflicting delimiter: ${file}`);
      }
      if (
        header !== undefined &&
        (header.length !== currentHeader.length ||
          header.some((field, index) => field !== currentHeader[index]))
      ) {
        throw new Error(`Header mismatch: ${file}`);
      }
      const first = header === undefined;
      delimiter = parsed.delimiter;
      header = currentHeader;
      rows += parsed.records.length - 1;
      writeFileSync(
        staged,
        stringify(first ? parsed.records : parsed.records.slice(1), {
          delimiter,
          bom: first && text.startsWith("\uFEFF"),
          record_delimiter: "\n",
        }),
        { flag: first ? "wx" : "a" },
      );
    }
    // A hard link publishes the complete file atomically and refuses any existing target.
    linkSync(staged, destination);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  console.log(`Created ${destination}: ${inputs.length} files, ${rows} data rows.`);
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      delimiter: { type: "string" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!values.output && !values["dry-run"]) {
    throw new Error("Specify --output FILE (or --dry-run). See --help.");
  }
  const override = values.delimiter === "tab" ? "\t" : values.delimiter;
  if (override !== undefined && (!/^.$/u.test(override) || /["\r\n\uFEFF]/u.test(override))) {
    throw new Error("--delimiter must be one character other than a quote, newline, or BOM.");
  }
  const output = values.output === undefined ? undefined : resolve(values.output);
  const files = new Set<string>();
  for (const pattern of positionals.length ? positionals : ["*.csv"]) {
    const matches = globSync(pattern).filter((file) => statSync(file).isFile());
    if (matches.length === 0) {
      throw new Error(`No files match: ${pattern}`);
    }
    for (const file of matches) {
      if (resolve(file) !== output) files.add(resolve(file));
    }
  }
  const inputs = [...files].sort(compareNames);
  if (inputs.length === 0) throw new Error("No input CSV files.");
  for (const file of inputs) console.log(file);
  if (values["dry-run"]) return;
  if (output === undefined) throw new Error("Specify --output FILE.");
  merge(inputs, output, override);
}

try {
  main();
} catch (error) {
  console.error(getErrorMessage(error));
  process.exitCode = 1;
}
