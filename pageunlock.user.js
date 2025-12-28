// ==UserScript==
// @name         Page Unlocker
// @namespace    https://github.com/cbkii/userscripts
// @version      2025.12.28.1234
// @description  Unlock text selection, copy/paste, and context menu on restrictive sites. Optional overlay buster + aggressive mode. Lightweight + SPA-friendly.
// @author       cbkii
// @license      MIT
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @run-at       document-start
// @noframes
// ==/UserScript==

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


  function normaliseCfg(input) {
    const cfg = Object.assign({}, DEFAULT_CFG, (input && typeof input === 'object') ? input : {});
    if (!Array.isArray(cfg.disabledHosts)) cfg.disabledHosts = [];
    if (!cfg.hotkey || typeof cfg.hotkey !== 'object') cfg.hotkey = DEFAULT_CFG.hotkey;
    return cfg;
  }

  let cfg = normaliseCfg(gmGet(STORAGE_KEY, DEFAULT_CFG));
  const host = location.hostname || '';
  let isHostDisabled = cfg.disabledHosts.includes(host);
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

  // Try immediate detection (likely fails at document-start)
  if (typeof document !== 'undefined' && document.readyState !== 'loading') {
    initSharedUi();
  }

  // Listen for shared UI ready event with proper detail consumption
  if (typeof document !== 'undefined') {
    document.addEventListener('userscriptSharedUiReady', (event) => {
      setTimeout(() => {
        const providedFactory = event?.detail?.sharedUi;
        if (!sharedUiReady) {
          initSharedUi(providedFactory);
        }
        if (sharedUi && !registrationAttempted && typeof renderPanel === 'function') {
          registrationAttempted = true;
          sharedUi.registerScript({
            id: SCRIPT_ID,
            title: SCRIPT_TITLE,
            enabled: cfg.enabled,
            render: renderPanel,
            onToggle: (next) => toggleEnabled(next)
          });
        }
      }, 0);
    });

    // Also try after DOMContentLoaded
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        if (!sharedUiReady) {
          initSharedUi();
          if (sharedUi && !registrationAttempted && typeof renderPanel === 'function') {
            registrationAttempted = true;
            sharedUi.registerScript({
              id: SCRIPT_ID,
              title: SCRIPT_TITLE,
              enabled: cfg.enabled,
              render: renderPanel,
              onToggle: (next) => toggleEnabled(next)
            });
          }
        }
      }, 100);
    }, { once: true });
  }


  // --- Menu (always available, even when disabled) ---
  gmMenu(`Page Unlock Pro: ${cfg.enabled ? 'Enabled' : 'Disabled'} (toggle)`, () => {
    cfg.enabled = !cfg.enabled;
    gmSet(STORAGE_KEY, cfg);
    location.reload();
  });

  gmMenu(`This site: ${isHostDisabled ? 'Disabled' : 'Enabled'} (toggle)`, () => {
    const set = new Set(cfg.disabledHosts);
    if (set.has(host)) set.delete(host);
    else set.add(host);
    cfg.disabledHosts = [...set].sort();
    gmSet(STORAGE_KEY, cfg);
    location.reload();
  });

  gmMenu(`Mode: ${cfg.aggressive ? 'Aggressive' : 'Normal'} (toggle)`, () => {
    cfg.aggressive = !cfg.aggressive;
    gmSet(STORAGE_KEY, cfg);
    location.reload();
  });

  gmMenu(`Overlay buster: ${cfg.overlayBuster ? 'On' : 'Off'} (toggle)`, () => {
    cfg.overlayBuster = !cfg.overlayBuster;
    gmSet(STORAGE_KEY, cfg);
    location.reload();
  });

  gmMenu(`Copy tail cleaner: ${cfg.cleanCopyTail ? 'On' : 'Off'} (toggle)`, () => {
    cfg.cleanCopyTail = !cfg.cleanCopyTail;
    gmSet(STORAGE_KEY, cfg);
    location.reload();
  });

  gmMenu(`Key event stopper: ${cfg.interceptKeys ? 'On' : 'Off'} (toggle)`, () => {
    cfg.interceptKeys = !cfg.interceptKeys;
    gmSet(STORAGE_KEY, cfg);
    location.reload();
  });

  gmMenu('Run: Force unlock now (remove overlays, restore scroll)', () => {
    try { forceUnlockNow(); gmNotify('Page Unlock Pro: forced unlock run'); } catch (_) {}
  });

  gmMenu('Reset settings', () => {
    gmDel(STORAGE_KEY);
    location.reload();
  });

  // Always return early if globally/site disabled, but keep menu available.
  if (!cfg.enabled || isHostDisabled) return;

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

  function ensureStyleLast() {
    try {
      if (!styleEl) styleEl = document.getElementById(STYLE_ID);
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        styleEl.type = 'text/css';
        styleEl.textContent = UNLOCK_CSS;
      }
      const parent = document.head || document.documentElement;
      if (parent) parent.appendChild(styleEl); // appendChild moves existing node to the end
    } catch (_) {}
  }

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

  function stopPropagationEarly(e) {
    // Don’t call preventDefault here; we want native behaviour.
    e.stopImmediatePropagation();
  }

  function installEventStoppers(types) {
    for (const type of types) {
      document.addEventListener(type, stopPropagationEarly, true);
      window.addEventListener(type, stopPropagationEarly, true);
    }
  }

  // Optional copy-tail cleaner.
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

  function installCopyCleaner() {
    if (!cfg.cleanCopyTail) return;
    document.addEventListener('copy', onCopyCapture, true);
  }

  // --- Aggressive mode: patch page context to ignore event hooks for our blocked event types ---
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
  function hookHistory() {
    try {
      const wrap = (fnName) => {
        const orig = history[fnName];
        if (typeof orig !== 'function') return;
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
      window.addEventListener('popstate', () => {
        ensureStyleLast();
        clearTopLevelDom0Handlers();
      }, true);
    } catch (_) {}
  }

  // --- Observers ---
  function installObservers() {
    // 1) Keep our style last if the site injects later CSS.
    const headWatcher = new MutationObserver(() => ensureStyleLast());

    const attachHeadWatcher = () => {
      const head = document.head;
      if (head) {
        headWatcher.observe(head, { childList: true });
        ensureStyleLast();
        return true;
      }
      return false;
    };

    if (!attachHeadWatcher()) {
      // Wait for <head>.
      const wait = new MutationObserver(() => {
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

    const attrWatcher = new MutationObserver((muts) => {
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

    // 3) Overlay buster for new nodes (cheap incremental scan).
    if (cfg.overlayBuster) {
      const overlayWatcher = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of m.addedNodes || []) {
            scanNodeForOverlays(n);
          }
        }
      });

      // Attach when body exists.
      const attachBody = () => {
        if (document.body) {
          overlayWatcher.observe(document.body, { childList: true, subtree: true });
          return true;
        }
        return false;
      };

      if (!attachBody()) {
        const waitBody = new MutationObserver(() => {
          if (attachBody()) waitBody.disconnect();
        });
        waitBody.observe(document.documentElement, { childList: true, subtree: true });
      }
    }
  }

  // --- Hotkey ---
  function installHotkey() {
    const hk = cfg.hotkey || DEFAULT_CFG.hotkey;
    document.addEventListener('keydown', (e) => {
      if (!!hk.alt !== e.altKey) return;
      if (!!hk.shift !== e.shiftKey) return;
      if (hk.ctrl && !e.ctrlKey) return;
      if (hk.meta && !e.metaKey) return;
      if (hk.code && e.code !== hk.code) return;

      e.stopImmediatePropagation();
      forceUnlockNow();
    }, true);
  }

  //////////////////////////////////////////////////////////////
  // INITIALIZATION 
  //////////////////////////////////////////////////////////////

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
})();
