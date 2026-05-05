/**
 * Based on https://raw.githubusercontent.com/mitsuhiko/agent-stuff/refs/heads/main/extensions/multi-edit.ts
 *
 * Adapted for this Pi config to:
 * - support Pi's current built-in `edit` shape (`path` + `edits[]`)
 * - add `multi` cross-file edits and `patch` apply_patch payloads
 * - participate in Pi's file mutation queue for safe parallel tool execution
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { executeMultiEditTool, multiEditSchema } from "../lib/multi-edit.ts";

export { executeMultiEditTool } from "../lib/multi-edit.ts";

export default function multiEditExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "edit",
    label: "edit",
    description:
      "Edit files using exact text replacement. Supports Pi's built-in single-file edits[], plus cross-file multi edits and Codex-style apply_patch payloads.",
    promptSnippet:
      "Make precise file edits with exact text replacement, including multi-file and patch-based edits",
    promptGuidelines: [
      "Use edit for precise changes (edits[].oldText or oldText must match exactly).",
      "Use edit.multi to apply multiple edits across one or more files in a single tool call.",
      "Use edit.patch for Codex-style apply_patch payloads when a hunk-based patch is the clearest representation.",
      "When using top-level edits[], all replacements target the same top-level path.",
    ],
    parameters: multiEditSchema,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return executeMultiEditTool(toolCallId, params, signal, onUpdate, ctx.cwd);
    },
  });
}
