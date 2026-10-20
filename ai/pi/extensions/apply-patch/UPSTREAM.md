# Upstream provenance

This extension is a TypeScript adaptation of OpenAI Codex's `apply_patch` implementation. It is
maintained locally rather than vendored, so compatibility is intentional but exact implementation
parity is not required.

## Baseline

- Repository: `https://github.com/openai/codex`
- Commit: `694b6319d3ad2399f6e435760a22d9b9357f0697`
- Commit date: 2026-09-07
- Upstream implementation: `codex-rs/apply-patch/`

The most relevant upstream sources are:

- `src/parser.rs`
- `src/file_update.rs`
- `src/seek_sequence.rs`
- `src/text_file.rs`
- `src/lib.rs`
- `tests/suite/`

The commit is the reviewed upstream baseline, not a claim that this extension matches a released
Codex version or remains identical to later upstream code.

## Intentional differences

- The implementation is a Pi extension using Node TypeScript and Pi's tool, rendering,
  constrained-sampling, and file-mutation APIs.
- Preview uses a virtual workspace before the real workspace is mutated.
- Repeated source paths are allowed. Operations run in patch order against the results of earlier
  operations, rather than requiring one operation per source path as upstream verification does.
- Previews and summaries retain each operation in order, including intermediate changes to the same
  file; they are not a net diff. Preflight failure leaves files unchanged, but execution failures
  can leave earlier operations applied.
- Results include combined previews, fuzz accounting, partial-success state, uncertain-state
  reporting, and explicit recovery paths.
- Preflight failures return structured operation and chunk locations while confirming that no files
  were mutated.
- The constrained Lark grammar is maintained alongside the runtime parser.
- Filesystem behavior is implemented by the local Node workspace boundary, including separate create
  and replace operations, atomic replacement, native rename, and rejection of symbolic-link path
  components.

## Locally maintained invariants

- The constrained grammar must not admit patches that the runtime parser necessarily rejects.
- Patch chunks must match monotonically; an end-of-file chunk must not rematch lines consumed by an
  earlier chunk.
- Insertions at the same position retain patch order.
- Appending to an unterminated file inserts a line separator without adding an unintended final
  newline.
- Preserve mode retains existing line contents and endings where the patch does not replace them.
- Failed replacement must preserve the original file whenever the atomic rename has not occurred.
- Mutations must reject paths containing symbolic-link components.
- Preflight and execution must use the same sequential semantics for repeated paths, including paths
  created, deleted, or moved by earlier operations.
- State-unknown move failures must identify both source and destination as recovery paths.

These invariants should remain covered by local tests even if upstream behavior changes.

## Reviewing a newer upstream baseline

1. Compare the current baseline with the candidate commit, scoped to `codex-rs/apply-patch/`.
2. Review changed upstream source and tests as reference data; do not replace local behavior
   mechanically.
3. Port applicable fixes while preserving the intentional differences and locally maintained
   invariants above.
4. Add or update focused local tests for every adopted semantic change.
5. Update the baseline commit and date only after that review is complete.