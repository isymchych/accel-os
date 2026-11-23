# Modern Web Platform — Quick Reference

Source: [Chrome for Developers: Top 10 things AI gets wrong in web development](https://developer.chrome.com/blog/top-10-things-ai-gets-wrong-in-web-dev) (2026-11-11).

Consult the relevant entry when implementing a matching feature. Check target-browser support before adopting newer APIs. For detailed patterns, use [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance).

## Focus and modal isolation

- Modal UI: `<dialog>.showModal()` provides top-layer behavior and background inertness; `inert` can isolate unavailable regions in other layouts.
- Move focus into newly opened views and restore it when returning to the triggering context.
- Composite widgets (toolbars, grids): use *roving `tabindex`* for a single Tab stop with arrow-key navigation. Keep `:focus-visible` indicators at ≥3:1 contrast.

## Reduced motion

- Apply `prefers-reduced-motion` to smooth scrolling, scroll-driven animations, carousels, and view transitions—not only CSS transitions.
- Gate cross-document `@view-transition` and smooth scrolling on motion preference. Adapt transforms together with animations to preserve stable geometry; retain meaningful non-motion state cues.

## Forms and autofill

- Native constraint validation plus `:user-invalid` supports styling after user interaction. Keep visible error state and `aria-invalid` aligned.
- Place persistent format/password hints **above** inputs; link them with `aria-describedby`. Use appropriate `autocomplete` attributes.
- Indicate `:autofill` with color plus a non-color cue (e.g., inset shadow) without shifting layout.

## Swipe and touch

- Use CSS Scroll Snap and native scrolling for swipe/reveal interfaces; use scroll-driven animations for scroll-linked effects where supported.
- `overscroll-behavior-x: none` can contain horizontal over-swipe navigation. Expose swipe actions to keyboard users.

## Dialogs and popovers

- `<dialog>` supports modal focus, dismissal, and platform back handling. `popover` supports top-layer positioning and light dismiss for suitable overlays.
- Animate top-layer entry/exit using `@starting-style` and `transition-behavior: allow-discrete` where supported.

## Color schemes

- For sites supporting both themes, declare `<meta name="color-scheme" content="light dark">` early and set CSS `color-scheme` for themed surfaces/native controls.
- `light-dark()` selects values based on the active color scheme. Theme controls can expose **system / light / dark**; the `storage` event syncs persisted changes across tabs.

## Runtime responsiveness

- `scheduler.postTask()` schedules priority work; `scheduler.yield()` breaks long tasks where supported. Monitor INP for interaction latency.
- `content-visibility: auto` plus `contain-intrinsic-size` limits offscreen rendering. `content-visibility: hidden` plus `inert` can retain inactive view state.
- CSS scroll-state queries can replace continuous scroll polling; Intersection Observer is a practical fallback.

## Layout stability and first paint

- Give `<video>` as well as `<img>` intrinsic dimensions; set `aspect-ratio` and `object-fit` on the media where needed.
- `font-size-adjust` can reduce reflow when fallback fonts swap. Use `svh` for a stable viewport floor and `dvh` for the live mobile viewport.
- For pre-paint critical content/experiments, investigate `blocking="render"` and `rel="expect"` where supported; assess CLS and LCP.

## DOM XSS protection

- Insert plain strings via `textContent`/framework escaping. For untrusted HTML, native `setHTML()` provides sanitization where available; use a maintained sanitizer such as DOMPurify as a fallback.
- Trusted Types policies should produce validated/sanitized values. CSP can use script hashes (static pages) or nonces with `'strict-dynamic'` (dynamic loading); `'report-sample'` aids diagnostics.

## Passkeys and WebAuthn

- Use `PublicKeyCredential.parseCreationOptionsFromJSON()`, `.parseRequestOptionsFromJSON()`, and credential `.toJSON()` for WebAuthn JSON serialization.
- `getClientCapabilities()` informs available management features; `signalUnknownCredential()` helps reconcile server-unknown credentials with password managers.
- Use `AbortSignal` for cancellable step-up authentication; check support for `uiMode: "immediate"` in immediate sign-in flows.
