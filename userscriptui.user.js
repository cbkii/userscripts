// ==UserScript==
// @name         Userscript Shared UI Manager
// @namespace    https://github.com/cbkii/userscripts
// @version      2025.12.29.2037
// @description  Provides a shared hotpink dock + dark modal with per-script tabs, toggles, and persistent layout for all userscripts.
// @author       cbkii
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkYxNDkzIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHJlY3QgeD0iMyIgeT0iMyIgd2lkdGg9IjciIGhlaWdodD0iNyIvPjxyZWN0IHg9IjE0IiB5PSIzIiB3aWR0aD0iNyIgaGVpZ2h0PSI3Ii8+PHJlY3QgeD0iMTQiIHk9IjE0IiB3aWR0aD0iNyIgaGVpZ2h0PSI3Ii8+PHJlY3QgeD0iMyIgeT0iMTQiIHdpZHRoPSI3IiBoZWlnaHQ9IjciLz48L3N2Zz4=
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/userscriptui.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/userscriptui.user.js
// @homepageURL  https://github.com/cbkii/userscripts
// @supportURL   https://github.com/cbkii/userscripts/issues
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// ==/UserScript==

/*
  Feature summary:
  - Shared hotpink dock button with a dark modal container and tabbed panels.
  - Persists dock position and active panel across sessions (GM + localStorage).
  - Lets scripts register panels with render callbacks and inline toggles.

  How it works:
  - Scripts call __userscriptSharedUi.getInstance() to register their panel and toggle handlers.
  - The manager renders a list of all registered scripts with inline toggles, and tabs for enabled ones.
  - GM-backed storage keeps position, active tab, and enabled states in sync with localStorage.

  Configuration:
  - Position can be flipped between bottom-right and bottom-left via the “Flip” button.
  - Scripts should pass onEnable/onDisable callbacks to manage teardown/startup.
*/

// Shared UI module for userscripts
// Provides a hotpink dock button, dark modal container, and tabbed panels
// for enabled scripts. The module stores UI position in both GM storage
// (per script) and localStorage for cross-script consistency.

