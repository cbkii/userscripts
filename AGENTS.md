# AGENTS.md — Userscripts (Tampermonkey-first, XBrowser-priority)

This repository contains **userscripts**. Developer agents (Codex/Copilot/etc.) must follow this guide when creating or updating scripts so they remain **fast, safe, maintainable, and portable** across script managers — with **Android XBrowser compatibility prioritised above all**.

**Mandatory API reference:** every userscript must be authored with a deep understanding of the repository API guidance in **[API-doc.md](./API-doc.md)**. Review it before designing behavior, metadata, permissions, or DOM interactions, and keep it open while implementing changes.

---

## 0) What “done” means

**Quick Reference:** See [BEST-PRACTICES-CHECKLIST.md](./docs/BEST-PRACTICES-CHECKLIST.md) for a comprehensive checklist.

A change is complete only when all items below are true:

- Script has a **valid metadata block** and includes at least one `@match` or `@include`.
- Matching rules are **as narrow as practical** (least privilege).
- `@grant` contains **only** the APIs used; `@connect` contains **only** the domains required.
- Works on:
  - Tampermonkey (latest stable in at least one Chromium browser)
  - **XBrowser** (Android) using its built-in script manager (priority)
- Clear manual test steps are included in the PR/commit message or `docs/<script>.md`.
- `@version` is bumped for any functional change, and update hosting behaviour is correct.
- API usage aligns with **[API-doc.md](./API-doc.md)** (read and applied for every script change).

---

## 1) Repo conventions

### Layout
- `scripts/<short-name>.user.js` — one userscript per file
- `docs/<short-name>.md` — optional per-script usage and test notes

### Repo-wide patterns (apply unless overridden)
- Persist enable/disable state per script with `GM_getValue`/`GM_setValue` using key `${id}.enabled`, expose a menu toggle (`GM_registerMenuCommand` + optional unregister).
- Register with the shared UI manager (`userscriptui.user.js`) when available, but ensure the script still runs with its own UI and commands if the shared UI is missing.
- Use the logging helper pattern that scrubs sensitive values and stores capped entries under `userscript.logs.<short>`.
- Keep UI idempotent and teardown-safe: disconnect observers, remove injected DOM, and clear timers on disable.

### Dependencies and updates (single-file only)
- **Single-file only**: each userscript must be fully self-contained; do not add a `lib/` folder or any shared local JS files.
- External dependencies must come from **trustworthy, stable CDNs** (e.g., official vendor CDNs, Google Hosted Libraries, cdnjs).
- Prefer using the **same CDN URL + version** across scripts for shared dependencies (e.g., one jQuery version reused consistently).
- Pin versions and update **weekly or less frequently**, unless a critical fix requires a faster bump.
- Assume the repository is **public**, and metadata URLs must point at the public GitHub repo.

### Script structure rules
- Must start with the metadata block (no BOM, no leading whitespace).
- Use a single top-level IIFE and `"use strict"`.
- Provide:
  - a clear `main()` entrypoint
  - idempotent DOM changes (safe to run multiple times)
  - optional teardown/disable logic when feasible
- Use a consistent log prefix and a `DEBUG` switch.
- Use English-only comments and user-facing strings.
- Add a top-of-file comment block (after metadata, before code) with:
  - Feature summary
  - How it works
  - Configuration notes

---

## 2) Metadata block: strict requirements

### 2.1 Syntax (must be exact)
- The block uses **line comments** and must be exactly:
  - `// ==UserScript==` and `// ==/UserScript==` at the start of their lines
  - each metadata line starts with `// ` (exactly one space after `//`)
- Put the metadata block at the **very beginning** of the file for broad compatibility.

### 2.2 Required keys (practical minimum)
Use these unless you have a strong reason not to:

- `@name`
- `@namespace` set to `https://github.com/cbkii/userscripts`
- `@version` using datetime format `YYYY.MM.DD.HHMM` (e.g., `2025.12.23.2043`).
  - Use the **current UTC datetime** at the moment you code or commit. If that is not possible, use the file’s modified time (UTC). If neither is possible or it conflicts, **increment by 1 minute** (HHMM + 1). Versions must never decrease.
- `@description` (concise English-only summary of main purpose and key features)
- `@author`
- `@icon` (required: base64-encoded SVG data URI with hot pink `#FF1493` stroke, placed after `@author` and before `@match`)
- `@match` (preferred) or `@include`
- `@run-at` (deliberate choice)
- `@grant` (explicit list; see below)

