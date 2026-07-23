import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { runCommand } from "@accel-os/shared/process";

type Args = {
  sourceDir: string;
  folders: string[];
  allAudiobooks: boolean;
  destination: string;
  replaceExisting: boolean;
};

type FileStats = {
  files: number;
  bytes: number;
};

type ManifestEntry = {
  path: string;
  bytes: number;
};

type PushSummary = {
  folder: string;
  output: string;
  filesPushed: number | null;
  bytes: number | null;
  durationSeconds: number | null;
};

type VerificationStatus =
  | "OK_PUSHED"
  | "OK_ALREADY_PRESENT"
  | "OK_REPLACED"
  | "DIFF_PRESENT"
  | "DIFF_AFTER_PUSH";

type VerificationRow = {
  folder: string;
  local: FileStats;
  phone: FileStats;
  status: VerificationStatus;
};

type DeviceRow = {
  serial: string;
  state: string;
  details: string;
};

type RemotePathState = "missing" | "dir" | "other";

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".m4a",
  ".m4b",
  ".aac",
  ".ogg",
  ".opus",
  ".flac",
  ".wav",
]);
const DEFAULT_DESTINATION = "/sdcard/Audiobooks";

function usage(): never {
  console.error(
    "Usage: sync_audiobooks.ts [--destination <path>] [--replace-existing] (--all-audiobooks <dir> | <dir> <folder>...)",
  );
  process.exit(64);
}

export function parseArgs(argv: string[]): Args {
  let destination = DEFAULT_DESTINATION;
  let allAudiobooks = false;
  let replaceExisting = false;
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--destination") {
      const value = argv[index + 1];
      if (!value) usage();
      destination = value;
      index += 1;
      continue;
    }
    if (arg === "--all-audiobooks") {
      allAudiobooks = true;
      continue;
    }
    if (arg === "--replace-existing") {
      replaceExisting = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") usage();
    if (arg?.startsWith("--")) usage();
    if (arg) positional.push(arg);
  }

  if (positional.length === 0) usage();
  const [sourceDir, ...folders] = positional;
  if (!sourceDir) usage();
  if (allAudiobooks && folders.length > 0) {
    console.error("ERR_USAGE: --all-audiobooks cannot be mixed with explicit folder names");
    process.exit(64);
  }
  if (!allAudiobooks && folders.length === 0) {
    console.error("ERR_USAGE: expected folder names or --all-audiobooks");
    process.exit(64);
  }

  return { sourceDir, folders, allAudiobooks, destination, replaceExisting };
}

export function posixQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function parseAdbPushSummary(folder: string, output: string): PushSummary {
  const match = output.match(
    /:\s*(\d+) files pushed,\s*\d+ skipped\.\s*[^(]*\((\d+) bytes in ([0-9.]+)s\)/,
  );
  return {
    folder,
    output,
    filesPushed: match?.[1] === undefined ? null : Number(match[1]),
    bytes: match?.[2] === undefined ? null : Number(match[2]),
    durationSeconds: match?.[3] === undefined ? null : Number(match[3]),
  };
}

export function validateFolderName(folder: string): void {
  if (
    folder.length === 0 ||
    folder === "." ||
    folder === ".." ||
    folder.includes("/") ||
    folder.includes("\\") ||
    folder.includes("\0")
  ) {
    console.error(`ERR_UNSAFE_FOLDER_NAME: expected direct child folder name: ${folder}`);
    process.exit(64);
  }
}

export function manifestStats(manifest: ManifestEntry[]): FileStats {
  return {
    files: manifest.length,
    bytes: manifest.reduce((sum, entry) => sum + entry.bytes, 0),
  };
}

export function manifestsEqual(left: ManifestEntry[], right: ManifestEntry[]): boolean {
  const sortedLeft = sortManifest([...left]);
  const sortedRight = sortManifest([...right]);
  if (sortedLeft.length !== sortedRight.length) return false;
  return sortedLeft.every((entry, index) => {
    const other = sortedRight[index];
    return other !== undefined && entry.path === other.path && entry.bytes === other.bytes;
  });
}

export async function discoverAudiobookFolders(sourceDir: string): Promise<string[]> {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const folders: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await containsAudioFile(join(sourceDir, entry.name))) folders.push(entry.name);
  }

  return folders.sort((left, right) => left.localeCompare(right));
}

async function containsAudioFile(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (await containsAudioFile(fullPath)) return true;
      continue;
    }
    if (entry.isFile() && AUDIO_EXTENSIONS.has(extensionOf(entry.name))) return true;
  }
  return false;
}

function extensionOf(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) return "";
  return fileName.slice(dotIndex).toLowerCase();
}

async function localManifest(dir: string): Promise<ManifestEntry[]> {
  const manifest: ManifestEntry[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const fileStat = await stat(fullPath);
      manifest.push({ path: normalizeRelativePath(relative(dir, fullPath)), bytes: fileStat.size });
    }
  }

  await walk(dir);
  return sortManifest(manifest);
}