(function (root) {
  'use strict';

  if (root.__userscriptSharedUi) {
    return;
  }

  //////////////////////////////////////////////////////////////
  // CONSTANTS & CONFIGURATION
  //////////////////////////////////////////////////////////////

  const SAFE_DOC = document;
  const STORAGE_KEY_POSITION = 'userscripts.sharedUi.position';
  const STORAGE_KEY_ACTIVE = 'userscripts.sharedUi.activePanel';
  const DEFAULT_POSITION = 'right';
  const UI_PREFIX = 'userscripts-ui';
  const MODAL_ID = `${UI_PREFIX}-modal`;
  const BUTTON_ID = `${UI_PREFIX}-button`;
  const TABLIST_ID = `${UI_PREFIX}-tabs`;
  const PANEL_ID = `${UI_PREFIX}-panel`;
  const STYLE_ID = `${UI_PREFIX}-style`;

  //////////////////////////////////////////////////////////////
  // UTILITIES & HELPERS
  //////////////////////////////////////////////////////////////

  const isTouch = () => 'ontouchstart' in SAFE_DOC.documentElement;
  const clickEvent = isTouch() ? 'touchstart' : 'click';

  const css = `
    #${BUTTON_ID} {
      position: fixed;
      bottom: 18px;
      right: 14px;
      width: 42px;
      height: 42px;
      border-radius: 50%;
      background: hotpink;
      color: #111;
      border: none;
      box-shadow: 0 8px 20px rgba(0,0,0,0.42);
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      cursor: pointer;
      padding: 3px;
      touch-action: manipulation;
      transition: transform 160ms ease, opacity 160ms ease, box-shadow 160ms ease;
    }
    #${BUTTON_ID}:active { transform: scale(0.94); }
    #${BUTTON_ID}:focus-visible {
      outline: 2px solid #ffd6f0;
      outline-offset: 2px;
    }
    #${MODAL_ID} {
      position: fixed;
      bottom: 64px;
      right: 10px;
      background: #101010;
      color: #f5f5f5;
      min-width: 260px;
      max-width: 420px;
      max-height: 72vh;
      border-radius: 14px;
      box-shadow: 0 16px 32px rgba(0,0,0,0.55);
      z-index: 2147483646;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.08);
      transform: translateY(8px);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: transform 160ms ease, opacity 160ms ease, visibility 0s linear 160ms;
    }
    #${MODAL_ID}.open {
      display: flex;
      transform: translateY(0);
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transition-delay: 0s;
    }
    #${MODAL_ID} header {
      padding: 10px 12px;
      background: #171717;
      font-weight: 700;
      letter-spacing: 0.02em;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    #${MODAL_ID} header button {
      background: none;
      border: none;
      color: #bbb;
      font-size: 16px;
      cursor: pointer;
      padding: 4px 8px;
    }
    #${TABLIST_ID} {
      display: flex;
      flex-direction: column;
      gap: 5px;
      padding: 8px 10px;
      overflow-y: auto;
      background: #121212;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      scrollbar-width: thin;
      max-height: 170px;
    }
    .userscripts-tab {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      background: #18181b;
      color: #f8fafc;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      padding: 6px 8px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
    }
    .userscripts-tab.active {
      border-color: #ff69b4;
      box-shadow: 0 0 0 1px #ff69b4, 0 0 0 3px rgba(255,105,180,0.15);
    }
    .userscripts-tab .title {
      flex: 1;
      text-align: left;
      font-size: 13px;
      font-weight: 600;
      color: #f8fafc;
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
    }
    .userscripts-tab .state {
      font-size: 10.5px;
      color: #cbd5e1;
      letter-spacing: 0.01em;
    }
    .userscripts-tab .toggle {
      background: #222;
      border: 1px solid rgba(255,255,255,0.18);
      color: #f8fafc;
      padding: 4px 8px;
      border-radius: 7px;
      cursor: pointer;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.01em;
    }
    #${PANEL_ID} {
      padding: 12px 14px;
      overflow-y: auto;
      max-height: 56vh;
      background: #0c0c0f;
    }
    #${PANEL_ID} .panel-empty {
      color: #ccc;
      font-size: 12.5px;
      text-align: center;
      padding: 18px 10px;
    }
    @media (max-width: 480px) {
      #${BUTTON_ID} { width: 38px; height: 38px; bottom: 14px; right: 12px; box-shadow: 0 10px 22px rgba(0,0,0,0.5); }
      #${MODAL_ID} { width: calc(100vw - 20px); right: 10px; bottom: 62px; max-height: 70vh; }
      #${TABLIST_ID} { max-height: 160px; }
    }
  `;

  //////////////////////////////////////////////////////////////
  // UI COMPONENTS
  //////////////////////////////////////////////////////////////

  let styleInjected = false;
  const injectStyle = () => {
    if (styleInjected || SAFE_DOC.getElementById(STYLE_ID)) {
      styleInjected = true;
      return;
    }
    const style = SAFE_DOC.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    (SAFE_DOC.head || SAFE_DOC.documentElement).appendChild(style);
    styleInjected = true;
  };

  const readLocal = (key, fallback) => {
    try {
      const val = root.localStorage.getItem(key);
      return val || fallback;
    } catch (_) {
      return fallback;
    }
  };

  const writeLocal = (key, value) => {
    try { root.localStorage.setItem(key, value); } catch (_) {}
  };

  const createStorage = (adapterRef) => ({
    async get(key, fallback) {
      const adapter = adapterRef.current;
      if (adapter && typeof adapter.get === 'function') {
        try { return await adapter.get(key, fallback); } catch (_) {}
      }
      return fallback;
    },
    async set(key, value) {
      const adapter = adapterRef.current;
      if (adapter && typeof adapter.set === 'function') {
        try { await adapter.set(key, value); } catch (_) {}
      }
    }
  });

  //////////////////////////////////////////////////////////////
  // STATE MANAGEMENT
  //////////////////////////////////////////////////////////////

  const createUi = (storageAdapterRef) => {
    injectStyle();

    const storage = createStorage(storageAdapterRef);
    const state = {
      button: null,
      modal: null,
      tabs: null,
      panel: null,
      position: DEFAULT_POSITION,
      activeId: null,
      scripts: new Map()
    };

    const ensureVisible = () => {
      if (state.button) {
        if (!SAFE_DOC.body.contains(state.button)) {
          SAFE_DOC.body.appendChild(state.button);
        }
        const btnStyle = root.getComputedStyle(state.button);
        if (btnStyle.display === 'none' || btnStyle.visibility === 'hidden') {
          state.button.style.setProperty('display', 'flex', 'important');
          state.button.style.setProperty('visibility', 'visible', 'important');
          state.button.style.setProperty('opacity', '1', 'important');
        }
      }
      if (state.modal) {
        if (!SAFE_DOC.body.contains(state.modal)) {
          SAFE_DOC.body.appendChild(state.modal);
        }
        const modalStyle = root.getComputedStyle(state.modal);
        if (modalStyle.display === 'none') {
          state.modal.style.setProperty('display', 'flex', 'important');
        }
      }
    };

    const setPosition = async (pos) => {
      state.position = pos === 'left' ? 'left' : 'right';
      const btn = state.button;
      const modal = state.modal;
      if (btn) {
        btn.style.right = state.position === 'right' ? '14px' : '';
        btn.style.left = state.position === 'left' ? '14px' : '';
      }
      if (modal) {
        modal.style.right = state.position === 'right' ? '10px' : '';
        modal.style.left = state.position === 'left' ? '10px' : '';
      }
      writeLocal(STORAGE_KEY_POSITION, state.position);
      await storage.set(STORAGE_KEY_POSITION, state.position);
    };

    const showPanelMessage = (text) => {
      if (!state.panel) return;
      state.panel.innerHTML = '';
      const empty = SAFE_DOC.createElement('div');
      empty.className = 'panel-empty';
      empty.textContent = text;
      state.panel.appendChild(empty);
    };

    const renderTabs = () => {
      if (!state.tabs) return;
      const entries = Array.from(state.scripts.values());
      if (!entries.length) {
        state.tabs.innerHTML = '';
        showPanelMessage('No scripts registered');
        return;
      }
      const fragment = SAFE_DOC.createDocumentFragment();
      entries.forEach((entry) => {
        if (!entry.row) {
          const row = SAFE_DOC.createElement('div');
          row.className = 'userscripts-tab';
          row.dataset.scriptId = entry.id;

          const titleBtn = SAFE_DOC.createElement('button');
          titleBtn.type = 'button';
          titleBtn.className = 'title';
          titleBtn.textContent = entry.title;

          const stateLabel = SAFE_DOC.createElement('span');
          stateLabel.className = 'state';

          const toggleBtn = SAFE_DOC.createElement('button');
          toggleBtn.type = 'button';
          toggleBtn.className = 'toggle';

          row.appendChild(titleBtn);
          row.appendChild(stateLabel);
          row.appendChild(toggleBtn);
          entry.row = { el: row, stateLabel, toggleBtn };
        }
        entry.row.el.classList.toggle('active', entry.id === state.activeId);
        entry.row.stateLabel.textContent = entry.enabled ? 'ON' : 'OFF';
        entry.row.toggleBtn.textContent = entry.enabled ? 'Disable' : 'Enable';
        fragment.appendChild(entry.row.el);
      });
      state.tabs.innerHTML = '';
      state.tabs.appendChild(fragment);
    };

    const switchPanel = async (id) => {
      state.activeId = id;
      writeLocal(STORAGE_KEY_ACTIVE, id);
      await storage.set(STORAGE_KEY_ACTIVE, id);
      renderTabs();
      const entry = state.scripts.get(id);
      if (!entry) return;
      state.panel.innerHTML = '';
      if (!entry.enabled) {
        showPanelMessage(`${entry.title} is disabled. Enable it to view controls.`);
        return;
      }
      const content = entry._cachedNode || entry.render();
      if (content && !entry._cachedNode) {
        entry._cachedNode = content;
      }
      if (content) {
        state.panel.appendChild(content);
      } else {
        showPanelMessage('No controls available');
      }
    };

    const toggleModal = () => {
      if (!state.modal) return;
      ensureVisible();
      const open = !state.modal.classList.contains('open');
      state.modal.classList.toggle('open', open);
      if (state.button) {
        state.button.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      state.modal.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (open && !state.activeId) {
        const first = Array.from(state.scripts.values()).find((s) => s.enabled);
        if (first) switchPanel(first.id);
        else showPanelMessage('Enable a script to view its controls.');
      } else if (open && state.activeId) {
        const active = state.scripts.get(state.activeId);
        if (!active || !active.enabled) {
          const next = Array.from(state.scripts.values()).find((s) => s.enabled);
          if (next) switchPanel(next.id);
          else showPanelMessage('Enable a script to view its controls.');
        }
      }
    };

    const buildChrome = () => {
      if (state.button && state.modal) return;
      const btn = SAFE_DOC.createElement('button');
      btn.id = BUTTON_ID;
      btn.type = 'button';
      btn.textContent = '⋯';
      btn.setAttribute('aria-label', 'Open userscript controls');
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener(clickEvent, (ev) => {
        ev.preventDefault();
        toggleModal();
      });

      const modal = SAFE_DOC.createElement('div');
      modal.id = MODAL_ID;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-label', 'Userscripts');
      modal.setAttribute('aria-hidden', 'true');
      const header = SAFE_DOC.createElement('header');
      const title = SAFE_DOC.createElement('span');
      title.textContent = 'Userscripts';
      const posBtn = SAFE_DOC.createElement('button');
      posBtn.type = 'button';
      posBtn.textContent = 'Flip';
      posBtn.addEventListener(clickEvent, (ev) => {
        ev.preventDefault();
        setPosition(state.position === 'right' ? 'left' : 'right');
      });
      header.appendChild(title);
      header.appendChild(posBtn);
      const tabs = SAFE_DOC.createElement('div');
      tabs.id = TABLIST_ID;
      const panel = SAFE_DOC.createElement('div');
      panel.id = PANEL_ID;
      modal.appendChild(header);
      modal.appendChild(tabs);
      modal.appendChild(panel);

      SAFE_DOC.body.appendChild(btn);
      SAFE_DOC.body.appendChild(modal);
      state.button = btn;
      state.modal = modal;
      state.tabs = tabs;
      state.panel = panel;
      ensureVisible();
      tabs.addEventListener(clickEvent, (ev) => {
        const target = ev.target.closest('.userscripts-tab');
        if (!target) return;
        const id = target.dataset.scriptId;
        if (!id) return;
        if (ev.target.classList.contains('toggle')) {
          const entry = state.scripts.get(id);
          if (entry?.onToggle) {
            entry.onToggle(!entry.enabled);
          } else {
            setScriptEnabled(id, !entry?.enabled);
          }
        } else {
          switchPanel(id);
        }
      });
    };

    const ensurePosition = async () => {
      const storedGM = await storage.get(STORAGE_KEY_POSITION, null);
      const pos = storedGM || readLocal(STORAGE_KEY_POSITION, null) || DEFAULT_POSITION;
      await setPosition(pos);
    };

    const ensureActive = async () => {
      const storedGM = await storage.get(STORAGE_KEY_ACTIVE, null);
      state.activeId = storedGM || readLocal(STORAGE_KEY_ACTIVE, null) || null;
    };

    const registerScript = (scriptConfig) => {
      const { id, title, render, enabled, onToggle } = scriptConfig;
      if (!id) throw new Error('id required');
      injectStyle();
      state.scripts.set(id, {
        id,
        title: title || id,
        render: render || (() => null),
        enabled: !!enabled,
        onToggle: typeof onToggle === 'function' ? onToggle : null,
        _cachedNode: null,
        row: null
      });
      renderTabs();
    };

    const setScriptEnabled = (id, value) => {
      const entry = state.scripts.get(id);
      if (!entry) return;
      entry.enabled = !!value;
      if (entry.enabled && !state.activeId) {
        state.activeId = entry.id;
      }
      if (!entry.enabled) {
        if (entry._cachedNode && entry._cachedNode.parentNode === state.panel) {
          state.panel.innerHTML = '';
        }
        entry._cachedNode = null;
      }
      if (entry.id === state.activeId && !entry.enabled) {
        const next = Array.from(state.scripts.values()).find((s) => s.enabled && s.id !== entry.id);
        state.activeId = next ? next.id : null;
      }
      renderTabs();
      if (state.activeId) {
        switchPanel(state.activeId);
      } else {
        showPanelMessage('Enable a script to view its controls.');
      }
    };

    const init = async () => {
      buildChrome();
      await ensurePosition();
      await ensureActive();
      renderTabs();
    };

    init().catch(() => {});

    return {
      registerScript,
      setScriptEnabled,
      switchPanel,
      toggleModal,
      get position() { return state.position; }
    };
  };

  //////////////////////////////////////////////////////////////
  // INITIALIZATION
  //////////////////////////////////////////////////////////////

  const sharedUiFactory = (() => {
    const adapterRef = { current: null };
    let instance = null;
    return {
      getInstance(adapter) {
        if (adapter) {
          adapterRef.current = adapter;
        }
        if (!instance) {
          instance = createUi(adapterRef);
        }
        return instance;
      },
      // Helper function for scripts to discover and initialize shared UI
      // This reduces code duplication across scripts
      createDiscoveryHelper(config) {
        const { scriptId, scriptTitle, gmStore, onReady } = config;
        let sharedUi = null;
        let sharedUiReady = false;
        let registrationAttempted = false;

        const initSharedUi = (providedFactory) => {
          let factory = providedFactory;
          
          if (!factory && typeof window !== 'undefined' && window.__userscriptSharedUi) {
            factory = window.__userscriptSharedUi;
          }
          
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

        const tryRegister = (renderPanel, onToggle, enabled) => {
          if (sharedUi && !registrationAttempted && typeof renderPanel === 'function') {
            registrationAttempted = true;
            sharedUi.registerScript({
              id: scriptId,
              title: scriptTitle,
              enabled: enabled,
              render: renderPanel,
              onToggle: onToggle
            });
          }
        };

        // Try immediate detection
        initSharedUi();
        
        if (typeof document !== 'undefined') {
          document.addEventListener('userscriptSharedUiReady', (event) => {
            setTimeout(() => {
              const providedFactory = event?.detail?.sharedUi;
              if (!sharedUiReady) {
                initSharedUi(providedFactory);
              }
              if (onReady && sharedUi) {
                onReady(sharedUi, tryRegister);
              }
            }, 0);
          });
        }

        return {
          get sharedUi() { return sharedUi; },
          get isReady() { return sharedUiReady; },
          tryRegister
        };
      }
    };
  })();

  // Expose on the root context (unsafeWindow in sandboxed scripts)
  root.__userscriptSharedUi = sharedUiFactory;

  // CRITICAL: Also expose on window when window !== root (sandbox boundary fix)
  // This ensures scripts can discover shared UI from both contexts
  if (typeof window !== 'undefined' && window !== root) {
    try {
      window.__userscriptSharedUi = sharedUiFactory;
    } catch (_) {
      // Ignore cross-context assignment errors
    }
  }

  // Dispatch custom event to notify other scripts that shared UI is ready
  // Include sharedUi in event.detail for direct access
  setTimeout(() => {
    if (typeof document === 'undefined') return;

    let event;
    try {
      if (typeof CustomEvent === 'function') {
        event = new CustomEvent('userscriptSharedUiReady', {
          detail: { sharedUi: sharedUiFactory }
        });
      } else {
        event = document.createEvent('CustomEvent');
        event.initCustomEvent(
          'userscriptSharedUiReady',
          false,
          false,
          { sharedUi: sharedUiFactory }
        );
      }
    } catch (_) {
      return;
    }

    document.dispatchEvent(event);
  }, 0);
})(typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
