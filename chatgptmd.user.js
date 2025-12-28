// ==UserScript==
// @name         ChatGPT Exporter for Android (md/txt/json)
// @namespace    https://github.com/cbkii/userscripts
// @version      2025.12.28.1513
// @description  Export ChatGPT conversations to Markdown, JSON, or text with download, copy, and share actions.
// @author       cbcoz
// @match        *://chat.openai.com/*
// @match        *://chatgpt.com/*
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/chatgptmd.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/chatgptmd.user.js
// @homepageURL  https://github.com/cbkii/userscripts
// @supportURL   https://github.com/cbkii/userscripts/issues
// @run-at       document-idle
// @noframes
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_download
// ==/UserScript==

/*
  Feature summary:
  - Adds export buttons to save ChatGPT chats as Markdown, JSON, or plain text.
  - Enhanced message detection with robust DOM selectors and validation.
  - Improved sender identification using multiple detection methods.
  - Automatic duplicate removal and sender sequence correction.
  - Supports robust DOM selectors and an optional API export mode.
  - Includes clipboard copy and Android share-sheet fallbacks.
  - Formats Deep Research citations as Markdown footnotes when detected.

  How it works:
  - Injects export controls near the input area and watches for SPA navigation.
  - Collects messages from the DOM using multiple selector strategies with content validation.
  - Identifies senders (User vs ChatGPT) using data attributes, avatars, content analysis, and structural heuristics.
  - Removes duplicates via content hashing and fixes consecutive same-sender messages.
  - Converts HTML to clean Markdown and downloads, copies, or shares the generated export.

  Configuration:
  - Toggle API export or citation formatting in the export popup.
  - Set DEBUG to true for detailed console logging.
*/

