---
name: test-design
description: Design tests that establish observable contracts with independent expectations and meaningful failures. Use when writing or changing tests, adding regression coverage, removing obsolete tests, or assessing whether tests establish correctness.
---

# Test Design

Test the required behavior, not a restatement of the implementation. Reuse
existing requirements, evidence, and test conventions; loading this skill does
not restart discovery or grant authorization to edit files.

## Establish the Contract

Identify the observable behavior, invariant, boundary, or failure mode the test
must protect. Inspect existing coverage and choose the narrowest test seam that
can demonstrate the contract.

Add or retain tests when requested, when the task is test-focused, or when they
protect a distinct branch, invariant, contract, boundary, or failure mode not
adequately covered elsewhere.

## Choose Independent Expectations

Derive expected results from requirements, documented contracts, or independently
worked examples, not by reproducing the implementation's calculation. If the
contract is unclear, resolve the ambiguity rather than treating current behavior
as the required result.

Identify a plausible incorrect implementation and check that the test would
distinguish it from correct behavior. Use this to choose meaningful inputs and
assertions, not to require mutation testing or an exhaustive case matrix.

## Establish a Meaningful Failure

For regression tests and test-first work, verify where feasible that the initial
failure demonstrates the intended missing or incorrect behavior. Setup,
environment, and unrelated compilation failures do not establish this. A
compilation failure can be meaningful when the test intentionally exercises a
required new public interface.

If a before-fix run is unavailable, state that limitation. Do not overwrite user
changes or alter Git state to manufacture a before-fix run.

## Verify and Maintain Coverage

Run the focused check after the correction and check affected behavior. A passing
command is useful evidence only for what its assertions and exercised paths
actually establish; report verification limits.

When a change removes a behavioral distinction, consolidate or remove tests
whose only purpose was that distinction. Do not add replacement tests merely to
preserve test count or matrix symmetry. Retain coverage of still-supported
contracts.

Report the protected behavior, checks run and their outcomes, and any meaningful
failure or coverage gaps. Keep the report proportional to the task.