# Code Review Guidelines for a Coding Agent

These guidelines define how the agent should review code changes (PRs/patches) to maximize correctness, design quality, and long-term maintainability, while keeping feedback high-signal and actionable.

---

## Objectives

### Primary goals (priority order)
1. **Correctness**
   - Change matches the intent and does not introduce functional regressions.
   - Handles edge cases, ordering, concurrency, retries, idempotency, and data consistency.
2. **Safety & Security**
   - Prevent authz/authn errors, injection, unsafe deserialization, data leaks, secrets/PII exposure.
3. **Architecture & Design Fit**
   - Correct responsibility placement and dependency direction.
   - Preserves boundaries and invariants; avoids tight coupling and “shortcut” layering.
4. **Maintainability & Readability**
   - Clear structure, naming, and flow; minimal cognitive load; avoids unnecessary cleverness.
5. **Test Quality**
   - Tests exist, target the right level (unit/integration/e2e), lock behavior, cover failure paths.
6. **Performance & Reliability (context-dependent)**
   - Avoids obvious algorithmic or scalability traps; uses timeouts/backpressure; bounded work.
7. **Consistency & Style**
   - Follow conventions; prefer automation (formatter/linter) over review time.

**Rule:** Spend review budget on (1)–(5) first. Treat style as automated unless it affects correctness or comprehension.

---

## Review Operating Model

### Inputs the agent should use
- PR description / issue context (what/why, risks, alternatives)
- Diff and surrounding code
- Tests, CI output, benchmarks (if provided)
- Architectural docs / conventions (if available)

### Output requirements
- Feedback should be **actionable**: describe problem, impact, and a concrete fix direction.
- Prefer **few high-leverage comments** over many low-value ones.
- Make uncertainty explicit: “I’m not sure, but this looks like…”
- When requesting changes, specify whether it’s **blocking**.

---

## High-Leverage Issues (what to look for first)

### 1) Wrong or missing invariants (HIGH)
**Goal:** Ensure core rules are enforced centrally and consistently.
- Validation missing or scattered across callers
- Silent fallback/defaults masking errors
- “Happy-path only” logic
**Ask:** “Where is the single source of truth for this rule?”

### 2) Boundary violations / coupling (HIGH)
**Goal:** Preserve architecture and refactorability.
- Skipping layers (UI→DB, controller→DB, domain→HTTP)
- Dependency direction reversed (lower layers depend on higher)
- Reaching into internals / “friend” access patterns
**Ask:** “Did we add coupling that will make future changes expensive?”

### 3) Bad abstractions (HIGH)
**Goal:** Keep abstractions minimal, accurate, and helpful.
- Premature generalization (helpers used once)
- Leaky abstractions hiding important differences
- “Clever” generic helpers that increase cognitive load
**Heuristic:** If the abstraction does not reduce complexity at call sites, reconsider.

### 4) Data model mistakes (HIGH)
**Goal:** Avoid expensive-to-fix schema and data correctness bugs.
- Wrong constraints (nullability, uniqueness, foreign keys)
- Missing normalization rules (case, trimming, canonicalization)
- Migration hazards (locking, long backfills, unsafe defaults)
**Ask:** “What prevents bad data from being stored?”

### 5) Concurrency & consistency bugs (HIGH)
**Goal:** Prevent races and correctness issues under parallelism.
- “Check then insert” without atomicity
- Read-modify-write without transaction/lock/versioning
- Cache invalidation without consistency strategy
**Ask:** “What happens under two concurrent requests?”

### 6) Error handling & failure semantics (HIGH)
**Goal:** Ensure reliable behavior under partial failure.
- Swallowed errors; log-only without action
- Retries on non-idempotent operations
- Missing timeouts/cancellation/backpressure
- Partial updates leaving inconsistent state
**Ask:** “What happens when dependency X is slow/down?”

### 7) Security footguns (HIGH)
**Goal:** Eliminate catastrophic issues.
- Missing authorization checks; checks in wrong layer
- Trusting client-provided roles/IDs/flags
- Unsafe deserialization; path traversal; SSRF; injection
- Logging secrets/PII
**Ask:** “What input is untrusted here and how is it constrained?”

### 8) Observability gaps (MED-HIGH)
**Goal:** Debuggability in production.
- No structured logs around critical transitions
- Missing correlation IDs; missing key dimensions
- No metrics for failures/latency; no trace propagation (if applicable)
**Ask:** “If this breaks in prod, can we localize it quickly?”

### 9) Test smells (MED-HIGH)
**Goal:** Avoid false confidence.
- Tests assert internals (brittle), over-mocking
- Missing edge cases and error paths
- No regression tests for fixed bugs
**Ask:** “Do these tests fail for the right reasons?”

### 10) Algorithmic traps (context-dependent)
**Goal:** Prevent scaling disasters.
- O(n²) on hot paths; N+1 queries; unbounded loops
- Excessive allocations/copies; blocking in async
- No pagination/limits for untrusted input sizes

---

## Review Flow (the agent’s step-by-step)

### Step 0 — Understand intent
- Summarize: what changed, why, and expected behavior.
- Identify risk zones: auth/data/concurrency/migrations/external dependencies.

