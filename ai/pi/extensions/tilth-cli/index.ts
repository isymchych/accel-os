/**
 * Register Pi-native Tilth CLI tools.
 *
 * This keeps Tilth under direct extension ownership instead of routing through
 * MCP, while preserving the main workflow guidance that makes Tilth useful for
 * code exploration: search first, read only when needed, use deps before
 * breaking API changes, and reach for grok when the task is about
 * understanding a symbol end-to-end.
 */
import { defineTool, isBashToolResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createTilthShellHint } from "./hints.ts";
import {
  renderTilthDepsCall,
  renderTilthFilesCall,
  renderTilthGrokCall,
  renderTilthReadCall,
  renderTilthResult,
  renderTilthSearchCall,
} from "./render.ts";
import {
  executeTilthDeps,
  executeTilthFiles,
  executeTilthGrok,
  executeTilthRead,
  executeTilthSearch,
  tilthDepsSchema,
  tilthFilesSchema,
  tilthGrokSchema,
  tilthReadSchema,
  tilthSearchSchema,
  tilthToolNames,
  type TilthExec,
  type TilthToolDetails,
} from "./tool.ts";

const tilthToolNameSet = new Set<string>(tilthToolNames);

const TILTH_GUIDANCE = `## Tilth CLI workflow

- Prefer \`tilth_search\` for code exploration before falling back to shell-based discovery.
- Use \`tilth_search\` with \`mode=auto\` for symbol and concept lookup, \`mode=literal\` for exact text, and \`mode=callers\` for call sites.
- Use \`tilth_read\` for file contents and focused sections after search has identified the right file.
- Use \`tilth_files\` only when you need file listing and do not yet have a useful search query.
- Use \`tilth_deps\` before renaming, removing, or changing exported APIs that callers may depend on.
- Use \`tilth_grok\` when the user asks to understand a symbol end-to-end instead of chaining multiple search and read calls.`;

export default function tilthCliExtension(pi: ExtensionAPI): void {
  const execTilth: TilthExec = async (command, args, options) => pi.exec(command, args, options);
  const getActiveTilthTools = (): ReadonlySet<string> => new Set(pi.getActiveTools());

  pi.registerTool(
    defineTool<typeof tilthReadSchema, TilthToolDetails>({
      name: "tilth_read",
      label: "tilth_read",
      description: "Read a file through Tilth with smart outlining and focused sections.",
      promptSnippet: "Read a file or focused section with Tilth smart outlining",
      promptGuidelines: [
        "Use tilth_read for file contents after you know which file or section you need.",
        "Use tilth_read with section for focused follow-up reads instead of reading entire large files.",
      ],
      parameters: tilthReadSchema,
      renderShell: "self",
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return executeTilthRead(execTilth, params, ctx.cwd, signal);
      },
      renderCall(args, theme, context) {
        return renderTilthReadCall(args, theme, context);
      },
      renderResult(result, options, theme, context) {
        return renderTilthResult(result, options, theme, context);
      },
    }),
  );

  pi.registerTool(
    defineTool<typeof tilthSearchSchema, TilthToolDetails>({
      name: "tilth_search",
      label: "tilth_search",
      description: "Search code with Tilth for symbols, concepts, exact text, regexes, or callers.",
      promptSnippet:
        "Search code with Tilth for definitions, usages, concepts, exact text, or callers",
      promptGuidelines: [
        "Use tilth_search first when exploring code instead of starting with shell-based grep or file listing.",
        "Use tilth_search with mode=callers when the task is to find call sites of a symbol.",
      ],
      parameters: tilthSearchSchema,
      renderShell: "self",
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return executeTilthSearch(execTilth, params, ctx.cwd, signal);
      },
      renderCall(args, theme, context) {
        return renderTilthSearchCall(args, theme, context);
      },
      renderResult(result, options, theme, context) {
        return renderTilthResult(result, options, theme, context);
      },
    }),
  );

  pi.registerTool(
    defineTool<typeof tilthFilesSchema, TilthToolDetails>({
      name: "tilth_files",
      label: "tilth_files",
      description: "List files matching a glob pattern through Tilth.",
      promptSnippet: "List files matching a glob pattern through Tilth",
      promptGuidelines: [
        "Use tilth_files only when you need file listing and do not yet have a useful tilth_search query.",
      ],
      parameters: tilthFilesSchema,
      renderShell: "self",
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return executeTilthFiles(execTilth, params, ctx.cwd, signal);
      },
      renderCall(args, theme, context) {
        return renderTilthFilesCall(args, theme, context);
      },
      renderResult(result, options, theme, context) {
        return renderTilthResult(result, options, theme, context);
      },
    }),
  );

  pi.registerTool(
    defineTool<typeof tilthDepsSchema, TilthToolDetails>({
      name: "tilth_deps",
      label: "tilth_deps",
      description: "Check Tilth blast-radius dependencies for a file before breaking changes.",
      promptSnippet: "Check a file's imports and dependents before a breaking change",
      promptGuidelines: [
        "Use tilth_deps before renaming, removing, or changing exported APIs that other files may call.",
      ],
      parameters: tilthDepsSchema,
      renderShell: "self",
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return executeTilthDeps(execTilth, params, ctx.cwd, signal);
      },
      renderCall(args, theme, context) {
        return renderTilthDepsCall(args, theme, context);
      },
      renderResult(result, options, theme, context) {
        return renderTilthResult(result, options, theme, context);
      },
    }),
  );

  pi.registerTool(
    defineTool<typeof tilthGrokSchema, TilthToolDetails>({
      name: "tilth_grok",
      label: "tilth_grok",
      description: "Understand a symbol end-to-end with Tilth grok.",
      promptSnippet: "Understand a symbol end-to-end with Tilth grok",
      promptGuidelines: [
        "Use tilth_grok when the task is to understand one symbol deeply instead of chaining multiple search and read calls.",
      ],
      parameters: tilthGrokSchema,
      renderShell: "self",
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return executeTilthGrok(execTilth, params, ctx.cwd, signal);
      },
      renderCall(args, theme, context) {
        return renderTilthGrokCall(args, theme, context);
      },
      renderResult(result, options, theme, context) {
        return renderTilthResult(result, options, theme, context);
      },
    }),
  );

  pi.on("before_agent_start", (event) => {
    const selectedTools = event.systemPromptOptions.selectedTools ?? [];
    if (!selectedTools.some((toolName) => tilthToolNameSet.has(toolName))) {
      return undefined;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${TILTH_GUIDANCE}`,
    };
  });

  pi.on("tool_result", (event) => {
    if (!isBashToolResult(event)) {
      return undefined;
    }

    const command = typeof event.input["command"] === "string" ? event.input["command"] : "";
    const hint = createTilthShellHint(command, getActiveTilthTools());
    if (hint === undefined) {
      return undefined;
    }

    return {
      content: [...event.content, { type: "text", text: hint }],
    };
  });
}
