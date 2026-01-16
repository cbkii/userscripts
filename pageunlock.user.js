// ==UserScript==
// @name         Page Unlocker
// @namespace    https://github.com/cbkii/userscripts
// @version      2026.01.16.1631
// @description  Unlock text selection, copy/paste, and context menu on restrictive sites. Optional overlay buster + aggressive mode. Lightweight + SPA-friendly.
// @author       cbkii
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkYxNDkzIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMTEiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxMSIgcng9IjIiIHJ5PSIyIi8+PHBhdGggZD0iTTcgMTFWN2E1IDUgMCAwIDEgOS45LTEiLz48L3N2Zz4=
// @license      MIT
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/pageunlock.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/pageunlock.user.js
// @homepageURL  https://github.com/cbkii/userscripts
// @supportURL   https://github.com/cbkii/userscripts/issues
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_notification
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
  LOAD PRIORITY: 2 (Early - Native API Patches)
  Must load before scripts that patch addEventListener to avoid conflicts.
  
  Feature summary:
  - Unlocks text selection, copy/paste, and right-click context menu on restrictive sites.
  - Removes annoying full-screen overlays that block content access.
  - Provides aggressive mode for page-context event patching on stubborn sites.

  How it works:
  - Injects CSS to enable text selection and removes event handlers that block user interactions.
  - Optionally patches addEventListener at document-start to prevent restrictive event handlers.
  - Detects and removes full-screen overlays that gate content behind paywalls or ads.

  Configuration:
  - Toggle aggressive mode, overlay buster, and other options via menu commands.
  - Per-host disable list to exclude sites where unlocking causes issues.
  - Keyboard shortcut (Alt+Shift+U by default) to quickly toggle the unlocker.
  - Manual test (Android/XBrowser):
    1) Enable Page Unlocker and Always Run in shared UI.
    2) Load a restrictive page and verify selection + copy works.
    3) Disable the script and confirm no further changes occur after reload.
*/

