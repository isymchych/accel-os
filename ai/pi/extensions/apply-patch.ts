/**
 * Register a dedicated apply_patch tool for Codex-style patch edits.
 *
 * This keeps hunk-based patch application separate from exact-text editing.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  applyPatchSchema,
  executeApplyPatchTool,
  prepareApplyPatchArguments,
} from "../lib/apply-patch.ts";

export default function applyPatchExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "apply_patch",
    label: "apply_patch",
    description: "Apply Codex-style patch envelopes with add/delete/update/move file operations.",
    promptSnippet:
      "Apply Codex-style patch envelopes for multi-file edits, updates, adds, deletes, and moves",
    promptGuidelines: [
      "Use apply_patch for hunk-based edits, especially multi-file changes, renames, adds, deletes, or context-based updates.",
      "Pass the full patch text in apply_patch.input.",
      "apply_patch accepts relative or absolute file paths in patch headers.",
    ],
    parameters: applyPatchSchema,
    prepareArguments: prepareApplyPatchArguments,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return executeApplyPatchTool(toolCallId, params, signal, onUpdate, ctx.cwd);
    },
  });
}
