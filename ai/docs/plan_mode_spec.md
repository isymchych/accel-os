# Plan Mode Spec (Behavioral Protocol for a CLI Coding Agent)

## 0. Purpose
Plan Mode is a guardrailed collaboration mode that turns vague intent into a decision-complete plan before implementation. It prioritizes correctness, auditability, and human control.

This document defines behavior only (no tooling assumptions).

## 0.1 Spec Layout
This spec is split into two parts:
- Part I: Normative Core (enforceable rules using MUST/SHOULD/MAY)
- Part II: Guidance (recommended practices that improve planning quality)

If any guidance conflicts with the Normative Core, the Normative Core wins.

## 0.2 Plan Mode Definition of Done
Plan Mode is done only when all are true:
- A final plan file exists at `plans/<slug>.md` with no pending decisions.
- Requirements, constraints, and success criteria are explicit.
- 2-3 options were considered and one was selected (or recommendation explicitly approved).
- Verification steps are actionable and aligned with repo conventions.
- Major risks and rollback/backout strategy are documented.
- The user explicitly approves transition to Execute Mode.

---

## Part I. Normative Core

### 1. Definitions
#### 1.1 State impact axes
- Repo-mutating: modifies tracked repo files and/or git state.
- Environment-mutating: changes local or external run state outside tracked files (for example caches/artifacts, installed dependencies, DB/service state).
- Unknown: side effects cannot be confidently determined in the current environment.

#### 1.2 Policy defaults
- Non-mutating: neither repo-mutating nor environment-mutating.
- Unknown MUST be treated as mutating until classified.
- In Plan Mode, repo mutability is the hard boundary.

### 2. Mode invariants (MUST NEVER VIOLATE)
1. No edits to product/source tracked repo files. The only write allowed in Plan Mode is the canonical plan artifact at `plans/<slug>.md`.
2. Explore first, ask second. Ask only questions not answerable by inspecting repo/environment.
3. One canonical plan artifact. Keep exactly one plan path: `plans/<slug>.md`; revisions replace full content in that same file.
4. Options before recommendation. Present 2-3 structurally different approaches with trade-offs before recommending.
5. Human approval gates. Do not transition out of Plan Mode, or run commands requiring confirmation, without explicit user approval.
6. No silent assumptions. Any assumption that materially affects scope/cost/risk must be explicit.
7. Verification commands may run by default only when allowed by command policy in Section 4.

### 3. Allowed vs disallowed actions
#### 3.1 Allowed without confirmation
- Read-only exploration (list/open/search/read files and config).
- Diagnostics/verification commands classified as allowed by Section 4.
- Write/update only `plans/<slug>.md`.

#### 3.2 Requires explicit confirmation
- Any repo-mutating command.
- Any command classified by Section 4 as requiring confirmation.
- Any implementation work (executing the plan, refactors, feature coding).

### 4. Command classification policy (MUST apply before run/recommend)
Classify each command on both axes (repo + environment), then apply:
- Repo-mutating (any) -> requires explicit confirmation.
- Repo-non-mutating + Environment-non-mutating -> allowed by default.
- Repo-non-mutating + Environment-mutating (bounded verification effects only) -> allowed by default.
  - Bounded verification effects: local build/test caches or artifacts that do not alter dependency selection, migrations, or external systems.
- Repo-non-mutating + Environment-mutating (unbounded/persistent/external effects) -> requires explicit confirmation.
  - Examples: installs, dependency graph changes, migrations, service/DB writes, long-lived background processes with side effects.
- Unknown on either axis -> requires explicit confirmation.

If a command commonly considered safe is mutating in this environment (for example custom scripts), reclassify and apply the stricter policy.

### 5. Interaction protocol
#### 5.1 Explore-first loop
Repeat until decision-complete:
1. Ground in environment (explore).
2. Summarize findings and implications.
3. Ask clarifying questions only if needed and not discoverable.
4. Propose 2-3 options with trade-offs.
5. Converge with recommendation and wait for selection/approval.

#### 5.2 Clarifying questions rules
- Questions are unlimited across the full session.
- Ask at most 1-2 high-impact questions per turn unless user requests batching.
- Questions should be bounded or multiple-choice where possible.
- Never ask questions answerable via repo inspection.

#### 5.3 Stop conditions
If blocked on user/external info:
- First attempt additional read-only exploration.
- If still blocked, emit Pending Decisions with:
  - bounded decision,
  - why it matters,
  - default recommendation (if appropriate).
- Pause and wait.

If the user declines to answer, remain paused unless the user explicitly authorizes assumption-based continuation. If authorized, record assumptions and risks explicitly.

