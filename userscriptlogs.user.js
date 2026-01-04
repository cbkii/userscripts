// ==UserScript==
// @name         Userscript Log Viewer
// @namespace    https://github.com/cbkii/userscripts
// @version      2026.01.03.0121
// @description  View and clear stored userscript logs from a simple on-page dialog.
// @author       cbkii
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkYxNDkzIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGxpbmUgeDE9IjgiIHkxPSI2IiB4Mj0iMjEiIHkyPSI2Ii8+PGxpbmUgeDE9IjgiIHkxPSIxMiIgeDI9IjIxIiB5Mj0iMTIiLz48bGluZSB4MT0iOCIgeTE9IjE4IiB4Mj0iMjEiIHkyPSIxOCIvPjxsaW5lIHgxPSIzIiB5MT0iNiIgeDI9IjMuMDEiIHkyPSI2Ii8+PGxpbmUgeDE9IjMiIHkxPSIxMiIgeDI9IjMuMDEiIHkyPSIxMiIvPjxsaW5lIHgxPSIzIiB5MT0iMTgiIHgyPSIzLjAxIiB5Mj0iMTgiLz48L3N2Zz4=
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
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

/*
  LOAD PRIORITY: 12 (Utilities - Load Last)
  Reads logs created by other scripts, so should load after all other scripts.
  
  Feature summary:
  - Shows stored userscript logs inside the shared userscript modal on demand.
  - Clears all stored userscript logs with one menu action.

  How it works:
  - Reads GM storage keys prefixed with "userscript.logs.".
  - Renders a simple panel with the latest stored entries.

  Configuration:
  - Logs update only on refresh; reopen the dialog after reloading the page.
*/

