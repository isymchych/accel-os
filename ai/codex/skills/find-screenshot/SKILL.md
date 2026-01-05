---
name: find-screenshot
description: Find and attach the newest screenshot PNG in ~/temp/screenshots. Use when a user asks to locate, show, or attach the latest screenshot or wants the newest PNG from the screenshots folder.
---

# Find Screenshot

## Workflow

1. Confirm scope: newest `.png` in `~/temp/screenshots` by modification time. If the user asks for a different directory or pattern, ask for confirmation before proceeding.
2. Run the script to get the latest screenshot path.
3. If the script reports missing directory or no PNGs, say so and ask the user what to do next.
4. Attach the image using the `view_image` tool, then reply with the path and note that the image was attached.

## Command

Run:

```bash
deno run --quiet --allow-read=$HOME/temp/screenshots --allow-env=HOME,USERPROFILE $CODEX_HOME/skills/find-screenshot/scripts/find_latest_screenshot.ts
```

It prints the absolute path on success and writes errors to stderr on failure.

## Resources

### scripts/
- `find_latest_screenshot.ts`: resolve newest PNG in `~/temp/screenshots`.
