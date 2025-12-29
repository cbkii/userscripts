# AGENTS Boilerplate — Templates & Shared Integrations

This is the **canonical scaffold** for all userscripts in this repo. Apply it to every script (unless a deeper `AGENTS.md` overrides). It captures templating, formatting, and shared-integration requirements.

## File headers & metadata (copy/paste skeleton)

```
// ==UserScript==
// @name         <Script Name>
// @namespace    https://github.com/cbkii/userscripts
// @version      YYYY.MM.DD.HHMM        // UTC datetime, bump on each functional change
// @description  <Concise purpose + key features>
// @author       cbkii
// @icon         data:image/svg+xml;base64,<base64-encoded-pink-svg>
// @match        <narrow patterns>
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/<file>.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/<file>.user.js
// @homepageURL  https://github.com/cbkii/userscripts
// @supportURL   https://github.com/cbkii/userscripts/issues
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @require      https://raw.githubusercontent.com/cbkii/userscripts/main/userscriptui.user.js
// ==/UserScript==

/*
  Feature summary:
  - <Bullets>

  How it works:
  - <Bullets>

  Configuration:
  - <Bullets>
*/
```

**Rules**
- Keep `@match`/`@include` as tight as possible.
- Only declare grants you use; prefer async GM APIs when present.
- Use a single top-level IIFE with `"use strict"` and a named `main()` entry.
- **Icon requirement**: Every userscript must include an `@icon` metadata field with a simple, consistent line-style SVG icon:
  - Use hot pink (`#FF1493`) stroke color for consistency across all scripts
  - Must be a base64-encoded data URI (format: `data:image/svg+xml;base64,<encoded-svg>`)
  - Choose imagery relevant to the script's purpose (e.g., shield for security, download for export, unlock for access)
  - Keep icons lightweight and from the same visual design set/style for consistency
  - Position `@icon` after `@author` and before `@match` in the metadata block

## Standard code scaffold (recommended)

```
(() => {
  'use strict';

  const DEBUG = false;
  const LOG_PREFIX = '[<short>]';
  const LOG_STORAGE_KEY = 'userscript.logs.<short>';
  const SCRIPT_ID = '<short>';
  const SCRIPT_TITLE = '<Human Title>';
  const ENABLE_KEY = `${SCRIPT_ID}.enabled`;

  const gmStore = {
    async get(key, fallback) { try { return await GM_getValue(key, fallback); } catch (_) { return fallback; } },
    async set(key, value) { try { await GM_setValue(key, value); } catch (_) {} }
  };

  const sharedUi = (typeof window !== 'undefined' && window.__userscriptSharedUi)
    ? window.__userscriptSharedUi.getInstance({ get: gmStore.get, set: gmStore.set })
    : null;

  const state = { enabled: true, started: false, menuIds: [] };
  const hasUnregister = typeof GM_unregisterMenuCommand === 'function';

  function main() { /* core behaviour here */ }

  function renderPanel() { /* build DOM for shared modal; idempotent */ }

  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    if (hasUnregister && state.menuIds.length) { state.menuIds.forEach(id => { try { GM_unregisterMenuCommand(id); } catch (_) {} }); state.menuIds = []; }
    state.menuIds.push(GM_registerMenuCommand(
      `Toggle ${SCRIPT_TITLE} (${state.enabled ? 'ON' : 'OFF'})`,
      async () => { await setEnabled(!state.enabled); }
    ));
    if (state.enabled) {
      state.menuIds.push(GM_registerMenuCommand('<Primary action>', () => main()));
    }
  }

  async function setEnabled(value) {
    state.enabled = !!value;
    await gmStore.set(ENABLE_KEY, state.enabled);
    if (sharedUi) sharedUi.setScriptEnabled(SCRIPT_ID, state.enabled);
    if (state.enabled && !state.started) { await start(); }
    if (!state.enabled) { await stop(); }
    registerMenu();
  }

  async function start() { if (state.started) return; state.started = true; main(); }
  async function stop() { state.started = false; /* teardown observers/UI */ }

  async function init() {
    const saved = await gmStore.get(ENABLE_KEY, true);
    await setEnabled(saved);
    if (sharedUi) {
      sharedUi.registerScript({ id: SCRIPT_ID, title: SCRIPT_TITLE, enabled: state.enabled, render: renderPanel, onToggle: (next) => setEnabled(next) });
    }
  }

  init();
})();
```

## Shared UI manager (`userscriptui.user.js`)

- **Do NOT `@require` the shared UI** - it must be installed separately as a userscript. Scripts detect it via `window.__userscriptSharedUi`.
- Register via `registerScript({ id, title, enabled, render, onToggle })` when `sharedUi` is available.
- **NO FALLBACK UI**: Scripts must NOT create standalone buttons, overlays, or panels. The shared UI modal is the ONLY permitted user interface.
- **NO STANDALONE UI ELEMENTS**: Do not create FABs, custom overlays, sidebar panels, or any DOM elements outside of `renderPanel()`.
- Menu commands are the ONLY fallback when shared UI is unavailable - they provide basic functionality without visual clutter.
- UI content must be touch-friendly, dark-themed, and idempotent.

## Userscript logs (`userscriptlogs.user.js`)

- Log keys must be prefixed `userscript.logs.<short>`.
- Do not record sensitive values (tokens, cookies, PII); scrub query params and long strings.
- Provide a clear path to view/clear logs via:
  - Shared UI panel **and**
  - Fallback modal/menu command when shared UI is unavailable.

