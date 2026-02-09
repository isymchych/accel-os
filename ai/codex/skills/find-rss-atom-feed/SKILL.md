---
name: find-rss-atom-feed
description: Find a website's recommended RSS or Atom feed URL from a page or domain. Use when a user asks for a feed link (RSS/Atom), wants to subscribe to a blog/site in a feed reader, or asks to verify whether a site exposes a feed.
---

# Find RSS Atom Feed

## Workflow

1. Run the bundled script.
2. Read JSON output.
3. Use `recommended.url` as the best-ranked feed candidate from discovered valid feeds.
4. If multiple feeds are returned, include `feeds` with short labels.
5. If the script exits non-zero, report failure and run fallback checks.

## Command

```bash
$ACCELERANDO_HOME/ai/codex/skills/find-rss-atom-feed/scripts/find_feed.ts <url>
```

Output fields:
- `recommended.url`
- `recommended.format`
- `recommended.source`
- `feeds[]`

## Fallback

Use only when the script fails:
- Check page HTML for `<link rel="alternate" type="application/rss+xml|application/atom+xml">`.
- Probe common endpoints such as `/feed.xml`, `/rss.xml`, `/atom.xml`, `/index.xml`, `/blog.xml`.
- Validate content has feed markers (`<rss` or `<feed` / Atom namespace), not generic HTML.

## Notes

- Prefer official site pages and direct feed URLs over third-party feed mirrors.
- Preserve user privacy: do not share project-specific URLs outside the local environment.

## Resources

### scripts/
- `find_feed.ts`: discover and validate RSS/Atom feeds from a website or page URL.