### 2.3 Strongly recommended keys
- `@license` (if you publish)
- `@noframes` (if you do not want to run inside iframes)
- `@homepageURL` set to `https://github.com/cbkii/userscripts`
- `@supportURL` set to `https://github.com/cbkii/userscripts/issues`
- `@updateURL` and `@downloadURL` both set to the raw GitHub URL for the script on `main`, e.g.:
  - `https://raw.githubusercontent.com/cbkii/userscripts/main/<script>.user.js`
- `@connect` (for any cross-origin network use)

### 2.3a Icon requirements (mandatory)
Every userscript must include an `@icon` metadata field:
- **Format**: Base64-encoded SVG data URI (`data:image/svg+xml;base64,<encoded-svg>`)
- **Style**: Simple line-style icon with consistent stroke weight (2px recommended)
- **Color**: Hot pink `#FF1493` stroke color for consistency across all scripts
- **Design**: Choose imagery relevant to the script's purpose
  - Examples: shield for security/blocking, download arrow for export, unlock for access removal, search magnifier for search tools, moon for dark mode, document for content extraction
- **Size**: Lightweight SVG (typically 24×24 viewBox)
- **Source**: Use consistent design set (e.g., Feather, Lucide, or similar line icon sets)
- **Position**: Place after `@author` and before `@match` in the metadata block
- **Consistency**: All icons should be from the same visual style/design family

### 2.4 Tampermonkey gotchas (important)
- Tampermonkey requires at least one `@match` or `@include` for a script to run.
- `@updateURL` requires `@version` for update checks to work.
- `@downloadURL none` disables update checks.
- Recent Tampermonkey versions on Chromium may require **Developer mode enabled** for userscripts to run.

---

## 3) Matching rules: how to choose `@match`, `@include`, `@exclude`

### Prefer `@match` for precision
Use Chrome-style match patterns:

`<scheme>://<host>/<path>`

Examples:
- `*://example.com/*`
- `https://*.example.com/*`
- `http://localhost/*`

Rules of thumb:
- Keep host and path as tight as possible.
- Avoid `*://*/*` unless the script is intentionally global and safe.

Tampermonkey notes:
- `@match` supports `http*://` and does **not** support `"<all_urls>"`.

### Use `@include` only when you need its flexibility
`@include` is more permissive and can match unexpectedly (e.g., inside query parameters).
Tampermonkey note: URL hashes (`#...`) are not matched by `@include`; consider SPA navigation handling.

### Use `@exclude` to carve out dangerous or irrelevant areas
Use `@exclude` for:
- logout pages, billing flows, payment pages
- admin panels you don’t want to alter
- pages where the script’s heuristics are unreliable

---

## 4) Permissions: `@grant` and `@connect` (least privilege)

### 4.1 `@grant`
- **List every GM API you use** (legacy `GM_*` or async `GM.*`).
- Do **not** rely on implicit behaviour.
- `@grant none` disables the sandbox and changes what `window` means; only use if you fully understand the consequences (and you do not need GM APIs).

Common grants:
- `GM_addStyle`
- `GM_getValue` / `GM_setValue` (or `GM.getValue` / `GM.setValue`)
- `GM_registerMenuCommand`
- `GM_openInTab`
- `GM_xmlhttpRequest`
- `GM_setClipboard`
- `GM_download`
- `GM_getResourceText` / `GM_getResourceURL`

### 4.2 `@connect` (required for cross-origin network)
If you use `GM_xmlhttpRequest`, you must declare domains:
- `// @connect example.com` (includes subdomains)
- `// @connect sub.example.com`
- `// @connect self`
- `// @connect localhost`

Avoid `@connect *` unless truly necessary. If you cannot enumerate all domains, declare common ones and optionally add `@connect *` so Tampermonkey can offer an “always allow all domains” option.

---

## 5) Execution model: `@run-at`, sandboxes, and page context

### 5.1 `@run-at`
Choose deliberately:
- `document-start` — very early; DOM may not exist
- `document-body` — after `<body>` exists (if supported)
- `document-end` — at/after DOMContentLoaded (common)
- `document-idle` — after DOMContentLoaded (default if omitted; good for heavier work)

Tampermonkey caches certain events fired after injection and delivers them to listeners added via the sandbox’s `window.addEventListener`. Still: prefer explicit readiness checks and observers.

### 5.2 Sandboxing / page context
Goal: **avoid page-context injection unless necessary**.

