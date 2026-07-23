import { discoverAudiobookFolders } from "./sync_audiobooks.ts";

type Args = {
  dir: string;
  json: boolean;
};

function usage(): never {
  console.error("Usage: list_audiobooks.ts [dir] [--json]");
  process.exit(64);
}

function parseArgs(argv: string[]): Args {
  let json = false;
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") usage();
    if (arg.startsWith("--")) usage();
    positional.push(arg);
  }

  if (positional.length > 1) usage();
  return { dir: positional[0] ?? process.cwd(), json };
}

const args = parseArgs(process.argv.slice(2));
const folders = await discoverAudiobookFolders(args.dir);

if (args.json) {
  console.log(JSON.stringify({ dir: args.dir, folders }, null, 2));
} else {
  for (const folder of folders) console.log(folder);
}
