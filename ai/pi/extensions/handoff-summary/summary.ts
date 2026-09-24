/**
 * Summary policy and model-call helpers for Pi handoff summaries.
 *
 * Keep this module free of Pi event wiring so deterministic summary behavior can
 * be tested without a live session or extension host.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  completeSimple,
  type Api,
  type Model,
  type ProviderHeaders,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  convertToLlm,
  prepareBranchEntries,
  serializeConversation,
} from "@earendil-works/pi-coding-agent";

const DEFAULT_CONTEXT_WINDOW = 128000;
const MAX_SHARED_CONTEXT_TOKENS = 8000;
const MAX_SUMMARY_TOKENS = 4096;
const PROMPT_OVERHEAD_TOKENS = 2048;
const MIN_MAIN_INPUT_TOKENS = 1024;

export interface FileOperations {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
}

export interface SummaryTokenBudgets {
  sharedContext: number;
  mainInput: number;
  response: number;
}

export interface SummaryAuth {
  apiKey?: string;
  headers?: ProviderHeaders;
  env?: Record<string, string>;
}

export type SummaryModel = Model<Api>;

export type SummaryBudgetResult =
  | { ok: true; budgets: SummaryTokenBudgets }
  | { ok: false; error: string };

export interface BranchSummaryRequest {
  promptText: string;
  responseTokens: number;
  readFiles: string[];
  modifiedFiles: string[];
  validateHeadings: boolean;
}

export interface CompactionSummaryRequest {
  promptText: string;
  responseTokens: number;
  readFiles: string[];
  modifiedFiles: string[];
}

const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured handoff summary.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const HANDOFF_RULES = `Include:
- The goal, progress, and key decisions made
- Current understanding, assumptions, and uncertainties
- Changed files, their current status, and important symbols
- Active requirements, constraints, and user preferences
- Authorization and scope: what the user approved, whether work is discussion/investigation only, and what still requires a decision or permission. Recommended next steps are not authorization to execute them.
- User-stated rejected approaches when they remain active constraints
- Unresolved errors, blockers, and open loops
- Critical commands, examples, references, or risks needed to continue
- Validation performed or still needed
- The next concrete action or command, when known
- Durable artifacts by path or URL when they already capture detailed context

Prioritize current state over chronology.

Preserve:
- Current state of the work
- Current file status
- Active requirements, constraints, and user preferences
- Accepted decisions and their rationale
- Accepted decisions clearly separated from agent recommendations, tentative options, assumptions, and uncertainties
- Unresolved work and next actions
- Unresolved errors, blockers, and open loops

Discard:
- Early drafts and superseded attempts
- Stale drafts, superseded plans, and exploratory dead ends
- Rejected ideas unless the rejection explains a still-active constraint or rejected approach
- Context from unrelated previous tasks

Be concise, structured, and focused on helping another LLM continue without duplicating work.
Do not duplicate content already captured in specs, plans, ADRs, issues, commits, or diffs; reference those artifacts instead.
Briefly restate load-bearing conclusions, constraints, and rationale so the next agent understands the task before following references.
Preserve the whole currently applicable plan when it exists only in the conversation, including all still-relevant steps, substeps, implementation details, dependencies, decisions, and validation criteria. Incorporate subsequent revisions and exclude superseded material. Mark completed work and distinguish approved work from proposals and unresolved choices. Do not reduce the plan to a summary or just the next action; brevity must not discard applicable plan content.
When a durable artifact contains the plan, reference it and preserve any applicable changes or details that exist only in the conversation. Record current progress against its steps and any deviations so the next agent can identify where to resume.
For investigations, preserve hypotheses, supporting and contradicting evidence, what was ruled out and why, and the next check that would distinguish remaining explanations.
For discussion/design, preserve open options, tradeoffs, decision criteria, unresolved disagreements, and the next question to settle.
Redact sensitive information such as API keys, tokens, passwords, secrets, and personally identifiable information.
Preserve exact file paths, function names, commands, and error messages. Do not invent missing context; mark unknowns explicitly.
Separate observed facts, inferences, and assumptions when ambiguity matters.
Tie consequential claims to their source or check and state its limitations; distinguish verified results from expectations and unperformed validation.
Before finishing, check that another agent can identify the goal, current state, authorization boundary, and next step without reconstructing the conversation, and that the whole currently applicable plan is preserved in the summary or its referenced artifacts, including conversation-only revisions.`;

const BRANCH_SUMMARY_STRUCTURE = `Use this structure. Keep the headings, but omit bullets that do not apply. Use "(none)" only when the absence is important.

## Goal
[What was the user trying to accomplish on the abandoned branch?]

## Authorization and Scope
- [Approvals and execution boundaries on this branch; pending permissions or decisions]

## Applicable Plan
[The whole plan applicable on this branch, or its durable reference with step progress, deviations, and conversation-only additions; distinguish approved work from proposals and unresolved choices]

## Branch Recap
### Done
- [x] [Completed branch-specific tasks/changes]

### In Progress / Open Loops
- [ ] [Branch-specific work that was started but not finished]

### Blocked / Unresolved Errors
- [Branch-specific issues preventing progress, unresolved errors, or "(none)"]

## Key Decisions, Constraints, Rejected Approaches, and Assumptions
- **[Decision/constraint/rejected approach/assumption]**: [Brief rationale or uncertainty]

## Shared Context Used
- [Only prior facts needed to interpret this branch, or "(none)"]

## Changed / Relevant Files, Symbols, and Commands
- [Changed files with current status, important symbols, commands, docs, or references needed to continue]

## Validation
- [Checks run and results, or validation still needed]

## Next Concrete Action
1. [The next concrete action or command to continue or reconcile this branch]

## Critical Context
- [Branch-specific data, examples, references, or risks needed later]
- [Or "(none)" if not applicable]`;

const COMPACTION_SUMMARY_STRUCTURE = `Use this structure. Keep the headings, but omit bullets that do not apply. Use "(none)" only when the absence is important.

## Goal
[What is the user trying to accomplish?]

## Authorization and Scope
- [What the user approved, discussion/investigation-only boundaries, and pending permissions or decisions]

## Applicable Plan
[The whole currently applicable plan, or its durable reference with step progress, deviations, and conversation-only additions; distinguish approved work from proposals and unresolved choices]

## Current State / Recap
### Done
- [x] [Completed tasks/changes]

### In Progress / Open Loops
- [ ] [Current work and open loops]

### Blocked / Unresolved Errors
- [Issues preventing progress, unresolved errors, or "(none)"]

## Active Requirements, Constraints, and Preferences
- [Active requirements, constraints, user preferences, or "(none)"]

## Key Decisions, Rejected Approaches, and Assumptions
- **[Decision/rejected approach/assumption]**: [Brief rationale or uncertainty]

## Changed / Relevant Files, Symbols, and Commands
- [Changed files with current status, important symbols, commands, docs, or references needed to continue]

## Validation
- [Checks run and results, or validation still needed]

## Next Concrete Action
1. [The next concrete action or command]

## Critical Context
- [Data, examples, references, or risks needed later]
- [Or "(none)" if not applicable]`;

export function calculateSummaryTokenBudgets(
  model: { contextWindow: number; maxTokens: number },
  options: { includeSharedContext: boolean },
): SummaryBudgetResult {
  const contextWindow = model.contextWindow > 0 ? model.contextWindow : DEFAULT_CONTEXT_WINDOW;
  const modelResponseLimit = model.maxTokens > 0 ? model.maxTokens : MAX_SUMMARY_TOKENS;
  const response = Math.min(
    MAX_SUMMARY_TOKENS,
    modelResponseLimit,
    Math.floor(contextWindow * 0.25),
  );
  const sharedContext = options.includeSharedContext
    ? Math.min(MAX_SHARED_CONTEXT_TOKENS, Math.floor(contextWindow * 0.2))
    : 0;
  const mainInput = contextWindow - sharedContext - response - PROMPT_OVERHEAD_TOKENS;

  if (mainInput < MIN_MAIN_INPUT_TOKENS) {
    return {
      ok: false,
      error: `insufficient context budget: ${mainInput} tokens available for conversation input`,
    };
  }

  return { ok: true, budgets: { sharedContext, mainInput, response } };
}

export function computeFileLists(fileOps: FileOperations): {
  readFiles: string[];
  modifiedFiles: string[];
} {
  const modifiedFiles = [...new Set([...fileOps.written, ...fileOps.edited])].sort();
  const modifiedFileSet = new Set(modifiedFiles);
  const readFiles = [...fileOps.read].filter((file) => !modifiedFileSet.has(file)).sort();
  return { readFiles, modifiedFiles };
}

export function formatFileOperations(
  readFiles: readonly string[],
  modifiedFiles: readonly string[],
): string {
  const readBlock = readFiles.length > 0 ? `\n${readFiles.join("\n")}\n` : "\n";
  const modifiedBlock = modifiedFiles.length > 0 ? `\n${modifiedFiles.join("\n")}\n` : "\n";
  return `\n\n<read-files count="${readFiles.length}">${readBlock}</read-files>\n\n<modified-files count="${modifiedFiles.length}">${modifiedBlock}</modified-files>`;
}

export function serializeMessages(messages: readonly AgentMessage[]): string {
  if (messages.length === 0) {
    return "(none)";
  }
  return serializeConversation(convertToLlm([...messages]));
}

export function serializeEntries(entries: readonly SessionEntry[], tokenBudget: number): string {
  if (entries.length === 0) {
    return "(none)";
  }

  const prepared = prepareBranchEntries([...entries], tokenBudget);
  if (prepared.messages.length === 0) {
    return "(none)";
  }

  return serializeMessages(prepared.messages);
}

export function buildSharedContextEntries(
  entries: readonly SessionEntry[],
  commonAncestorId: string | null,
): SessionEntry[] {
  if (commonAncestorId === null) {
    return [];
  }

  const commonAncestorIndex = entries.findIndex((entry) => entry.id === commonAncestorId);
  if (commonAncestorIndex < 0) {
    return [];
  }

  return entries.slice(0, commonAncestorIndex + 1);
}

export function buildBranchPrompt(
  sharedContext: string,
  abandonedBranch: string,
  customInstructions: string | undefined,
  replaceInstructions: boolean | undefined,
): string {
  const customInstructionsBlock =
    customInstructions !== undefined && customInstructions.length > 0
      ? `\n\nAdditional focus:\n${customInstructions}`
      : "";
  const shouldReplaceInstructions =
    replaceInstructions === true &&
    customInstructions !== undefined &&
    customInstructions.length > 0;
  const summaryInstructions = shouldReplaceInstructions
    ? customInstructions
    : `You are creating a handoff summary for another LLM that may resume work from an abandoned conversation branch.

Use <shared-context> only to understand the branch. Summarize <abandoned-branch> as the primary subject. Recap what was done on the abandoned branch. Discard shared context that is not needed to understand this branch.
Preserve the plan, decisions, and approvals as applicable on the abandoned branch; do not imply they automatically govern the destination branch. Identify any known conflicts that require reconciliation rather than treating branch proposals or approvals as authorization to execute on the destination branch.

${HANDOFF_RULES}

${BRANCH_SUMMARY_STRUCTURE}

${customInstructionsBlock}`;

  return `<shared-context>\n${sharedContext}\n</shared-context>\n\n<abandoned-branch>\n${abandonedBranch}\n</abandoned-branch>\n\n${summaryInstructions}`;
}

export function buildCompactionPrompt(
  conversation: string,
  splitTurnPrefix: string | undefined,
  previousSummary: string | undefined,
  customInstructions: string | undefined,
): string {
  const hasPreviousSummary = previousSummary !== undefined && previousSummary.length > 0;
  const hasCustomInstructions = customInstructions !== undefined && customInstructions.length > 0;
  const hasSplitTurnPrefix = splitTurnPrefix !== undefined && splitTurnPrefix.length > 0;
  const updateInstructions = hasPreviousSummary
    ? `The messages above are NEW conversation messages to incorporate into the existing summary in <previous-summary>. Update the existing summary: preserve still-relevant current state, add new progress and decisions, move completed work to Done, remove obsolete details, and refresh next steps. Preserve applicable plan content from the previous summary unless new conversation explicitly revises, completes, or supersedes it. Absence from new messages does not make a step obsolete. Record completed steps without discarding their still-applicable details or dependencies.`
    : "Create a context checkpoint handoff summary that another LLM will use to continue the current work.";
  const previousSummaryBlock = hasPreviousSummary
    ? `\n\n<previous-summary>\n${previousSummary}\n</previous-summary>`
    : "";
  const customInstructionsBlock = hasCustomInstructions
    ? `\n\nAdditional focus:\n${customInstructions}`
    : "";
  const splitTurnPrefixBlock = hasSplitTurnPrefix
    ? `\n\n<split-turn-prefix>\n${splitTurnPrefix}\n</split-turn-prefix>`
    : "";
  const splitTurnInstructions = hasSplitTurnPrefix
    ? "\n\nThe <split-turn-prefix> content is the early part of the current oversized turn. It will be discarded by compaction while the later part of the turn is kept, so preserve the user's current request, early work, decisions, errors, and open loops from it."
    : "";

  return `<conversation>\n${conversation}\n</conversation>${splitTurnPrefixBlock}${previousSummaryBlock}\n\n${updateInstructions}${splitTurnInstructions}\n\nRecap what was done in the current session state.\n\n${HANDOFF_RULES}\n\n${COMPACTION_SUMMARY_STRUCTURE}${customInstructionsBlock}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function hasRequiredHeadings(summary: string, headings: readonly string[]): boolean {
  return headings.every((heading) =>
    new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, "mu").test(summary),
  );
}

export function buildBranchSummaryRequest(input: {
  model: SummaryModel;
  entriesToSummarize: readonly SessionEntry[];
  sharedBranchEntries: readonly SessionEntry[];
  commonAncestorId: string | null;
  customInstructions: string | undefined;
  replaceInstructions: boolean | undefined;
}):
  | { ok: true; request: BranchSummaryRequest }
  | { ok: false; fallbackSummary?: string; error?: string } {
  const budgetResult = calculateSummaryTokenBudgets(input.model, { includeSharedContext: true });
  if (!budgetResult.ok) {
    return { ok: false, error: budgetResult.error };
  }

  const preparedAbandoned = prepareBranchEntries(
    [...input.entriesToSummarize],
    budgetResult.budgets.mainInput,
  );
  if (preparedAbandoned.messages.length === 0) {
    return { ok: false, fallbackSummary: "No content to summarize" };
  }

  const sharedEntries = buildSharedContextEntries(
    input.sharedBranchEntries,
    input.commonAncestorId,
  );
  const sharedContext = serializeEntries(sharedEntries, budgetResult.budgets.sharedContext);
  const abandonedBranch = serializeMessages(preparedAbandoned.messages);
  const { readFiles, modifiedFiles } = computeFileLists(preparedAbandoned.fileOps);

  return {
    ok: true,
    request: {
      promptText: buildBranchPrompt(
        sharedContext,
        abandonedBranch,
        input.customInstructions,
        input.replaceInstructions,
      ),
      responseTokens: budgetResult.budgets.response,
      readFiles,
      modifiedFiles,
      validateHeadings: !(
        input.replaceInstructions === true &&
        input.customInstructions !== undefined &&
        input.customInstructions.length > 0
      ),
    },
  };
}

export function buildCompactionSummaryRequest(input: {
  model: SummaryModel;
  messagesToSummarize: readonly AgentMessage[];
  isSplitTurn: boolean;
  turnPrefixMessages: readonly AgentMessage[];
  previousSummary: string | undefined;
  customInstructions: string | undefined;
  fileOps: FileOperations;
}): { ok: true; request: CompactionSummaryRequest } | { ok: false; error?: string } {
  const budgetResult = calculateSummaryTokenBudgets(input.model, { includeSharedContext: false });
  if (!budgetResult.ok) {
    return { ok: false, error: budgetResult.error };
  }

  const conversation = serializeMessages(input.messagesToSummarize);
  const splitTurnPrefix =
    input.isSplitTurn && input.turnPrefixMessages.length > 0
      ? serializeMessages(input.turnPrefixMessages)
      : undefined;
  if (conversation === "(none)" && splitTurnPrefix === undefined) {
    return { ok: false };
  }

  const { readFiles, modifiedFiles } = computeFileLists(input.fileOps);

  return {
    ok: true,
    request: {
      promptText: buildCompactionPrompt(
        conversation,
        splitTurnPrefix,
        input.previousSummary,
        input.customInstructions,
      ),
      responseTokens: budgetResult.budgets.response,
      readFiles,
      modifiedFiles,
    },
  };
}

export function formatBranchSummary(
  text: string,
  readFiles: readonly string[],
  modifiedFiles: readonly string[],
): string {
  return `The user explored a different conversation branch before returning here.\nSummary of that exploration:\n\n${text}${formatFileOperations(readFiles, modifiedFiles)}`;
}

export function formatCompactionSummary(
  text: string,
  readFiles: readonly string[],
  modifiedFiles: readonly string[],
): string {
  return `${text}${formatFileOperations(readFiles, modifiedFiles)}`;
}

function extractText(response: Awaited<ReturnType<typeof completeSimple>>): string {
  return response.content
    .filter((content): content is { type: "text"; text: string } => content.type === "text")
    .map((content) => content.text)
    .join("\n")
    .trim();
}

function buildRequestOptions(
  auth: SummaryAuth,
  maxTokens: number,
  signal: AbortSignal,
): SimpleStreamOptions {
  const requestOptions: SimpleStreamOptions = { maxTokens, signal };
  if (auth.apiKey !== undefined) {
    requestOptions.apiKey = auth.apiKey;
  }
  if (auth.headers !== undefined) {
    requestOptions.headers = auth.headers;
  }
  if (auth.env !== undefined) {
    requestOptions.env = auth.env;
  }
  return requestOptions;
}

export async function completeSummary(
  model: SummaryModel,
  auth: SummaryAuth,
  promptText: string,
  maxTokens: number,
  signal: AbortSignal,
): Promise<{ ok: true; text: string } | { ok: false; aborted: boolean; error: string }> {
  try {
    const response = await completeSimple(
      model,
      {
        systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: promptText }],
            timestamp: Date.now(),
          },
        ],
      },
      buildRequestOptions(auth, maxTokens, signal),
    );

    if (response.stopReason === "aborted") {
      return { ok: false, aborted: true, error: "aborted" };
    }
    if (response.stopReason === "error") {
      return { ok: false, aborted: false, error: response.errorMessage ?? "unknown error" };
    }

    const text = extractText(response);
    if (text.length === 0) {
      return { ok: false, aborted: false, error: "empty summary" };
    }

    return { ok: true, text };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, aborted: signal.aborted, error: message };
  }
}