function normalizeRelativePath(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

function sortManifest(manifest: ManifestEntry[]): ManifestEntry[] {
  return manifest.sort((left, right) => left.path.localeCompare(right.path));
}

function parseDeviceRows(output: string): DeviceRow[] {
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial = "", state = "", ...details] = line.split(/\s+/);
      return { serial, state, details: details.join(" ") };
    });
}

async function resolveAdbSerial(): Promise<string> {
  const devices = await runCommand("adb", ["devices", "-l"]);
  if (!devices.success) failCommand("adb devices -l", devices.stdout, devices.stderr, devices.code);

  console.log(devices.stdout);
  const rows = parseDeviceRows(devices.stdout);
  const unauthorized = rows.find((row) => row.state === "unauthorized");
  if (unauthorized) {
    console.error(
      `ERR_ADB_UNAUTHORIZED: ${unauthorized.serial} is unauthorized; unlock phone and accept USB debugging prompt`,
    );
    process.exit(65);
  }

  const ready = rows.filter((row) => row.state === "device");
  if (ready.length === 0) {
    console.error("ERR_ADB_NO_DEVICE: no adb device in state 'device'");
    process.exit(65);
  }
  if (ready.length > 1) {
    console.error(`ERR_ADB_MULTIPLE_DEVICES: expected one device, found ${ready.length}`);
    process.exit(65);
  }
  const [device] = ready;
  if (device === undefined) {
    console.error("ERR_ADB_NO_DEVICE: no adb device in state 'device'");
    process.exit(65);
  }
  return device.serial;
}

async function adbShell(serial: string, command: string): Promise<string> {
  const result = await runCommand("adb", ["-s", serial, "shell", command]);
  if (!result.success)
    failCommand(`adb -s ${serial} shell ${command}`, result.stdout, result.stderr, result.code);
  return result.stdout.replaceAll("\r", "").trim();
}

async function prepareDestination(serial: string, destination: string): Promise<void> {
  await adbShell(serial, `mkdir -p ${posixQuote(destination)}`);
}

function remoteFolderPath(destination: string, folder: string): string {
  return `${destination.replace(/\/+$/, "")}/${folder}`;
}

async function remotePathState(
  serial: string,
  destination: string,
  folder: string,
): Promise<RemotePathState> {
  const quotedPath = posixQuote(remoteFolderPath(destination, folder));
  const state = await adbShell(
    serial,
    `if [ -d ${quotedPath} ]; then echo dir; elif [ -e ${quotedPath} ]; then echo other; else echo missing; fi`,
  );
  if (state !== "missing" && state !== "dir" && state !== "other") {
    console.error(
      `ERR_REMOTE_STATE: unexpected state for ${remoteFolderPath(destination, folder)}: ${state}`,
    );
    process.exit(1);
  }
  return state;
}

async function removeRemotePath(
  serial: string,
  destination: string,
  folder: string,
): Promise<void> {
  await adbShell(serial, `rm -rf ${posixQuote(remoteFolderPath(destination, folder))}`);
}

async function pushFolder(
  serial: string,
  sourceDir: string,
  folder: string,
  destination: string,
): Promise<PushSummary> {
  const localFolder = join(sourceDir, folder);
  const folderStat = await stat(localFolder);
  if (!folderStat.isDirectory()) {
    console.error(`ERR_LOCAL_FOLDER: not a directory: ${localFolder}`);
    process.exit(66);
  }

  const result = await runCommand("adb", [
    "-s",
    serial,
    "push",
    localFolder,
    `${destination.replace(/\/+$/, "")}/`,
  ]);
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (!result.success)
    failCommand(`adb -s ${serial} push ${localFolder}`, result.stdout, result.stderr, result.code);
  return parseAdbPushSummary(folder, output);
}

