# Codebase Context (Android-first)

## Purpose
This repository contains standalone userscripts intended to run primarily on **Android XBrowser** (built-in userscript manager) and Android Chromium + Tampermonkey. The scripts are designed to be lightweight, safe, and compatible with mobile constraints.

## Architecture
- **One script per file**: `*.user.js` in repo root.
- **Shared UI manager**: `userscriptui.user.js` provides the hot‑pink dock button and modal; all script controls live inside that shared UI.
- **Per-script state**: uses `GM_getValue` / `GM_setValue` where available; XBrowser fallbacks are used in a few scripts.

## Android Constraints
- XBrowser does **not** expose `performance.memory`; any memory-guard logic that depends on it is unsupported on Android and should be avoided.
- Prefer `document-idle` for heavier work; use lightweight observers and avoid long‑running intervals when possible.

## Local Validation
```bash
cd dev
npm run lint
npm run test
```

## Ticket Placeholder (No issue created)
Suggested issue title:
- "Android: Prevent userscripts from causing memory/CPU spikes"

Suggested issue body:
- "Audit userscripts for observer/timer leaks, ensure Android‑safe behavior, and remove unsupported memory telemetry (performance.memory)."

Reference placeholder:
- "Refs: <TICKET-ID>"