Tampermonkey:
- Prefer `@sandbox DOM` for DOM-only scripts.
- Use `@sandbox JavaScript` or `raw` only when you genuinely need `unsafeWindow` or page JS access.
- Be mindful of CSP and differences across browsers.

Cross-manager note:
- Violentmonkey uses `@inject-into` (`page`, `content`, `auto`). If you must rely on page context, add the appropriate setting for that manager too.

---

## 6) SPA / dynamic pages: must be idempotent

Many modern sites don’t reload fully. Your script must:
- Detect route changes:
  - `popstate`
  - safe wrappers around `history.pushState` / `replaceState`
  - `MutationObserver` on stable containers
- Be idempotent:
  - do not duplicate UI
  - do not add duplicate listeners
  - mark injected elements (`data-<namespace>="1"`) and check before inserting

---

## 7) Performance and safety patterns

### 7.1 Avoid polling
Prefer:
- `MutationObserver` (disconnect on teardown)
- event delegation
- `requestAnimationFrame` for UI alignment work
- narrow selectors and caching

### 7.2 Clean teardown
Where feasible:
- Track observers and disconnect them when no longer needed.
- Track event listeners (use `AbortController` if available).
- Remove injected UI on disable.

### 7.3 Defensive coding
- Wrap entrypoint with try/catch.
- Fail gracefully when selectors don’t match.
- Log with a consistent prefix; keep `DEBUG` off by default.

### 7.4 Secure logging practices
- Use a single `createLogger(...)` helper per script to keep logging consistent and minimal.
- Keep `LOG_PREFIX` concise (short tag in square brackets, e.g., `[pmd]`).
- Store logs under `GM_setValue('userscript.logs.<short>')` with a capped list size.
- Redact sensitive data (tokens, auth/session values, passwords, cookies) and strip URL queries/hashes.
- Avoid logging full DOM nodes, page content, or large payloads; keep logs useful, not exhaustive.
- Emit console output only for `warn`/`error` or when debug is explicitly enabled.

---

## 8) GM4 vs legacy API compatibility (recommended wrapper)

Use a tiny compatibility layer so scripts work across managers and versions:

~~~js
const GMX = (() => {
  const hasGM = typeof GM !== 'undefined' && GM;
  const hasAsync =
    hasGM && typeof GM.getValue === 'function' && typeof GM.setValue === 'function';

  return {
    async getValue(key, def) {
      return hasAsync ? GM.getValue(key, def) : GM_getValue(key, def);
    },
    async setValue(key, val) {
      return hasAsync ? GM.setValue(key, val) : GM_setValue(key, val);
    },
    async deleteValue(key) {
      return hasAsync ? GM.deleteValue(key) : GM_deleteValue(key);
    },
    addStyle(css) {
      return hasGM && typeof GM.addStyle === 'function' ? GM.addStyle(css) : GM_addStyle(css);
    },
    openInTab(url, opts) {
      return hasGM && typeof GM.openInTab === 'function' ? GM.openInTab(url, opts) : GM_openInTab(url, opts);
    },
  };
})();
~~~

Notes:
- Keep `@grant` aligned with what you actually call (legacy vs async).
- For maximum compatibility (including XBrowser), prefer widely supported GM APIs and provide fallbacks.

---

## 9) External dependencies: `@require` and `@resource`

### Prefer “no dependencies”
If you do add them:
- Use trusted, stable URLs.
- Pin with integrity hashes where supported (Tampermonkey supports hash suffixes for `@require` / `@resource`).
- Keep the runtime footprint small.

---

## 10) Versioning & updates (distribution)

### Required behaviour
- Increment `@version` on every functional change.
- If you host scripts yourself:
  - set `@updateURL` (metadata URL; often `.meta.js`)
  - set `@downloadURL` (full `.user.js` URL)
- If you publish via a userscript host (e.g., Greasy Fork), prefer its update mechanisms and avoid fighting them.

### Local dev
- Installing from a local file won’t behave like hosted updates. Provide explicit dev instructions when needed.

---

## 11) XBrowser (Android) compatibility checklist (priority)

When targeting XBrowser:
- Stick to common, documented Tampermonkey APIs and avoid obscure/experimental features.
- Don’t assume DevTools or advanced extension settings exist.
- Provide a simple manual install path:
  - opening the `.user.js` URL should prompt installation in supported browsers/managers
- Avoid heavy dependencies and cutting-edge syntax unless you compile/transpile (prefer plain ES2018-ish).

---

## 12) Canonical script template (copy/paste)