(function () {
  'use strict';

  //////////////////////////////////////////////////////////////
  // CONSTANTS & CONFIGURATION
  //////////////////////////////////////////////////////////////

  const STORAGE_KEY = 'pageUnlock:cfg';
  const STYLE_ID = 'pageUnlock-style';
  const PATCH_FLAG = '__pageUnlockPatched__';
  const SCRIPT_ID = 'pageunlock';
  const SCRIPT_TITLE = 'Page Unlocker';
  const ENABLE_KEY = `${SCRIPT_ID}.enabled`;
  const ALWAYS_RUN_KEY = `${SCRIPT_ID}.alwaysRun`;

  const DEBUG = false;
  const LOG_PREFIX = '[pgunlock]';
  const log = (...args) => { if (DEBUG) console.log(LOG_PREFIX, ...args); };

  const DEFAULT_CFG = {
    enabled: true,
    aggressive: false,          // page-context patch: ignore addEventListener/preventDefault for blocked event types
    overlayBuster: true,        // remove obvious full-screen overlays + restore scrolling
    cleanCopyTail: false,       // attempt to strip “source/from/来源” tails when copying
    interceptKeys: false,       // only matters in non-aggressive mode; adds keydown/keyup stoppers
    disabledHosts: [],          // per-host disable list
    hotkey: { alt: true, shift: true, code: 'KeyU' }, // Alt+Shift+U
    alwaysRun: false,           // dormant by default: only run automatically when enabled
  };

  //////////////////////////////////////////////////////////////
  // UTILITIES & HELPERS
  //////////////////////////////////////////////////////////////

  // --- GM helpers (sync in XBrowser; sync in TM legacy API) ---
  function gmGet(key, def) {
    try { return GM_getValue(key, def); } catch (_) { return def; }
  }
  function gmSet(key, val) {
    try { GM_setValue(key, val); } catch (_) {}
  }
  function gmDel(key) {
    try { GM_deleteValue(key); } catch (_) {}
  }
  function gmMenu(title, fn) {
    try { GM_registerMenuCommand(title, fn); } catch (_) {}
  }
  function gmNotify(text) {
    try { GM_notification({ text }); } catch (_) {}
  }
  const gmStore = {
    get(key, fallback) { return gmGet(key, fallback); },
    set(key, value) { gmSet(key, value); }
  };


  /**
   * Normalize persisted configuration with defaults.
   * @param {object|null|undefined} input Raw config object.
   * @returns {object} Normalized config.
   */
  function normaliseCfg(input) {
    const cfg = Object.assign({}, DEFAULT_CFG, (input && typeof input === 'object') ? input : {});
    if (!Array.isArray(cfg.disabledHosts)) cfg.disabledHosts = [];
    if (!cfg.hotkey || typeof cfg.hotkey !== 'object') cfg.hotkey = DEFAULT_CFG.hotkey;
    return cfg;
  }

  let cfg = normaliseCfg(gmGet(STORAGE_KEY, DEFAULT_CFG));
  const host = location.hostname || '';
  let isHostDisabled = cfg.disabledHosts.includes(host);
  const state = {
    menuIds: [],
    observers: [], // Track MutationObservers for cleanup
    resources: null,
    historyPatched: false,
    originalPushState: null,
    originalReplaceState: null,
  };
  const hasUnregister = typeof GM_unregisterMenuCommand === 'function';
  const MENU_PREFIX = '[Unlock]';
  // Robust shared UI detection across sandbox boundaries
  // Try to use helper from userscriptui.user.js if available, otherwise use fallback
  let sharedUi = null;
  let sharedUiReady = false;
  let registrationAttempted = false;

  /**
   * Register with the shared UI if available.
   * @param {Function|undefined} tryRegister Shared UI helper callback.
   */
  function attemptSharedUiRegistration(tryRegister) {
    if (registrationAttempted) return;
    if (typeof tryRegister === 'function') {
      try {
        tryRegister(renderPanel, (next) => setEnabled(next), cfg.enabled);
        registrationAttempted = true;
      } catch (_) {
        registrationAttempted = false;
      }
      return;
    }
    if (sharedUi && typeof sharedUi.registerScript === 'function') {
      try {
        sharedUi.registerScript({
          id: SCRIPT_ID,
          title: SCRIPT_TITLE,
          enabled: cfg.enabled,
          render: renderPanel,
          onToggle: (next) => setEnabled(next)
        });
        registrationAttempted = true;
      } catch (_) {
        registrationAttempted = false;
      }
    }
  }

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
        attemptSharedUiRegistration(tryRegister);
      }
    });
    sharedUi = helper.sharedUi;
    sharedUiReady = helper.isReady;
    if (sharedUiReady) {
      attemptSharedUiRegistration();
    }
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
      if (sharedUiReady) {
        attemptSharedUiRegistration();
        // Clean up resources after successful registration
        clearPollTimeout();
        removeEventListener();
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


  //////////////////////////////////////////////////////////////
  // SHARED UI + MENU
  //////////////////////////////////////////////////////////////

  /**
   * Toggle script enabled state and reload.
   * @param {boolean} next Next enabled state.
   */
  function setEnabled(next) {
    cfg.enabled = !!next;
    gmSet(STORAGE_KEY, cfg);
    if (sharedUi) {
      sharedUi.setScriptEnabled(SCRIPT_ID, cfg.enabled);
    }
    registerMenu();
    cleanupResources();
    location.reload();
  }

  /**
   * Disconnect tracked MutationObservers.
   */
  function disconnectObservers() {
    // Disconnect all tracked MutationObservers
    if (state.observers && state.observers.length > 0) {
      state.observers.forEach(observer => {
        try {
          observer.disconnect();
        } catch (_) {}
      });
      state.observers = [];
    }
  }

  /**
   * Create a resource tracker for timers, observers, listeners, and DOM nodes.
   * @returns {object} Tracker with register/cleanup helpers.
   */
  function createResourceTracker() {
    const tracker = {
      intervals: new Set(),
      timeouts: new Set(),
      observers: new Set(),
      listeners: [],
      nodes: new Set(),
      styles: new Set(),
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
      trackStyle(node) {
        if (node) tracker.styles.add(node);
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
        tracker.styles.forEach((node) => { try { node.remove(); } catch (_) {} });
        tracker.intervals.clear();
        tracker.timeouts.clear();
        tracker.observers.clear();
        tracker.listeners.length = 0;
        tracker.nodes.clear();
        tracker.styles.clear();
      }
    };
  }

  /**
   * Clean up all tracked resources and observers.
   */
  function cleanupResources() {
    disconnectObservers();
    if (state.resources) {
      state.resources.cleanup();
      state.resources = null;
    }
    if (state.historyPatched) {
      try {
        if (state.originalPushState) history.pushState = state.originalPushState;
        if (state.originalReplaceState) history.replaceState = state.originalReplaceState;
      } catch (_) {}
      state.historyPatched = false;
    }
  }

  /**
   * Toggle Always Run and reload.
   * @param {boolean} next Next Always Run state.
   */
  function setAlwaysRun(next) {
    cfg.alwaysRun = !!next;
    gmSet(STORAGE_KEY, cfg);
    registerMenu();
    cleanupResources();
    location.reload();
  }


  /**
   * Enable or disable on current host and reload.
   * @param {boolean} enable Whether to enable on this host.
   */
  function toggleSite(enable) {
    const nextEnabled = typeof enable === 'boolean' ? enable : isHostDisabled;
    const set = new Set(cfg.disabledHosts);
    if (nextEnabled) {
      set.delete(host);
      isHostDisabled = false;
    } else {
      set.add(host);
      isHostDisabled = true;
    }
    cfg.disabledHosts = [...set].sort();
    gmSet(STORAGE_KEY, cfg);
    registerMenu();
    cleanupResources();
    location.reload();
  }

  /**
   * Toggle aggressive mode and reload.
   * @param {boolean} next Desired aggressive state.
   */
  function toggleAggressive(next) {
    cfg.aggressive = typeof next === 'boolean' ? next : !cfg.aggressive;
    gmSet(STORAGE_KEY, cfg);
    registerMenu();
    cleanupResources();
    location.reload();
  }

  /**
   * Toggle overlay buster and reload.
   * @param {boolean} next Desired overlay buster state.
   */
  function toggleOverlayBuster(next) {
    cfg.overlayBuster = typeof next === 'boolean' ? next : !cfg.overlayBuster;
    gmSet(STORAGE_KEY, cfg);
    registerMenu();
    cleanupResources();
    location.reload();
  }

  /**
   * Toggle copy tail cleaner and reload.
   * @param {boolean} next Desired copy tail cleaner state.
   */
  function toggleCopyTail(next) {
    cfg.cleanCopyTail = typeof next === 'boolean' ? next : !cfg.cleanCopyTail;
    gmSet(STORAGE_KEY, cfg);
    registerMenu();
    cleanupResources();
    location.reload();
  }

  /**
   * Toggle key event interception and reload.
   * @param {boolean} next Desired key interception state.
   */
  function toggleInterceptKeys(next) {
    cfg.interceptKeys = typeof next === 'boolean' ? next : !cfg.interceptKeys;
    gmSet(STORAGE_KEY, cfg);
    registerMenu();
    cleanupResources();
    location.reload();
  }

  /**
   * Execute a manual unlock and notify.
   */
  function runForceUnlock() {
    try {
      forceUnlockNow();
      gmNotify('Page Unlocker: forced unlock executed');
    } catch (err) {
      gmNotify('Page Unlocker: force unlock failed');
      if (DEBUG) console.error(LOG_PREFIX, 'force unlock failed', err);
    }
  }

  /**
   * Reset stored settings and reload.
   */
  function resetSettings() {
    gmDel(STORAGE_KEY);
    location.reload();
  }

  /**
   * Register Tampermonkey menu commands.
   */
  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    if (hasUnregister && state.menuIds.length) {
      state.menuIds.forEach((id) => {
        try { GM_unregisterMenuCommand(id); } catch (err) { if (DEBUG) console.warn(LOG_PREFIX, 'Failed to unregister menu', id, err); }
      });
      state.menuIds = [];
    }
    state.menuIds.push(GM_registerMenuCommand(
      `${MENU_PREFIX} 🔓 ${cfg.enabled ? '✓ Enabled' : '✗ Disabled'} (reload)`,
      () => setEnabled(!cfg.enabled)
    ));
    state.menuIds.push(GM_registerMenuCommand(
      `${MENU_PREFIX} ↻ Always Run (${cfg.alwaysRun ? 'ON' : 'OFF'})`,
      () => setAlwaysRun(!cfg.alwaysRun)
    ));
    state.menuIds.push(GM_registerMenuCommand(
      `${MENU_PREFIX} 🌐 This site (${isHostDisabled ? 'OFF' : 'ON'})`,
      () => toggleSite(!isHostDisabled)
    ));
    state.menuIds.push(GM_registerMenuCommand(
      `${MENU_PREFIX} 🛡 Mode: ${cfg.aggressive ? 'Aggressive' : 'Normal'} (reload)`,
      () => toggleAggressive(!cfg.aggressive)
    ));
    state.menuIds.push(GM_registerMenuCommand(
      `${MENU_PREFIX} 🧹 Overlay buster (${cfg.overlayBuster ? 'ON' : 'OFF'})`,
      () => toggleOverlayBuster(!cfg.overlayBuster)
    ));
    state.menuIds.push(GM_registerMenuCommand(
      `${MENU_PREFIX} ✂️ Copy tail cleaner (${cfg.cleanCopyTail ? 'ON' : 'OFF'})`,
      () => toggleCopyTail(!cfg.cleanCopyTail)
    ));
    state.menuIds.push(GM_registerMenuCommand(
      `${MENU_PREFIX} ⌨️ Key stopper (${cfg.interceptKeys ? 'ON' : 'OFF'})`,
      () => toggleInterceptKeys(!cfg.interceptKeys)
    ));
    state.menuIds.push(GM_registerMenuCommand(
      `${MENU_PREFIX} ⚡ Force unlock now`,
      () => runForceUnlock()
    ));
    state.menuIds.push(GM_registerMenuCommand(
      `${MENU_PREFIX} 🗑 Reset settings`,
      () => resetSettings()
    ));
  }

  /**
   * Render the shared UI panel for this script.
   * @returns {HTMLDivElement} Panel root element.
   */
  function renderPanel() {
    const panel = document.createElement('div');
    panel.style.cssText = 'padding: 12px; color: #e5e7eb; font-family: system-ui, sans-serif; font-size: 13px;';
    const title = document.createElement('h3');
    title.textContent = SCRIPT_TITLE;
    title.style.cssText = 'margin: 0 0 12px 0; font-size: 15px; font-weight: 700; color: #f8fafc;';
    panel.appendChild(title);
    const note = document.createElement('p');
    note.textContent = '⚠️ Most changes reload the page to take effect.';
    note.style.cssText = 'margin: 0 0 14px 0; padding: 8px; background: rgba(251,191,36,0.15); border-left: 3px solid #fbbf24; font-size: 12px; color: #fcd34d; border-radius: 4px;';
    panel.appendChild(note);
    const createToggle = (label, initialChecked, onChange) => {
      let current = !!initialChecked;
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; padding: 8px; background: rgba(255,255,255,0.03); border-radius: 6px;';
      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      labelEl.style.cssText = 'flex: 1; color: #cbd5e1;';
      const btn = document.createElement('button');
      const syncBtn = () => {
        btn.textContent = current ? 'ON' : 'OFF';
        btn.style.background = current ? '#10b981' : '#374151';
        btn.style.color = current ? '#111' : '#9ca3af';
      };
      btn.style.cssText = 'padding: 4px 12px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.2); cursor: pointer; font-size: 11px; font-weight: 700;';
      syncBtn();
      btn.addEventListener('click', () => {
        current = !current;
        onChange(current);
        syncBtn();
      });
      row.appendChild(labelEl);
      row.appendChild(btn);
      return row;
    };
    const createButton = (label, onClick, variant = 'primary') => {
      const btn = document.createElement('button');
      btn.textContent = label;
      const base = variant === 'danger' ? '#ef4444' : '#3b82f6';
      btn.style.cssText = `padding: 8px 14px; margin: 6px 0; background: ${base}; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; width: 100%;`;
      btn.addEventListener('click', onClick);
      btn.addEventListener('mouseenter', () => { btn.style.background = variant === 'danger' ? '#dc2626' : '#2563eb'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = base; });
      return btn;
    };
    panel.appendChild(createToggle('🔓 Enable Page Unlocker (reload)', cfg.enabled, (val) => setEnabled(val)));
    panel.appendChild(createToggle('↻ Always Run on all sites', cfg.alwaysRun, (val) => setAlwaysRun(val)));
    panel.appendChild(createToggle(`🌐 Enable on this site (${host || 'unknown'})`, !isHostDisabled, (val) => toggleSite(val)));
    panel.appendChild(createToggle('🛡 Aggressive mode (blocks more events)', cfg.aggressive, (val) => toggleAggressive(val)));
    panel.appendChild(createToggle('🧹 Overlay buster (remove blockers)', cfg.overlayBuster, (val) => toggleOverlayBuster(val)));
    panel.appendChild(createToggle('✂️ Copy tail cleaner (strip attribution)', cfg.cleanCopyTail, (val) => toggleCopyTail(val)));
    panel.appendChild(createToggle('⌨️ Key event stopper (intercepts keys)', cfg.interceptKeys, (val) => toggleInterceptKeys(val)));
    const sep = document.createElement('hr');
    sep.style.cssText = 'border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 14px 0;';
    panel.appendChild(sep);
    panel.appendChild(createButton('⚡ Force unlock now', () => runForceUnlock()));
    panel.appendChild(createButton('🗑 Reset all settings', () => {
      if (confirm('Reset all Page Unlocker settings to defaults?')) {
        resetSettings();
      }
    }, 'danger'));
    return panel;
  }

  // --- Core behaviour ---
  const EVENT_BASE = [
    'contextmenu',
    'selectstart',
    'dragstart',
    'copy',
    'cut',
    'paste',
    'beforecopy',
    'beforecut',
    'beforepaste',
  ];

  const EVENT_EXTRA_KEYS = ['keydown', 'keypress', 'keyup'];

  // Keep this intentionally smaller than “kill everything”, to avoid breaking sites.
  const stopEvents = cfg.interceptKeys ? EVENT_BASE.concat(EVENT_EXTRA_KEYS) : EVENT_BASE;

  // CSS is the cheapest, most compatible way to fix selection.
  const UNLOCK_CSS = `
    html, body {
      -webkit-text-size-adjust: 100% !important;
      -webkit-touch-callout: default !important;
    }
    * {
      -webkit-user-select: text !important;
      user-select: text !important;
      -webkit-user-drag: auto !important;
    }
    input, textarea, [contenteditable="true"] {
      -webkit-user-select: auto !important;
      user-select: auto !important;
    }
  `;

  let styleEl = null;
  let styleEnsureScheduled = false;

  /**
   * Ensure the unlock CSS is appended last in head.
   */
  function ensureStyleLast() {
    try {
      if (!styleEl) styleEl = document.getElementById(STYLE_ID);
      if (!styleEl) {
        styleEl = state.resources
          ? state.resources.trackStyle(document.createElement('style'))
          : document.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.type = 'text/css';
        styleEl.textContent = UNLOCK_CSS;
      }
      const parent = document.head || document.documentElement;
      if (!parent) return;
      if (styleEl.parentNode !== parent) {
        parent.appendChild(styleEl);
        return;
      }
      if (parent.lastElementChild !== styleEl) {
        parent.appendChild(styleEl);
      }
    } catch (_) {}
  }

  /**
   * Debounce style reinsertion using RAF/timeout.
   */
  function scheduleEnsureStyleLast() {
    if (styleEnsureScheduled) return;
    styleEnsureScheduled = true;
    const trigger = () => {
      styleEnsureScheduled = false;
      ensureStyleLast();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(trigger);
    } else if (state.resources) {
      state.resources.trackTimeout(setTimeout(trigger, 0));
    } else {
      setTimeout(trigger, 0);
    }
  }

  /**
   * Remove top-level DOM0 event handlers that block interactions.
   */
  function clearTopLevelDom0Handlers() {
    const targets = [document, document.documentElement, document.body].filter(Boolean);
    const props = [
      'oncontextmenu',
      'onselectstart',
      'ondragstart',
      'oncopy',
      'oncut',
      'onpaste',
    ];
    for (const t of targets) {
      for (const p of props) {
        try { t[p] = null; } catch (_) {}
      }
    }
  }

  /**
   * Stop event propagation for restrictive handlers.
   * @param {Event} e Event to stop.
   */
  function stopPropagationEarly(e) {
    // Don’t call preventDefault here; we want native behaviour.
    e.stopImmediatePropagation();
  }

  /**
   * Install capture-phase event stoppers.
   * @param {string[]} types Event types to intercept.
   */
  function installEventStoppers(types) {
    for (const type of types) {
      if (state.resources) {
        state.resources.trackListener(document, type, stopPropagationEarly, true);
        state.resources.trackListener(window, type, stopPropagationEarly, true);
      } else {
        document.addEventListener(type, stopPropagationEarly, true);
        window.addEventListener(type, stopPropagationEarly, true);
      }
    }
  }

  // Optional copy-tail cleaner.
  /**
   * Capture copy events and clean attribution tails.
   * @param {ClipboardEvent} e Copy event.
   */
  function onCopyCapture(e) {
    if (!cfg.cleanCopyTail) return;
    try {
      const sel = String(window.getSelection && window.getSelection());
      if (!sel) return;

      // Common “tail” patterns seen in CN/EN sites; conservative removal.
      const cleaned = sel
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\n?\s*(?:来源|出处|from|source)\b[\s\S]*$/i, '')
        .trim();

      if (e.clipboardData) {
        e.clipboardData.setData('text/plain', cleaned);
        e.preventDefault();
      }
    } catch (_) {}
  }

  /**
   * Install copy cleaner event listener when enabled.
   */
  function installCopyCleaner() {
    if (!cfg.cleanCopyTail) return;
    if (state.resources) {
      state.resources.trackListener(document, 'copy', onCopyCapture, true);
    } else {
      document.addEventListener('copy', onCopyCapture, true);
    }
  }

  // --- Aggressive mode: patch page context to ignore event hooks for our blocked event types ---
  /**
   * Inject page-context event patches for blocked event types.
   * @param {string[]} blockedTypes Event types to block.
   */
  function injectAggressivePatch(blockedTypes) {
    try {
      if (window[PATCH_FLAG]) return;
      window[PATCH_FLAG] = true;

      const payload = {
        flag: PATCH_FLAG,
        blocked: blockedTypes,
      };

      const s = document.createElement('script');
      s.textContent = `(() => {
        try {
          const P = ${JSON.stringify(payload)};
          if (window[P.flag]) return;
          window[P.flag] = true;

          const blocked = new Set(P.blocked);

          const origAdd = EventTarget.prototype.addEventListener;
          EventTarget.prototype.addEventListener = function(type, listener, options) {
            if (blocked.has(type)) return;
            return origAdd.call(this, type, listener, options);
          };

          const origPrevent = Event.prototype.preventDefault;
          Event.prototype.preventDefault = function() {
            if (blocked.has(this.type)) return;
            return origPrevent.apply(this, arguments);
          };

          // Some older code uses event.returnValue = false.
          try {
            const desc = Object.getOwnPropertyDescriptor(Event.prototype, 'returnValue');
            Object.defineProperty(Event.prototype, 'returnValue', {
              configurable: true,
              enumerable: desc ? desc.enumerable : true,
              get() { return desc && desc.get ? desc.get.call(this) : true; },
              set(v) {
                if (blocked.has(this.type)) {
                  if (desc && desc.set) desc.set.call(this, true);
                  return;
                }
                if (desc && desc.set) desc.set.call(this, v);
              }
            });
          } catch (_) {}
        } catch (_) {}
      })();`;

      (document.documentElement || document.head).appendChild(s);
      s.remove();
    } catch (_) {}
  }

  // --- Overlay buster ---
  const overlaySeen = new WeakSet();

  /**
   * Restore scrollability on root elements.
   */
  function restoreScroll() {
    const targets = [document.documentElement, document.body].filter(Boolean);
    for (const t of targets) {
      try {
        t.style.setProperty('overflow', 'auto', 'important');
        t.style.setProperty('overflow-x', 'auto', 'important');
        t.style.setProperty('overflow-y', 'auto', 'important');
        t.style.setProperty('position', 'static', 'important');
      } catch (_) {}
    }
  }

  /**
   * Determine if a node looks like a blocking overlay.
   * @param {Element} el Candidate element.
   * @returns {boolean} True when overlay heuristics match.
   */
  function isLikelyFullscreenOverlay(el) {
    try {
      if (!el || el.nodeType !== 1) return false;
      if (overlaySeen.has(el)) return false;

      const tag = el.tagName;
      if (!tag || tag === 'HTML' || tag === 'BODY' || tag === 'STYLE' || tag === 'SCRIPT' || tag === 'LINK') return false;

      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return false;

      const pos = cs.position;
      if (pos !== 'fixed' && pos !== 'sticky') return false;

      const z = Number.parseInt(cs.zIndex, 10);
      if (Number.isFinite(z) && z < 999) return false;

      const r = el.getBoundingClientRect();
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      const area = Math.max(0, r.width) * Math.max(0, r.height);
      const minArea = 0.85 * vw * vh;

      const covers = r.left <= 0 && r.top <= 0 && r.right >= vw - 1 && r.bottom >= vh - 1 && area >= minArea;
      if (!covers) return false;

      // If it looks like a legit fixed header/footer (small height), keep it.
      if (r.height < vh * 0.5) return false;

      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Remove or hide an overlay element.
   * @param {Element} el Overlay element.
   */
  function removeOverlay(el) {
    try {
      overlaySeen.add(el);
      // Prefer removing; fall back to hiding.
      if (el.parentNode) el.remove();
      else {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      }
    } catch (_) {}
  }

  /**
   * Scan a subtree for likely overlays and remove them.
   * @param {Element|Node} root Root node to scan.
   */
  function scanNodeForOverlays(root) {
    if (!cfg.overlayBuster) return;
    if (!root) return;

    // Cheap breadth-first scan with a hard cap.
    const q = [root];
    let checked = 0;
    const MAX = 200;
    while (q.length && checked < MAX) {
      const n = q.shift();
      checked++;
      if (!n || n.nodeType !== 1) continue;

      if (isLikelyFullscreenOverlay(n)) {
        removeOverlay(n);
        restoreScroll();
        continue;
      }

      // Shallow-ish traversal to keep overhead low.
      let c = n.firstElementChild;
      while (c && checked < MAX) {
        q.push(c);
        c = c.nextElementSibling;
      }
    }
  }

  /**
   * Run manual unlock operations immediately.
   */
  function forceUnlockNow() {
    ensureStyleLast();
    clearTopLevelDom0Handlers();
    restoreScroll();

    if (cfg.overlayBuster) {
      // Manual scan can be heavier – but only runs on demand.
      const nodes = document.body ? Array.from(document.body.querySelectorAll('*')) : [];
      for (const el of nodes) {
        if (isLikelyFullscreenOverlay(el)) removeOverlay(el);
      }
      restoreScroll();
    }
  }

  // --- SPA navigation: re-apply on history changes ---
  /**
   * Hook SPA navigation to re-apply unlock steps.
   */
  function hookHistory() {
    try {
      const wrap = (fnName) => {
        const orig = history[fnName];
        if (typeof orig !== 'function') return;
        if (fnName === 'pushState') state.originalPushState = orig;
        if (fnName === 'replaceState') state.originalReplaceState = orig;
        state.historyPatched = true;
        history[fnName] = function () {
          const r = orig.apply(this, arguments);
          queueMicrotask(() => {
            ensureStyleLast();
            clearTopLevelDom0Handlers();
          });
          return r;
        };
      };
      wrap('pushState');
      wrap('replaceState');
      const onPop = () => {
        ensureStyleLast();
        clearTopLevelDom0Handlers();
      };
      if (state.resources) {
        state.resources.trackListener(window, 'popstate', onPop, true);
      } else {
        window.addEventListener('popstate', onPop, true);
      }
    } catch (_) {}
  }

  // --- Observers ---
  /**
   * Install MutationObservers for style and overlay handling.
   */
  function installObservers() {
    // 1) Keep our style last if the site injects later CSS.
    const headWatcher = state.resources
      ? state.resources.trackObserver(new MutationObserver(() => scheduleEnsureStyleLast()))
      : new MutationObserver(() => scheduleEnsureStyleLast());

    const attachHeadWatcher = () => {
      const head = document.head;
      if (head) {
        headWatcher.observe(head, { childList: true });
        ensureStyleLast();
        // Track long-running observer for cleanup
        state.observers.push(headWatcher);
        return true;
      }
      return false;
    };

    if (!attachHeadWatcher()) {
      // Wait for <head>.
      const wait = state.resources
        ? state.resources.trackObserver(new MutationObserver(() => {
          if (attachHeadWatcher()) wait.disconnect();
        }))
        : new MutationObserver(() => {
          if (attachHeadWatcher()) wait.disconnect();
        });
      wait.observe(document.documentElement, { childList: true, subtree: true });
    }

    // 2) Remove newly-added inline handlers for the key events.
    const attrFilter = [
      'oncontextmenu',
      'onselectstart',
      'ondragstart',
      'oncopy',
      'oncut',
      'onpaste',
    ];

    const attrWatcher = state.resources
      ? state.resources.trackObserver(new MutationObserver((muts) => {
        for (const m of muts) {
          const el = m.target;
          if (!el || el.nodeType !== 1) continue;
          const a = m.attributeName;
          if (!a) continue;
          if (attrFilter.includes(a)) {
            try {
              el.removeAttribute(a);
              // Also clear property in case the browser reflected it.
              el[a] = null;
            } catch (_) {}
          }
        }
      }))
      : new MutationObserver((muts) => {
        for (const m of muts) {
          const el = m.target;
          if (!el || el.nodeType !== 1) continue;
          const a = m.attributeName;
          if (!a) continue;
          if (attrFilter.includes(a)) {
            try {
              el.removeAttribute(a);
              // Also clear property in case the browser reflected it.
              el[a] = null;
            } catch (_) {}
          }
        }
      });

    attrWatcher.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: attrFilter,
    });
    // Track long-running observer for cleanup
    state.observers.push(attrWatcher);

    // 3) Overlay buster for new nodes (cheap incremental scan).
    if (cfg.overlayBuster) {
      const overlayQueue = new Set();
      let overlayScanScheduled = false;
      const flushOverlayQueue = () => {
        overlayScanScheduled = false;
        if (!overlayQueue.size) return;
        const nodes = Array.from(overlayQueue);
        overlayQueue.clear();
        for (const node of nodes) {
          scanNodeForOverlays(node);
        }
      };
      const scheduleOverlayScan = () => {
        if (overlayScanScheduled) return;
        overlayScanScheduled = true;
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(flushOverlayQueue);
        } else {
          setTimeout(flushOverlayQueue, 16);
        }
      };
      const overlayWatcher = state.resources
        ? state.resources.trackObserver(new MutationObserver((muts) => {
          for (const m of muts) {
            for (const n of m.addedNodes || []) {
              overlayQueue.add(n);
            }
          }
          scheduleOverlayScan();
        }))
        : new MutationObserver((muts) => {
          for (const m of muts) {
            for (const n of m.addedNodes || []) {
              overlayQueue.add(n);
            }
          }
          scheduleOverlayScan();
        });

      // Attach when body exists.
      const attachBody = () => {
        if (document.body) {
          overlayWatcher.observe(document.body, { childList: true, subtree: true });
          // Track long-running observer for cleanup
          state.observers.push(overlayWatcher);
          return true;
        }
        return false;
      };

      if (!attachBody()) {
        const waitBody = state.resources
          ? state.resources.trackObserver(new MutationObserver(() => {
            if (attachBody()) waitBody.disconnect();
          }))
          : new MutationObserver(() => {
            if (attachBody()) waitBody.disconnect();
          });
        waitBody.observe(document.documentElement, { childList: true, subtree: true });
      }
    }
  }

  // --- Hotkey ---
  /**
   * Install the hotkey listener for manual unlock.
   */
  function installHotkey() {
    const hk = cfg.hotkey || DEFAULT_CFG.hotkey;
    const handler = (e) => {
      if (!!hk.alt !== e.altKey) return;
      if (!!hk.shift !== e.shiftKey) return;
      if (hk.ctrl && !e.ctrlKey) return;
      if (hk.meta && !e.metaKey) return;
      if (hk.code && e.code !== hk.code) return;

      e.stopImmediatePropagation();
      forceUnlockNow();
    };
    if (state.resources) {
      state.resources.trackListener(document, 'keydown', handler, true);
    } else {
      document.addEventListener('keydown', handler, true);
    }
  }

  //////////////////////////////////////////////////////////////
  // INITIALIZATION 
  //////////////////////////////////////////////////////////////

  /**
   * Main entrypoint for Page Unlocker.
   */
  function main() {
    registerMenu();

    // Always return early if globally/site disabled, but keep menu available.
    // Dormant by default: only run automatically if Always Run is enabled
    if (!cfg.enabled || isHostDisabled || !cfg.alwaysRun) return;

    state.resources = createResourceTracker();

    // --- Bootstrap ---
    ensureStyleLast();
    clearTopLevelDom0Handlers();

    if (cfg.aggressive) {
      // In aggressive mode we also block more event types (including mouse/key) at the page level.
      injectAggressivePatch(stopEvents.concat(['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown', 'keypress', 'keyup']));
    }

    installEventStoppers(stopEvents);
    installCopyCleaner();
    installObservers();
    hookHistory();
    installHotkey();
  }

  main();
})();
