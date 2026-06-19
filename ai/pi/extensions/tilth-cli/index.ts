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

- Prefer Tilth tools for repository exploration; use the host \`read\` tool when exact raw output formatting matters, such as numbered lines or loading SKILL.md instructions.
- Prefer \`tilth_search\` for code exploration before falling back to shell-based discovery.
- Use \`tilth_search\` with \`mode=auto\` for symbol and concept lookup, \`mode=literal\` for exact text, and \`mode=callers\` for call sites.
- Use \`tilth_read\` to inspect repository files with a concise structured view, especially for large files or focused follow-ups.
- Use \`tilth_read\` with \`section\` for line ranges like \`45-89\` or headings like \`## Installation\`.
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
      description:
        "Inspect repository files with concise structured output, scoped sections, and token budgets.",
      promptSnippet:
        "Inspect a repository file with concise structured output or a focused section",
      promptGuidelines: [
        "Use tilth_read to inspect repository files when you need a concise structured view instead of raw full-file output.",
        "Use tilth_read for large files because it can return an outline with important sections expanded within a token budget.",
        'Use tilth_read with section for focused follow-up reads by line range or heading, such as section: "45-89".',
        "Use the host read tool when exact raw output formatting matters, such as numbered lines.",
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
      description:
        "Find definitions, usages, exact text, regex matches, or callers in repository code.",
      promptSnippet: "Find repository code by definition, usage, exact text, regex, or caller",
      promptGuidelines: [
        "Use tilth_search first when you need to find where code, symbols, concepts, or text live before reading files.",
        "Use tilth_search with mode=literal for exact text and mode=regex for pattern searches.",
        "Use tilth_search with mode=callers when you need call sites for a known symbol.",
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
      description: "Find repository files by glob when you need candidate paths.",
      promptSnippet: "Find repository file paths by glob pattern",
      promptGuidelines: [
        "Use tilth_files to discover candidate file paths by glob when you do not have a useful search query yet.",
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
      description: "Inspect a file's imports and dependents before changing its API or location.",
      promptSnippet: "Inspect a file's imports and dependents before a breaking change",
      promptGuidelines: [
        "Use tilth_deps before renaming, moving, deleting, or changing exported APIs so you can see affected imports and dependents.",
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
      description:
        "Build an end-to-end map of a symbol or target, including related definitions, callers, and tests.",
      promptSnippet: "Map a symbol or target across definitions, callers, and tests",
      promptGuidelines: [
        "Use tilth_grok when you need to understand one symbol, module, or path:line target deeply before changing it.",
        "Prefer tilth_search or tilth_read for simple lookup and file inspection tasks.",
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
