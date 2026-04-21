/**
 * Worktree Context Dedupe Extension
 *
 * When Pi runs inside a git worktree nested under `.worktrees/`, it discovers
 * context files by walking parent directories. That can load both the worktree
 * root `AGENTS.md`/`CLAUDE.md` and the parent repository root file.
 *
 * This extension keeps the worktree-local context file and removes the parent
 * repo-root duplicate from the effective system prompt. It also emits a
 * one-time notification when filtering happens.
 */

import path from "node:path";
import type { BuildSystemPromptOptions, ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface ContextFile {
	path: string;
	content: string;
}

interface WorktreeLayout {
	repoRoot: string;
	worktreeRoot: string;
}

const CONTEXT_FILENAMES = new Set(["AGENTS.md", "CLAUDE.md"]);
const PROJECT_CONTEXT_HEADER = "\n\n# Project Context\n\nProject-specific instructions and guidelines:\n\n";

function findWorktreeLayout(cwd: string): WorktreeLayout | null {
	const resolvedCwd = path.resolve(cwd);
	const marker = `${path.sep}.worktrees${path.sep}`;
	const markerIndex = resolvedCwd.indexOf(marker);

	if (markerIndex === -1) {
		return null;
	}

	const repoRoot = markerIndex === 0 ? path.sep : resolvedCwd.slice(0, markerIndex);
	const remainder = resolvedCwd.slice(markerIndex + marker.length);
	const [worktreeName = ""] = remainder.split(path.sep);

	if (worktreeName.length === 0) {
		return null;
	}

	return {
		repoRoot,
		worktreeRoot: path.join(repoRoot, ".worktrees", worktreeName),
	};
}

function isRootContextFile(filePath: string, dirPath: string): boolean {
	return path.dirname(filePath) === dirPath && CONTEXT_FILENAMES.has(path.basename(filePath));
}

function getRepoRootContextFiles(options: BuildSystemPromptOptions): ContextFile[] {
	const contextFiles = options.contextFiles ?? [];
	if (contextFiles.length === 0) {
		return [];
	}

	const layout = findWorktreeLayout(options.cwd);
	if (!layout) {
		return [];
	}

	const hasWorktreeRootContext = contextFiles.some((file) => isRootContextFile(file.path, layout.worktreeRoot));
	if (!hasWorktreeRootContext) {
		return [];
	}

	return contextFiles.filter((file) => isRootContextFile(file.path, layout.repoRoot));
}

function stripContextFileBlock(systemPrompt: string, contextFile: ContextFile): string {
	const block = `## ${contextFile.path}\n\n${contextFile.content}\n\n`;
	return systemPrompt.replace(block, "");
}

function stripEmptyProjectContextHeader(systemPrompt: string): string {
	return systemPrompt.replace(PROJECT_CONTEXT_HEADER, "");
}

export default function worktreeContextDedupe(pi: ExtensionAPI): void {
	let hasNotified = false;

	pi.on("before_agent_start", async (event, ctx) => {
		const repoRootContextFiles = getRepoRootContextFiles(event.systemPromptOptions);
		if (repoRootContextFiles.length === 0) {
			return undefined;
		}

		let nextSystemPrompt = event.systemPrompt;
		for (const contextFile of repoRootContextFiles) {
			nextSystemPrompt = stripContextFileBlock(nextSystemPrompt, contextFile);
		}

		const hasRemainingProjectContext = (event.systemPromptOptions.contextFiles?.length ?? 0) > repoRootContextFiles.length;
		if (!hasRemainingProjectContext) {
			nextSystemPrompt = stripEmptyProjectContextHeader(nextSystemPrompt);
		}

		if (nextSystemPrompt === event.systemPrompt) {
			return undefined;
		}

		if (!hasNotified) {
			const filteredPaths = repoRootContextFiles.map((file) => file.path).join(", ");
			ctx.ui.notify(`Filtered repo-root context from prompt: ${filteredPaths}`, "info");
			hasNotified = true;
		}

		return { systemPrompt: nextSystemPrompt };
	});
}
