# Firefox `user.js` workflow

## Update prefs in repo
- Edit `firefox/user.js`.
- Group prefs by logical sections and keep one comment per active pref.

## Check for stale/deprecated prefs
- Verify pref keys against current Mozilla source (`firefox-main` / `gecko-dev`).
- Replace deprecated keys with current equivalents.
- Remove keys with no current source hits (likely no-op).

## Apply to default profile (Linux)
1. Find the install-default profile from `~/.mozilla/firefox/profiles.ini`:
   - Use `[Install*] Default=<profile-id>` when present.
2. Back up current profile `user.js`:
   - `cp ~/.mozilla/firefox/<profile-id>/user.js ~/.mozilla/firefox/<profile-id>/user.js.bak.$(date +%Y%m%d-%H%M%S)`
3. Copy repo prefs into profile:
   - `cp "$ACCEL_OS/firefox/user.js" ~/.mozilla/firefox/<profile-id>/user.js`
4. Verify copy:
   - `cmp -s "$ACCEL_OS/firefox/user.js" ~/.mozilla/firefox/<profile-id>/user.js && echo MATCH || echo DIFF`
5. Restart Firefox fully.