async function phoneManifest(
  serial: string,
  destination: string,
  folder: string,
): Promise<ManifestEntry[]> {
  const phonePath = remoteFolderPath(destination, folder);
  const quotedPath = posixQuote(phonePath);
  const output = await adbShell(
    serial,
    `cd ${quotedPath} && find . -type f -exec stat -c '%n\t%s' {} \\;`,
  );
  if (output.length === 0) return [];
  return sortManifest(
    output.split("\n").map((line) => {
      const tabIndex = line.lastIndexOf("\t");
      if (tabIndex < 0) {
        console.error(`ERR_PHONE_MANIFEST: cannot parse line: ${line}`);
        process.exit(1);
      }
      const rawPath = line.slice(0, tabIndex);
      const bytes = Number(line.slice(tabIndex + 1));
      if (!Number.isSafeInteger(bytes) || bytes < 0) {
        console.error(`ERR_PHONE_MANIFEST: invalid byte count: ${line}`);
        process.exit(1);
      }
      return { path: rawPath.replace(/^\.\//, ""), bytes };
    }),
  );
}

async function verifyFolder(
  serial: string,
  sourceDir: string,
  folder: string,
  destination: string,
  successStatus: VerificationStatus,
): Promise<VerificationRow> {
  const local = await localManifest(join(sourceDir, folder));
  const phone = await phoneManifest(serial, destination, folder);
  const status = manifestsEqual(local, phone) ? successStatus : "DIFF_AFTER_PUSH";
  return { folder, local: manifestStats(local), phone: manifestStats(phone), status };
}

function printPushSummaries(summaries: PushSummary[]): void {
  console.log("\n== PUSH SUMMARIES ==");
  if (summaries.length === 0) {
    console.log("none");
    return;
  }
  for (const summary of summaries) {
    const files = summary.filesPushed === null ? "unknown files" : `${summary.filesPushed} files`;
    const bytes = summary.bytes === null ? "unknown bytes" : `${summary.bytes} bytes`;
    const duration =
      summary.durationSeconds === null ? "unknown duration" : `${summary.durationSeconds}s`;
    console.log(`${summary.folder}\t${files}\t${bytes}\t${duration}`);
  }
}

function printVerification(rows: VerificationRow[]): void {
  console.log("\n== VERIFY ==");
  console.log("folder\tfiles_local\tfiles_phone\tbytes_local\tbytes_phone\tstatus");
  for (const row of rows) {
    console.log(
      `${row.folder}\t${row.local.files}\t${row.phone.files}\t${row.local.bytes}\t${row.phone.bytes}\t${row.status}`,
    );
  }
}

function failCommand(command: string, stdout: string, stderr: string, code: number): never {
  console.error(`ERR_COMMAND: ${command} exited with status ${code}`);
  if (stderr) console.error(stderr);
  if (stdout) console.error(stdout);
  process.exit(1);
}

async function resolveFolders(args: Args): Promise<string[]> {
  if (!args.allAudiobooks) return args.folders;
  const folders = await discoverAudiobookFolders(args.sourceDir);
  if (folders.length === 0) {
    console.error(`ERR_EMPTY_TRANSFER_SET: no audiobook folders found in ${args.sourceDir}`);
    process.exit(67);
  }
  return folders;
}

async function handlePresentFolder(
  serial: string,
  sourceDir: string,
  folder: string,
  destination: string,
  replaceExisting: boolean,
  pushSummaries: PushSummary[],
): Promise<VerificationRow> {
  const local = await localManifest(join(sourceDir, folder));
  const phone = await phoneManifest(serial, destination, folder);
  if (manifestsEqual(local, phone)) {
    return {
      folder,
      local: manifestStats(local),
      phone: manifestStats(phone),
      status: "OK_ALREADY_PRESENT",
    };
  }

  if (!replaceExisting) {
    return {
      folder,
      local: manifestStats(local),
      phone: manifestStats(phone),
      status: "DIFF_PRESENT",
    };
  }

  await removeRemotePath(serial, destination, folder);
  pushSummaries.push(await pushFolder(serial, sourceDir, folder, destination));
  return verifyFolder(serial, sourceDir, folder, destination, "OK_REPLACED");
}

async function syncFolder(
  serial: string,
  sourceDir: string,
  folder: string,
  destination: string,
  replaceExisting: boolean,
  pushSummaries: PushSummary[],
): Promise<VerificationRow> {
  const state = await remotePathState(serial, destination, folder);
  if (state === "missing") {
    pushSummaries.push(await pushFolder(serial, sourceDir, folder, destination));
    return verifyFolder(serial, sourceDir, folder, destination, "OK_PUSHED");
  }
  if (state === "dir") {
    return handlePresentFolder(
      serial,
      sourceDir,
      folder,
      destination,
      replaceExisting,
      pushSummaries,
    );
  }

  if (!replaceExisting) {
    const local = await localManifest(join(sourceDir, folder));
    return {
      folder,
      local: manifestStats(local),
      phone: { files: 0, bytes: 0 },
      status: "DIFF_PRESENT",
    };
  }

  await removeRemotePath(serial, destination, folder);
  pushSummaries.push(await pushFolder(serial, sourceDir, folder, destination));
  return verifyFolder(serial, sourceDir, folder, destination, "OK_REPLACED");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const folders = await resolveFolders(args);
  for (const folder of folders) validateFolderName(folder);

  console.log("selected folders");
  for (const folder of folders) console.log(`- ${folder}`);

  const serial = await resolveAdbSerial();
  await prepareDestination(serial, args.destination);

  const pushSummaries: PushSummary[] = [];
  const verificationRows: VerificationRow[] = [];
  for (const folder of folders) {
    verificationRows.push(
      await syncFolder(
        serial,
        args.sourceDir,
        folder,
        args.destination,
        args.replaceExisting,
        pushSummaries,
      ),
    );
  }

  printPushSummaries(pushSummaries);
  printVerification(verificationRows);

  const finalStatus = verificationRows.every((row) => row.status.startsWith("OK_"))
    ? "ALL_OK"
    : "HAS_DIFF";
  console.log(`FINAL_STATUS=${finalStatus}`);
  process.exit(finalStatus === "ALL_OK" ? 0 : 1);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERR_INTERNAL: ${message}`);
    process.exit(1);
  }
}

export type { Args, FileStats, ManifestEntry, PushSummary, VerificationRow, VerificationStatus };
export { AUDIO_EXTENSIONS, DEFAULT_DESTINATION };
