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
