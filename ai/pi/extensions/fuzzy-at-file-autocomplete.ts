/**
 * Replaces Pi's built-in `@...` attachment autocomplete with fd-backed fuzzy
 * file picking.
 *
 * Autocomplete spec:
 * - triggers only for recognized `@...` attachment tokens, including quoted
 *   forms like `@"my folder/fi`
 * - fully replaces built-in suggestions for those `@...` tokens
 * - leaves normal path completion unchanged
 * - scopes search to an existing directory prefix when the query contains `/`
 *   (for example `@src/au` searches under `src/`)
 * - uses fuzzy subsequence discovery via `fd`, then reranks candidates in
 *   TypeScript with path-aware scoring
 * - keeps directories ranked ahead of files and inserts directories with a
 *   trailing `/`
 * - hides hidden paths by default; includes them only when the active query
 *   segment after the last `/` starts with `.`
 * - always excludes `.git`
 * - requires `fd` in PATH; if missing, shows an error instead of falling back
 *   to built-in `@...` suggestions
 * - delegates completion application back to Pi to preserve insertion,
 *   spacing, and quoting behavior
 */
import { existsSync } from "node:fs";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AutocompleteProvider, AutocompleteSuggestions } from "@mariozechner/pi-tui";

import {
  buildFdPattern,
  dedupeCandidates,
  extractAtFileToken,
  formatAutocompleteItems,
  planFdQuery,
  rankCandidates,
  parseAtFileToken,
  type CandidateEntry,
} from "../lib/fuzzy-at-file-autocomplete.ts";

const FD_TIMEOUT_MS = 2_000;
const MAX_RESULTS_PER_KIND = 200;
const FD_BINARY = "fd";
const ERROR_STATUS_KEY = "fuzzy-at-file-autocomplete";

async function loadFdCandidates(
  pi: ExtensionAPI,
  searchRoot: string,
  fuzzyQuery: string,
  includeHidden: boolean,
  signal: AbortSignal,
): Promise<CandidateEntry[]> {
  if (!existsSync(searchRoot)) {
    return [];
  }

  const baseArgs = [
    "--follow",
    "--ignore-case",
    "--exclude",
    ".git",
    "--exclude",
    ".git/*",
    "--exclude",
    ".git/**",
    "--full-path",
    "--max-results",
    String(MAX_RESULTS_PER_KIND),
  ];
  if (includeHidden) {
    baseArgs.push("--hidden");
  }

  const pattern = buildFdPattern(fuzzyQuery);

  const runFd = async (type: "d" | "f"): Promise<CandidateEntry[]> => {
    const result = await pi.exec(FD_BINARY, [...baseArgs, "--type", type, pattern], {
      cwd: searchRoot,
      signal,
      timeout: FD_TIMEOUT_MS,
    });
    if (signal.aborted || result.code !== 0 || result.stdout.trim().length === 0) {
      return [];
    }

    return result.stdout
      .split(/\r?\n/u)
      .map((line) => line.replace(/\r$/u, ""))
      .filter((line) => line.length > 0)
      .map((path) => ({
        path: type === "d" && path.endsWith("/") ? path.slice(0, -1) : path,
        isDirectory: type === "d",
      }));
  };

  const [directories, files] = await Promise.all([runFd("d"), runFd("f")]);
  return dedupeCandidates([...directories, ...files]);
}

function createAutocompleteProvider(
  current: AutocompleteProvider,
  pi: ExtensionAPI,
  cwd: string,
): AutocompleteProvider {
  return {
    async getSuggestions(
      lines,
      cursorLine,
      cursorCol,
      options,
    ): Promise<AutocompleteSuggestions | null> {
      const currentLine = lines[cursorLine] ?? "";
      const textBeforeCursor = currentLine.slice(0, cursorCol);
      const token = extractAtFileToken(textBeforeCursor);
      if (token === null) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const { quoted, rawQuery } = parseAtFileToken(token);
      const plan = planFdQuery(cwd, rawQuery);
      const candidates = await loadFdCandidates(
        pi,
        plan.searchRoot,
        plan.fuzzyQuery,
        plan.includeHidden,
        options.signal,
      );
      if (options.signal.aborted) {
        return null;
      }

      const suggestions = formatAutocompleteItems(rankCandidates(candidates, plan.fuzzyQuery), {
        displayPrefix: plan.displayPrefix,
        quoted,
      });
      return {
        items: suggestions,
        prefix: token,
      };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

export default function fuzzyAtFileAutocomplete(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const fdPathResult = await pi.exec("bash", ["-lc", `command -v ${FD_BINARY}`], {
      cwd: ctx.cwd,
      timeout: FD_TIMEOUT_MS,
    });
    if (fdPathResult.code !== 0 || fdPathResult.stdout.trim().length === 0) {
      ctx.ui.setStatus(ERROR_STATUS_KEY, "fd missing");
      ctx.ui.notify("fuzzy @ autocomplete requires `fd` in PATH", "error");
      return;
    }

    ctx.ui.setStatus(ERROR_STATUS_KEY, undefined);
    ctx.ui.addAutocompleteProvider((current) => createAutocompleteProvider(current, pi, ctx.cwd));
  });
}
