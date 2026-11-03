import { rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

import {
  discardCandidate,
  prepareArtifact,
  publishArtifact,
  stateDirectory,
  type Artifact,
} from "../launcher/artifacts.ts";
import { buildCandidate, buildLauncher } from "./build-candidate.ts";
import { initializeState } from "./setup-state.ts";

const source = resolve(import.meta.dirname, "..");
const state = stateDirectory(source);
const args = process.argv.slice(2);
const standalone = args.length === 0;
if (standalone) await initializeState(source, state);
let candidate: Artifact;
if (standalone) {
  candidate = await prepareArtifact(state);
} else {
  const directory = args.at(1);
  const id = args.at(2);
  if (args.length !== 3 || args[0] !== "--candidate" || !directory || !id)
    throw new Error("Usage: build [--candidate <directory> <version>]");
  candidate = { directory: resolve(directory), id };
}

try {
  await buildCandidate(candidate);
  // Retain the saved-state directory names; launcher output is independent of API/UI slots.
  if (standalone) {
    const owner = resolve(state, "owner");
    const pendingOwner = resolve(state, "owner.next");
    await rm(pendingOwner, { recursive: true, force: true });
    await buildLauncher(pendingOwner);
    await rm(owner, { recursive: true, force: true });
    await rename(pendingOwner, owner);
    await publishArtifact(state, candidate);
  }
} finally {
  if (standalone) {
    await discardCandidate(state);
    await rm(resolve(state, "owner.next"), { recursive: true, force: true });
  }
}