(() => {
  'use strict';

  //////////////////////////////////////////////////////////////
  // CONSTANTS & CONFIGURATION
  //////////////////////////////////////////////////////////////

  const DEBUG = false;
  const LOG_PREFIX = '[cgpt]';
  const BUTTONS_ID = 'exporter-buttons';
  const POPUP_ID = 'export-popup';
  const STATE = {
    apiMode: false,
    citations: true
  };
  const SCRIPT_ID = 'chatgptmd';
  const SCRIPT_TITLE = 'ChatGPT Exporter';
  const ENABLE_KEY = `${SCRIPT_ID}.enabled`;
  const LOG_STORAGE_KEY = 'userscript.logs.chatgptmd';
  const LOG_MAX_ENTRIES = 200;
  const gmDownloadLegacy = typeof GM_download === 'function' ? GM_download : null;
  const gmDownloadAsync = typeof GM !== 'undefined' && GM && typeof GM.download === 'function'
    ? GM.download.bind(GM)
    : null;
  const DOWNLOAD_ANCHOR_DELAY_MS = 500;
  const BLOB_STALE_MS = 10000;
  const BLOB_REVOKE_MS = 120000;

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
  }
        }
      }
    }, 0);
  });
  const state = {
    enabled: true,
    started: false,
    menuIds: [],
    observers: [],
    historyPatched: false
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
  // CORE LOGIC - CHATGPT EXPORT
  //////////////////////////////////////////////////////////////

  async function main() {
    state.enabled = await gmStore.get(ENABLE_KEY, true);

    const ensureButtons = () => {
      if (document.getElementById(BUTTONS_ID)) return;
      const inputWrapper = findInputWrapper();
      if (inputWrapper) {
        injectButtons(inputWrapper);
      }
    };

    const observeUiChanges = () => {
      let debounceId = 0;
      const observer = new MutationObserver(() => {
        if (document.getElementById(BUTTONS_ID)) return;
        if (debounceId) return;
        debounceId = window.setTimeout(() => {
          debounceId = 0;
          ensureButtons();
        }, 250);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      state.observers.push(observer);
    };

    const wrapHistory = (method) => {
      const original = history[method];
      if (!original || state.historyPatched) return;
      history[method] = function (...args) {
        const result = original.apply(this, args);
        ensureButtons();
        return result;
      };
      state.historyPatched = true;
    };

    const teardownLegacyUi = () => {
      document.getElementById(BUTTONS_ID)?.remove();
      document.getElementById(POPUP_ID)?.remove();
      state.observers.forEach((obs) => { try { obs.disconnect(); } catch (_) {} });
      state.observers = [];
    };

    const start = async () => {
      if (state.started) return;
      state.started = true;
      if (!sharedUi) {
        wrapHistory('pushState');
        wrapHistory('replaceState');
        window.addEventListener('popstate', ensureButtons);
        observeUiChanges();
        ensureButtons();
      }
    };

    const stop = async () => {
      if (!state.started) return;
      state.started = false;
      teardownLegacyUi();
    };

    //////////////////////////////////////////////////////////////
    // STATE MANAGEMENT
    //////////////////////////////////////////////////////////////

    const registerMenu = () => {
      if (typeof GM_registerMenuCommand !== 'function') return;
      if (hasUnregister && state.menuIds.length) {
        state.menuIds.forEach((id) => {
          try { GM_unregisterMenuCommand(id); } catch (_) {}
        });
        state.menuIds = [];
      }
      state.menuIds.push(GM_registerMenuCommand(
        `Toggle ${SCRIPT_TITLE} (${state.enabled ? 'ON' : 'OFF'})`,
        async () => { await setEnabled(!state.enabled); }
      ));
      if (state.enabled) {
        state.menuIds.push(GM_registerMenuCommand('Quick export (.md)', () => exportChat({ format: 'md', action: 'download' })));
      }
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
      wrapper.style.gap = '10px';

      const header = document.createElement('div');
      header.textContent = 'Export ChatGPT conversation';
      header.style.fontSize = '13px';
      header.style.color = '#e5e7eb';
      wrapper.appendChild(header);

      const optionsRow = document.createElement('div');
      optionsRow.style.display = 'flex';
      optionsRow.style.flexDirection = 'column';
      optionsRow.style.gap = '8px';
      optionsRow.appendChild(buildToggle({
        id: 'export-api-toggle',
        label: 'Full export (API mode)',
        checked: STATE.apiMode,
        onChange: (checked) => { STATE.apiMode = checked; }
      }));
      optionsRow.appendChild(buildToggle({
        id: 'export-citation-toggle',
        label: 'Format citations as footnotes',
        checked: STATE.citations,
        onChange: (checked) => { STATE.citations = checked; }
      }));
      wrapper.appendChild(optionsRow);

      const buttonGroup = document.createElement('div');
      buttonGroup.style.display = 'flex';
      buttonGroup.style.flexDirection = 'column';
      buttonGroup.style.gap = '8px';
      buttonGroup.appendChild(buildActionRow('Markdown (.md)', 'md'));
      buttonGroup.appendChild(buildActionRow('Plain Text (.txt)', 'txt'));
      buttonGroup.appendChild(buildActionRow('JSON (.json)', 'json'));
      wrapper.appendChild(buttonGroup);

      return wrapper;
    };

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

  function buildToggle({ id, label, checked, onChange }) {
    const wrapper = document.createElement('label');
    wrapper.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.checked = checked;
    checkbox.addEventListener('change', () => onChange(checkbox.checked));

    const text = document.createElement('span');
    text.textContent = label;

    wrapper.appendChild(checkbox);
    wrapper.appendChild(text);
    return wrapper;
  }

  function buildActionRow(label, format) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;';

    const downloadBtn = buildActionButton(`⬇️ ${label}`, () => {
      void exportChat({ format, action: 'download' });
    });
    const copyBtn = buildActionButton(`📋 Copy ${format.toUpperCase()}`, () => {
      void exportChat({ format, action: 'copy' });
    });
    const shareBtn = buildActionButton(`📲 Share ${format.toUpperCase()}`, () => {
      void exportChat({ format, action: 'share' });
    });

    row.appendChild(downloadBtn);
    row.appendChild(copyBtn);
    row.appendChild(shareBtn);

    return row;
  }

  function buildActionButton(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText = buttonStyle();
    btn.addEventListener('click', onClick);
    return btn;
  }

  function buttonStyle() {
    return [
      'padding: 8px 12px',
      'font-size: 14px',
      'border-radius: 6px',
      'border: 1px solid rgba(255,255,255,0.15)',
      'background: #1f2937',
      'color: #f8fafc',
      'cursor: pointer',
      'font-weight: 600'
    ].join(';');
  }

  function legacyButtonStyle() {
    return [
      'padding: 9px 13px',
      'font-size: 13px',
      'border-radius: 10px',
      'border: 1px solid #ff70c6',
      'background: linear-gradient(145deg,#0f0f17,#16162a)',
      'color: #f8fafc',
      'cursor: pointer',
      'font-weight: 700',
      'letter-spacing: 0.01em',
      'box-shadow: 0 10px 22px rgba(0,0,0,0.45)'
    ].join(';');
  }

  function findInputWrapper() {
    return document.querySelector('form')?.parentElement || null;
  }

  function injectButtons(container) {
    if (sharedUi) return; // shared UI handles controls
    if (document.getElementById(BUTTONS_ID)) return;
    const wrapper = document.createElement('div');
    wrapper.id = BUTTONS_ID;
    wrapper.dataset.chatgptExporter = '1';
    wrapper.style.cssText =
      'margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-start;z-index:9999;' +
      'background:#0d1324;padding:10px;border:1px solid #ff69b4;border-radius:12px;box-shadow:0 14px 30px rgba(0,0,0,0.45);';

    const quickBtn = document.createElement('button');
    quickBtn.type = 'button';
    quickBtn.innerText = '⬇️ Quick Export (.md)';
    quickBtn.style.cssText = legacyButtonStyle();
    quickBtn.addEventListener('click', () => {
      void exportChat({ format: 'md', action: 'download' });
    });

    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.innerText = '⚙️ More Options';
    moreBtn.style.cssText = legacyButtonStyle();
    moreBtn.addEventListener('click', showOptionsDialog);

    wrapper.appendChild(quickBtn);
    wrapper.appendChild(moreBtn);

    if (container === document.body) {
      container.insertBefore(wrapper, container.firstChild);
    } else {
      container.appendChild(wrapper);
    }
  }

  function showOptionsDialog() {
    if (sharedUi) {
      sharedUi.switchPanel(SCRIPT_ID);
      sharedUi.toggleModal();
      return;
    }
    if (document.getElementById(POPUP_ID)) return;

    const popup = document.createElement('div');
    popup.id = POPUP_ID;
    popup.dataset.chatgptExporter = '1';
    popup.style.cssText = [
      'position: fixed',
      'bottom: 90px',
      'left: 8%',
      'right: 8%',
      'background: linear-gradient(160deg,#0b0b12,#121226)',
      'border: 1px solid #ff70c6',
      'border-radius: 12px',
      'padding: 16px',
      'z-index: 9999',
      'box-shadow: 0 16px 34px rgba(0,0,0,0.5)',
      'font-size: 16px',
      'text-align: center'
    ].join(';');

    const title = document.createElement('div');
    title.textContent = '📤 Export Chat As';
    title.style.cssText = 'margin-bottom: 12px; font-weight: 700; color:#f8fafc;';

    const optionsRow = document.createElement('div');
    optionsRow.style.cssText = 'display:flex;flex-direction:column;gap:8px;align-items:flex-start;margin-bottom:12px;color:#e5e7eb;';

    const apiToggle = buildToggle({
      id: 'export-api-toggle',
      label: 'Full export (API mode)',
      checked: STATE.apiMode,
      onChange: checked => {
        STATE.apiMode = checked;
      }
    });

    const citationToggle = buildToggle({
      id: 'export-citation-toggle',
      label: 'Format citations as footnotes',
      checked: STATE.citations,
      onChange: checked => {
        STATE.citations = checked;
      }
    });

    optionsRow.appendChild(apiToggle);
    optionsRow.appendChild(citationToggle);

    const buttonGroup = document.createElement('div');
    buttonGroup.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

    buttonGroup.appendChild(buildActionRow('Markdown (.md)', 'md'));
    buttonGroup.appendChild(buildActionRow('Plain Text (.txt)', 'txt'));
    buttonGroup.appendChild(buildActionRow('JSON (.json)', 'json'));

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = '❌ Cancel';
    cancelBtn.style.cssText = `${legacyButtonStyle()};background:#1b2436;color:#f8fafc;margin-top:12px;`;

    popup.appendChild(title);
    popup.appendChild(optionsRow);
    popup.appendChild(buttonGroup);
    popup.appendChild(cancelBtn);

    document.body.appendChild(popup);

    let observer = null;
    const cleanup = () => {
      document.removeEventListener('keydown', escapeHandler);
      if (observer) observer.disconnect();
      observer = null;
    };

    const removePopup = () => {
      if (popup.parentNode) {
        popup.remove();
      }
      cleanup();
    };

    popup.addEventListener('click', (ev) => {
      if (ev.target === popup) removePopup();
    });
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        removePopup();
      }
    };
    document.addEventListener('keydown', escapeHandler);
    observer = new MutationObserver(() => {
      if (!popup.isConnected) {
        cleanup();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    cancelBtn.addEventListener('click', () => removePopup());
  }

  async function exportChat({ format, action }) {
    const useApi = STATE.apiMode;
    const enableCitations = STATE.citations && format === 'md';
    let exportData = null;

    if (useApi) {
      exportData = await buildExportFromApi(format, { enableCitations });
      if (!exportData) {
        alert('API export failed. Falling back to DOM export.');
        exportData = buildExportFromDom(format, { enableCitations });
      }
    } else {
      exportData = buildExportFromDom(format, { enableCitations });
    }

    if (!exportData) return;

    const { content, filename, mimeType } = exportData;
    if (action === 'download') {
      mobileDownload(content, filename, mimeType);
    } else if (action === 'copy') {
      await copyToClipboard(content);
    } else if (action === 'share') {
      await shareContent(content, filename, mimeType);
    }
  }

  function buildExportFromDom(format, { enableCitations }) {
    const messages = collectMessagesFromDom({ enableCitations });
    if (!messages.length) {
      alert('❗ No chat messages found!');
      return null;
    }

    const title = getChatTitle();
    if (format === 'json') {
      const payload = buildDomJsonPayload(title, messages);
      const ext = 'json';
      const mimeType = 'application/json';
      const filename = buildFilename(title, ext);
      return { content: JSON.stringify(payload, null, 2), filename, mimeType };
    }

    const output = formatMessages(messages, format);
    const ext = format === 'md' ? 'md' : 'txt';
    const mimeType = format === 'md' ? 'text/markdown' : 'text/plain';
    const filename = buildFilename(title, ext);

    return { content: output, filename, mimeType };
  }

  async function buildExportFromApi(format, { enableCitations }) {
    const conversationId = getConversationIdFromUrl();
    if (!conversationId) {
      alert('❗ Unable to detect conversation ID for API export.');
      return null;
    }

    const apiData = await fetchConversation(conversationId);
    if (!apiData) {
      return null;
    }

    const messages = collectMessagesFromApi(apiData, { enableCitations });
    if (!messages.length) {
      alert('❗ API export returned no messages.');
      return null;
    }

    const title = apiData.title || getChatTitle();
    if (format === 'json') {
      const payload = {
        exportedAt: new Date().toISOString(),
        source: location.href,
        mode: 'api',
        conversation: apiData
      };
      const ext = 'json';
      const mimeType = 'application/json';
      const filename = buildFilename(title, ext);
      return { content: JSON.stringify(payload, null, 2), filename, mimeType };
    }

    const output = formatMessages(messages, format);
    const ext = format === 'md' ? 'md' : 'txt';
    const mimeType = format === 'md' ? 'text/markdown' : 'text/plain';
    const filename = buildFilename(title, ext);

    return { content: output, filename, mimeType };
  }

  function collectMessagesFromDom({ enableCitations }) {
    const nodes = getMessageNodes();
    if (!nodes.length) return [];

    const converter = new MarkdownConverter({ enableCitations });
    
    // Extract messages with content hash for duplicate detection
    const processedMessages = [];
    const seenContent = new Set();

    nodes.forEach((node, index) => {
      const messageData = extractMessageFromNode(node, converter);
      if (!messageData) return;
      
      const content = messageData.markdown;
      
      // Skip if empty or too short
      if (!content || content.trim().length < 30) {
        if (DEBUG) {
          log('debug', `Skipping message ${index}: too short or empty`);
        }
        return;
      }

      // Create a content hash for duplicate detection
      const contentHash = content.substring(0, 100).replace(/\s+/g, ' ').trim();
      if (seenContent.has(contentHash)) {
        if (DEBUG) {
          log('debug', `Skipping message ${index}: duplicate content`);
        }
        return;
      }
      seenContent.add(contentHash);

      processedMessages.push({
        role: messageData.role,
        markdown: content,
        originalIndex: index
      });
    });

    // Apply sender sequence correction to fix consecutive same-role messages
    for (let i = 1; i < processedMessages.length; i++) {
      const current = processedMessages[i];
      const previous = processedMessages[i - 1];
      
      // If we have two consecutive messages from the same sender, try to fix it
      if (current.role === previous.role) {
        // Use content analysis to determine which should be flipped
        const currentLength = current.markdown.length;
        const previousLength = previous.markdown.length;
        
        // If current message is much longer, it's likely ChatGPT
        if (currentLength > previousLength * 2 && currentLength > 500) {
          current.role = 'assistant';
        } else if (previousLength > currentLength * 2 && previousLength > 500) {
          previous.role = 'assistant';
          current.role = 'user';
        } else {
          // Default alternating fix
          current.role = current.role === 'user' ? 'assistant' : 'user';
        }
        
        if (DEBUG) {
          log('debug', `Fixed consecutive ${previous.role} messages at positions ${i-1} and ${i}`);
        }
      }
    }

    return processedMessages.map(({ role, markdown }) => ({ role, markdown }));
  }

  function getMessageNodes() {
    // Enhanced selector list with better coverage for conversation turns
    const selectors = [
      'div[data-message-author-role]',           // Modern ChatGPT with clear author role
      'article[data-testid*="conversation-turn"]', // Conversation turns
      'article[data-message-author-role]',       // Article-based messages
      'div[data-testid="conversation-turn"]',     // Specific conversation turn
      '.group\\/conversation-turn',               // Fix for nested groups
      'div[class*="group"]:not([class*="group"] [class*="group"])', // Top-level groups only
    ];

    let messages = [];
    for (const selector of selectors) {
      messages = document.querySelectorAll(selector);
      if (messages.length > 0) {
        if (DEBUG) {
          log('debug', `Using selector: ${selector}, found ${messages.length} messages`);
        }
        break;
      }
    }

    if (messages.length === 0) {
      // Fallback: try to find conversation container and parse its structure
      const conversationContainer = document.querySelector('[role="main"], main, .conversation, [class*="conversation"]');
      if (conversationContainer) {
        messages = conversationContainer.querySelectorAll(':scope > div, :scope > article');
        if (DEBUG) {
          log('debug', `Fallback: found ${messages.length} potential messages in conversation container`);
        }
      }
    }

    // Filter and validate messages
    const validMessages = Array.from(messages).filter(msg => {
      const text = msg.textContent.trim();
      
      // Must have substantial content
      if (text.length < 30) return false;
      if (text.length > 100000) return false;
      
      // Skip elements that are clearly UI components
      if (msg.querySelector('input[type="text"], textarea')) return false;
      if (msg.classList.contains('typing') || msg.classList.contains('loading')) return false;
      
      // Must contain meaningful content (not just buttons/UI)
      const meaningfulText = text.replace(/\s+/g, ' ').trim();
      if (meaningfulText.split(' ').length < 5) return false;
      
      return true;
    });

    // Remove nested messages and consolidate content
    const consolidatedMessages = [];
    const usedElements = new Set();

    validMessages.forEach(msg => {
      if (usedElements.has(msg)) return;
      
      // Check if this message is nested within another valid message
      const isNested = validMessages.some(other => 
        other !== msg && other.contains(msg) && !usedElements.has(other)
      );
      
      if (!isNested) {
        consolidatedMessages.push(msg);
        usedElements.add(msg);
      }
    });

    return consolidatedMessages;
  }

  function extractMessageFromNode(node, converter) {
    const { role, contentNode } = resolveRoleAndContent(node);
    if (!contentNode) return null;

    const html = contentNode.innerHTML || '';
    const markdown = converter.turndown(html);
    const normalized = normalizeMarkdown(markdown, converter.getFootnotes());

    return {
      role: role || 'assistant',
      markdown: normalized
    };
  }

  function resolveRoleAndContent(node) {
    // Method 1: Check for data attributes (most reliable)
    let role = node.getAttribute('data-message-author-role');
    let contentNode = node;

    if (role) {
      const markdownNode =
        node.querySelector('.markdown') ||
        node.querySelector('[class*="markdown"]') ||
        node;
      return { role, contentNode: markdownNode };
    }

    // Method 2: Look for nested role attributes
    const roleNode = node.querySelector('[data-message-author-role]');
    if (roleNode) {
      role = roleNode.getAttribute('data-message-author-role');
      contentNode = roleNode;
    }

    // Method 3: Check for avatar images with better detection
    if (!role) {
      const avatars = node.querySelectorAll('img');
      for (const avatar of avatars) {
        const alt = avatar.alt?.toLowerCase() || '';
        const src = avatar.src?.toLowerCase() || '';
        const classes = avatar.className?.toLowerCase() || '';
        
        // User indicators
        if (alt.includes('user') || src.includes('user') || classes.includes('user')) {
          role = 'user';
          break;
        }
        
        // Assistant indicators
        if (alt.includes('chatgpt') || alt.includes('assistant') || alt.includes('gpt') || 
            src.includes('assistant') || src.includes('chatgpt') || classes.includes('assistant')) {
          role = 'assistant';
          break;
        }
      }
    }

    // Method 4: Look for role labels in the DOM
    if (!role) {
      const roleLabel = node.querySelector('.whitespace-nowrap, [class*="label"], [class*="role"]');
      const labelText = roleLabel?.textContent?.trim().toLowerCase() || '';
      if (labelText.includes('you')) role = 'user';
      if (labelText.includes('assistant') || labelText.includes('chatgpt')) role = 'assistant';
    }

    // Method 5: Content analysis with better patterns
    if (!role) {
      const text = node.textContent.toLowerCase();
      const textStart = text.substring(0, 200); // Look at beginning of message
      
      // Strong ChatGPT indicators
      if (textStart.match(/^(i understand|i can help|here's|i'll|let me|i'd be happy|certainly|of course)/)) {
        role = 'assistant';
      }
      
      // Strong user indicators  
      if (textStart.match(/^(can you|please help|how do i|i need|i want|help me|could you)/)) {
        role = 'user';
      }
    }

    // Method 6: Structural analysis
    if (!role) {
      const hasCodeBlocks = node.querySelectorAll('pre, code').length > 0;
      const hasLongText = node.textContent.length > 200;
      const hasLists = node.querySelectorAll('ul, ol, li').length > 0;
      
      // ChatGPT messages tend to be longer and more structured
      if (hasCodeBlocks && hasLongText && hasLists) {
        role = 'assistant';
      }
    }

    const markdownNode =
      contentNode.querySelector('.markdown') ||
      contentNode.querySelector('[class*="markdown"]') ||
      contentNode;

    return { role: role || 'assistant', contentNode: markdownNode };
  }

  function collectMessagesFromApi(apiData, { enableCitations }) {
    const mapping = apiData?.mapping || {};
    let nodeId = apiData?.current_node || null;
    const ordered = [];

    while (nodeId) {
      const node = mapping[nodeId];
      if (!node) break;
      ordered.push(node);
      nodeId = node.parent;
    }

    return ordered
      .reverse()
      .map(node => buildMessageFromApiNode(node, { enableCitations }))
      .filter(Boolean);
  }

  function buildMessageFromApiNode(node, { enableCitations }) {
    const message = node?.message;
    if (!message) return null;

    const role = message.author?.role || 'assistant';
    const content = extractApiContent(message);
    if (!content) return null;

    let markdown = content.trim();
    const citations = extractApiCitations(message);
    if (enableCitations && citations.length) {
      markdown = applyCitationsToMarkdown(markdown, citations);
    }

    return { role, markdown };
  }

  function extractApiContent(message) {
    const content = message?.content;
    if (!content) return '';

    if (content.content_type === 'text' || content.content_type === 'multimodal_text') {
      const parts = Array.isArray(content.parts) ? content.parts : [];
      return parts
        .map(part => (typeof part === 'string' ? part : part?.text || ''))
        .filter(Boolean)
        .join('\n');
    }

    if (typeof content.text === 'string') return content.text;

    return '';
  }

  function extractApiCitations(message) {
    const citations = message?.metadata?.citations || message?.content?.citations || [];
    if (!Array.isArray(citations)) return [];

    return citations
      .map(citation => ({
        title: citation.title || citation?.metadata?.title || '',
        url: citation.url || citation?.metadata?.url || ''
      }))
      .filter(citation => citation.url);
  }

  function applyCitationsToMarkdown(markdown, citations) {
    let output = markdown;
    let replaced = false;

    citations.forEach((citation, index) => {
      const number = index + 1;
      const regex = new RegExp(`\\[${number}\\]`, 'g');
      if (regex.test(output)) {
        replaced = true;
        output = output.replace(regex, `[^${number}]`);
      }
    });

    if (!replaced) return output;

    const footnotes = citations.map((citation, index) => {
      const label = citation.title ? `${citation.title} - ${citation.url}` : citation.url;
      return `[^${index + 1}]: ${label}`;
    });

    return `${output}\n\n${footnotes.join('\n')}`;
  }

  function formatMessages(messages, format) {
    const lines = messages.map(message => {
      const speaker = formatRoleLabel(message.role, format);
      let body = message.markdown || '';
      if (format === 'txt') {
        body = stripMarkdown(body);
      }
      return `${speaker}\n${body}`.trim();
    });

    return lines.join('\n\n---\n\n');
  }

  function formatRoleLabel(role, format) {
    const normalized = role?.toLowerCase() || 'assistant';
    const label = normalized === 'user'
      ? 'User'
      : normalized === 'system'
        ? 'System'
        : 'ChatGPT';

    return format === 'md' ? `**${label}:**` : `${label}:`;
  }

  function normalizeMarkdown(markdown, footnotes) {
    let output = markdown
      .replace(/\n{3,}/g, '\n\n')
      .replace(/(\n\s*\n)+(?=- )/g, '\n')
      .replace(/(- .+)\n\n(?=- )/g, '$1\n')
      .replace(/([^\n])\n(#+ )/g, '$1\n\n$2')
      .replace(/(#+ .+)\n{2,}/g, '$1\n')
      .replace(/^\s+|\s+$/g, '');

    if (footnotes.length) {
      output = `${output}\n\n${footnotes.join('\n')}`.trim();
    }

    return output;
  }

  function buildFilename(title, ext) {
    // Use document title for better file naming
    const safeTitle = (title || document.title || 'chatgpt-export')
      .replace(/[<>:"/\\|?*]/g, '')    // Remove invalid filename characters
      .replace(/\s+/g, ' ')             // Normalize whitespace
      .trim();

    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    return safeTitle ? `${safeTitle} (${date}).${ext}` : `ChatGPT_Conversation_${date}.${ext}`;
  }

  function getChatTitle() {
    // Try to get actual conversation title from various locations
    const titleSelectors = [
      'h1:not([class*="hidden"])',
      '[class*="conversation-title"]',
      '[data-testid*="conversation-title"]',
      'title'
    ];

    for (const selector of titleSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim()) {
        const title = element.textContent.trim();
        // Avoid generic titles
        if (!['chatgpt', 'new chat', 'untitled', 'chat'].includes(title.toLowerCase())) {
          return title.replace(/\s*-\s*ChatGPT.*/i, '').trim();
        }
      }
    }

    // Fallback to cleaned document title
    const docTitle = document.querySelector('title')?.textContent || 'ChatGPT Export';
    return docTitle.replace(/\s*-\s*ChatGPT.*/i, '').trim() || 'ChatGPT Export';
  }

  function buildDomJsonPayload(title, messages) {
    return {
      exportedAt: new Date().toISOString(),
      source: location.href,
      mode: 'dom',
      title,
      messages: messages.map(message => ({
        role: message.role,
        markdown: message.markdown
      }))
    };
  }

  async function fetchAccessToken() {
    const response = await fetch(`${location.origin}/api/auth/session`, { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`Session fetch failed: ${response.status}`);
    }
    const data = await response.json();
    return data?.accessToken || null;
  }

  async function fetchConversation(conversationId) {
    const url = `${location.origin}/backend-api/conversation/${conversationId}`;
    try {
      const accessToken = await fetchAccessToken();
      const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
      const response = await fetch(url, { credentials: 'include', headers });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      log('error', 'API export failed', error);
      return null;
    }
  }

  function getConversationIdFromUrl() {
    const match = location.pathname.match(/\/(?:c|share)\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  async function copyToClipboard(text) {
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopy(text);
      }
      alert('✅ Copied to clipboard.');
      return true;
    } catch (error) {
      log('error', 'Clipboard copy failed', error);
      alert('❗ Unable to copy to clipboard.');
      return false;
    }
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  async function shareContent(text, filename, mimeType) {
    if (!navigator.share) {
      alert('❗ Share is not supported on this device.');
      return false;
    }

    try {
      const file = new File([text], filename, { type: `${mimeType};charset=utf-8` });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ title: filename, files: [file] });
      } else {
        await navigator.share({ title: filename, text });
      }
      return true;
    } catch (error) {
      log('error', 'Share failed', error);
      alert('❗ Share failed.');
      return false;
    }
  }

  class MarkdownConverter {
    constructor({ enableCitations }) {
      this.enableCitations = enableCitations;
      this.citations = [];
      this.citationMap = new Map();
      this.rules = [
        { filter: ['strong', 'b'], replacement: content => `**${content}**` },
        { filter: ['em', 'i'], replacement: content => `*${content}*` },
        {
          filter: 'code',
          replacement: (content, node) => {
            if (node.parentElement?.tagName?.toLowerCase() === 'pre') {
              return node.textContent || content;
            }
            return `\`${content}\``;
          }
        },
        {
          filter: 'pre',
          replacement: (content, node) => {
            const codeNode = node.querySelector('code');
            const language = detectCodeLanguage(node, codeNode);
            const text = (codeNode?.textContent || node.textContent || '').trimEnd();
            const fence = language ? `\n\`\`\`${language}\n` : '\n\`\`\`\n';
            return `${fence}${text}\n\`\`\`\n`;
          }
        },
        {
          filter: 'a',
          replacement: (content, node) => {
            const href = node.getAttribute('href');
            if (!href) return content;

            if (this.enableCitations && isCitationLink(node, content)) {
              const index = this.registerCitation({ title: content, url: href });
              return `[^${index}]`;
            }

            return `[${content}](${href})`;
          }
        },
        {
          filter: 'img',
          replacement: (content, node) => {
            const src = node.getAttribute('src');
            if (!src) return '';
            return `![${node.getAttribute('alt') || ''}](${src})`;
          }
        },
        { filter: 'br', replacement: () => '\n' },
        {
          filter: ['h1', 'h2', 'h3', 'h4'],
          replacement: (content, node) => `${'#'.repeat(parseInt(node.tagName[1], 10))} ${content}\n`
        },
        { filter: 'p', replacement: content => `${content}\n` },
        {
          filter: 'li',
          replacement: content => {
            const trimmed = content.trim();
            return trimmed ? `- ${trimmed}\n` : '';
          }
        },
        { filter: 'ul', replacement: content => `\n${content}\n` },
        {
          filter: 'ol',
          replacement: content => {
            return (
              '\n' +
              content
                .split('\n')
                .filter(Boolean)
                .map((line, index) => `${index + 1}. ${line.replace(/^[-*]\s/, '')}`)
                .join('\n') +
              '\n'
            );
          }
        },
        {
          filter: 'blockquote',
          replacement: content => {
            const lines = content.split('\n').map(line => (line ? `> ${line}` : '>'));
            return `${lines.join('\n')}\n`;
          }
        }
      ];
    }

    turndown(html) {
      this.citations = [];
      this.citationMap.clear();

      const container = document.createElement('div');
      container.innerHTML = html;

      const recurse = node => {
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const rule = this.rules.find(candidate => {
          if (typeof candidate.filter === 'string') {
            return candidate.filter === node.tagName.toLowerCase();
          }
          if (Array.isArray(candidate.filter)) {
            return candidate.filter.includes(node.tagName.toLowerCase());
          }
          return candidate.filter(node);
        });

        const content = Array.from(node.childNodes).map(recurse).join('');
        return rule ? rule.replacement(content, node) : content;
      };

      let markdown = recurse(container);
      
      // Clean up markdown: normalize whitespace and line breaks
      markdown = markdown
        .replace(/\n{3,}/g, '\n\n')           // Max 2 consecutive newlines
        .replace(/\\\\/g, '\\')               // Fix escaped backslashes
        .replace(/\\([^\\])/g, '$1')          // Remove unnecessary escapes
        .trim();
      
      return markdown;
    }

    registerCitation(citation) {
      const key = `${citation.title}|${citation.url}`;
      if (this.citationMap.has(key)) {
        return this.citationMap.get(key);
      }

      const index = this.citations.length + 1;
      this.citations.push({
        title: citation.title,
        url: citation.url
      });
      this.citationMap.set(key, index);
      return index;
    }

    getFootnotes() {
      if (!this.enableCitations || !this.citations.length) return [];

      return this.citations.map((citation, index) => {
        const label = citation.title
          ? `${citation.title} - ${citation.url}`
          : citation.url;
        return `[^${index + 1}]: ${label}`;
      });
    }
  }

  function detectCodeLanguage(preNode, codeNode) {
    const candidates = [
      codeNode?.getAttribute('data-language'),
      codeNode?.getAttribute('data-lang'),
      preNode?.getAttribute('data-language'),
      preNode?.getAttribute('data-lang')
    ].filter(Boolean);

    const classTargets = [
      codeNode?.className,
      preNode?.className
    ].filter(Boolean);

    classTargets.forEach(className => {
      const match = className.match(/language-([\w-]+)/i) || className.match(/lang(?:uage)?-([\w-]+)/i);
      if (match) {
        candidates.push(match[1]);
      }
    });

    return candidates.find(Boolean) || '';
  }

  function isCitationLink(node, content) {
    const text = content.trim();
    const numeric = /^\[?\d+\]?$/.test(text);
    const hasSource =
      node.dataset?.source ||
      node.dataset?.sourceId ||
      node.getAttribute('data-source') ||
      node.closest('[data-source]');

    return Boolean(numeric || hasSource);
  }

  function stripMarkdown(markdown) {
    let text = markdown;
    text = text.replace(/```[\s\S]*?```/g, match =>
      match.replace(/```[\w-]*\n?/g, '').replace(/```/g, '')
    );
    text = text.replace(/`([^`]+)`/g, '$1');
    text = text.replace(/\*\*(.*?)\*\*/g, '$1');
    text = text.replace(/\*(.*?)\*/g, '$1');
    text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    text = text.replace(/^\s*> ?/gm, '');
    text = text.replace(/^\s{0,3}[-*+] /gm, '');
    text = text.replace(/^\s{0,3}\d+\. /gm, '');
    text = text.replace(/\[\^\d+\]: .*/g, '');
    return text.trim();
  }

  const createDownloadResource = (text, mime) => {
    const state = {
      blob: null,
      url: null,
      stale: true,
      revoked: false,
      staleTimer: null,
      revokeTimer: null,
    };

    const scheduleTimers = () => {
      clearTimeout(state.staleTimer);
      clearTimeout(state.revokeTimer);
      state.staleTimer = setTimeout(() => {
        state.stale = true;
      }, BLOB_STALE_MS);
      state.revokeTimer = setTimeout(() => {
        state.stale = true;
        if (state.url && !state.revoked) {
          try {
            URL.revokeObjectURL(state.url);
            state.revoked = true;
          } catch (_) {
            // no-op
          }
        }
      }, BLOB_REVOKE_MS);
    };

    const refresh = () => {
      if (state.url && !state.revoked) {
        try {
          URL.revokeObjectURL(state.url);
        } catch (_) {
          // no-op
        }
      }
      state.blob = new Blob([text], { type: mime });
      state.url = URL.createObjectURL(state.blob);
      state.stale = false;
      state.revoked = false;
      scheduleTimers();
    };

    refresh();

    return {
      getUrl() {
        if (state.stale || state.revoked || !state.url) {
          refresh();
        }
        return state.url;
      },
      getBlob() {
        if (state.stale || state.revoked || !state.blob) {
          refresh();
        }
        return state.blob;
      },
      markStale() {
        state.stale = true;
      },
      cleanup(delayMs = DOWNLOAD_ANCHOR_DELAY_MS) {
        clearTimeout(state.staleTimer);
        clearTimeout(state.revokeTimer);
        const currentUrl = state.url;
        setTimeout(() => {
          if (currentUrl && !state.revoked) {
            try {
              URL.revokeObjectURL(currentUrl);
            } catch (_) {
              // no-op
            }
            state.revoked = true;
          }
        }, delayMs);
      },
    };
  };

  const anchorDownload = (resource, filename) => {
    try {
      const link = document.createElement('a');
      link.href = resource.getUrl();
      link.download = filename;
      link.style.cssText = 'position:absolute;left:-9999px;top:-9999px;opacity:0;';
      document.body.appendChild(link);

      const clickEvent = new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true
      });
      link.dispatchEvent(clickEvent);

      setTimeout(() => {
        link.remove();
        resource.cleanup(DOWNLOAD_ANCHOR_DELAY_MS);
      }, DOWNLOAD_ANCHOR_DELAY_MS);
      return true;
    } catch (err) {
      log('error', 'Anchor download failed', err);
      return false;
    }
  };

  const dataUrlDownload = (resource, filename) => {
    try {
      const blob = resource.getBlob();
      const reader = new FileReader();
      reader.onload = () => {
        const href = typeof reader.result === 'string' ? reader.result : '';
        if (!href) {
          resource.cleanup(DOWNLOAD_ANCHOR_DELAY_MS);
          return;
        }
        const link = document.createElement('a');
        link.href = href;
        link.download = filename;
        link.style.cssText = 'position:absolute;left:-9999px;top:-9999px;opacity:0;';
        document.body.appendChild(link);
        link.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
        setTimeout(() => {
          link.remove();
          resource.cleanup(DOWNLOAD_ANCHOR_DELAY_MS);
        }, DOWNLOAD_ANCHOR_DELAY_MS);
      };
      reader.onerror = () => resource.cleanup(DOWNLOAD_ANCHOR_DELAY_MS);
      reader.readAsDataURL(blob);
      return true;
    } catch (err) {
      log('error', 'Data URL download failed', err);
      return false;
    }
  };

  function mobileDownload(content, filename, mimeType = 'text/plain') {
    const resource = createDownloadResource(content, `${mimeType};charset=utf-8`);
    const fallback = () => {
      if (!anchorDownload(resource, filename)) {
        dataUrlDownload(resource, filename);
      }
    };

    try {
      if (gmDownloadLegacy || gmDownloadAsync) {
        const usingLegacyOnly = !!gmDownloadLegacy && !gmDownloadAsync;
        const cleanupDelay = gmDownloadAsync ? DOWNLOAD_ANCHOR_DELAY_MS : BLOB_REVOKE_MS;
        const detail = {
          url: resource.getUrl(),
          name: filename,
          saveAs: true,
          onload: () => resource.cleanup(cleanupDelay),
          onerror: () => {
            resource.markStale();
            fallback();
          },
        };
        const result = gmDownloadAsync ? gmDownloadAsync(detail) : gmDownloadLegacy(detail);
        if (usingLegacyOnly) {
          fallback();
        }
        if (result && typeof result.then === 'function') {
          result.then(() => resource.cleanup(cleanupDelay)).catch(() => {
            resource.markStale();
            fallback();
          });
        } else {
          setTimeout(() => resource.cleanup(cleanupDelay), cleanupDelay);
        }
        return true;
      }

      fallback();
      return true;
    } catch (error) {
      resource.markStale();
      fallback();
      log('error', 'Download failed', error);
      alert('❗ Download failed. Try copying manually.');
      return false;
    }
  }

  //////////////////////////////////////////////////////////////
  // INITIALIZATION
  //////////////////////////////////////////////////////////////

  main().catch((error) => {
    log('error', 'fatal error', error);
  });
})();