(() => {
  'use strict';

  //////////////////////////////////////////////////////////////
  // CONSTANTS & CONFIGURATION
  //////////////////////////////////////////////////////////////

  const DEBUG = false;
  const LOG_PREFIX = '[logview]';
  const LOG_PREFIX_KEY = 'userscript.logs.';
  const LOG_STORAGE_KEY = 'userscript.logs.logview';
  const LOG_MAX_ENTRIES = 200;
  const SCRIPT_ID = 'userscriptlogs';
  const SCRIPT_TITLE = 'Log Viewer';
  const ENABLE_KEY = `${SCRIPT_ID}.enabled`;
  const ALWAYS_RUN_KEY = `${SCRIPT_ID}.alwaysRun`;
  const UI_IDS = {
    body: 'userscript-logs-body',
  };
  const FALLBACK_OVERLAY_ID = 'userscript-logs-overlay';

  //////////////////////////////////////////////////////////////
  // UTILITIES & HELPERS
  //////////////////////////////////////////////////////////////

  const gmStore = {
    async get(key, fallback) {
      try { return await GM_getValue(key, fallback); } catch (_) { return fallback; }
    },
    async set(key, value) {
      try { await GM_setValue(key, value); } catch (_) {}
    }
  };
  // Robust shared UI detection across sandbox boundaries
  // Try to use helper from userscriptui.user.js if available, otherwise use fallback
  let sharedUi = null;
  let sharedUiReady = false;
  let registrationAttempted = false;

  // Check if userscriptui.user.js provides the helper (reduces code duplication)
  const factory = (typeof window !== 'undefined' && window.__userscriptSharedUi) || 
                   (typeof unsafeWindow !== 'undefined' && unsafeWindow.__userscriptSharedUi);
  
  if (factory && typeof factory.createDiscoveryHelper === 'function') {
    // Use the helper from userscriptui.user.js
    const helper = factory.createDiscoveryHelper({
      scriptId: SCRIPT_ID,
      scriptTitle: SCRIPT_TITLE,
      gmStore: gmStore,
      onReady: (ui, tryRegister) => {
        sharedUi = ui;
        sharedUiReady = true;
        if (typeof state !== 'undefined' && typeof renderPanel === 'function' && typeof setEnabled === 'function') {
          tryRegister(renderPanel, (next) => setEnabled(next), state.enabled);
        }
      }
    });
    sharedUi = helper.sharedUi;
    sharedUiReady = helper.isReady;
  } else {
    // Fallback: inline discovery logic (for backward compatibility)
    const initSharedUi = (providedFactory) => {
      // Priority 1: Use factory provided in event detail
      let factory = providedFactory;
      
      // Priority 2: Check window (sandboxed context)
      if (!factory && typeof window !== 'undefined' && window.__userscriptSharedUi) {
        factory = window.__userscriptSharedUi;
      }
      
      // Priority 3: Check unsafeWindow (page context)
      if (!factory && typeof unsafeWindow !== 'undefined' && unsafeWindow.__userscriptSharedUi) {
        factory = unsafeWindow.__userscriptSharedUi;
      }
      
      if (factory && typeof factory.getInstance === 'function') {
        sharedUi = factory.getInstance({
          get: (key, fallback) => gmStore.get(key, fallback),
          set: (key, value) => gmStore.set(key, value)
        });
        sharedUiReady = true;
        return true;
      }
      return false;
    };

    const tryRegisterScript = () => {
      if (sharedUi && typeof state !== 'undefined' && 
          typeof renderPanel === 'function' && typeof setEnabled === 'function') {
        if (!registrationAttempted) {
          registrationAttempted = true;
          sharedUi.registerScript({
            id: SCRIPT_ID,
            title: SCRIPT_TITLE,
            enabled: state.enabled,
            render: renderPanel,
            onToggle: (next) => setEnabled(next)
          });
          // Clean up resources after successful registration
          clearPollTimeout();
          removeEventListener();
        }
      }
    };

    // Try immediate detection (for scripts that load after userscriptui.user.js)
    if (initSharedUi()) {
      tryRegisterScript();
    }

    let eventListenerRef = null;
    const removeEventListener = () => {
      if (eventListenerRef) {
        document.removeEventListener('userscriptSharedUiReady', eventListenerRef);
        eventListenerRef = null;
      }
    };

    // Listen for shared UI ready event - REMOVED { once: true } to handle multiple events
    // and race conditions with load order
    eventListenerRef = (event) => {
      // Try to get factory from event detail first
      const providedFactory = event?.detail?.sharedUi;
      
      if (!sharedUiReady) {
        initSharedUi(providedFactory);
      }
      
      // Always try registration when event fires (idempotent)
      tryRegisterScript();
    };
    document.addEventListener('userscriptSharedUiReady', eventListenerRef);
    
    // Polling fallback for race conditions where event already fired
    // or userscriptui.user.js loads after this script
    let pollAttempts = 0;
    const maxPollAttempts = 20; // Poll for up to 2 seconds
    const pollInterval = 100;
    let pollTimeoutId = null;

    const clearPollTimeout = () => {
      if (pollTimeoutId !== null) {
        clearTimeout(pollTimeoutId);
        pollTimeoutId = null;
      }
    };

    const pollForSharedUi = () => {
      if (sharedUiReady || pollAttempts >= maxPollAttempts) {
        clearPollTimeout();
        removeEventListener(); // Clean up event listener on timeout
        return;
      }
      pollAttempts++;
      if (initSharedUi()) {
        tryRegisterScript();
      } else {
        pollTimeoutId = setTimeout(pollForSharedUi, pollInterval);
      }
    };
    pollTimeoutId = setTimeout(pollForSharedUi, pollInterval);
  }
  const state = {
    enabled: true,
    started: false,
    alwaysRun: false,
    menuIds: []
  };
  const hasUnregister = typeof GM_unregisterMenuCommand === 'function';

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
    const writeEntry = async (level, message, meta) => {
      try {
        const existing = await Promise.resolve(GM_getValue(storageKey, []));
        const list = Array.isArray(existing) ? existing : [];
        list.push({ ts: new Date().toISOString(), level, message, meta });
        if (list.length > maxEntries) {
          list.splice(0, list.length - maxEntries);
        }
        await Promise.resolve(GM_setValue(storageKey, list));
      } catch (_) {}
    };
    const log = (level, message, meta) => {
      if (level === 'debug' && !debugEnabled) return;
      const msg = typeof message === 'string' ? scrubString(message) : 'event';
      const data = typeof message === 'string' ? meta : message;
      const sanitized = data === undefined ? undefined : scrubValue(data);
      writeEntry(level, msg, sanitized).catch(() => {});
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

  //////////////////////////////////////////////////////////////
  // CORE LOGIC - LOG MANAGEMENT
  //////////////////////////////////////////////////////////////

  async function getLogKeys() {
    try {
      const keys = await Promise.resolve(GM_listValues());
      if (!Array.isArray(keys)) return [];
      return keys.filter((key) => typeof key === 'string' && key.startsWith(LOG_PREFIX_KEY));
    } catch (_) {
      return [];
    }
  }

  async function loadLogs() {
    const keys = await getLogKeys();
    const entries = [];
    for (const key of keys) {
      const script = key.slice(LOG_PREFIX_KEY.length) || 'unknown';
      let list = [];
      try {
        list = await Promise.resolve(GM_getValue(key, []));
      } catch (_) {
        list = [];
      }
      if (!Array.isArray(list)) continue;
      list.forEach((entry) => {
        if (!entry || typeof entry !== 'object') return;
        const hasMeta = Object.prototype.hasOwnProperty.call(entry, 'meta');
        entries.push({
          script,
          ts: entry.ts || '',
          level: entry.level || 'info',
          message: entry.message || '',
          meta: hasMeta ? entry.meta : undefined,
        });
      });
    }
    entries.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    return entries;
  }

  function formatLogs(entries) {
    if (!entries.length) {
      return 'No stored userscript logs found.';
    }
    return entries.map((entry) => {
      const meta =
        entry.meta === undefined || entry.meta === null
          ? ''
          : (() => {
            try {
              return ` ${typeof entry.meta === 'string' ? entry.meta : JSON.stringify(entry.meta)}`;
            } catch (_) {
              return ` ${String(entry.meta)}`;
            }
          })();
      return `[${entry.ts}] [${entry.level}] [${entry.script}] ${entry.message}${meta}`;
    }).join('\n');
  }

  //////////////////////////////////////////////////////////////
  // UI COMPONENTS
  //////////////////////////////////////////////////////////////

  function ensureStyles() {
    if (document.getElementById('userscript-logs-style')) return;
    const css = `
      .userscript-logs-panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
        color: #e2e8f0;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .userscript-logs-panel h2 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
      }
      #${UI_IDS.body} {
        background: #020617;
        border: 1px solid #1e293b;
        border-radius: 8px;
        padding: 12px;
        overflow: auto;
        white-space: pre-wrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 12px;
        user-select: text;
        -webkit-user-select: text;
        -moz-user-select: text;
        -ms-user-select: text;
      }
      .userscript-logs-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        flex-wrap: wrap;
      }
      .userscript-logs-actions button {
        appearance: none;
        border: 1px solid #ff70c6;
        background: linear-gradient(145deg,#0f0f17,#151528);
        color: #f8fafc;
        padding: 7px 12px;
        border-radius: 8px;
        font-size: 12.5px;
        font-weight: 700;
        letter-spacing: 0.01em;
        cursor: pointer;
        box-shadow: 0 10px 20px rgba(0,0,0,0.45);
      }
      .userscript-logs-actions button:hover {
        background: linear-gradient(145deg,#11111c,#191933);
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

  async function clearLogs() {
    const keys = await getLogKeys();
    for (const key of keys) {
      try {
        await Promise.resolve(GM_deleteValue(key));
      } catch (_) {}
    }
  }

  const renderPanel = () => {
    ensureStyles();
    const wrapper = document.createElement('div');
    wrapper.className = 'userscript-logs-panel';

    const title = document.createElement('h2');
    title.textContent = 'Userscript Logs (refresh page to update)';
    wrapper.appendChild(title);

    const body = document.createElement('div');
    body.id = UI_IDS.body;
    body.textContent = 'Loading logs...';
    wrapper.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'userscript-logs-actions';

    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh';
    refreshBtn.addEventListener('click', async () => {
      const entries = await loadLogs();
      body.textContent = formatLogs(entries);
    });

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 Copy Logs';
    copyBtn.addEventListener('click', async () => {
      try {
        const logText = body.textContent;
        if (typeof GM_setClipboard === 'function') {
          GM_setClipboard(logText, { type: 'text', mimetype: 'text/plain' });
        } else {
          // Fallback
          const textarea = document.createElement('textarea');
          textarea.value = logText;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          textarea.remove();
        }
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => { copyBtn.textContent = originalText; }, 2000);
        log('info', 'Logs copied to clipboard');
      } catch (err) {
        log('error', 'Failed to copy logs', err);
        copyBtn.textContent = '✗ Failed';
        setTimeout(() => { copyBtn.textContent = '📋 Copy Logs'; }, 2000);
      }
    });

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear Logs';
    clearBtn.addEventListener('click', async () => {
      await clearLogs();
      body.textContent = 'Logs cleared. Refresh the page to view new logs.';
    });

    actions.appendChild(refreshBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(clearBtn);
    wrapper.appendChild(actions);

    loadLogs().then((entries) => {
      body.textContent = formatLogs(entries);
    }).catch((err) => {
      log('error', 'failed to load logs', err);
      body.textContent = 'Failed to load stored logs. Please try again.';
    });

    return wrapper;
  };

  const removeFallback = () => {
    const overlay = document.getElementById(FALLBACK_OVERLAY_ID);
    if (overlay && overlay.parentNode) {
      try { overlay.parentNode.removeChild(overlay); } catch (_) {}
    }
  };

  const renderFallbackModal = async () => {
    ensureStyles();
    removeFallback();
    const overlay = document.createElement('div');
    overlay.id = FALLBACK_OVERLAY_ID;
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: radial-gradient(circle at 20% 20%, rgba(255,105,180,0.08), transparent 36%), rgba(0, 0, 0, 0.6);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    `;
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      width: min(780px, 94vw);
      max-height: 88vh;
      background: linear-gradient(165deg, #0d0d13, #151528);
      color: #f8fafc;
      border-radius: 14px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      border: 1px solid #ff70c6;
    `;
    const title = document.createElement('h2');
    title.textContent = 'Userscript Logs (refresh page to update)';
    title.style.margin = '0';
    dialog.appendChild(title);

    const body = document.createElement('div');
    body.id = UI_IDS.body;
    body.style.cssText = `
      flex: 1;
      background: #020617;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 12px;
      overflow: auto;
      white-space: pre-wrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      user-select: text;
      -webkit-user-select: text;
      -moz-user-select: text;
      -ms-user-select: text;
    `;
    body.textContent = 'Loading logs...';
    dialog.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'userscript-logs-actions';
    actions.style.marginTop = '4px';

    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh';
    refreshBtn.addEventListener('click', async () => {
      const entries = await loadLogs();
      body.textContent = formatLogs(entries);
    });

    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋 Copy Logs';
    copyBtn.addEventListener('click', async () => {
      try {
        const logText = body.textContent;
        if (typeof GM_setClipboard === 'function') {
          GM_setClipboard(logText, { type: 'text', mimetype: 'text/plain' });
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = logText;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          textarea.remove();
        }
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => { copyBtn.textContent = originalText; }, 2000);
      } catch (err) {
        log('error', 'Failed to copy logs', err);
        copyBtn.textContent = '✗ Failed';
        setTimeout(() => { copyBtn.textContent = '📋 Copy Logs'; }, 2000);
      }
    });

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear Logs';
    clearBtn.addEventListener('click', async () => {
      await clearLogs();
      body.textContent = 'Logs cleared. Refresh the page to view new logs.';
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', removeFallback);

    actions.appendChild(refreshBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(clearBtn);
    actions.appendChild(closeBtn);
    dialog.appendChild(actions);

    overlay.appendChild(dialog);
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) removeFallback();
    });
    document.addEventListener('keydown', function escHandler(ev) {
      if (ev.key === 'Escape') {
        removeFallback();
        document.removeEventListener('keydown', escHandler);
      }
    });

    try {
      const entries = await loadLogs();
      body.textContent = formatLogs(entries);
    } catch (err) {
      log('error', 'failed to load logs', err);
      body.textContent = 'Failed to load stored logs. Please try again.';
    }

    document.body.appendChild(overlay);
  };

  const teardown = () => {
    state.started = false;
    removeFallback();
  };

  //////////////////////////////////////////////////////////////
  // STATE MANAGEMENT
  //////////////////////////////////////////////////////////////

  const start = async () => {
    if (state.started) return;
    state.started = true;
    log('debug', 'log viewer ready');
  };

  const setEnabled = async (value) => {
    state.enabled = value;
    await gmStore.set(ENABLE_KEY, state.enabled);
    if (sharedUi) {
      sharedUi.setScriptEnabled(SCRIPT_ID, state.enabled);
    }
    if (!state.enabled) {
      teardown();
    } else {
      await start();
    }
    registerMenu();
  };

  const registerMenu = () => {
    if (typeof GM_registerMenuCommand !== 'function') return;
    if (hasUnregister && state.menuIds.length) {
      state.menuIds.forEach((id) => {
        try { GM_unregisterMenuCommand(id); } catch (_) {}
      });
      state.menuIds = [];
    }
    state.menuIds.push(GM_registerMenuCommand(
      `[Logs] ${state.enabled ? '✓' : '✗'} Enable`,
      async () => { await setEnabled(!state.enabled); }
    ));
    if (state.enabled) {
      state.menuIds.push(GM_registerMenuCommand('[Logs] 👁 Open log viewer', () => {
        if (sharedUi) {
          sharedUi.switchPanel(SCRIPT_ID);
          sharedUi.toggleModal();
        } else {
          renderFallbackModal();
        }
      }));
      state.menuIds.push(GM_registerMenuCommand('[Logs] 🗑 Clear stored logs', () => clearLogs()));
    }
  };

  //////////////////////////////////////////////////////////////
  // INITIALIZATION
  //////////////////////////////////////////////////////////////

  const init = async () => {
    state.enabled = await gmStore.get(ENABLE_KEY, true);
    state.alwaysRun = await gmStore.get(ALWAYS_RUN_KEY, false);
    
    if (sharedUi && !registrationAttempted) {
      registrationAttempted = true;
      sharedUi.registerScript({
        id: SCRIPT_ID,
        title: SCRIPT_TITLE,
        enabled: state.enabled,
        render: renderPanel,
        onToggle: (next) => setEnabled(next)
      });
    }
    
    registerMenu();
    
    // userscriptlogs is always on-demand (log viewer), no auto-work
    if (state.enabled) {
      await start();
    }
  };

  init().catch((err) => {
    log('error', 'fatal error', err);
  });
})();
