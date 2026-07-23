---
name: adb-audiobook-sync
description: Sync local audiobook folders to an Android phone over adb and verify integrity. Use when a user wants audiobook transfer to /sdcard/Audiobooks, when MTP is unreliable, or when transfer correctness must be confirmed with local-vs-phone file and byte checks.
disable-model-invocation: true
---

# Adb Audiobook Sync

Use adb as the primary transfer path for Android audiobook sync.
Prefer deterministic transfer + verification over best-effort copy.

## Available scripts

- Resolve helper paths relative to `dirname(SKILL.md)`, not the current working directory.
- Prefer the helper scripts below when available; use the raw adb workflow as fallback when helpers fail or are unavailable.
- `scripts/list_audiobooks.ts` — Lists direct child folders containing audiobook-looking audio files.
- `scripts/sync_audiobooks.ts` — Syncs explicit folders, or a computed audiobook set with `--all-audiobooks`, then verifies exact relative file paths and byte sizes.

Examples:

```bash
node <skill-dir>/scripts/list_audiobooks.ts <local-dir>
node <skill-dir>/scripts/sync_audiobooks.ts <local-dir> "<folder>"...
node <skill-dir>/scripts/sync_audiobooks.ts --all-audiobooks <local-dir>
node <skill-dir>/scripts/sync_audiobooks.ts --replace-existing <local-dir> "<folder>"...
```

Use `--all-audiobooks` only when the user explicitly asks to sync the computed audiobook-looking set.
Use `--replace-existing` only when the user explicitly approves replacing existing phone folders.

## Workflow

1. Build transfer set

- Identify local audiobook folders to copy.
- Use explicit folder names from user intent or computed set difference.
- Use `scripts/list_audiobooks.ts` or `scripts/sync_audiobooks.ts --all-audiobooks` for computed audiobook-looking sets.
- Keep names exact; preserve Unicode and spaces.
- Treat selected folders as direct child names only; reject path separators, empty names, `.`, and `..`.

2. Verify adb readiness

- Run `adb devices -l`.
- If device is `unauthorized`, stop and ask user to unlock phone and accept USB debugging prompt.
- Continue only when device state is `device`.

3. Prepare destination

- Ensure destination exists: `adb shell 'mkdir -p /sdcard/Audiobooks'`.

4. Classify existing phone folders

- For each selected folder, inspect `/sdcard/Audiobooks/<folder>` before transfer.
- If the phone folder is missing, push it.
- If the phone folder is present and its manifest matches local files, skip transfer and mark `OK_ALREADY_PRESENT`.
- If the phone folder is present and differs, do not modify it by default; mark `DIFF_PRESENT` and tell the user to rerun with `--replace-existing` if replacement is desired.
- With `--replace-existing`, remove only the exact selected destination path, then push that folder again.

5. Transfer folders

- Push each folder individually so failures are isolated:

```bash
adb push "<local-folder>" "/sdcard/Audiobooks/"
```

- Record adb summary output (`files pushed`, `bytes`, `duration`).
- Do not claim success from process exit alone.

6. Verify integrity per folder

- Compare local and phone manifests per folder:
  - relative file path
  - byte size
- Print aggregate file count and total bytes for readability, but mark folders `OK` only from manifest equality.
- Local:

```bash
find "<local-folder>" -type f -exec stat -c '%n\t%s' {} \;
```

- Phone:

```bash
adb shell "cd '/sdcard/Audiobooks/<folder>' && find . -type f -exec stat -c '%n\t%s' {} \\;"
```

- Mark folder `OK_PUSHED`, `OK_ALREADY_PRESENT`, or `OK_REPLACED` only when manifests match.

7. Handle mismatches

- If any folder differs, report exact folder-level mismatch.
- For `DIFF_PRESENT`, do not retry automatically because stale phone files require an explicit replacement decision.
- For `DIFF_AFTER_PUSH`, ask user to keep screen unlocked and USB stable, then retry only the failed folders.

## Output Contract

Return:

- folders transferred
- folders skipped or replaced
- adb push summaries
- verification table (`files local/phone`, `bytes local/phone`, `OK_PUSHED|OK_ALREADY_PRESENT|OK_REPLACED|DIFF_PRESENT|DIFF_AFTER_PUSH`)
- final status: `ALL_OK` or `HAS_DIFF`

## Anti-Patterns

- Do not treat folder presence as proof of successful transfer.
- Do not overwrite or delete existing phone folders unless the user explicitly approves `--replace-existing`.
- Do not trust MTP-only success when correctness matters.
- Do not skip verification after large transfers.
- Do not bulk-retry all folders when only a subset failed.