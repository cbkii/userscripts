# Userscript Best Practices Checklist

Quick reference for developers: ensure your userscripts meet industry standards.

## ✅ Metadata Block

- [ ] Starts with `// ==UserScript==` and ends with `// ==/UserScript==`
- [ ] Includes `@name`, `@namespace`, `@version`, `@description`, `@author`
- [ ] Has `@icon` (base64 SVG data URI, hot pink #FF1493 stroke)
- [ ] Uses `@match` (preferred) or `@include` with narrow patterns
- [ ] Declares all `@grant` permissions explicitly
- [ ] Includes `@run-at` with deliberate timing choice
- [ ] Has `@noframes` if iframe execution is unwanted
- [ ] Provides `@updateURL` and `@downloadURL` for auto-updates
- [ ] Sets `@homepageURL` and `@supportURL` for user support

## ✅ Permission Model (Least Privilege)

- [ ] Only grants APIs that are actually used
- [ ] Avoids `@connect *` unless absolutely necessary
- [ ] Documents why each permission is needed (in code comments)
- [ ] Uses `@grant none` only if no GM APIs are needed

## ✅ Code Structure

- [ ] Wrapped in single top-level IIFE with `'use strict'`
- [ ] Has clear constants section (DEBUG, LOG_PREFIX, SCRIPT_ID, etc.)
- [ ] Implements `state` object with `enabled` and `started` flags
- [ ] Provides idempotent `main()` or `start()` function
- [ ] Includes `renderPanel()` for shared UI integration
- [ ] Implements `registerMenu()` for Tampermonkey commands
- [ ] Has `setEnabled()` for toggle with proper teardown
- [ ] Initializes with DOMContentLoaded or setTimeout check

## ✅ Performance

- [ ] Uses `@run-at document-idle` for heavy processing
- [ ] Uses `@run-at document-start` only for early intervention
- [ ] Caches DOM queries instead of repeated lookups
- [ ] Uses event delegation over individual listeners
- [ ] Disconnects MutationObservers when no longer needed
- [ ] Implements dormant-by-default for `@match *://*/*` scripts
- [ ] Debounces/throttles high-frequency events (scroll, resize)
- [ ] Batches DOM modifications with DocumentFragment

## ✅ Error Handling & Logging

- [ ] Wraps risky operations in try/catch
- [ ] Uses structured logger from boilerplate
- [ ] Scrubs sensitive data (tokens, passwords, URLs)
- [ ] Caps log storage (default 200 entries)
- [ ] Stores logs in `userscript.logs.<scriptid>` key
- [ ] Only logs to console when DEBUG=true or level=error/warn
- [ ] Provides meaningful error messages

## ✅ DOM Manipulation Safety

- [ ] Checks element existence before manipulation
- [ ] Uses `querySelector` with narrow scope (not document-wide)
- [ ] Avoids `innerHTML` with user-provided data (XSS risk)
- [ ] Uses `createElement`/`appendChild` for safe injection
- [ ] Toggles classes instead of setting inline styles
- [ ] Cleans up injected elements on disable
- [ ] Marks injected elements with `data-*` attributes

## ✅ Mobile & Touch Optimization

- [ ] Detects touch support and uses appropriate events
- [ ] Uses `touchstart` instead of `click` on touch devices
- [ ] Ensures touch targets are at least 42x42px (44px ideal)
- [ ] Designs UI for small screens (responsive layout)
- [ ] Avoids hover-only interactions
- [ ] Tests on XBrowser (Android) if possible
- [ ] Tests on Tampermonkey (Chrome/Firefox desktop)

## ✅ Dependency Management

- [ ] Uses only trusted CDNs (Google, jsDelivr, unpkg, etc.)
- [ ] Pins exact versions (e.g., `@7.2.2`, not `@latest`)
- [ ] Uses canonical CDN URLs from repository table
- [ ] Verifies UMD builds for browser globals (not CJS)
- [ ] Documents why each dependency is needed
- [ ] Uses HTTPS-only for all `@require` URLs
- [ ] Considers fallback if CDN fails (optional but recommended)

## ✅ Security Practices

- [ ] Never uses `eval()` or `Function()` constructor
- [ ] Validates and sanitizes all external data
- [ ] Uses HTTPS for all network requests
- [ ] Avoids inline event handlers (use `addEventListener`)
- [ ] Follows Content Security Policy (CSP) best practices
- [ ] Never logs or stores sensitive user data
- [ ] Uses secure random for any ID generation (crypto.randomUUID)

## ✅ Unified UI Integration

- [ ] Registers with shared UI manager (`userscriptui.user.js`)
- [ ] Implements `renderPanel()` with idempotent DOM building
- [ ] Does NOT create standalone floating action buttons
- [ ] Does NOT create custom overlays or modals
- [ ] Places all controls inside shared UI panel
- [ ] Provides fallback menu commands (but UI is primary)
- [ ] Updates UI state on enable/disable toggle

## ✅ Documentation

- [ ] Has top-of-file comment with feature summary
- [ ] Explains how the script works
- [ ] Lists configuration options
- [ ] Includes manual test steps in `docs/<script>.md` (if complex)
- [ ] Uses English-only for comments and UI strings
- [ ] Updates README.md if adding new script
- [ ] Documents load order priority if relevant

## ✅ Load Order & Concurrency

- [ ] Declares load priority in top comment (1-12)
- [ ] Implements idempotency guard (`if (state.started) return`)
- [ ] Doesn't pollute global namespace (except framework scripts)
- [ ] Checks for existing patches before patching native APIs
- [ ] Listens for `userscriptSharedUiReady` event (don't assume immediate)
- [ ] Works independently if dependencies missing (graceful degradation)

## ✅ Version & Updates

- [ ] Uses datetime format `YYYY.MM.DD.HHMM` for `@version`
- [ ] Bumps version on every functional change
- [ ] Updates `@updateURL` and `@downloadURL` if filename changes
- [ ] Tests auto-update mechanism (install from GitHub raw URL)
- [ ] Documents breaking changes in commit message

## ✅ Testing & Quality

- [ ] Runs `node --check <script>.user.js` (syntax validation)
- [ ] Passes `cd dev && npm run lint` (metadata validation)
- [ ] Passes `cd dev && npm run test` (pattern checks)
- [ ] Manually tests on target pages (happy path)
- [ ] Tests edge cases (missing elements, blocked resources)
- [ ] Tests SPA navigation (if applicable)
- [ ] Tests on XBrowser (Android priority)
- [ ] Tests on Tampermonkey (Chrome/Firefox desktop)
- [ ] Verifies enable/disable toggle with proper cleanup

## ✅ Dormant-by-Default (Required for `@match *://*/*`)

- [ ] Implements `ALWAYS_RUN_KEY` setting (default: OFF)
- [ ] Only runs heavy work when Always Run is ON or user-triggered
- [ ] Registers menu commands and UI panel regardless of Always Run
- [ ] Provides clear Always Run toggle in UI panel
- [ ] Shows "Dormant" vs "Active" status in UI
- [ ] Documents what qualifies as "heavy work" for this script

---

## Common Anti-Patterns to Avoid

🚫 **Don't:**
- Use `@grant none` when you need GM APIs (causes undefined errors)
- Create duplicate closing braces (`}, 0);` parse failures)
- Load CommonJS builds that expect `module.exports` (use UMD)
- Run heavy DOM scans on every page with `@match *://*/*`
- Create standalone UI elements (use shared UI only)
- Mix `@grant none` with specific grants (none takes precedence)
- Forget to disconnect MutationObservers (memory leaks)
- Use `innerHTML` with untrusted data (XSS vulnerability)
- Poll with `setInterval` without max iterations (CPU saturation)
- Load dependencies from multiple CDNs (version conflicts)

## Quick Reference: Common Patterns

### Idempotent Start
```javascript
const state = { started: false };
const start = async () => {
  if (state.started) return;
  state.started = true;
  // Safe to initialize now
};
```

### Safe DOM Query
```javascript
const button = document.querySelector('#myButton');
if (button) {
  button.addEventListener('click', handleClick);
}
```

### Touch Detection
```javascript
const isTouch = () => 'ontouchstart' in document.documentElement;
const clickEvent = isTouch() ? 'touchstart' : 'click';
element.addEventListener(clickEvent, handler);
```

### Observer Cleanup
```javascript
const observers = [];
const observer = new MutationObserver(callback);
observer.observe(target, { childList: true });
observers.push(observer);

// On disable:
observers.forEach(obs => obs.disconnect());
observers.length = 0;
```

### Shared UI Registration
```javascript
if (sharedUi) {
  sharedUi.registerScript({
    id: SCRIPT_ID,
    title: SCRIPT_TITLE,
    enabled: state.enabled,
    render: renderPanel,
    onToggle: (next) => setEnabled(next)
  });
}
```

---

## Priority Checklist for New Scripts

**Must Have (Blocking):**
1. Valid metadata block with all required keys
2. Explicit @grant list
3. Icon (base64 SVG, hot pink stroke)
4. Narrow @match patterns
5. IIFE wrapper with 'use strict'
6. Idempotent initialization

**Should Have (Important):**
7. Structured logger with scrubbing
8. Shared UI integration
9. Enable/disable toggle with cleanup
10. Touch event support
11. Error handling with try/catch
12. Documentation comment block

**Nice to Have (Polish):**
13. Debounced event handlers
14. Performance monitoring
15. Per-script docs in `/docs`
16. Comprehensive test scenarios
17. CDN fallback strategy
18. Load order priority comment

---

**Reference**: See [RESEARCH-FINDINGS.md](./RESEARCH-FINDINGS.md) for detailed analysis and rationale.

**Last Updated**: 2026-01-02
