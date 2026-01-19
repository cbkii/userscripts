// ==UserScript==
// @name         Router Contrast Dark Mode
// @namespace    https://github.com/cbkii/userscripts
// @version      2026.01.19.0217
// @description  High-contrast dark mode for the VX230V router UI.
// @author       cbkii
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkYxNDkzIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTIxIDEyLjc5QTkgOSAwIDEgMSAxMS4yMSAzIDcgNyAwIDAgMCAyMSAxMi43OXoiLz48L3N2Zz4=
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
  LOAD PRIORITY: 8 (Content Enhancement)
  Site-specific dark mode that runs at document-end after DOM is available.
  
  Feature summary:
  - Applies a high-contrast dark theme to the router UI.
  - Keeps map icons readable and maintains dark background overrides.
  - Forces text selection to remain enabled for router values (ex: MAC addresses).

  How it works:
  - Injects CSS for dark styling and observes DOM changes to reapply styles.
  - Overrides user-select restrictions with CSS and DOM attribute resets.

  Configuration:
  - No user settings; edit the CSS in main() if needed.
  - Manual test (Android/XBrowser):
    1) Install and enable the script in XBrowser.
    2) Load http://192.168.1.1 and verify dark theme styling.
    3) Disable the script and confirm the UI returns to default styling.
*/

