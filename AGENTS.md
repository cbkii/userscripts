# AGENTS.md — Userscripts (Tampermonkey-first, XBrowser-priority)

This repository contains **userscripts**. Developer agents (Codex/Copilot/etc.) must follow this guide when creating or updating scripts so they remain **fast, safe, maintainable, and portable** across script managers — with **Android XBrowser compatibility prioritised above all**.

---

## 0) What “done” means

A change is complete only when all items below are true:

- Script has a **valid metadata block** and includes at least one `@match` or `@include`.
- Matching rules are **as narrow as practical** (least privilege).
- `@grant` contains **only** the APIs used; `@connect` contains **only** the domains required.
- Works on:
  - Tampermonkey (latest stable in at least one Chromium browser)
  - **XBrowser** (Android) using its built-in script manager (priority)
- Clear manual test steps are included in the PR/commit message or `docs/<script>.md`.
- `@version` is bumped for any functional change, and update hosting behaviour is correct.

---

## 1) Repo conventions

### Layout
- `scripts/<short-name>.user.js` — one userscript per file
- `lib/` — optional shared helpers (plain JS, no build step unless explicitly added)
- `docs/<short-name>.md` — optional per-script usage and test notes

### Script structure rules
- Must start with the metadata block (no BOM, no leading whitespace).
- Use a single top-level IIFE and `"use strict"`.
- Provide:
  - a clear `main()` entrypoint
  - idempotent DOM changes (safe to run multiple times)
  - optional teardown/disable logic when feasible
- Use a consistent log prefix and a `DEBUG` switch.

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
- `@namespace`
- `@version`
- `@description`
- `@match` (preferred) or `@include`
- `@run-at` (deliberate choice)
- `@grant` (explicit list; see below)

### 2.3 Strongly recommended keys
- `@author`
- `@license` (if you publish)
- `@noframes` (if you do not want to run inside iframes)
- `@connect` (for any cross-origin network use)
- `@updateURL` / `@downloadURL` (if you control distribution)
- `@supportURL` / `@homepageURL` (if publishing)

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

~~~js
// ==UserScript==
// @name         <Script Name>
// @namespace    https://example.com/userscripts
// @version      0.1.0
// @description  <What it does>
// @author       <You>
// @match        https://example.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(() => {
  'use strict';

  const DEBUG = false;
  const LOG_PREFIX = '[<short-name>]';

  const log = (...args) => { if (DEBUG) console.log(LOG_PREFIX, ...args); };

  function safeAddStyle(css) {
    try { GM_addStyle(css); } catch (_) { /* no-op */ }
  }

  function main() {
    // 1) validate page state / URL
    // 2) apply idempotent DOM changes
    // 3) attach minimal observers/listeners
    log('started');
  }

  try {
    main();
  } catch (err) {
    console.error(LOG_PREFIX, 'fatal error', err);
  }
})();
~~~

---

## 13) Agent workflow: how to execute requests

When asked to build or update a script:

1. **Restate the goal** and list assumptions.
2. Identify target pages and design **tight `@match` patterns**.
3. Decide `@run-at` and sandbox requirements.
4. List required permissions:
   - `@grant` APIs
   - `@connect` domains (if any)
5. Implement:
   - idempotent DOM updates
   - SPA-safe navigation handling (if needed)
   - minimal UI and toggles (menu commands) where helpful
6. Update `@version` and update URLs (if applicable).
7. Provide a **manual test plan**:
   - happy path
   - negative path (excluded pages, missing elements)
   - SPA navigation (if relevant)
   - XBrowser check

---

## 14) References (for agents)

- Tampermonkey documentation (metadata, grants, APIs, sandbox, updates)
- Tampermonkey changelog (behaviour changes, MV3 notes)
- Chrome match patterns documentation (for `@match` semantics)
- GreaseSpot metadata block reference (baseline syntax)
- Violentmonkey metadata reference (compatibility rules)
- XBrowser user script API reference (Android target compatibility)
