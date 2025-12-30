# userscripts

A collection of assorted userscripts, with a **strong focus on Android and XBrowser compatibility**, but also intended to work well on  Tampermonkey and other userscript managers.

> **NOTE:**  This repository prioritizes XBrowser (Android) compatibility.  

---

## What is this repository?

This repo contains single-file, self-contained userscripts to be used with userscript managers (Tampermonkey, XBrowser, etc.), especially those targeting **Android browsers**. Each script is provided as a `.user.js` file.

The repository emphasizes:
- Minimum permission, maximum portability. **Scripts are single JS files** with no local dependencies.
- **External dependencies** only from trusted CDNs, versions pinned and reused.
- Practical scripts for real-world web annoyances or workflow streamlining.
- Explicit priorities: **Android, XBrowser** → Tampermonkey → others.

> See [AGENTS.md](./AGENTS.md) for the repo conventions, authoring and review workflow. 

## Install & Use

1. **Choose a userscript manager**:  
   - **[XBrowser](https://en.xbext.com/)**: Android-first, built-in userscript manager.
   - **[Tampermonkey](https://www.tampermonkey.net/)** & others: Supported, but with nonzero risk of compatibility quirks.

2. **Browse scripts:**
   - Tap/click the `.user.js` filename, then choose "Raw" (or download directly in your userscript manager). Xbrowser should automatically pop up toast to install from the file view page.

3. **Review metadata and optional configs:**  
   - Every script begins with a strict metadata block (`// ==UserScript== ... // ==/UserScript==`).
   - All @match/@include and required permissions are kept as tight as possible.
   - Some scripts have accompanying usage/test notes in `docs/<script-name>.md`.
  
### Optional helper scripts

- **userscriptui.user.js** — Provides a lightweight, mobile-friendly UI framework. Enhances and integrates with many scripts in this repo; not required, but recommended for full UI support.

- **userscriptlogs.user.js** — Adds centralised viewing and clearing of script logs via on-page dialog. Optional, but allows all scripts here to share and display log data efficiently.

> Both scripts are optional, but provide enhanced UI and logging features when installed alongside any other scripts in this collection. 

## Load Order & Concurrency

When multiple userscripts run on the same page, **load order matters** for proper operation. Scripts in this repository are designed to handle concurrent execution, but some have dependencies or can conflict if not loaded correctly.

### Recommended Load Order (Priority)

Install scripts in this order for best compatibility:

1. **userscriptui.user.js** — Shared UI framework (must load first if used)
2. **pageunlock.user.js** — Native API patches (document-start, must load early)
3. **antiadblock.user.js** — Anti-adblock mitigation (document-start)
4. **adinteract.user.js** — Ad interaction unlocking (document-start)
5. **dlcountdown.user.js** — Download countdown bypasses (document-start)
6. **searchgoogle.user.js** — Google search enhancements (document-end)
7. **searchduck.user.js** — DuckDuckGo search enhancements (document-end)
8. **vxdark.user.js** — Router dark mode (document-end)
9. **pagemd.user.js** — Page to Markdown converter (document-idle)
10. **chatgptmd.user.js** — ChatGPT export (document-idle)
11. **pageinfoexport.user.js** — Page metadata export (document-idle)
12. **userscriptlogs.user.js** — Log viewer (document-idle, should load last)

### Why Load Order Matters

**Foundation Scripts (1-2):** `userscriptui.user.js` exposes a global factory that other scripts discover. `pageunlock.user.js` patches native APIs like `addEventListener` at document-start and must load before other scripts that rely on unpolluted native methods.

**Early Intervention (3-5):** Anti-adblock and interaction scripts modify page behavior at document-start to prevent restrictive scripts from loading. Loading these early ensures they can intercept before the page's defensive code runs.

**Content Enhancement (6-8):** Site-specific scripts enhance search engines and UIs. These load at document-end after DOM is available but before all resources finish.

**Document Processing (9-11):** Heavy scripts that extract/convert content load at document-idle after the page is fully interactive, preventing slowdowns during initial load.

**Utilities (12):** Log viewer depends on other scripts having created log entries, so it loads last.

### Concurrency Safeguards

All scripts in this repository implement these patterns to prevent conflicts:

- **Idempotency guards**: Check if already initialized before running setup
- **Namespace isolation**: No global variable pollution (except framework scripts)
- **API patch detection**: Scripts that patch native APIs check if already patched
- **Event listener deduplication**: Shared UI discovery uses once-only registration
- **Graceful degradation**: Scripts work independently if dependencies are missing

### Known Conflicts

⚠️ **Critical**: If you enable both `pageunlock.user.js` and `adinteract.user.js`, ensure `pageunlock.user.js` has a higher priority (loads first). Both scripts can patch `addEventListener` in aggressive mode, and the first patch wins.

⚠️ **Note**: Scripts with `@run-at document-start` have access to the page before the DOM exists. They use mutation observers or wait for DOM ready before manipulating elements.

### Verifying Load Order in Tampermonkey

1. Open Tampermonkey dashboard
2. Drag scripts in the list to reorder them
3. Scripts at the top load first
4. Verify by checking console timestamps when DEBUG is enabled

### XBrowser Load Order

XBrowser loads scripts in the order they appear in the script manager list. To reorder:
1. Open XBrowser script manager
2. Long-press a script and drag to reorder
3. Or reinstall scripts in the desired order

## API and Compatibility

- **XBrowser**: All scripts target maximum compatibility with the built-in Android script manager, using features in [API-doc.md](./API-doc.md).
- **Tampermonkey**: Full API, but minor differences possible.
- **Others**: Not guaranteed, but usually work.

If you find a site where a script doesn’t function, or you spot API/compat issues, please [open an issue](https://github.com/cbkii/userscripts/issues).

---

## Contributing

- All contributions must adhere to [AGENTS.md](./AGENTS.md) and consult [API-doc.md](./API-doc.md).
- Scripts **must be Android-first** (XBrowser as baseline).
- Code style: modern JS, strict metadata, English-only comments and UI.
- See PR/commit rules in [AGENTS.md](./AGENTS.md).

---

*Browse, install, and adjust to suit your Android experience!*  