(function () {
  'use strict';

  //////////////////////////////////////////////////////////////
  // CONSTANTS & CONFIGURATION
  //////////////////////////////////////////////////////////////

  const DEBUG = false;
  const LOG_PREFIX = '[vxdark]';
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
  /**
   * Create a resource tracker for timers, observers, listeners, and DOM nodes.
   * @returns {object} Tracker helpers.
   */
  const createResourceTracker = () => {
    const tracker = {
      intervals: new Set(),
      timeouts: new Set(),
      observers: new Set(),
      listeners: [],
      nodes: new Set()
    };

    return {
      trackInterval(id) {
        if (id) tracker.intervals.add(id);
        return id;
      },
      trackTimeout(id) {
        if (id) tracker.timeouts.add(id);
        return id;
      },
      trackObserver(observer) {
        if (observer) tracker.observers.add(observer);
        return observer;
      },
      trackListener(target, type, handler, options) {
        if (!target || !type || !handler) return;
        target.addEventListener(type, handler, options);
        tracker.listeners.push({ target, type, handler, options });
      },
      trackNode(node) {
        if (node) tracker.nodes.add(node);
        return node;
      },
      cleanup() {
        tracker.intervals.forEach((id) => { try { clearInterval(id); } catch (_) {} });
        tracker.timeouts.forEach((id) => { try { clearTimeout(id); } catch (_) {} });
        tracker.observers.forEach((observer) => { try { observer.disconnect(); } catch (_) {} });
        tracker.listeners.forEach(({ target, type, handler, options }) => {
          try { target.removeEventListener(type, handler, options); } catch (_) {}
        });
        tracker.nodes.forEach((node) => { try { node.remove(); } catch (_) {} });
        tracker.intervals.clear();
        tracker.timeouts.clear();
        tracker.observers.clear();
        tracker.listeners.length = 0;
        tracker.nodes.clear();
      }
    };
  };

  const resources = createResourceTracker();
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeSetInterval = window.setInterval.bind(window);
  const setTimeout = (...args) => resources.trackTimeout(nativeSetTimeout(...args));
  const setInterval = (...args) => resources.trackInterval(nativeSetInterval(...args));
  const NativeMutationObserver = window.MutationObserver;
  const MutationObserver = function(callback) {
    const observer = new NativeMutationObserver(callback);
    resources.trackObserver(observer);
    return observer;
  };
  MutationObserver.prototype = NativeMutationObserver.prototype;
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
    resources.trackListener(document, 'userscriptSharedUiReady', eventListenerRef);
    
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
    menuIds: [],
    observers: [],
    styleNode: null,
    selectableStyleNode: null,
    selectableRestore: null,
    unloadHandler: null
  };
  const hasUnregister = typeof GM_unregisterMenuCommand === 'function';

  const createLogger = ({ prefix, debug }) => {
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
    const log = (level, message, meta) => {
      if ((level === 'debug' || level === 'info') && !debugEnabled) return;
      const msg = typeof message === 'string' ? scrubString(message) : 'event';
      const data = typeof message === 'string' ? meta : message;
      const sanitized = data === undefined ? undefined : scrubValue(data);
      const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
      const payload = sanitized === undefined ? [] : [sanitized];
      console[method](prefix, msg, ...payload);
    };
    log.setDebug = (value) => { debugEnabled = !!value; };
    return log;
  };

  const log = createLogger({
    prefix: LOG_PREFIX,
    debug: DEBUG
  });


  //////////////////////////////////////////////////////////////
  // CORE LOGIC - DARK MODE STYLING
  //////////////////////////////////////////////////////////////

  /**
   * Initialize state, UI registration, and apply theme.
   * @returns {Promise<void>}
   */
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

    const SELECTABLE_CSS = `
    * {
      -webkit-user-select: text !important;
      -moz-user-select: text !important;
      -ms-user-select: text !important;
      user-select: text !important;
    }

    td, th, span, input[type="text"], input[type="password"], input[type="search"],
    input[type="tel"], input[type="url"], input[type="email"], textarea, pre, code {
      -webkit-user-select: text !important;
      user-select: text !important;
    }
    `;

    const applySelectableStyles = () => {
      try {
        const node = GM_addStyle(SELECTABLE_CSS);
        if (node) state.selectableStyleNode = node;
      } catch (_) {
        const style = document.createElement('style');
        style.textContent = SELECTABLE_CSS;
        (document.head || document.documentElement).appendChild(style);
        state.selectableStyleNode = style;
      }
    };

    const removeSelectableStyles = () => {
      if (state.selectableStyleNode && state.selectableStyleNode.parentNode) {
        try { state.selectableStyleNode.parentNode.removeChild(state.selectableStyleNode); } catch (_) {}
      }
      state.selectableStyleNode = null;
    };

    const removeStyles = () => {
      if (state.styleNode && state.styleNode.parentNode) {
        try { state.styleNode.parentNode.removeChild(state.styleNode); } catch (_) {}
      }
      state.styleNode = null;
      removeSelectableStyles();
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

    const makeTextSelectable = () => {
      const NULL_MARKER = '__vxdark_null__';
      const TOUCH_ATTR = 'data-vxdark-selectable';
      const STORE_ATTR_USER = 'data-vxdark-prev-user-select';
      const STORE_ATTR_WEBKIT = 'data-vxdark-prev-webkit-user-select';
      const STORE_ATTR_MOZ = 'data-vxdark-prev-moz-user-select';
      const STORE_ATTR_MS = 'data-vxdark-prev-ms-user-select';
      const STORE_ATTR_ONSELECT = 'data-vxdark-prev-onselectstart';
      const STORE_ATTR_UNSELECT = 'data-vxdark-prev-unselectable';

      applySelectableStyles();

      const storeAttr = (el, attr, storeAttrName) => {
        if (el.hasAttribute(storeAttrName)) return;
        const value = el.getAttribute(attr);
        el.setAttribute(storeAttrName, value === null ? NULL_MARKER : value);
      };

      const storeStyle = (el, prop, storeAttrName) => {
        if (el.hasAttribute(storeAttrName)) return;
        const value = el.style.getPropertyValue(prop);
        el.setAttribute(storeAttrName, value ? value : NULL_MARKER);
      };

      const setSelectableStyle = (el, prop, storeAttrName) => {
        storeStyle(el, prop, storeAttrName);
        el.style.setProperty(prop, 'text', 'important');
      };

      const forceSelectable = (el) => {
        if (!el || el.nodeType !== 1) return;
        let touched = false;

        if (el.hasAttribute('onselectstart')) {
          storeAttr(el, 'onselectstart', STORE_ATTR_ONSELECT);
          el.removeAttribute('onselectstart');
          touched = true;
        }

        if (el.hasAttribute('unselectable')) {
          storeAttr(el, 'unselectable', STORE_ATTR_UNSELECT);
          el.removeAttribute('unselectable');
          touched = true;
        }

        const style = el.style;
        if (style) {
          if (style.getPropertyValue('user-select') === 'none') {
            setSelectableStyle(el, 'user-select', STORE_ATTR_USER);
            touched = true;
          }
          if (style.getPropertyValue('-webkit-user-select') === 'none') {
            setSelectableStyle(el, '-webkit-user-select', STORE_ATTR_WEBKIT);
            touched = true;
          }
          if (style.getPropertyValue('-moz-user-select') === 'none') {
            setSelectableStyle(el, '-moz-user-select', STORE_ATTR_MOZ);
            touched = true;
          }
          if (style.getPropertyValue('-ms-user-select') === 'none') {
            setSelectableStyle(el, '-ms-user-select', STORE_ATTR_MS);
            touched = true;
          }
        }

        if (touched) {
          el.setAttribute(TOUCH_ATTR, '1');
        }
      };

      const restoreSelectable = () => {
        const touchedNodes = document.querySelectorAll(`[${TOUCH_ATTR}]`);
        touchedNodes.forEach((el) => {
          const restoreStyle = (prop, storeAttrName) => {
            if (!el.hasAttribute(storeAttrName)) return;
            const value = el.getAttribute(storeAttrName);
            if (value === NULL_MARKER) {
              el.style.removeProperty(prop);
            } else {
              el.style.setProperty(prop, value);
            }
            el.removeAttribute(storeAttrName);
          };

          restoreStyle('user-select', STORE_ATTR_USER);
          restoreStyle('-webkit-user-select', STORE_ATTR_WEBKIT);
          restoreStyle('-moz-user-select', STORE_ATTR_MOZ);
          restoreStyle('-ms-user-select', STORE_ATTR_MS);

          if (el.hasAttribute(STORE_ATTR_ONSELECT)) {
            const value = el.getAttribute(STORE_ATTR_ONSELECT);
            if (value === NULL_MARKER) {
              el.removeAttribute('onselectstart');
            } else {
              el.setAttribute('onselectstart', value);
            }
            el.removeAttribute(STORE_ATTR_ONSELECT);
          }

          if (el.hasAttribute(STORE_ATTR_UNSELECT)) {
            const value = el.getAttribute(STORE_ATTR_UNSELECT);
            if (value === NULL_MARKER) {
              el.removeAttribute('unselectable');
            } else {
              el.setAttribute('unselectable', value);
            }
            el.removeAttribute(STORE_ATTR_UNSELECT);
          }

          el.removeAttribute(TOUCH_ATTR);
        });
      };

      state.selectableRestore = restoreSelectable;

      const root = document.body || document.documentElement;
      if (!root) return;
      forceSelectable(root);
      root.querySelectorAll('*').forEach(forceSelectable);

      const mo = new MutationObserver((mutations) => {
        if (!state.enabled) return;
        mutations.forEach((mutation) => {
          if (mutation.type === 'childList') {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === 1) {
                forceSelectable(node);
                node.querySelectorAll?.('*').forEach(forceSelectable);
              }
            });
          } else if (mutation.type === 'attributes') {
            forceSelectable(mutation.target);
          }
        });
      });

      mo.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'onselectstart', 'unselectable']
      });

      state.observers.push(mo);
      log('info', 'Text selection overrides applied');
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
      resources.trackListener(window, 'beforeunload', state.unloadHandler);
    };

    //////////////////////////////////////////////////////////////
    // STATE MANAGEMENT
    //////////////////////////////////////////////////////////////

    /**
     * Stop script activity and cleanup.
     * @returns {Promise<void>}
     */
    const stop = async () => {
      if (!state.started) return;
      state.started = false;
      disconnectObservers();
      detachUnload();
      removeStyles();
      if (state.selectableRestore) {
        try { state.selectableRestore(); } catch (_) {}
        state.selectableRestore = null;
      }
      resources.cleanup();
    };

    /**
     * Start script activity if not already started.
     * @returns {Promise<void>}
     */
    const start = async () => {
      if (state.started) return;
      state.started = true;
      applyStyles();
      startObservers();
      makeTextSelectable();
      attachUnload();
      log('info', 'Dark mode applied');
    };

    /**
     * Register Tampermonkey menu commands.
     */
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
        `[Dark Theme] ${state.enabled ? '✓' : '✗'} Enable`,
        async () => { await setEnabled(!state.enabled); }
      ));
    };

    /**
     * Enable or disable the script.
     * @param {boolean} value Desired enabled state.
     * @returns {Promise<void>}
     */
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

    /**
     * Render the shared UI panel for this script.
     * @returns {HTMLDivElement} Panel root element.
     */
    const renderPanel = () => {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';
      wrapper.style.gap = '10px';

      const status = document.createElement('div');
      status.textContent = state.enabled ? 'Dark mode is active.' : 'Dark mode is disabled.';
      status.style.fontSize = '13px';
      status.style.color = '#cbd5e1';
      wrapper.appendChild(status);

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.textContent = state.enabled ? 'Disable' : 'Enable';
      toggleBtn.style.padding = '8px 12px';
      toggleBtn.style.borderRadius = '6px';
      toggleBtn.style.border = '1px solid rgba(255,255,255,0.18)';
      toggleBtn.style.background = '#1f2937';
      toggleBtn.style.color = '#f8fafc';
      toggleBtn.style.cursor = 'pointer';
      toggleBtn.style.fontSize = '13px';
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