## Storage, naming, and common patterns

- State keys: `${scriptId}.enabled`, `userscripts.sharedUi.position`, `userscripts.sharedUi.activePanel`.
- Use a capped logger writing to `LOG_STORAGE_KEY` (200 entries); prefer the existing scrubber pattern in scripts.
- Observe idempotency: guard DOM injection with IDs/data-attributes; disconnect observers/timers on disable.
- Avoid global side effects when disabled; re-run safely after SPA navigation.

## Code structure and section banners

### Standard section order

All userscripts must organize code in this order, with consistent section banners:

1. **CONSTANTS & CONFIGURATION** — Script IDs, storage keys, feature flags, numeric constants
2. **UTILITIES & HELPERS** — Logger, storage wrappers, generic helper functions
3. **CORE LOGIC** — Main business logic, algorithms, extraction/processing/transformation
4. **UI COMPONENTS** — renderPanel, fallback UI, toast/notification builders
5. **STATE MANAGEMENT** — setEnabled, registerMenu, start, stop, teardown
6. **INITIALIZATION** — init function and its invocation

Additional sections may be added between or after these when necessary for complex scripts (e.g., "THIRD-PARTY LIBRARY CONFIGURATION", "NETWORK & API", "EVENT HANDLERS"), but the core six must appear in this order when present.

### Section banner format

Every distinct section must have a banner comment. Use this exact format:

```
//////////////////////////////////////////////////////////////
// SECTION NAME CONCISE DESCRIPTIVE SINGLE LINE ALL CAPS
//////////////////////////////////////////////////////////////
```

**Rules:**
- Empty line **above** the banner
- Empty line **below** the banner
- Use ALL CAPS for section names
- Keep section names concise (fit on one line)
- Use this format for all major sections (constants, utilities, core logic, UI, state, init)

**Example:**

```

//////////////////////////////////////////////////////////////
// CONSTANTS & CONFIGURATION
//////////////////////////////////////////////////////////////

const DEBUG = false;
const LOG_PREFIX = '[example]';

//////////////////////////////////////////////////////////////
// UTILITIES & HELPERS
//////////////////////////////////////////////////////////////

const createLogger = (...) => { ... };
```

## Testing & manual steps (minimum to document)

- Happy path on target pages (desktop + XBrowser).
- Negative paths (excluded URLs, missing elements).
- SPA/navigation changes if applicable.
- Toggle enable/disable to verify teardown and re-init (shared UI + fallback).

---

## Wildcard scripts: Dormant by default

Scripts matching `*://*/*` or similar broad patterns **must** be dormant by default:

### Required pattern

```js
const ALWAYS_RUN_KEY = `${SCRIPT_ID}.alwaysRun`;

async function init() {
  state.enabled = await gmStore.get(ENABLE_KEY, true);
  state.alwaysRun = await gmStore.get(ALWAYS_RUN_KEY, false);
  
  registerMenu();  // Always register menu commands
  
  if (sharedUi) {
    sharedUi.registerScript({
      id: SCRIPT_ID,
      title: SCRIPT_TITLE,
      enabled: state.enabled,
      render: renderPanel,
      onToggle: (next) => setEnabled(next)
    });
  }
  
  // Only auto-start if Always Run is enabled
  if (state.enabled && state.alwaysRun) {
    await start();
  }
}
```

### Required UI elements
- Show "Always Run" toggle in shared UI panel
- Show current state (dormant vs active) in panel
- Provide "Run now" button for on-demand activation
- Update menu commands to reflect dormant/active state

---

## Lifecycle contract

Every script must implement these lifecycle methods:

### `init()` — Boot
- Read configuration from storage
- Register with shared UI
- Register menu commands
- **Do NOT** start heavy work unless Always Run is enabled

### `start()` — Activate
- Must be **idempotent** (safe to call multiple times)
- Begin script's active behaviour (observers, DOM changes, etc.)
- Track all resources for cleanup

### `stop()` — Teardown
- Disconnect all MutationObservers
- Remove all injected DOM nodes
- Remove injected styles
- Clear all intervals/timeouts
- Abort pending fetch operations (use AbortController)
- Unregister menu commands where supported
- Reset state flags

### Resources tracker pattern

```js
const resources = {
  observers: [],
  intervals: [],
  timeouts: [],
  abortControllers: [],
  injectedNodes: []
};

function trackObserver(observer) {
  resources.observers.push(observer);
  return observer;
}

function cleanup() {
  resources.observers.forEach(obs => { try { obs.disconnect(); } catch (_) {} });
  resources.intervals.forEach(id => clearInterval(id));
  resources.timeouts.forEach(id => clearTimeout(id));
  resources.abortControllers.forEach(ac => { try { ac.abort(); } catch (_) {} });
  resources.injectedNodes.forEach(node => { try { node.remove(); } catch (_) {} });
  // Reset arrays
  Object.keys(resources).forEach(k => resources[k] = []);
}
```

---

## Running validation

Before committing, run the dev tooling:

```bash
cd dev
npm run validate
```

This runs:
1. `node --check` syntax validation on all scripts
2. Metadata validation (required fields, namespace, version format)
3. Pattern checks (IIFE wrapper, strict mode, etc.)

All scripts must pass with 0 errors before merge.
