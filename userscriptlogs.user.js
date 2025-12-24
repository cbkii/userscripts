// ==UserScript==
// @name         Userscript Log Viewer
// @namespace    https://github.com/cbkii/userscripts
// @version      2025.12.24.0014
// @description  View and clear stored userscript logs from a simple on-page dialog.
// @author       cbkii
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/userscriptlogs.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/userscriptlogs.user.js
// @homepageURL  https://github.com/cbkii/userscripts
// @supportURL   https://github.com/cbkii/userscripts/issues
// @run-at       document-idle
// @noframes
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

/*
  Feature summary:
  - Shows a modal with stored userscript logs on demand.
  - Clears all stored userscript logs with one menu action.

  How it works:
  - Reads GM storage keys prefixed with "userscript.logs.".
  - Renders a simple dialog with the latest stored entries.

  Configuration:
  - Logs update only on refresh; reopen the dialog after reloading the page.
*/

(() => {
  'use strict';

  const DEBUG = false;
  const LOG_PREFIX = '[logview]';
  const LOG_PREFIX_KEY = 'userscript.logs.';
  const LOG_STORAGE_KEY = 'userscript.logs.logview';
  const LOG_MAX_ENTRIES = 200;
  const UI_IDS = {
    overlay: 'userscript-logs-overlay',
    dialog: 'userscript-logs-dialog',
    body: 'userscript-logs-body',
  };
  let escapeHandler = null;

  const createLogger = ({ prefix, storageKey, maxEntries, debug }) => {
    let debugEnabled = !!debug;
    const SENSITIVE_KEY_RE = /pass(word)?|token|secret|auth|session|cookie|key/i;
    const scrubString = (value) => {
      if (typeof value !== 'string') return '';
      let text = value.replace(
        /([?&])(token|auth|key|session|password|passwd|secret)=([^&]+)/ig,
        '$1$2=[redacted]'
      );
      if (/^https?:\/\//i.test(text)) {
        try {
          const url = new URL(text);
          text = `${url.origin}${url.pathname}`;
        } catch (_) {}
      }
      return text.length > 200 ? `${text.slice(0, 200)}…` : text;
    };
    const scrubValue = (value, depth = 0) => {
      if (value == null) return value;
      if (typeof value === 'string') return scrubString(value);
      if (value instanceof Error) {
        return { name: value.name, message: scrubString(value.message) };
      }
      if (typeof value === 'object') {
        if (depth >= 1) return '[truncated]';
        if (Array.isArray(value)) {
          return value.slice(0, 4).map((item) => scrubValue(item, depth + 1));
        }
        const out = {};
        Object.keys(value).slice(0, 4).forEach((key) => {
          out[key] = SENSITIVE_KEY_RE.test(key)
            ? '[redacted]'
            : scrubValue(value[key], depth + 1);
        });
        return out;
      }
      return value;
    };
    const writeEntry = (level, message, meta) => {
      try {
        const existing = GM_getValue(storageKey, []);
        const list = Array.isArray(existing) ? existing : [];
        list.push({ ts: new Date().toISOString(), level, message, meta });
        if (list.length > maxEntries) {
          list.splice(0, list.length - maxEntries);
        }
        GM_setValue(storageKey, list);
      } catch (_) {}
    };
    const log = (level, message, meta) => {
      if (level === 'debug' && !debugEnabled) return;
      const msg = typeof message === 'string' ? scrubString(message) : 'event';
      const data = typeof message === 'string' ? meta : message;
      const sanitized = data === undefined ? undefined : scrubValue(data);
      writeEntry(level, msg, sanitized);
      if (debugEnabled || level === 'warn' || level === 'error') {
        const method = level === 'debug' ? 'log' : level;
        const payload = sanitized === undefined ? [] : [sanitized];
        console[method](prefix, msg, ...payload);
      }
    };
    log.setDebug = (value) => { debugEnabled = !!value; };
    return log;
  };

  const log = createLogger({
    prefix: LOG_PREFIX,
    storageKey: LOG_STORAGE_KEY,
    maxEntries: LOG_MAX_ENTRIES,
    debug: DEBUG
  });

  function main() {
    GM_registerMenuCommand('View userscript logs', renderDialog);
    GM_registerMenuCommand('Clear userscript logs', () => {
      clearLogs();
      removeDialog();
      log('debug', 'Logs cleared');
    });
  }

  function getLogKeys() {
    try {
      return GM_listValues().filter((key) => key.startsWith(LOG_PREFIX_KEY));
    } catch (_) {
      return [];
    }
  }

  function loadLogs() {
    const keys = getLogKeys();
    const entries = [];
    keys.forEach((key) => {
      const script = key.slice(LOG_PREFIX_KEY.length) || 'unknown';
      let list = [];
      try {
        list = GM_getValue(key, []);
      } catch (_) {
        list = [];
      }
      if (!Array.isArray(list)) return;
      list.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const meta = Array.isArray(entry.meta) ? entry.meta : [];
        entries.push({
          script,
          ts: entry.ts || '',
          level: entry.level || 'info',
          message: entry.message || '',
          meta,
        });
      });
    });
    entries.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    return entries;
  }

  function formatLogs(entries) {
    if (!entries.length) {
      return 'No stored userscript logs found.';
    }
    return entries.map((entry) => {
      const meta = Array.isArray(entry.meta) && entry.meta.length
        ? ` ${JSON.stringify(entry.meta)}`
        : '';
      return `[${entry.ts}] [${entry.level}] [${entry.script}] ${entry.message}${meta}`;
    }).join('\n');
  }

  function ensureStyles() {
    if (document.getElementById('userscript-logs-style')) return;
    const css = `
      #${UI_IDS.overlay} {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      #${UI_IDS.dialog} {
        width: min(780px, 94vw);
        max-height: 88vh;
        background: #0f172a;
        color: #e2e8f0;
        border-radius: 12px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
      }
      #${UI_IDS.dialog} h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
      }
      #${UI_IDS.body} {
        flex: 1;
        background: #020617;
        border: 1px solid #1e293b;
        border-radius: 8px;
        padding: 12px;
        overflow: auto;
        white-space: pre-wrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 12px;
      }
      .userscript-logs-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .userscript-logs-actions button {
        appearance: none;
        border: 1px solid #334155;
        background: #1e293b;
        color: #e2e8f0;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        cursor: pointer;
      }
      .userscript-logs-actions button:hover {
        background: #334155;
      }
    `;
    if (typeof GM_addStyle === 'function') {
      try {
        const styleNode = GM_addStyle(css);
        if (styleNode && styleNode.setAttribute) {
          styleNode.setAttribute('id', 'userscript-logs-style');
          return;
        }
      } catch (_) {}
    }
    const style = document.createElement('style');
    style.id = 'userscript-logs-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function removeDialog() {
    const overlay = document.getElementById(UI_IDS.overlay);
    if (overlay) overlay.remove();
    if (escapeHandler) {
      document.removeEventListener('keydown', escapeHandler);
      escapeHandler = null;
    }
  }

  function clearLogs() {
    getLogKeys().forEach((key) => {
      try {
        GM_deleteValue(key);
      } catch (_) {}
    });
  }

  function renderDialog() {
    removeDialog();
    ensureStyles();

    const overlay = document.createElement('div');
    overlay.id = UI_IDS.overlay;

    const dialog = document.createElement('div');
    dialog.id = UI_IDS.dialog;

    const title = document.createElement('h2');
    title.textContent = 'Userscript Logs (refresh page to update)';

    const body = document.createElement('div');
    body.id = UI_IDS.body;
    const entries = loadLogs();
    body.textContent = formatLogs(entries);

    const actions = document.createElement('div');
    actions.className = 'userscript-logs-actions';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', removeDialog);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear Logs';
    clearBtn.addEventListener('click', () => {
      clearLogs();
      body.textContent = 'Logs cleared. Refresh the page to view new logs.';
    });

    actions.appendChild(clearBtn);
    actions.appendChild(closeBtn);

    dialog.appendChild(title);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) removeDialog();
    });
    escapeHandler = (event) => {
      if (event.key === 'Escape') removeDialog();
    };
    document.addEventListener('keydown', escapeHandler);

    document.body.appendChild(overlay);
  }

  try {
    main();
  } catch (err) {
    log('error', 'fatal error', err);
  }
})();
