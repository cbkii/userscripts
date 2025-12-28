// ==UserScript==
// @name         Router Contrast Dark Mode
// @namespace    https://github.com/cbkii/userscripts
// @version      2025.12.28.1213
// @description  High-contrast dark mode for the VX230V router UI.
// @match        http://192.168.1.1/*
// @match        https://192.168.1.1/*
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/vxdark.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/vxdark.user.js
// @homepageURL  https://github.com/cbkii/userscripts
// @supportURL   https://github.com/cbkii/userscripts/issues
// @run-at       document-end
// @noframes
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

/*
  Feature summary:
  - Applies a high-contrast dark theme to the router UI.
  - Keeps map icons readable and maintains dark background overrides.

  How it works:
  - Injects CSS for dark styling and observes DOM changes to reapply styles.

  Configuration:
  - No user settings; edit the CSS in main() if needed.
*/

(function () {
  'use strict';

  //////////////////////////////////////////////////////////////
  // CONSTANTS & CONFIGURATION
  //////////////////////////////////////////////////////////////

  const DEBUG = false;
  const LOG_PREFIX = '[vxdark]';
  const LOG_STORAGE_KEY = 'userscript.logs.vxdark';
  const LOG_MAX_ENTRIES = 200;
  const SCRIPT_ID = 'vxdark';
  const SCRIPT_TITLE = 'VX Router Dark Mode';
  const ENABLE_KEY = `${SCRIPT_ID}.enabled`;

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
  let sharedUi = null;
  let sharedUiReady = false;
  let registrationAttempted = false;

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

  // Try immediate detection
  initSharedUi();

  // Listen for shared UI ready event with proper detail consumption
  document.addEventListener('userscriptSharedUiReady', (event) => {
    setTimeout(() => {
      // Try to get factory from event detail first
      const providedFactory = event?.detail?.sharedUi;
      
      if (!sharedUiReady) {
        initSharedUi(providedFactory);
      }
      
      // Register/re-register if ready and not already done
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
        }
      }
    }, 0);
  });
  const state = {
    enabled: true,
    started: false,
    menuIds: [],
    observers: [],
    styleNode: null,
    unloadHandler: null
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
      if (/^https?:\\/\\//i.test(text)) {
        try {
          const url = new URL(text);
          text = `${url.origin}${url.pathname}`;
        } catch (_) {}
      }
      return text.length > 200 ? `${text.slice(0, 200)}…` : text;
    };
    const describeElement = (value) => {
      if (!value || !value.tagName) return 'element';
      const id = value.id ? `#${value.id}` : '';
      const classes = value.classList && value.classList.length
        ? `.${Array.from(value.classList).slice(0, 2).join('.')}`
        : '';
      return `${value.tagName.toLowerCase()}${id}${classes}`;
    };
    const scrubValue = (value, depth = 0) => {
      if (value == null) return value;
      if (typeof value === 'string') return scrubString(value);
      if (value instanceof Error) {
        return { name: value.name, message: scrubString(value.message) };
      }
      if (typeof Element !== 'undefined' && value instanceof Element) {
        return describeElement(value);
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
  // CORE LOGIC - DARK MODE STYLING
  //////////////////////////////////////////////////////////////

  async function main() {
    state.enabled = await gmStore.get(ENABLE_KEY, true);

    const DARK_CSS = `
    html, body, top {
      background-color: #121212 !important;
      color: #ffffff !important;
      text-shadow: none !important;
    }

    input, select, textarea, button {
      background-color: #2c2c2c !important;
      color: #ffffff !important;
      border: 1px solid #333 !important;
    }

    div.active, div.clicked, div.sel, div.selected,
    span.active, span.clicked, span.sel, span.selected,
    a.active, a.clicked, a.sel, a.selected,
    button.active, button.clicked, button.sel, button.selected,
    input.active, input.clicked, input.sel, input.selected,
    select.active, select.clicked, select.sel, select.selected,
    textarea.active, textarea.clicked, textarea.sel, textarea.selected,
    div:active, span:active, a:active, button:active,
    input:active, select:active, textarea:active,
    div:focus, span:focus, a:focus, button:focus,
    input:focus, select:focus, textarea:focus {
      color: #4acbd6 !important;
    }

    input[readonly], input[disabled], select[disabled] {
      color: #e8e8e8 !important;
      padding-left: 8px !important;
      border-style: dashed !important;
    }

    .gbar-parent { background-color: #333 !important; }
    .gbar-perf, .gbar { background-color: #4acbd6 !important; }

    .T_basic, .T_adv {
      background-color: #121212 !important;
      color: #ffffff !important;
      transition: all 0.2s ease;
      border-bottom: 2px solid transparent !important;
    }

    .T_basic:hover, .T_adv:hover {
      background-color: #333 !important;
      color: #ffffff !important;
    }

    .clicked, .click.sel.clicked, .sel.clicked,
    .T_basic.clicked, .T_adv.clicked,
    .T_basic.sel, .T_adv.sel,
    .T_basic.selected, .T_adv.selected,
    .T_basic.active, .T_adv.active {
      background-color: #2b2b2b !important;
      color: #4acbd6 !important;
      font-weight: bold !important;
      border-bottom: 2px solid #48c7a5 !important;
    }

    hr, .line, .separator {
      border-color: #666 !important;
      background-color: #666 !important;
    }

    a { color: #4acbd6 !important; }
    a:hover, .hover, li:hover, button:hover {
      background-color: #333 !important;
      color: #48c7a5 !important;
    }

    .map-icon, .map-icon-num, span.map-icon-num, .icon {
        color: #000000 !important;
    }

    ::-webkit-scrollbar { width: 12px; }
    ::-webkit-scrollbar-track { background: #1e1e1e; }
    ::-webkit-scrollbar-thumb { background: #555; }
    ::-webkit-scrollbar-thumb:hover { background: #777; }
    `;

    const applyStyles = () => {
      try {
        const node = GM_addStyle(DARK_CSS);
        if (node) state.styleNode = node;
      } catch (_) {
        const style = document.createElement('style');
        style.textContent = DARK_CSS;
        (document.head || document.documentElement).appendChild(style);
        state.styleNode = style;
      }
    };

    const removeStyles = () => {
      if (state.styleNode && state.styleNode.parentNode) {
        try { state.styleNode.parentNode.removeChild(state.styleNode); } catch (_) {}
      }
      state.styleNode = null;
    };

    const disconnectObservers = () => {
      state.observers.forEach((observer) => {
        try { observer.disconnect(); } catch (_) {}
      });
      state.observers.length = 0;
    };

    const startObservers = () => {
      const forceMapIconColor = (node) => {
        if (!node || node.nodeType !== 1) return;
        if (node.matches && node.matches('.map-icon, .map-icon-num')) {
          node.style.setProperty('color', '#000000', 'important');
        }
      };

      document.querySelectorAll('.map-icon, .map-icon-num').forEach(forceMapIconColor);

      const mo = new MutationObserver((mutations) => {
        if (!state.enabled) return;
        for (const m of mutations) {
          if (m.type === 'childList') {
            m.addedNodes.forEach((n) => {
              if (n.nodeType === 1) {
                if (n.matches?.('.map-icon, span.map-icon-num, .map-icon-num')) forceMapIconColor(n);
                n.querySelectorAll?.('.map-icon, .map-icon-num').forEach(forceMapIconColor);
              }
            });
          } else if (m.type === 'attributes') {
            if (m.target.matches?.('.map-icon, span.map-icon-num, .map-icon-num')) forceMapIconColor(m.target);
          }
        }
      });

      mo.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style']
      });
      state.observers.push(mo);

      const main = document.getElementById('main');
      if (main) {
        const applyMainStyle = () => {
          main.style.backgroundColor = '#1a1a1a';
          main.style.backgroundImage = 'none';
        };
        applyMainStyle();
        const mainObserver = new MutationObserver(applyMainStyle);
        mainObserver.observe(main, { attributes: true, childList: true, subtree: false });
        state.observers.push(mainObserver);
      }
    };

    const detachUnload = () => {
      if (state.unloadHandler) {
        window.removeEventListener('beforeunload', state.unloadHandler);
        state.unloadHandler = null;
      }
    };

    const attachUnload = () => {
      if (state.unloadHandler) return;
      state.unloadHandler = () => disconnectObservers();
      window.addEventListener('beforeunload', state.unloadHandler);
    };

    //////////////////////////////////////////////////////////////
    // STATE MANAGEMENT
    //////////////////////////////////////////////////////////////

    const stop = async () => {
      if (!state.started) return;
      state.started = false;
      disconnectObservers();
      detachUnload();
      removeStyles();
    };

    const start = async () => {
      if (state.started) return;
      state.started = true;
      applyStyles();
      startObservers();
      attachUnload();
      log('info', 'Dark mode applied');
    };

    const registerMenu = () => {
      if (typeof GM_registerMenuCommand !== 'function') return;
      if (hasUnregister && state.menuIds.length) {
        state.menuIds.forEach((id) => {
          try { GM_unregisterMenuCommand(id); } catch (_) {}
        });
        state.menuIds = [];
      }
      if (!hasUnregister && state.menuIds.length) return;
      state.menuIds.push(GM_registerMenuCommand(
        `Toggle ${SCRIPT_TITLE} (${state.enabled ? 'ON' : 'OFF'})`,
        async () => { await setEnabled(!state.enabled); }
      ));
    };

    const setEnabled = async (value) => {
      state.enabled = !!value;
      await gmStore.set(ENABLE_KEY, state.enabled);
      if (sharedUi) {
        sharedUi.setScriptEnabled(SCRIPT_ID, state.enabled);
      }
      if (!state.enabled) {
        await stop();
      } else {
        await start();
      }
      registerMenu();
    };

    //////////////////////////////////////////////////////////////
    // UI COMPONENTS
    //////////////////////////////////////////////////////////////

    const renderPanel = () => {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';
      wrapper.style.gap = '8px';

      const status = document.createElement('div');
      status.textContent = state.enabled ? 'Dark mode is active.' : 'Dark mode is disabled.';
      status.style.fontSize = '13px';
      wrapper.appendChild(status);

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.textContent = state.enabled ? 'Disable' : 'Enable';
      toggleBtn.style.padding = '8px 10px';
      toggleBtn.style.borderRadius = '8px';
      toggleBtn.style.border = '1px solid rgba(255,255,255,0.18)';
      toggleBtn.style.background = '#1f2937';
      toggleBtn.style.color = '#f8fafc';
      toggleBtn.addEventListener('click', () => setEnabled(!state.enabled));
      wrapper.appendChild(toggleBtn);

      return wrapper;
    };

    //////////////////////////////////////////////////////////////
    // INITIALIZATION
    //////////////////////////////////////////////////////////////

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

    await setEnabled(state.enabled);
  }

  main().catch((err) => {
    log('error', 'fatal error', err);
  });
})();