You **must** follow **[AGENTS-boilerplate.md](./AGENTS-boilerplate.md)** for the required metadata, scaffold, formatting, and shared UI/logging integration template applied across all scripts. Deviations require explicit justification in review notes.

---

## 13) Agent workflow: how to execute requests

When asked to build or update a script:

1. **Restate the goal** and list assumptions.
2. Identify target pages and design **tight `@match` patterns**.
3. Decide `@run-at` and sandbox requirements.
4. List required permissions:
   - `@grant` APIs
   - `@connect` domains (if any)
5. Review and apply the guidance in **[API-doc.md](./API-doc.md)** before implementing.
6. Implement:
   - idempotent DOM updates
   - SPA-safe navigation handling (if needed)
   - minimal UI and toggles (menu commands) where helpful
7. Update `@version` and update URLs (if applicable).
8. Provide a **manual test plan**:
   - happy path
   - negative path (excluded pages, missing elements)
   - SPA navigation (if relevant)
   - XBrowser check

---

## 14) Dormant by default (for wildcard scripts)

Any script with `@match *://*/*` or similar broad patterns **must** follow "Dormant by default" rules:

### Required behaviour
- On page load, the script **may**:
  - Register menu commands
  - Create minimal UI shell (panel entry in shared UI manager)
  - Read configuration
  - Set up lightweight event hooks that do NOT do heavy work

- The script **must NOT**:
  - Run heavy DOM scans
  - Start MutationObservers that traverse large subtrees continuously
  - Start polling loops
  - Inject heavy CSS/HTML
  - Call network operations
  - ...unless triggered explicitly by the user via UI/menu **or** unless the user enables "Always Run".

### Always Run toggle (required)
- Provide a per-script setting `Always Run` (stored via `GM_getValue`/`GM_setValue`)
- Default: **OFF**
- When ON: script may auto-run its main actions on every matching page
- When OFF: heavy actions only run on demand (UI/menu button)
- Make state visible in UI (e.g., toggle + status text)
- Ensure it's safe across frames

### Implementation pattern
```js
const ALWAYS_RUN_KEY = `${SCRIPT_ID}.alwaysRun`;
let alwaysRun = await GM_getValue(ALWAYS_RUN_KEY, false);

// In init():
if (alwaysRun) {
  start(); // Full activation
} else {
  // Only register commands and UI hooks
  registerMenu();
  registerSharedUiPanel();
}
```

---

## 15) Dependency hygiene

### Canonical CDN URLs
If multiple scripts use the same third-party library, they **must** use:
- The **same version**
- The **same CDN source URL**

Canonical CDN URLs for this repository:
| Library | Canonical CDN URL |
|---------|-------------------|
| jQuery | `https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js` |
| jQuery UI | `https://ajax.googleapis.com/ajax/libs/jqueryui/1.13.2/jquery-ui.min.js` |
| Readability | `https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.js` |
| Turndown | `https://cdn.jsdelivr.net/npm/turndown@7.2.2/lib/turndown.browser.cjs.min.js` |
| Turndown GFM | `https://cdn.jsdelivr.net/npm/turndown-plugin-gfm@1.0.2/dist/turndown-plugin-gfm.min.js` |

### Rules
- Never load the same library from multiple CDNs in different scripts
- Prefer removing jQuery in new/refactored code (use vanilla DOM)
- If keeping jQuery, isolate it (avoid polluting page globals, avoid conflicts)
- The `/dev/scripts/lint.js` tool checks for non-canonical URLs

---

## 16) Dev tooling and CI

### Location rules
- All development tooling lives in `/dev`
- No bundling/release build scripts; releases are produced via Git tags
- `/dev/package.json` contains scripts for linting and testing

### Available scripts
```bash
cd dev
npm run lint     # node --check + metadata validation
npm run test     # metadata tests, pattern checks
npm run validate # lint + test combined
```

### CI pipeline
The repository uses GitHub Actions (`.github/workflows/ci.yml`) to run:
1. `node --check` on all userscripts (hard fail on syntax errors)
2. Lint script (validates metadata, checks for issues)
3. Test script (runs deterministic checks)

### Adding new checks
Add new validation logic to `/dev/scripts/lint.js` or `/dev/scripts/test.js`.

---

## 17) Common Tampermonkey failure modes

### A) Invalid or too-broad `@match`/`@include` patterns
- `@match` does **not** include query parameters (`?...`); use `@include` or runtime URL checks
- Prefer narrow patterns + runtime checks over `*://*/*`
- Test patterns with Tampermonkey's "Includes" tab before deployment

