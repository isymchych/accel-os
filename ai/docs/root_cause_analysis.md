# SKILL.md — Root Cause Analysis (RCA / 5 Whys)

## Purpose

Identify the true underlying cause of a problem—not symptoms—using structured, evidence-based reasoning. Produce actionable fixes that prevent recurrence.

This skill is used when:

* Bugs reappear after fixes
* Failures lack clear explanation
* Unexpected behavior occurs
* Tests fail unexpectedly
* Performance regressions occur
* Incidents or production failures occur

This skill prioritizes **causal certainty over speed**.

---

## Core Principles

### 1. Root Cause ≠ First Cause

The root cause is the deepest cause that:

* explains the failure
* is controllable
* can be fixed to prevent recurrence

Stop only when further questioning would reach:

* external uncontrollable factors, or
* fundamental constraints

---

### 2. Evidence over speculation

Every causal claim must be supported by at least one:

* code reference
* log
* test result
* reproduction
* commit diff
* execution trace

Never guess.

If uncertain, mark explicitly:

```
UNCERTAIN: needs verification via <method>
```

---

### 3. Trace backwards along causal chain

Always move backward:

```
Failure
← Trigger
← Mechanism
← Enabling condition
← Root cause
```

Not forward.

---

### 4. Stop at the fixable layer

Bad root cause:

> variable was null

Good root cause:

> validation missing when parsing config file, allowing invalid state creation

Best root cause:

> parser violates invariant: Config must never allow null X

---

### 5. Prefer systemic causes over local mistakes

Prefer:

* invariant violations
* missing validation
* incorrect assumptions
* broken abstractions
* race conditions
* contract violations

Over:

* typos
* one-off errors

---

## Standard Procedure

Follow this exact sequence.

---

### Step 1 — Define the failure precisely

Document:

```
Failure:
Observed behavior:
Expected behavior:
Where observed:
When observed:
Frequency:
Impact:
```

Never proceed with vague failure definitions.

---

### Step 2 — Reproduce the failure

If possible:

* run tests
* run code
* simulate inputs

Record:

```
Reproduction steps:
Reproduction reliability: Always / Intermittent / Cannot reproduce
```

If cannot reproduce, use logs and traces.

---

### Step 3 — Identify immediate cause

Find the direct technical reason.

Examples:

* null dereference
* incorrect branch taken
* wrong value computed
* invariant violation

Document:

```
Immediate cause:
Evidence:
```

Include code references.

---

### Step 4 — Perform iterative "Why?" analysis

Ask why repeatedly.

Structure:

```
Why 1: Why did X happen?
Answer:
Evidence:

Why 2: Why did that happen?
Answer:
Evidence:

Why 3:
...
```

Continue until reaching:

* design flaw
* missing invariant
* broken assumption
* architectural weakness
* process failure

Usually 3–7 iterations.

Stop when further "Why?" would not produce a controllable fix.

---

### Step 5 — Identify root cause

Must satisfy:

* explains entire causal chain
* fixing it prevents recurrence
* is specific and actionable

Format:

```
Root cause:
Evidence:
Confidence: High / Medium / Low
```

---

### Step 6 — Propose fixes

Separate into three layers.

---

#### Layer 1 — Immediate fix

Fix symptom.

```
Immediate fix:
```

Example:

```
Add null check before dereference
```

---

#### Layer 2 — Root fix

Fix root cause.

```
Root fix:
```

Example:

```
Add validation when constructing Config to prevent null invariant violation
```

---

#### Layer 3 — Prevention

Prevent similar failures.

```
Prevention:
```

Examples:

* add invariant checks
* add tests
* add assertions
* strengthen types
* improve abstraction

---

### Step 7 — Add verification plan

Explain how fix will be verified.

```
Verification:
- test X fails before fix
- test X passes after fix
- invariant enforced
```

---

## Output Format

Always use this exact structure:

```
ROOT CAUSE ANALYSIS

Failure:
...

Expected behavior:
...

Observed behavior:
...

Reproduction:
...

Immediate cause:
...
Evidence:
...

Why 1:
...
Evidence:
...

Why 2:
...
Evidence:
...

Why 3:
...
Evidence:
...

Root cause:
...
Evidence:
...
Confidence:
...

Fixes:

Immediate fix:
...

Root fix:
...

Prevention:
...

Verification:
...
```

---

## Anti-Patterns (Forbidden)

Do NOT stop at:

* "bug in code"
* "wrong logic"
* "unexpected input"
* "race condition occurred"

These are symptoms, not root causes.

Must explain WHY they occurred.

---

## Heuristics for Common Root Causes

Common true root causes include:

* Missing invariant enforcement
* Invalid state allowed
* Incorrect abstraction boundary
* Contract violation between components
* Missing validation
* Incorrect assumptions about ordering or timing
* Race condition due to shared mutable state
* Type system insufficient to enforce constraints
* Incorrect error handling strategy
* Incomplete state machine

---

## When to Use

Use automatically when:

* bug fixes fail
* failures recur
* cause unclear
* debugging complex behavior
* investigating incidents

---

## Integration Guidance

Use before implementing fixes.

Never implement fixes without identifying root cause first, unless emergency mitigation required.

---

## Confidence Levels

High confidence requires:

* reproduction
* code evidence
* causal chain verified

Medium confidence:

* strong evidence but not reproduced

Low confidence:

* hypothesis only

Must explicitly declare confidence.

---

## Goal

Produce fixes that eliminate entire classes of failures—not individual instances.