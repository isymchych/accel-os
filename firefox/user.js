// =========================
// UI and input behavior
// =========================

// Keep dragged tabs in the same window.
user_pref("browser.tabs.allowTabDetach", false);
// Keep tabs out of the native titlebar.
user_pref("browser.tabs.inTitlebar", 0);
// Enable Firefox tab groups.
user_pref("browser.tabs.groups.enabled", true);
// Disable Ctrl+Q quit shortcut.
user_pref("browser.quitShortcut.disabled", true);
// Open context menus on mouse button release (fixes WM right-click issue).
user_pref("ui.context_menus.after_mouseup", true);
// Disable Pocket integration.
user_pref("extensions.pocket.enabled", false);
// Open context-menu web searches in a background tab.
user_pref("browser.search.context.loadInBackground", true);
// Disable swipe-left tab history navigation gesture.
user_pref("browser.gesture.swipe.left", "");
// Disable swipe-right tab history navigation gesture.
user_pref("browser.gesture.swipe.right", "");
// Disable inertial (kinetic) scrolling.
user_pref("apz.gtk.kinetic_scroll.enabled", false);

// =========================
// Media and rendering
// =========================

// Block autoplay by default.
user_pref("media.autoplay.default", 5);
// Force-enable WebRender compositor.
user_pref("gfx.webrender.all", true);
// Prefer non-ffvpx codecs when available.
user_pref("media.prefer-non-ffvpx", true);

// =========================
// Privacy and anti-tracking
// =========================

// Restrict WebRTC ICE candidates to default address only.
user_pref("media.peerconnection.ice.default_address_only", true);
// Disable Firefox telemetry submission.
user_pref("toolkit.telemetry.enabled", false);
// Send Do Not Track header.
user_pref("privacy.donottrackheader.enabled", true);
// Strip known tracking query params in normal windows.
user_pref("privacy.query_stripping.enabled", true);
// Strip known tracking query params in private windows.
user_pref("privacy.query_stripping.enabled.pbmode", true);

// =========================
// Security and permissions
// =========================

// Disable geolocation API.
user_pref("geo.enabled", false);
// Disable Safe Browsing malware checks.
user_pref("browser.safebrowsing.malware.enabled", false);
// Disable Safe Browsing phishing checks.
user_pref("browser.safebrowsing.phishing.enabled", false);
// Disable Safe Browsing download checks.
user_pref("browser.safebrowsing.downloads.enabled", false);
// Disable website notifications API.
user_pref("dom.webnotifications.enabled", false);
// Deny notification permission prompts by default.
user_pref("permissions.default.desktop-notification", 2);

// =========================
// Background activity and networking
// =========================

// Disable Push API to prevent push-triggered wakeups.
user_pref("dom.push.enabled", false);
// Disable link prefetching.
user_pref("network.prefetch-next", false);
// Disable DNS prefetching.
user_pref("network.dns.disablePrefetch", true);
// Disable speculative HTTP connections.
user_pref("network.http.speculative-parallel-limit", 0);
// Disable urlbar speculative connects.
user_pref("browser.urlbar.speculativeConnect.enabled", false);

// =========================
// Optional (currently disabled)
// =========================

// Auto frame rate by default.
// user_pref("layout.frame_rate", 120);
// Make tabs take less space.
// user_pref("browser.uidensity", 1);
// Lower touch scroll sensitivity.
// user_pref("mousewheel.default.delta_multiplier_y", 80);
// Old media experiments kept for reference.
// user_pref("media.rdd-vpx.enabled", false);
// user_pref("media.av1.enabled", false); // youtube crashes as of FF82