### B) Regex `@include` caveats
- In Tampermonkey MV3 "Dynamic Mode", regex `@include` may inject into every frame
- Keep regex patterns tight and use `@noframes` unless frame injection is needed
- Test on sites with many iframes to verify behaviour

### C) `document-start` timing unreliability
- DOM may not exist at `document-start`; prefer `document-idle` with guards
- If `document-start` is required:
  - Do almost nothing until DOM is safe
  - Use `MutationObserver` to wait for elements
  - Never assume `document.body` exists
  - Keep `document-start` work minimal (e.g., early patches only)

### D) Library conflicts
- jQuery/global collisions with page libraries cause silent errors
- Use `noConflict()` or avoid jQuery entirely in new scripts
- Never override `window.jQuery`, `window.$`, or other common globals
- Isolate all script logic inside IIFE; expose only namespaced globals

### E) Heavy DOM polling / unbounded MutationObservers
- Continuous `setInterval` polling without backoff causes CPU saturation
- MutationObservers with `subtree: true` on large nodes can cause layout thrashing
- Always:
  - Disconnect observers when no longer needed
  - Use `debounce` or `throttle` for observer callbacks
  - Pause on tab hidden (`visibilitychange`)
  - Set hard timeouts for retry loops

### F) Missing/incorrect `@grant`
- Missing grants cause APIs to be `undefined` at runtime
- Incorrect sandbox mode (`@grant none` when GM APIs are needed) causes silent failures
- Always test with a fresh Tampermonkey profile to catch grant issues

### G) Ghost behaviour from uncleared timers/observers
- Not cleaning up `setInterval`/`setTimeout`/`MutationObserver` on disable causes:
  - Memory leaks
  - Duplicate actions on SPA navigation
  - Interference with other scripts
- Always implement proper teardown:
  - Track all timers with IDs
  - Store observer references for disconnection
  - Use `AbortController` for fetch operations

---

## 18) References (for agents)

### Core Documentation (Required Reading)

- **[API-doc.md](./API-doc.md)** — Authoritative API guidance for all scripts (XBrowser compatibility reference)
- **[AGENTS-boilerplate.md](./AGENTS-boilerplate.md)** — Scaffold, formatting, and shared UI/logging integration rules
- **[BEST-PRACTICES-CHECKLIST.md](./docs/BEST-PRACTICES-CHECKLIST.md)** — Quick reference checklist for ensuring scripts meet industry standards
- **[RESEARCH-FINDINGS.md](./docs/RESEARCH-FINDINGS.md)** — Comprehensive analysis comparing this repository against industry best practices

### Concurrency & Load Order (Critical)

- **[CONCURRENCY.md](./docs/CONCURRENCY.md)** — Detailed analysis of race conditions, API conflicts, and mitigation strategies when 12+ scripts run simultaneously
- **[ANDROID-XBROWSER-FIXES-TECHNICAL.md](./docs/ANDROID-XBROWSER-FIXES-TECHNICAL.md)** — Technical details on polling fallback pattern, download fixes, and load order independence

### Testing & Validation

- **[ANDROID-XBROWSER-TESTING.md](./docs/ANDROID-XBROWSER-TESTING.md)** — Android XBrowser testing procedures and compatibility verification
- **[README.md](./README.md)** — User-facing documentation with load order priorities and concurrency safeguards

### Script-Specific Documentation

- **[docs/README-dlcountdown-fix.md](./docs/README-dlcountdown-fix.md)** — Download countdown timer fixes and implementation details
- **[docs/dlcountdown-changes.md](./docs/dlcountdown-changes.md)** — Change log for dlcountdown.user.js
- **[docs/dlcountdown-flow.md](./docs/dlcountdown-flow.md)** — Flow diagram for download countdown bypass logic
- **[docs/dlcountdown-testing.md](./docs/dlcountdown-testing.md)** — Testing procedures for download countdown script

### External References

- Tampermonkey documentation (metadata, grants, APIs, sandbox, updates)
- Tampermonkey changelog (behaviour changes, MV3 notes)
- Chrome match patterns documentation (for `@match` semantics)
- GreaseSpot metadata block reference (baseline syntax)
- Violentmonkey metadata reference (compatibility rules)
- XBrowser user script API reference (Android target compatibility)

---

## 19) Canonical Dependencies & Dependency Hygiene

**Rule:** The same dependency must always come from the same CDN source/version across the entire repository.

### Canonical CDN URLs (enforced by lint)

