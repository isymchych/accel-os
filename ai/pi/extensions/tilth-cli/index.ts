/**
 * Register Pi-native, one-shot Tilth CLI tools.
 *
 * Tilth is intentionally invoked directly rather than through its MCP server.
 * Pi sessions are conversation trees: `/tree` can abandon a branch without
 * restarting extensions. Tilth MCP keeps process-local expansion state and may
 * subsequently report definitions as already shown even when their original
 * output exists only on the abandoned branch.
 *
 * Direct invocation also gives every call an explicit `ctx.cwd`. Tilth MCP's
 * search/list/grok scope resolution currently ignores `root` when `scope` is
 * omitted, which can silently inspect the server launch directory instead of
 * the requested repository. One-shot execution additionally prevents timed-out
 * MCP workers and process-lifetime caches from leaking across calls.
 *
 * The tradeoff is repeated parsing and maintenance of this thin adapter, which
 * is accepted in favor of branch-local, explicit, deterministic tool behavior.
 */
import {
  defineTool,
  isBashToolResult,
  isToolCallEventType,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

import { createTilthShellHint } from "./hints.ts";
import {
  renderTilthDepsCall,
  renderTilthDiffCall,
  renderTilthGrokCall,
  renderTilthListCall,
  renderTilthReadCall,
  renderTilthResult,
  renderTilthSearchCall,
} from "./render.ts";
import {
  executeTilthDeps,
  executeTilthDiff,
  executeTilthGrok,
  executeTilthList,
  executeTilthRead,
  executeTilthSearch,
  prepareTilthDepsInput,
  prepareTilthDiffInput,
  prepareTilthListInput,
  prepareTilthReadInput,
  prepareTilthSearchInput,
  tilthDepsSchema,
  tilthDiffSchema,
  tilthGrokSchema,
  tilthListSchema,
  tilthReadSchema,
  tilthSearchSchema,
  tilthToolNames,
  type TilthDepsInput,
  type TilthDiffInput,
  type TilthExec,
  type TilthListInput,
  type TilthReadInput,
  type TilthSearchInput,
  type TilthToolDetails,
} from "./tool.ts";

const tilthToolNameSet = new Set<string>(tilthToolNames);

const TILTH_GUIDANCE = `## Tilth CLI workflow

- Search first with \`tilth_search\`; it returns definitions, usages, and expanded top matches.
- Do not re-read source already present in expanded search results.
- Use \`tilth_read\` for a known file or focused section; use the host \`read\` tool only when exact raw formatting or instruction loading matters.
- Use \`tilth_list\` only when no useful symbol or text query is available.
- Use \`tilth_deps\` only before changes that may affect callers, exported APIs, or file locations.
- Use \`tilth_grok\` only for end-to-end understanding of one symbol; otherwise use search/read.
- Use \`tilth_diff\` for structural change review; use raw \`git diff --patch\` only when exact patch text is required.
    - Tilth search/read/list/deps/grok tools can inspect another repository or checkout: pass its absolute path as \`scope\`. For \`tilth_diff\`, pass it as \`repository\`; \`scope\` is a repository-relative changed file or \`file:function\` filter, not a directory.
- For authorized inspection of temporary or untrusted clones, prefer Tilth search/read/list over \`git grep\`, \`git ls-files\`, \`find\`, or broad file reads. Tilth inspects files; it does not execute repository code.`;

export default function tilthCliExtension(pi: ExtensionAPI): void {
  const execTilth: TilthExec = async (command, args, options) => pi.exec(command, args, options);
  const getActiveTilthTools = (): ReadonlySet<string> => new Set(pi.getActiveTools());
  const tilthArgumentWarnings = new Map<string, string[]>();

  pi.registerTool(
    defineTool<typeof tilthReadSchema, TilthToolDetails>({
      name: "tilth_read",
      label: "tilth_read",
      description:
        "Read a known file in the current repository or another checkout selected by absolute scope, with bounded output or a focused line range or heading.",
      promptSnippet: "Read a known repository file with bounded output or a focused section",
      promptGuidelines: [
        "Use tilth_read after you know the file you need; search first when its location is unknown.",
        'Use section for a focused follow-up read by line range or heading, such as section: "45-89".',
        "Do not re-read source already shown by an expanded tilth_search result.",
        "Omit budget by default; narrow with section before raising it.",
        "Avoid tilth_read full unless the full file is the artifact under review.",
        "To inspect another repository or checkout, pass its absolute path as scope.",
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
        "Primary code-discovery tool for the current repository or another checkout selected by absolute scope. Find structural definitions first, then usages, exact text, regex matches, or callers; top matches include source.",
      promptSnippet:
        "Search repository code for definitions, usages, text, regex matches, or callers",
      promptGuidelines: [
        "Use tilth_search first when you need to locate code, symbols, concepts, or text.",
        "Keep searches narrow with scope and glob; stop searching once the owner file is known.",
        "Use tilth_search with mode=literal for exact text and mode=regex for pattern searches.",
        "Use tilth_search with mode=callers when you need call sites for one known symbol or up to five comma-separated symbols.",
        "Do not re-read source already included in expanded search results.",
        "To inspect another repository or checkout, pass its absolute path as scope.",
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
    defineTool<typeof tilthListSchema, TilthToolDetails>({
      name: "tilth_list",
      label: "tilth_list",
      description:
        "List files in the current repository or another checkout selected by absolute scope when no useful symbol or text query is available.",
      promptSnippet: "List candidate repository file paths by glob pattern",
      promptGuidelines: [
        "Use tilth_list only for file discovery when you do not have a useful symbol or text query; keep the pattern scoped and avoid broad repository listings.",
        "To inspect another repository or checkout, pass its absolute path as scope.",
      ],
      parameters: tilthListSchema,
      renderShell: "self",
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return executeTilthList(execTilth, params, ctx.cwd, signal);
      },
      renderCall(args, theme, context) {
        return renderTilthListCall(args, theme, context);
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
      description:
        "Blast-radius check before a breaking change. Shows a file's imports and dependents. Use only for API, behavior, export, or location changes that callers may rely on—not ordinary reads, new code, or internal-only edits.",
      promptSnippet: "Check imports and dependents before a potentially breaking change",
      promptGuidelines: [
        "Use tilth_deps only before renaming, moving, deleting, changing exported APIs, or modifying behavior that callers rely on.",
        "Do not use tilth_deps for ordinary file reading, adding new code, or internal-only changes; use tilth_read instead.",
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
        "Get an end-to-end structural map of one symbol or target: definition, signature, documentation, callers, callees, siblings, and tests. Not for concept search or ordinary file reading.",
      promptSnippet: "Understand one symbol end-to-end across its relationships and tests",
      promptGuidelines: [
        "Use tilth_grok only when the task is to understand one symbol or path:line target end-to-end.",
        "Use tilth_search for concepts and simple lookups; use tilth_read for file contents.",
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

  pi.registerTool(
    defineTool<typeof tilthDiffSchema, TilthToolDetails>({
      name: "tilth_diff",
      label: "tilth_diff",
      description:
        "Show a structural diff with function-level change summaries for uncommitted, staged, ref, file-pair, patch, or log sources in the current repository or an explicit checkout.",
      promptSnippet: "Review repository changes as a structural diff",
      promptGuidelines: [
        "Use tilth_diff for structural change review instead of raw git diff or git log --patch.",
        "Use raw git diff --no-ext-diff --patch only when exact patch text is required.",
        "Call tilth_diff with no arguments for tracked staged and unstaged changes relative to HEAD; untracked files are excluded and must be discovered separately. Use source=staged for the index only.",
        "Use repository to select another checkout; scope must identify one changed file or file:function relative to that repository; never pass a directory.",
      ],
      parameters: tilthDiffSchema,
      renderShell: "self",
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        return executeTilthDiff(execTilth, params, ctx.cwd, signal);
      },
      renderCall(args, theme, context) {
        return renderTilthDiffCall(args, theme, context);
      },
      renderResult(result, options, theme, context) {
        return renderTilthResult(result, options, theme, context);
      },
    }),
  );

  pi.on("before_agent_start", (event) => {
    const selectedTools = event.systemPromptOptions.selectedTools;
    if (!selectedTools.some((toolName) => tilthToolNameSet.has(toolName))) {
      return undefined;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${TILTH_GUIDANCE}`,
    };
  });

  pi.on("tool_call", (event) => {
    const warnings = ((): string[] | undefined => {
      if (isToolCallEventType<"tilth_read", TilthReadInput>("tilth_read", event)) {
        const prepared = prepareTilthReadInput(event.input);
        Object.assign(event.input, prepared.input);
        return prepared.warnings;
      }
      if (isToolCallEventType<"tilth_search", TilthSearchInput>("tilth_search", event)) {
        const prepared = prepareTilthSearchInput(event.input);
        Object.assign(event.input, prepared.input);
        return prepared.warnings;
      }
      if (isToolCallEventType<"tilth_list", TilthListInput>("tilth_list", event)) {
        const prepared = prepareTilthListInput(event.input);
        Object.assign(event.input, prepared.input);
        return prepared.warnings;
      }
      if (isToolCallEventType<"tilth_deps", TilthDepsInput>("tilth_deps", event)) {
        const prepared = prepareTilthDepsInput(event.input);
        Object.assign(event.input, prepared.input);
        return prepared.warnings;
      }
      if (isToolCallEventType<"tilth_diff", TilthDiffInput>("tilth_diff", event)) {
        const prepared = prepareTilthDiffInput(event.input);
        Object.assign(event.input, prepared.input);
        return prepared.warnings;
      }
      return undefined;
    })();
    if (warnings === undefined || warnings.length === 0) {
      return undefined;
    }

    tilthArgumentWarnings.set(event.toolCallId, warnings);
    return undefined;
  });

  pi.on("tool_result", (event) => {
    if (!tilthToolNameSet.has(event.toolName)) {
      return undefined;
    }

    const warnings = tilthArgumentWarnings.get(event.toolCallId);
    tilthArgumentWarnings.delete(event.toolCallId);
    if (warnings === undefined || warnings.length === 0) {
      return undefined;
    }

    return {
      content: [
        ...event.content,
        { type: "text", text: `Tilth argument note: ${warnings.join(" ")}` },
      ],
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
