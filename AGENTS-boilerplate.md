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
    if (!hasUnregister && state.menuIds.length) return;
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

  function init() {
    setEnabled(gmStore.get(ENABLE_KEY, true));
    if (sharedUi) {
      sharedUi.registerScript({ id: SCRIPT_ID, title: SCRIPT_TITLE, enabled: state.enabled, render: renderPanel, onToggle: (next) => setEnabled(next) });
    }
  }

  init();
})();
```

## Shared UI manager (`userscriptui.user.js`)

- Always `@require` the shared UI; register via `registerScript({ id, title, enabled, render, onToggle })`.
- Shared UI is a scaffold only; **each script must remain fully functional without it** (fallback buttons/overlays + menu commands).
- Fallbacks: if the shared UI fails to load, inject the legacy UI (floating button/panel) with **the same dark + hotpink styling** and keep menu commands working.
- UI content must be touch-friendly, dark-themed, and idempotent; remove injected nodes on teardown.

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

## Testing & manual steps (minimum to document)

- Happy path on target pages (desktop + XBrowser).
- Negative paths (excluded URLs, missing elements).
- SPA/navigation changes if applicable.
- Toggle enable/disable to verify teardown and re-init (shared UI + fallback).
