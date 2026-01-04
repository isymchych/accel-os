#!/usr/bin/env -S deno run --quiet --allow-env=HOME,USERPROFILE

const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
if (!home) {
  console.error("ERROR: HOME/USERPROFILE not set");
  Deno.exit(2);
}

const target = `${home}/temp/screenshots`;
let dirInfo;
try {
  dirInfo = await Deno.stat(target);
} catch {
  console.error(`ERROR: missing directory: ${target}`);
  Deno.exit(2);
}

if (!dirInfo.isDirectory) {
  console.error(`ERROR: not a directory: ${target}`);
  Deno.exit(2);
}

let latestPath: string | null = null;
let latestMtime = 0;

for await (const entry of Deno.readDir(target)) {
  if (!entry.isFile || !entry.name.toLowerCase().endsWith(".png")) continue;
  const fullPath = `${target}/${entry.name}`;
  const stat = await Deno.stat(fullPath);
  const mtime = stat.mtime?.getTime() ?? 0;
  if (mtime >= latestMtime) {
    latestMtime = mtime;
    latestPath = fullPath;
  }
}

if (!latestPath) {
  console.error(`ERROR: no .png files in: ${target}`);
  Deno.exit(3);
}

console.log(latestPath);
