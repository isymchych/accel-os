---
name: adb-audiobook-sync
description: Sync local audiobook folders to an Android phone over adb and verify integrity. Use when a user wants audiobook transfer to /sdcard/Audiobooks, when MTP is unreliable, or when transfer correctness must be confirmed with local-vs-phone file and byte checks.
---

# Adb Audiobook Sync

Use adb as the primary transfer path for Android audiobook sync.
Prefer deterministic transfer + verification over best-effort copy.

## Workflow

1. Build transfer set
- Identify local audiobook folders to copy.
- Use explicit folder names from user intent or computed set difference.
- Keep names exact; preserve Unicode and spaces.

2. Verify adb readiness
- Run `adb devices -l`.
- If device is `unauthorized`, stop and ask user to unlock phone and accept USB debugging prompt.
- Continue only when device state is `device`.

3. Prepare destination
- Ensure destination exists: `adb shell 'mkdir -p /sdcard/Audiobooks'`.

4. Transfer folders
- Push each folder individually so failures are isolated:
```bash
adb push "<local-folder>" "/sdcard/Audiobooks/"
```
- Record adb summary output (`files pushed`, `bytes`, `duration`).
- Do not claim success from process exit alone.

5. Verify integrity per folder
- Compare local and phone values per folder:
  - file count
  - total bytes
- Local:
```bash
find "<local-folder>" -type f | wc -l
find "<local-folder>" -type f -exec stat -c%s {} \; | awk '{s+=$1} END {print s+0}'
```
- Phone:
```bash
adb shell "find '/sdcard/Audiobooks/<folder>' -type f | wc -l"
adb shell "find '/sdcard/Audiobooks/<folder>' -type f -exec stat -c%s {} \\; | awk '{s+=\$1} END {print s+0}'"
```
- Mark folder `OK` only when both values match.

6. Handle mismatches
- If any folder differs, report exact folder-level mismatch.
- Re-push only failed folders, then re-run verification for those folders.
- If repeated failures occur, ask user to keep screen unlocked and USB stable, then retry.

## Output Contract

Return:
- folders transferred
- adb push summaries
- verification table (`files local/phone`, `bytes local/phone`, `OK|DIFF`)
- final status: `ALL_OK` or `HAS_DIFF`

## Anti-Patterns

- Do not treat folder presence as proof of successful transfer.
- Do not trust MTP-only success when correctness matters.
- Do not skip verification after large transfers.
- Do not bulk-retry all folders when only a subset failed.