| Library | Canonical CDN | Notes |
|---------|---------------|-------|
| jQuery | `https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js` | Avoid if possible; use vanilla DOM |
| jQuery UI | `https://ajax.googleapis.com/ajax/libs/jqueryui/1.13.2/jquery-ui.min.js` | Only if jQuery is used |
| Readability | `https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.js` | Mozilla's article extractor |
| Turndown | `https://unpkg.com/turndown@7.2.2/dist/turndown.js` | **UMD build** (not CJS) |
| Turndown GFM | `https://unpkg.com/turndown-plugin-gfm@1.0.2/dist/turndown-plugin-gfm.js` | **UMD build** |

### Why unpkg for Turndown?

jsdelivr serves CommonJS builds (`turndown.browser.cjs.min.js`) that expect `module.exports`, causing crashes in userscript contexts. unpkg serves proper UMD builds that expose browser globals (`TurndownService`).

### Adding New Dependencies

1. Check if dependency has UMD/browser build (not CommonJS)
2. Use pinned version (e.g., `@7.2.2` not `@latest`)
3. Add to canonical list in `/dev/scripts/lint.js`
4. Document in this section
5. Use same URL across all scripts

**Never mix CDNs** for the same library (e.g., don't use both googleapis and cdnjs for jQuery).

---

## 20) Performance & Concurrency Best Practices

**See also:** [CONCURRENCY.md](./docs/CONCURRENCY.md) for detailed analysis of race conditions, API conflicts, and mitigation strategies.

### Idempotency
- Every script must be safe to run twice (SPA navigation, hot reloads)
- Check if already initialized before running setup
- Use flags like `state.started` to prevent duplicate work

### Non-Blocking Work
- Never block main thread with large synchronous loops
- Chunk DOM work with `requestIdleCallback` or `setTimeout(0)`
- Use `queueMicrotask` for small async tasks

### MutationObservers
- **Narrow scope**: Target specific containers, not `document.body`
- **Debounce/throttle**: Batch rapid changes
- **Disconnectable**: Always store observer references
- **OFF by default**: For `@match *://*/*`, only observe when Always Run ON or user-triggered

### Intervals/Timeouts
- **Bounded**: Set hard limits on retries
- **Cleared on success**: Stop polling when work is done
- **Exponential backoff**: Increase delay on repeated failures
- **Never run forever**: Use max iteration counts

### Network Requests
- **Cancellable**: Use `AbortController` where possible
- **No auto-work**: Don't fetch on init for `@match *://*/*` scripts
- **Error handling**: Always catch and log failures

### SPA Navigation
- Detect route changes: `popstate`, history wrapper, MutationObserver
- Don't duplicate initialization
- Don't duplicate observers
- Clean up old state before re-running

---

## 21) Dormant-by-Default Pattern (REQUIRED for @match *://*/*)

Scripts with broad `@match *://*/*` patterns **must** be dormant by default to prevent performance issues when many scripts run simultaneously.

### Required Implementation

```javascript
// Constants
const SCRIPT_ID = 'myscript';
const ALWAYS_RUN_KEY = `${SCRIPT_ID}.alwaysRun`;

// State
const state = {
  enabled: true,
  started: false,
  alwaysRun: false,  // DEFAULT: OFF
  menuIds: []
};

// Init - LIGHTWEIGHT ONLY
const init = async () => {
  state.enabled = await gmStore.get(ENABLE_KEY, true);
  state.alwaysRun = await gmStore.get(ALWAYS_RUN_KEY, false);
  
  // Always register UI/menu (lightweight)
  registerMenu();
  
  if (sharedUi) {
    sharedUi.registerScript({
      id: SCRIPT_ID,
      title: SCRIPT_TITLE,
      enabled: state.enabled,
      render: renderPanel,
      onToggle: (next) => setEnabled(next)
    });
  }
  
  // ONLY auto-start heavy work if Always Run is ON
  if (state.enabled && state.alwaysRun) {
    await start();  // Heavy work: observers, DOM scans, network
  }
};

// Heavy work function
const start = async () => {
  if (state.started) return;
  state.started = true;
  
  // NOW safe to start:
  // - MutationObservers over large subtrees
  // - DOM scanning/extraction
  // - Network fetches
  // - Interval polling
  // - Readability/Turndown processing
};
```

### Required UI Elements

**renderPanel must include:**
- Always Run toggle with clear ON/OFF state
- Status indicator showing "Dormant" vs "Active"
- On-demand action buttons (user can trigger work manually)

**Menu must include:**
- `[ScriptName] ↻ Always Run (ON/OFF)` command
- Other action commands work regardless of Always Run state

### What Qualifies as "Heavy Work"?

- MutationObservers with `subtree: true` over large DOM sections
- Document scanning (readability extraction, content parsing)
- Network requests (API calls, data fetching)
- Interval/timeout polling
- Large synchronous DOM manipulation
- Library initialization (Turndown, Readability setup)

### Exceptions

**Scripts that don't need Always Run:**
- Specific site scripts (narrow @match like `@match https://chat.openai.com/*`)
- UI infrastructure (userscriptui.user.js - it IS the foundation)
- Pure on-demand tools (no auto-work at all, only button-triggered)

---

## 22) Unified UI System (MANDATORY)

**CRITICAL: All userscripts must use ONLY the 'userscripts-ui-button' with all controls contained in their respective 'userscripts-tab' within 'userscripts-ui-modal'. NO separate UI elements are allowed — this means NO floating action buttons (FABs), NO standalone overlays, NO custom panels, and NO popup windows. The shared UI modal is the ONLY permitted user interface for all userscripts in this repository.**

### Requirements

- **Single entry point**: The hotpink dock button (`userscripts-ui-button`) provided by `userscriptui.user.js`
- **No standalone UI**: Scripts must NOT create:
  - Floating action buttons (FABs)
  - Standalone overlays or modals
  - Custom sidebar panels
  - Pop-up windows or tooltips with controls
  - Fixed-position buttons or icons
- **No fallback UI**: Don't create "if sharedUi missing" fallback interfaces
- **All controls in panel**: Every setting, button, toggle, and display goes in `renderPanel()`
- **Menu commands only for shortcuts**: Tampermonkey menu commands are allowed for quick access, but NOT as replacement for shared UI

### Implementation

```javascript
// Correct: Register with shared UI only
const renderPanel = () => {
  const wrapper = document.createElement('div');
  // ... build UI with buttons, toggles, status ...
  return wrapper;
};

// Correct: Menu commands for quick access
registerMenu();  // Adds Tampermonkey menu items

// WRONG: Don't do this - NO standalone UI
const injectFallbackButton = () => {
  // Creating standalone UI element - NOT ALLOWED
  const button = document.createElement('button');
  document.body.appendChild(button);  // VIOLATION
};

// WRONG: Don't do this - NO custom overlays
const createCustomOverlay = () => {
  const overlay = document.createElement('div');
  overlay.id = 'my-custom-ui';  // VIOLATION - use shared UI only
  document.body.appendChild(overlay);
};
```

### Why This Rule Exists

- **Consistency**: Single unified UI pattern across all scripts
- **No visual clutter**: Users don't see scattered buttons/panels on pages
- **Performance**: One lightweight UI manager instead of N separate UIs
- **Maintainability**: Single integration point for all scripts
- **User experience**: Users learn one interface, not N different ones
- **Mobile-friendly**: Shared UI is tested on mobile; custom UIs often break

### Enforcement

Code review and agents MUST reject PRs that:
- Create any DOM elements for UI outside of the `renderPanel()` function
- Add fixed/absolute positioned elements to the page
- Create overlay/modal elements with custom IDs
- Add event listeners for UI elements not in shared UI panel

---

## 23) Common Tampermonkey Pitfalls (CRITICAL)

### A) Parse Failures Stop Injection Entirely

**Symptom:** Script doesn't run at all, no console errors, appears broken.

**Cause:** Syntax error (missing brace, extra `}`, invalid token) prevents Tampermonkey from injecting the script.

**Solution:**
- Always use `node --check <script>.user.js` before committing
- CI gates enforce this (see `.github/workflows/ci.yml`)
- Look for duplicate closing braces in event listeners
- Check for stray `}, 0);` or `});` fragments

**Example of common error:**
```javascript
document.addEventListener('myEvent', () => {
  // ... code ...
});
}, 0);  // EXTRA }, 0); causes parse failure
```

### B) @require Format Mismatch (CJS vs UMD)

**Symptom:** `Cannot set properties of undefined (setting 'exports')` or `module is not defined`

**Cause:** Loading a CommonJS build that expects Node.js `module.exports` / `require()`.

**Solution:**
- Use UMD builds that expose browser globals
- For Turndown: Use `https://unpkg.com/turndown@7.2.2/dist/turndown.js` (NOT `.cjs.min.js`)
- Check library docs for "browser" or "UMD" build
- Test: library should expose global like `window.TurndownService`

### C) Over-Broad @match + Heavy Work = Page Hangs

**Symptom:** Pages slow to load, high CPU, browser becomes unresponsive.

**Cause:** Script with `@match *://*/*` runs heavy work (DOM scans, observers) on every page load.

**Solution:**
- Implement dormant-by-default pattern (see Section 21)
- Use `@run-at document-idle` not `document-start`
- Only start heavy work when:
  - Always Run is ON, or
  - User triggers action via UI/menu

### D) Non-Idempotent Init Breaks SPAs

**Symptom:** Script works on first page load, breaks after navigation (SPA routing).

**Cause:** Not checking if already initialized; observers/listeners added multiple times.

**Solution:**
```javascript
const state = { started: false };

const start = async () => {
  if (state.started) return;  // Idempotency guard
  state.started = true;
  
  // Safe to initialize now
};
```

### E) Unbounded Observers/Intervals Leak Resources

**Symptom:** Memory grows over time, CPU usage increases, browser slows down.

**Cause:** Observers/intervals not disconnected/cleared when no longer needed.

**Solution:**
```javascript
const observers = [];
const timers = [];

const observer = new MutationObserver(callback);
observer.observe(target, config);
observers.push(observer);

const timer = setInterval(check, 1000);
timers.push(timer);

// Cleanup
const teardown = () => {
  observers.forEach(obs => obs.disconnect());
  observers.length = 0;
  timers.forEach(id => clearInterval(id));
  timers.length = 0;
};
```

### F) Not Guarding GM_* Usage

**Symptom:** Script works in Tampermonkey but crashes in Violentmonkey or vice versa.

**Cause:** Different managers have different API support and behavior.

**Solution:**
```javascript
// Always check before using
if (typeof GM_registerMenuCommand === 'function') {
  GM_registerMenuCommand('My Command', handler);
}

// Use compatibility wrapper
const GMX = {
  async getValue(key, def) {
    return typeof GM !== 'undefined' && GM.getValue 
      ? GM.getValue(key, def) 
      : GM_getValue(key, def);
  }
};
```

### G) CSS Selector Fragility

**Symptom:** Script works today, breaks tomorrow after site updates.

**Cause:** Relying on generated class names or deep DOM structure.

**Solution:**
- Prefer attribute selectors: `[data-testid="message"]`
- Use semantic attributes: `[role="textbox"]`, `[aria-label="Send"]`
- Avoid: `.css-abc123-Message`, `div > div > div:nth-child(3)`
- Store selectors as constants for easy updates

### H) Duplicate Shared UI Bootstrap

**Symptom:** Multiple scripts trying to initialize shared UI, conflicts.

**Cause:** Copy-pasted bootstrap code with slight variations.

**Solution:**
- Use canonical bootstrap pattern (see AGENTS-boilerplate.md)
- Listen for `userscriptSharedUiReady` event exactly once
- Don't duplicate `setTimeout(() => { ... }, 0)` wrappers
- Check `registrationAttempted` flag before re-registering

---

## 24) Testing & Validation

### Before Committing

1. **Syntax check:** `node --check *.user.js`
2. **Lint:** `cd dev && npm run lint`
3. **Tests:** `cd dev && npm run test`
4. **Manual test:** Install in Tampermonkey, verify on target site

### CI Gates (Enforced)

- All `*.user.js` pass `node --check`
- Lint checks metadata, dependencies, patterns
- Tests validate structure, grants, conventions
- See `.github/workflows/ci.yml`

### Test Scenarios

- **Cold start**: Fresh Tampermonkey profile
- **Multiple scripts**: Install all, verify no conflicts
- **SPA navigation**: Click links, back/forward buttons
- **Enable/disable**: Toggle script, verify cleanup
- **Always Run**: Test both ON and OFF states
- **Menu commands**: Verify all menu items work
- **Shared UI**: Verify panel displays correctly

---

## 25) Dev Tooling (All in /dev)

### Structure

```
/dev
  /scripts
    lint.js        - Metadata validation, dependency checks
    test.js        - Pattern tests, structure validation
  package.json     - npm scripts (lint, test, validate)
```

### Commands

```bash
cd dev
npm run lint      # Check all scripts
npm run test      # Run tests
npm run validate  # Both lint + test
```

### No Build/Bundle Step

- Scripts are used directly from Git
- Git tags create releases (zip files)
- No webpack/rollup/esbuild
- No transpilation
- Single-file userscripts only

---

