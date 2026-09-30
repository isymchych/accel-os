import { parseArgs as parseNodeArgs } from "node:util";

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
  const parsed = parseCliArgs(argv);
  if (parsed.values.help === true) usage();

  if (parsed.positionals.length > 1) usage();
  return { dir: parsed.positionals[0] ?? process.cwd(), json: parsed.values.json === true };
}

// oxlint-disable-next-line typescript/explicit-function-return-type -- Preserve Node's option-specific inferred return type.
function parseCliArgs(args: string[]) {
  try {
    return parseNodeArgs({
      args,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
      },
    });
  } catch {
    return usage();
  }
}

const args = parseArgs(process.argv.slice(2));
const folders = await discoverAudiobookFolders(args.dir);

if (args.json) {
  console.log(JSON.stringify({ dir: args.dir, folders }, null, 2));
} else {
  for (const folder of folders) console.log(folder);
}