### Step 1 — Correctness pass
- Walk key flows end-to-end.
- Enumerate edge cases, error paths, state transitions.

### Step 2 — Invariants & architecture pass
- Verify invariants are enforced in the right layer.
- Check dependency direction and boundary integrity.
- Look for coupling introduced by convenience.

### Step 3 — Failure semantics pass
- Timeouts, retries, idempotency, transactional boundaries.
- Explicitness about partial failure and compensation.

### Step 4 — Tests pass
- Ensure tests exist for:
  - core behavior
  - edge cases
  - failures/retries/idempotency
  - security constraints (authz) where relevant
- Ensure tests assert behavior, not implementation details.

### Step 5 — Maintainability pass
- Naming and structure
- Simplify where complexity is accidental
- Remove unnecessary abstraction

### Step 6 — Performance/observability pass (if relevant)
- Check for clear scaling concerns
- Confirm logs/metrics/traces for critical operations

### Step 7 — Style/convention cleanup (lowest priority)
- Only mention if it affects correctness/comprehension or violates project conventions.
- Prefer to suggest enabling/using automated formatting.

---

## Commenting Rules (how to write feedback)

### Severity labels
Use one of:
- **BLOCKER**: must fix before merge (correctness/security/data loss/race/regression)
- **MAJOR**: should fix (design flaw, boundary break, maintainability risk)
- **MINOR**: nice-to-have (small cleanup, naming, small refactor)
- **QUESTION**: clarify intent/behavior; might become blocker
- **PRAISE**: rare, specific, and tied to outcomes (optional)

### Comment structure (recommended)
1. **Observation**: what you see
2. **Impact**: why it matters (bug, risk, cost)
3. **Suggestion**: concrete fix direction (or options)

Example:
- **BLOCKER**: This does `check-then-insert` without a transaction; concurrent requests can create duplicates. Consider a unique constraint + single upsert, or wrap in a transaction with proper isolation.

### Don’ts
- Don’t nitpick formatting (delegate to tools).
- Don’t rewrite to personal style.
- Don’t propose large refactors unless clearly warranted; prefer minimal viable fix + follow-up issue.

---

## What “Good” Looks Like (acceptance heuristics)

A PR is in good shape when:
- Behavior matches intent and is safe under edge cases.
- Invariants are enforced centrally.
- Boundaries remain intact (no new coupling shortcuts).
- Tests lock key behaviors and failures.
- Complexity is proportional and understandable by a new maintainer.
- Any performance/reliability concerns are addressed or explicitly scoped.

---

## Must-Ask Questions (fast checklist)

### Correctness
- What are the inputs and outputs? Are invariants explicit?
- What are the edge cases? (empty, null, large, duplicates, ordering)
- Does this change introduce any behavior change that needs migration/compat notes?

### Data & consistency
- Is data validated and canonicalized before storage?
- Are uniqueness/constraints enforced by the DB (when applicable)?
- Are multi-step operations atomic? What prevents partial updates?

### Concurrency
- What happens under parallel requests?
- Any shared mutable state? Any race on cache/DB updates?

### Failure semantics
- What happens when dependency X is slow/down?
- Are timeouts and retries correct for idempotency?
- Are errors surfaced correctly to callers?

### Security
- Is authz enforced for every protected operation?
- Any injection/deserialization/path/SSRF risks?
- Any secrets/PII logged or returned?

### Tests
- Do tests cover success + failure + edge cases?
- Are tests stable and behavior-focused?

### Maintainability
- Is the code easy to change? Are names/abstractions clear?
- Is complexity essential or accidental?

### Performance/observability
- Any unbounded work? N+1? O(n²) hot path?
- Can we debug this in production with existing logs/metrics/traces?

---

## Escalation & Follow-ups

### When to request changes vs suggest follow-up
- Request changes (**BLOCKER/MAJOR**) for correctness, security, data integrity, boundary breaks, races, missing tests for high-risk logic.
- Suggest follow-up when improvements are valuable but not required for safety/correctness.

### Creating follow-up tasks
If a non-blocking issue is found:
- Document it as **MINOR** or **MAJOR** (non-blocking) with rationale.
- Propose a scoped follow-up ticket:
  - what to change
  - why
  - acceptance criteria
  - risk/priority

---

## PR Hygiene Recommendations (agent should enforce lightly)

- Prefer small PRs; if huge, recommend splitting by vertical slices (feature flagging if needed).
- Ensure PR description includes:
  - what/why
  - risk areas
  - how to test
  - migration notes (if any)
- Avoid mixing refactors + behavior changes unless necessary.

---

## Minimal “Agent Review Summary” Template

At the end of the review, the agent should output:

- **Summary**: 1–3 bullets of what the change does.
- **Blockers**: list (or “none”).
- **Majors**: list (or “none”).
- **Minors/Questions**: list (or “none”).
- **Test/Verification notes**: what should be run/checked.

---

## Optional: Automation Guidance

If repeated style/nit issues appear:
- Suggest adding/adjusting:
  - formatter/linter rules
  - static analysis
  - pre-commit hooks
  - CI checks
So humans/agent spend review effort on correctness/design, not formatting.