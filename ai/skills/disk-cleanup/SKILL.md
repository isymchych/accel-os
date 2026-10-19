---
name: disk-cleanup
description: Inspect disk usage with dust and clean up explicitly approved groups of files.
disable-model-invocation: true
---

# Disk Cleanup

Invoking this skill starts read-only inspection, not deletion. Use the requested path, or the home
directory by default.

1. **Measure.** Run `df -h <path>` and `dust -x -c -P -d 2 -n 25 <path>`. Drill into the largest
   directories. Report permission gaps; do not elevate privileges automatically.
2. **Explain.** Separate personal data, application state, build artifacts, caches, and toolchains.
   Being under `.cache` does not make something disposable.
3. **Propose.** Group candidates meaningfully, such as build caches, browser/shader caches, and tool
   downloads. For each group, show the exact paths or cleanup command, estimated savings, and costs:
   slower rebuilds, slower initial loads, downloads, or lost offline availability. Avoid
   double-counting nested directories or shared Docker layers.
4. **Confirm.** Get approval for the listed groups, not each file. Carry forward explicit
   exclusions. A general "clean caches" request is not permission to add undisclosed groups.
   Existing approval covers an unchanged, already-disclosed list; do not ask again unnecessarily.
5. **Clean.** Execute only approved actions. Prefer tool-native cleanup commands and check for
   active use before removing build artifacts. Preserve user data and histories unless their
   deletion is explicitly approved. Never recursively wipe an entire cache or application-data root.
6. **Verify.** Remeasure disk space and remaining targets; verify exclusions remain intact. Report
   actual savings, what was removed, failures, and interruptions. After interruption, inspect the
   current state before claiming completion or retrying.

For Docker, inspect `docker system df` and distinguish build cache, unused images, containers, and
volumes. Prune only approved categories; never delete Docker's storage directory manually. Before
removing Rust toolchains, check project pins and overrides, and retain the default and required
versions.