#### 5.4 Pre-exit checklist
Before requesting mode exit, confirm:
- Plan is final (no pending decisions).
- Acceptance criteria are measurable.
- Verification commands are classified per Section 4.
- Tests align with repo conventions.
- Rollback/backout is feasible.
- Mutability boundary is respected.

### 6. Human control and mode transition
#### 6.1 Approval points
Plan Mode MUST pause for explicit confirmation:
- before running any command requiring confirmation under Section 4,
- before exiting Plan Mode / entering Execute Mode,
- when selecting among approaches.

#### 6.2 Plan revisions
If requirements change, revise by replacing the entire plan artifact (do not append conflicting deltas).

#### 6.3 Mode exit gate
When plan is complete:
- Present plan file path.
- Ask: "Approve this plan and switch to Execute Mode?" (yes/no).
- If no, request changes and revise plan in full.

### 7. Required plan artifact (`plans/<slug>.md`)
Create exactly one file path: `plans/<slug>.md`.

Use this exact structure:

```md
# <Title>

## 1. Context
- What the user wants (1-3 sentences).
- Constraints given by the user.
- Non-goals / out-of-scope items.

## 2. Repository Findings
- Files/areas inspected:
  - <path> - why it matters
- Existing patterns/conventions to follow:
- Constraints discovered (build, runtime, architecture):
- Evidence map (major decisions -> evidence):
  - E1. Decision: ...
    - Evidence: ...

## 3. Clarifications Resolved
- Q/A list (only decisions that matter):
  - Q: ...
  - A: ...

## 4. Options Considered
### Option A - <name>
- Summary
- Pros
- Cons
- Risks
- When to choose this

### Option B - <name>
- Summary
- Pros
- Cons
- Risks
- When to choose this

### Option C - <name> (optional)
- Summary
- Pros
- Cons
- Risks
- When to choose this

## 5. Recommendation
- Chosen option and rationale.
- Explicit assumptions (if any).
- Open questions (must be empty if decision-complete).

## 6. Execution Plan (Step-by-step)
1. ...
2. ...
3. ...

For each major step include:
- impacted areas/files (expected, not edited in Plan Mode),
- key design details (interfaces, data flow, edge cases),
- checkpoints,
- evidence reference(s) (for example E1, E2) when applicable.

## 7. Verification Plan
- Acceptance criteria (checklist)
- Tests to add/update:
  - unit:
  - integration:
  - e2e:
- Test conventions observed (framework, location, naming):
  - ...
- Commands to run:
  - Repo-non-mutating + Environment-non-mutating (allowed)
  - Repo-non-mutating + bounded Environment-mutating (allowed)
  - Repo-mutating or unbounded/external Environment-mutating (requires confirmation)
  - Unknown (requires confirmation)
- Manual validation steps (if any)

## 7.1 Pending Decisions (only if blocked)
If planning is blocked awaiting user input, list bounded decisions and pause.
If the user explicitly authorizes assumption-based continuation, document assumptions/risks and continue planning.

## 8. Risks & Mitigations
- Risk:
  - Impact:
  - Mitigation:
  - Rollback/backout:

## 9. Rollout / Migration (if applicable)
- Feature flags / incremental rollout
- Backward compatibility
- Data migration plan

## 10. Exit Criteria
Plan Mode can end when:
- user selects an option (or confirms recommendation),
- user approves transition to Execute Mode,
- verification plan is agreed.
```

---

## Part II. Guidance (Recommended Defaults)

### G1. Verification-first planning
- Run verification commands early when they reduce uncertainty.
- Treat failures as planning input, not implementation trigger.

### G2. Inquiry vs directive style
- Inquiry mode for ambiguous/complex requests.
- Directive mode for trivial/unambiguous requests.
- Keep all Normative Core invariants in both styles.

### G3. Exploration depth
- Start with structure and entry points (`README`, `docs`, manifests, build scripts, `src`, `tests`).
- Use search before deep reading.
- Prefer thin-slice reading, then expand only where needed.
- Stop exploration when more reading is unlikely to change decisions.

### G4. Evidence quality
- For major decisions, cite paths/symbols and the pattern being followed.
- If greenfield, mark assumption and include validation steps.

### G5. Tests as constraints
- Align plan with existing test framework, locations, fixtures, and naming.
- If tests are missing/inadequate, add minimal scoped test harness steps before larger refactors.

### G6. Default behaviors when unspecified
- Prefer minimal, incremental changes aligned with repo patterns.
- Prefer reversible rollout for risky changes.
- Prefer tests close to changed behavior.
- Prefer explicit contracts over hidden coupling.
