# Agent Memory Formulation Spec (AMFS)

## 1. Purpose

Ensure stored memory is:

* **Atomic**
* **Unambiguous**
* **Low-interference**
* **Retrieval-efficient**
* **Composable**

Memory quality > memory quantity.

---

## 2. Core Constraints

### 2.1 Atomicity

Each memory entry must encode **one testable idea**.

**Reject if:**

* Contains conjunctions (“and”, “or”, “also”)
* Encodes a list of heterogeneous items
* Mixes cause + consequence
* Bundles definition + example

**Allowed:**

* One fact
* One rule
* One invariant
* One decision rationale
* One constraint

---

### 2.2 Minimalism

Store the **smallest sufficient representation**.

Prefer:

* Short declarative rule
* Explicit constraint
* Structured field over prose

Avoid:

* Narrative paragraphs
* Contextual fluff
* Re-explaining obvious domain knowledge

---

### 2.3 Explicit Trigger Surface

Each memory must answer:

> Under what condition should this be retrieved?

Memory must include at least one:

* Clear domain tag
* Trigger condition
* Decision boundary
* Failure pattern

If retrieval condition is vague → rewrite.

---

### 2.4 Disambiguation

If similar memories exist:

* Add contrast field
* Explicitly encode boundary condition

Example:

Bad:

```
Use approach A for performance.
```

Better:

```
Use approach A when latency < 10ms matters more than memory footprint.
```

---

### 2.5 No Enumerations

Do not store raw lists.

Instead of:

```
Causes of X: A, B, C
```

Store:

```
Cause X-1: A
Cause X-2: B
Cause X-3: C
```

Lists increase interference and reduce retrieval precision.

---

## 3. Structural Schema

Recommended memory schema:

```yaml
id: unique_slug
type: rule | invariant | constraint | preference | failure_pattern | design_principle

trigger:
  when: condition under which this applies

statement:
  atomic declarative rule

rationale:
  short explanation (optional but preferred)

boundary:
  when this does NOT apply (optional but encouraged)

tags:
  - domain
  - subsystem
  - decision_area
```

---

## 4. Quality Checks

Before persisting memory:

### Q1 — Atomic?

Can this be split further without loss?

If yes → split.

---

### Q2 — Testable?

Could this be violated?

If not → it’s probably vague philosophy, not actionable memory.

---

### Q3 — Retrieval-Specific?

Would an agent know when to retrieve this?

If not → add trigger or boundary.

---

### Q4 — Low Interference?

Would this conflict with another memory?

If yes → add contrast or merge.

---

## 5. Compression Rule

If a memory:

* Exceeds 3–4 lines
* Contains multiple clauses
* Requires explanation to apply

It is likely under-compressed.

Refactor until it becomes:

* Direct
* Operational
* Decidable

---

## 6. Anti-Patterns

Reject memory if it is:

* A summary of a long article
* A motivational statement
* A vague best practice
* A full checklist (must split)
* Redundant with existing invariant

---

## 7. Advanced Patterns

### 7.1 Contrast Encoding

Prefer storing:

```
Use X instead of Y when Z.
```

Contrast reduces retrieval ambiguity.

---

### 7.2 Failure-Driven Storage

High-value memories:

* Postmortem conclusions
* Architectural boundary decisions
* Performance regressions
* Security invariants

Avoid storing:

* Easily derivable textbook facts

---

## 8. Memory Economy Principle

Store only what:

* Is costly to rediscover
* Is project-specific
* Encodes irreversible decisions
* Prevents repeated mistakes

Do NOT store:

* Obvious framework defaults
* Generic language knowledge
* Widely known principles

---

## 9. Reformulation Loop

When memory retrieval fails or causes confusion:

1. Split further
2. Add trigger
3. Add boundary
4. Remove ambiguity
5. Compress

Memory refinement is iterative.

---

# Meta Insight

Good agent memory behaves like:

* Well-factored code
* Small pure functions
* Strong invariants
* Clear interface contracts

Poor memory behaves like:

* God objects
* Implicit coupling
* Hidden state
* Ambiguous APIs