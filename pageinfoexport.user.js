// ==UserScript==
// @name         Export Full Page Info (XBrowser)
// @namespace    https://github.com/cbkii/userscripts
// @author       cbkii
// @version      2025.12.28.1213
// @description  Export page DOM, scripts, styles, and performance data on demand with safe download fallbacks.
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/pageinfoexport.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/pageinfoexport.user.js
// @homepageURL  https://github.com/cbkii/userscripts
// @supportURL   https://github.com/cbkii/userscripts/issues
// @run-at       document-idle
// @noframes
// @grant        GM_addElement
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_info
// @grant        GM_notification
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

/*
  Feature summary:
  - Exports page DOM, scripts, styles, and performance data on demand.
  - Provides multiple save paths with a 15-second fallback UI and clipboard/preview helpers.
  - Supports export modes and optional split-file output.

  How it works:
  - A menu command opens an export dialog; capture runs only after explicit action.
  - Data is collected into text or JSON and downloaded via layered save strategies.
  - A non-blocking overlay offers retry/copy/preview tools if a download is blocked.

  Configuration:
  - Default options are hard-coded in DEFAULT_OPTIONS (mode, split, delay, shadow/iframe capture).
*/

(() => {
  'use strict';

  //////////////////////////////////////////////////////////////
  // CONSTANTS & CONFIGURATION
  //////////////////////////////////////////////////////////////

  const DEBUG = false;
  const LOG_PREFIX = '[pginfo]';
  const LOG_STORAGE_KEY = 'userscript.logs.pageinfoexport';
  const LOG_MAX_ENTRIES = 200;
  const SCRIPT_ID = 'pageinfoexport';
  const SCRIPT_TITLE = 'Page Info Export';
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

  //////////////////////////////////////////////////////////////
  // CORE LOGIC - PAGE INFO CAPTURE & EXPORT
  //////////////////////////////////////////////////////////////

  const DEFAULT_OPTIONS = {
    mode: 'full',
    split: false,
    includeShadow: true,
    includeIframes: true,
    delayMs: 0,
    dataUrlMaxChars: 800000,
    revokeDelayMs: 120000,
  };

  const DOWNLOAD_ANCHOR_DELAY_MS = 500;
  const BLOB_STALE_MS = 10000;
  const BLOB_REVOKE_MS = 120000;

  const UI_IDS = {
    overlay: 'pageinfoexport-overlay',
    dialog: 'pageinfoexport-dialog',
    status: 'pageinfoexport-status',
  };

  const GMX = (() => {
    const hasGM = typeof GM !== 'undefined' && GM;
    const gmDownload = typeof GM_download === 'function' ? GM_download : null;
    const gmDownloadAsync = hasGM && typeof GM.download === 'function' ? GM.download.bind(GM) : null;

    return {
      hasDownload: !!gmDownload || !!gmDownloadAsync,
      addElement(parent, tag, attrs) {
        if (typeof GM_addElement === 'function') {
          if (parent && parent.nodeType) {
            return GM_addElement(parent, tag, attrs);
          }
          return GM_addElement(tag, attrs);
        }
        const node = document.createElement(tag);
        if (attrs) {
          Object.entries(attrs).forEach(([key, value]) => {
            if (key in node) {
              node[key] = value;
            } else {
              node.setAttribute(key, value);
            }
          });
        }
        if (parent && parent.nodeType) {
          parent.appendChild(node);
        }
        return node;
      },
      addStyle(css) {
        if (typeof GM_addStyle === 'function') {
          return GM_addStyle(css);
        }
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
        return style;
      },
      setClipboard(text) {
        if (typeof GM_setClipboard === 'function') {
          GM_setClipboard(text);
          return Promise.resolve(true);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
        }
        return Promise.resolve(false);
      },
      openInTab(url, opts) {
        if (typeof GM_openInTab === 'function') {
          return GM_openInTab(url, opts && opts.background);
        }
        window.open(url, '_blank');
        return null;
      },
      notification(text) {
        if (typeof GM_notification === 'function') {
          GM_notification(text);
        }
      },
      registerMenuCommand(label, cb) {
        if (typeof GM_registerMenuCommand === 'function') {
          return GM_registerMenuCommand(label, cb);
        }
        return null;
      },
      info() {
        if (typeof GM_info !== 'undefined') {
          return GM_info;
        }
        return null;
      },
      async download(details) {
        if (gmDownloadAsync) {
          return gmDownloadAsync(details);
        }
        if (gmDownload) {
          return new Promise((resolve, reject) => {
            try {
              gmDownload({
                ...details,
                onload: () => resolve(true),
                onerror: err => reject(err),
              });
            } catch (err) {
              reject(err);
            }
          });
        }
        return null;
      },
    };
  })();

  const log = createLogger({
    prefix: LOG_PREFIX,
    storageKey: LOG_STORAGE_KEY,
    maxEntries: LOG_MAX_ENTRIES,
    debug: DEBUG
  });

  const pad = n => (n < 10 ? '0' : '') + n;
  const nowStamp = () => {
    const d = new Date();
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  };

  const safeStr = value => {
    try {
      return value == null ? '' : String(value);
    } catch (_) {
      return '';
    }
  };

  const section = title => `\n=== ${title} ===\n`;

  function ensureStyles() {
    if (document.getElementById('pageinfoexport-style')) {
      return;
    }
    GMX.addStyle(`
      #${UI_IDS.overlay} {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      #${UI_IDS.dialog} {
        width: min(520px, 92vw);
        background: #fff;
        color: #1f2933;
        border-radius: 10px;
        padding: 18px;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
      }
      #${UI_IDS.dialog} h2 {
        margin: 0 0 10px;
        font-size: 18px;
      }
      #${UI_IDS.dialog} label {
        display: block;
        font-size: 13px;
        margin-top: 10px;
      }
      #${UI_IDS.dialog} select,
      #${UI_IDS.dialog} input[type="number"] {
        width: 100%;
        margin-top: 6px;
        padding: 6px 8px;
        border: 1px solid #ccd2d6;
        border-radius: 6px;
      }
      #${UI_IDS.dialog} .row {
        display: flex;
        gap: 12px;
        align-items: center;
        margin-top: 8px;
      }
      #${UI_IDS.dialog} .row label {
        margin: 0;
        font-size: 13px;
      }
      #${UI_IDS.dialog} .actions {
        display: flex;
        gap: 10px;
        margin-top: 16px;
        flex-wrap: wrap;
      }
      #${UI_IDS.dialog} button {
        padding: 8px 12px;
        border-radius: 6px;
        border: 1px solid #c5cdd3;
        background: #f5f7f9;
        cursor: pointer;
      }
      #${UI_IDS.dialog} button.primary {
        background: #2563eb;
        color: #fff;
        border-color: #2563eb;
      }
      #${UI_IDS.status} {
        margin-top: 12px;
        padding: 10px;
        background: #f5f7f9;
        border-radius: 8px;
        font-size: 13px;
        line-height: 1.4;
      }
      #${UI_IDS.dialog} .small {
        font-size: 12px;
        color: #5b6770;
      }
    `);
    const style = document.querySelector('style:last-of-type');
    if (style) {
      style.id = 'pageinfoexport-style';
    }
  }

  function removeOverlay() {
    const overlay = document.getElementById(UI_IDS.overlay);
    if (overlay) {
      overlay.remove();
    }
  }

  function createOverlay() {
    removeOverlay();
    const overlay = GMX.addElement(document.body, 'div', { id: UI_IDS.overlay });
    const dialog = GMX.addElement(overlay, 'div', { id: UI_IDS.dialog });
    return { overlay, dialog };
  }

  function buildOptionsFromForm(form) {
    return {
      mode: form.querySelector('[name="mode"]').value,
      split: form.querySelector('[name="split"]').checked,
      includeShadow: form.querySelector('[name="shadow"]').checked,
      includeIframes: form.querySelector('[name="iframes"]').checked,
      delayMs: Number(form.querySelector('[name="delay"]').value || 0),
      dataUrlMaxChars: DEFAULT_OPTIONS.dataUrlMaxChars,
      revokeDelayMs: DEFAULT_OPTIONS.revokeDelayMs,
    };
  }

  //////////////////////////////////////////////////////////////
  // UI COMPONENTS
  //////////////////////////////////////////////////////////////

  function renderDialog() {
    ensureStyles();
    const { dialog, overlay } = createOverlay();

    dialog.innerHTML = `
      <h2>Export page info</h2>
      <label>
        Export mode
        <select name="mode">
          <option value="full">Full (HTML + scripts + styles + perf)</option>
          <option value="dom">DOM only (HTML)</option>
          <option value="scripts">Scripts list only</option>
          <option value="styles">Styles list only</option>
          <option value="perf">Resource timings only</option>
        </select>
      </label>
      <div class="row">
        <label><input type="checkbox" name="split"> Split into files</label>
        <label><input type="checkbox" name="shadow" checked> Include shadow DOM</label>
        <label><input type="checkbox" name="iframes" checked> Include iframes</label>
      </div>
      <label>
        Delay before capture (ms)
        <input type="number" name="delay" min="0" step="100" value="0">
      </label>
      <div class="small">Tip: use a delay if you need to open menus or panels before capture.</div>
      <div class="actions">
        <button class="primary" data-action="start">Start export</button>
        <button data-action="close">Close</button>
      </div>
      <div id="${UI_IDS.status}" hidden></div>
    `;

    const status = dialog.querySelector(`#${UI_IDS.status}`);
    dialog.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) {
        return;
      }
      const action = button.getAttribute('data-action');
      if (action === 'close') {
        removeOverlay();
        return;
      }
      if (action === 'start') {
        const options = buildOptionsFromForm(dialog);
        status.hidden = false;
        status.textContent = 'Preparing export…';
        runExportFlow(options, status);
      }
    });

    overlay.addEventListener('click', event => {
      if (event.target === overlay) {
        removeOverlay();
      }
    });
  }

  function collectScripts() {
    const scripts = Array.from(document.getElementsByTagName('script'));
    return scripts.map((script, index) => {
      let src = '';
      try {
        src = script.src || script.getAttribute('src') || '';
      } catch (_) {
        src = '';
      }
      let content = '';
      if (!src) {
        try {
          content = script.textContent || '';
        } catch (_) {
          content = '';
        }
      }
      return {
        index: index + 1,
        type: safeStr(script.type),
        async: !!script.async,
        defer: !!script.defer,
        noModule: !!script.noModule,
        nonce: safeStr(script.nonce),
        referrerPolicy: safeStr(script.referrerPolicy),
        src: src || null,
        inline: !src,
        content: content || null,
      };
    });
  }

  function collectStyles() {
    const links = Array.from(document.querySelectorAll('link[rel~="stylesheet"]'));
    const inlineStyles = Array.from(document.getElementsByTagName('style'));
    return {
      links: links.map((link, index) => ({
        index: index + 1,
        href: safeStr(link.href),
        media: safeStr(link.media),
        type: safeStr(link.type),
      })),
      inline: inlineStyles.map((style, index) => {
        let content = '';
        try {
          content = style.textContent || '';
        } catch (_) {
          content = '';
        }
        return {
          index: index + 1,
          media: safeStr(style.media),
          nonce: safeStr(style.nonce),
          content,
        };
      }),
    };
  }

  function collectPerformanceResources() {
    let entries = [];
    try {
      entries = performance.getEntriesByType('resource') || [];
    } catch (_) {
      entries = [];
    }
    return entries.map((entry, index) => ({
      index: index + 1,
      name: safeStr(entry.name),
      initiatorType: safeStr(entry.initiatorType),
      startTime: safeStr(entry.startTime),
      duration: safeStr(entry.duration),
      transferSize: safeStr(entry.transferSize),
      encodedBodySize: safeStr(entry.encodedBodySize),
      decodedBodySize: safeStr(entry.decodedBodySize),
    }));
  }

  function collectShadowRoots() {
    const roots = [];
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT, null);
    let node = walker.currentNode;
    while (node) {
      if (node.shadowRoot) {
        let html = '';
        try {
          html = node.shadowRoot.innerHTML || '';
        } catch (_) {
          html = '';
        }
        roots.push({
          hostTag: node.tagName.toLowerCase(),
          hostId: safeStr(node.id),
          hostClass: safeStr(node.className),
          mode: node.shadowRoot.mode || 'open',
          html,
        });
      }
      node = walker.nextNode();
    }
    return roots;
  }

  function collectIframes() {
    const frames = Array.from(document.getElementsByTagName('iframe'));
    return frames.map((frame, index) => {
      let src = '';
      let sameOrigin = false;
      let title = '';
      let html = '';
      try {
        src = frame.src || frame.getAttribute('src') || '';
      } catch (_) {
        src = '';
      }
      try {
        title = frame.title || '';
      } catch (_) {
        title = '';
      }
      try {
        if (frame.contentDocument && frame.contentWindow && frame.contentWindow.location) {
          sameOrigin = true;
          html = frame.contentDocument.documentElement
            ? frame.contentDocument.documentElement.outerHTML
            : '';
        }
      } catch (_) {
        sameOrigin = false;
      }
      return {
        index: index + 1,
        src,
        title,
        sameOrigin,
        html: sameOrigin ? html : null,
      };
    });
  }

  function buildReportData(options) {
    const meta = {
      generatedAt: new Date().toISOString(),
      url: safeStr(location.href),
      title: safeStr(document.title),
      userAgent: safeStr(navigator.userAgent),
      referrer: safeStr(document.referrer || ''),
    };

    const includeAll = options.mode === 'full';
    const dom = includeAll || options.mode === 'dom'
      ? (document.documentElement ? document.documentElement.outerHTML : '')
      : null;
    const scripts = includeAll || options.mode === 'scripts' ? collectScripts() : null;
    const styles = includeAll || options.mode === 'styles' ? collectStyles() : null;
    const perf = includeAll || options.mode === 'perf' ? collectPerformanceResources() : null;
    const shadows = options.includeShadow && (includeAll || options.mode === 'dom') ? collectShadowRoots() : null;
    const iframes = options.includeIframes && (includeAll || options.mode === 'dom') ? collectIframes() : null;

    return {
      meta,
      dom,
      scripts,
      styles,
      perf,
      shadows,
      iframes,
    };
  }

  function buildFullReportText(data) {
    const parts = [];
    parts.push(`Export generated: ${data.meta.generatedAt}`);
    parts.push(`Page URL: ${data.meta.url}`);
    parts.push(`Title: ${data.meta.title}`);
    parts.push(`User-Agent: ${data.meta.userAgent}`);
    parts.push(`Referrer: ${data.meta.referrer}`);
    parts.push('');

    if (data.dom != null) {
      parts.push(section('FULL HTML SOURCE'));
      parts.push(data.dom || '');
    }

    if (data.scripts != null) {
      parts.push(section('SCRIPTS (JSON)'));
      parts.push(JSON.stringify(data.scripts, null, 2));
    }

    if (data.styles != null) {
      parts.push(section('STYLES (JSON)'));
      parts.push(JSON.stringify(data.styles, null, 2));
    }

    if (data.perf != null) {
      parts.push(section('PERFORMANCE RESOURCES (JSON)'));
      parts.push(JSON.stringify(data.perf, null, 2));
    }

    if (data.shadows != null) {
      parts.push(section('SHADOW ROOTS (JSON)'));
      parts.push(JSON.stringify(data.shadows, null, 2));
    }

    if (data.iframes != null) {
      parts.push(section('IFRAMES (JSON)'));
      parts.push(JSON.stringify(data.iframes, null, 2));
    }

    return parts.join('\n');
  }

  function buildSplitFiles(data) {
    const files = {};
    files['meta.json'] = JSON.stringify(data.meta, null, 2);

    if (data.dom != null) {
      files['page.html'] = data.dom;
    }
    if (data.scripts != null) {
      files['scripts.json'] = JSON.stringify(data.scripts, null, 2);
    }
    if (data.styles != null) {
      files['styles.json'] = JSON.stringify(data.styles, null, 2);
    }
    if (data.perf != null) {
      files['perf.json'] = JSON.stringify(data.perf, null, 2);
    }
    if (data.shadows != null) {
      files['shadows.json'] = JSON.stringify(data.shadows, null, 2);
    }
    if (data.iframes != null) {
      files['iframes.json'] = JSON.stringify(data.iframes, null, 2);
    }
    return files;
  }

  const createDownloadResource = (text, mime, revokeDelayMs = DEFAULT_OPTIONS.revokeDelayMs) => {
    const state = {
      blob: null,
      url: null,
      stale: true,
      revoked: false,
      staleTimer: null,
      revokeTimer: null,
      revokeAfter: Math.max(revokeDelayMs || BLOB_REVOKE_MS, DOWNLOAD_ANCHOR_DELAY_MS),
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
      }, state.revokeAfter);
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

  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Failed to read blob as data URL'));
    reader.readAsDataURL(blob);
  });

  async function saveWithFilePicker(filename, resource, mime) {
    if (!window.showSaveFilePicker) {
      return { attempted: false };
    }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: mime,
            accept: { [mime]: ['.txt', '.json', '.html'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(resource.getBlob());
      await writable.close();
      resource.cleanup(DOWNLOAD_ANCHOR_DELAY_MS);
      return { attempted: true, success: true, method: 'file-picker' };
    } catch (err) {
      return { attempted: true, success: false, error: err, method: 'file-picker' };
    }
  }

  async function saveWithGMDownload(filename, resource, fallback) {
    const info = GMX.info();
    if (!GMX.hasDownload) {
      return { attempted: false };
    }
    if (info && info.downloadMode === 'disabled') {
      return { attempted: true, success: false, method: 'gm-download', error: new Error('Downloads disabled') };
    }
    let fallbackResult = null;
    let resolveLegacy;
    const legacyCompletion = new Promise((resolve) => {
      resolveLegacy = resolve;
    });
    const handleError = async (err) => {
      resource.markStale();
      fallbackResult = await fallback(err);
      if (resolveLegacy) {
        resolveLegacy({ success: false });
        resolveLegacy = null;
      }
    };

    const downloadDetails = {
      url: resource.getUrl(),
      name: filename,
      saveAs: true,
      onload: () => {
        resource.cleanup(DOWNLOAD_ANCHOR_DELAY_MS);
        if (resolveLegacy) {
          resolveLegacy({ success: true });
          resolveLegacy = null;
        }
      },
      onerror: (err) => {
        void handleError(err);
      },
    };

    try {
      const downloadPromise = GMX.download(downloadDetails);
      if (downloadPromise && typeof downloadPromise.then === 'function') {
        await downloadPromise.then(() => resource.cleanup(DOWNLOAD_ANCHOR_DELAY_MS)).catch(handleError);
        resolveLegacy = null;
      } else {
        await legacyCompletion;
        resolveLegacy = null;
      }
    } catch (err) {
      await handleError(err);
      return {
        attempted: true,
        success: fallbackResult?.success || false,
        method: fallbackResult?.method || 'gm-download',
        error: err,
      };
    }

    if (fallbackResult) {
      return fallbackResult;
    }

    return { attempted: true, success: true, method: 'gm-download' };
  }

  function saveWithAnchor(filename, resource) {
    try {
      const anchor = GMX.addElement(document.body, 'a', {
        href: resource.getUrl(),
        download: filename,
      });
      anchor.style.display = 'none';
      anchor.click();
      setTimeout(() => {
        anchor.remove();
        resource.cleanup(DOWNLOAD_ANCHOR_DELAY_MS);
      }, DOWNLOAD_ANCHOR_DELAY_MS);
      return { attempted: true, success: true, method: 'anchor-blob' };
    } catch (err) {
      return { attempted: true, success: false, method: 'anchor-blob', error: err };
    }
  }

  async function saveWithDataUrl(filename, resource, textLength, maxChars) {
    if (textLength > maxChars) {
      return { attempted: false };
    }
    try {
      const dataUrl = await blobToDataUrl(resource.getBlob());
      const anchor = GMX.addElement(document.body, 'a', {
        href: dataUrl,
        download: filename,
      });
      anchor.style.display = 'none';
      anchor.click();
      setTimeout(() => {
        anchor.remove();
        resource.cleanup(DOWNLOAD_ANCHOR_DELAY_MS);
      }, DOWNLOAD_ANCHOR_DELAY_MS);
      return { attempted: true, success: true, method: 'data-url' };
    } catch (err) {
      return { attempted: true, success: false, method: 'data-url', error: err };
    }
  }

  async function saveReport(payload, options) {
    const { filename, mime, text } = payload;
    let lastResult = null;
    const resource = createDownloadResource(text, mime, options.revokeDelayMs);
    const doFallback = async () => {
      const anchorResult = saveWithAnchor(filename, resource);
      if (anchorResult.success) {
        return anchorResult;
      }
      lastResult = anchorResult;
      const dataResult = await saveWithDataUrl(filename, resource, text.length, options.dataUrlMaxChars);
      if (dataResult.attempted) {
        if (dataResult.success) {
          return dataResult;
        }
        lastResult = dataResult;
      }
      return null;
    };

    const picker = await saveWithFilePicker(filename, resource, mime);
    if (picker.attempted) {
      if (picker.success) {
        return picker;
      }
      lastResult = picker;
    }

    const gmResult = await saveWithGMDownload(filename, resource, doFallback);
    if (gmResult.attempted) {
      if (gmResult.success) {
        return gmResult;
      }
      lastResult = gmResult;
    }

    const fallbackResult = await doFallback();
    if (fallbackResult) {
      return fallbackResult;
    }

    return lastResult || { attempted: false, success: false, method: 'none' };
  }

  function buildPreviewHtml(text) {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Page Info Export Preview</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 16px; }
  pre { white-space: pre-wrap; word-break: break-word; background: #f6f8fa; padding: 12px; border-radius: 8px; }
</style>
</head>
<body>
<h1>Page Info Export Preview</h1>
<pre>${escaped}</pre>
</body>
</html>`;
  }

  function openPreviewTab(text) {
    const html = buildPreviewHtml(text);
    const resource = createDownloadResource(html, 'text/html;charset=utf-8', DEFAULT_OPTIONS.revokeDelayMs);
    GMX.openInTab(resource.getUrl(), { background: false });
    resource.cleanup(DEFAULT_OPTIONS.revokeDelayMs);
  }

  function updateStatus(statusEl, message) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message;
  }

  function renderFallbackActions(statusEl, context) {
    const downloadNote = context.downloadDisabled
      ? '<div class="small">Tampermonkey downloads are disabled. Enable them in the extension settings to use GM_download.</div>'
      : '<div class="small">Tip: if downloads are disabled in Tampermonkey, enable them in extension settings.</div>';
    statusEl.innerHTML = `
      <div>If you didn't get a download prompt, try one of these:</div>
      <div class="actions">
        <button data-action="retry">Try again</button>
        <button data-action="copy">Copy to clipboard</button>
        <button data-action="preview">Open preview</button>
        <button data-action="split">Split export</button>
      </div>
      ${downloadNote}
    `;
    statusEl.querySelectorAll('button').forEach(button => {
      button.addEventListener('click', event => {
        const action = event.target.getAttribute('data-action');
        if (action === 'retry') {
          context.retry();
        } else if (action === 'copy') {
          context.copy();
        } else if (action === 'preview') {
          context.preview();
        } else if (action === 'split') {
          context.split();
        }
      });
    });
  }

  async function runExportFlow(options, statusEl) {
    if (options.delayMs > 0) {
      updateStatus(statusEl, `Waiting ${options.delayMs}ms before capture…`);
      await new Promise(resolve => setTimeout(resolve, options.delayMs));
    }

    updateStatus(statusEl, 'Capturing page data…');
    const data = buildReportData(options);
    const baseName = `page-info-${nowStamp()}`;
    const payload = {
      filename: `${baseName}.txt`,
      mime: 'text/plain;charset=utf-8',
      text: buildFullReportText(data),
      splitFiles: buildSplitFiles(data),
    };

    const tryDownload = async currentPayload => {
      const info = GMX.info();
      const downloadDisabled = info && info.downloadMode === 'disabled';
      updateStatus(statusEl, 'Attempting download…');
      const result = await saveReport(currentPayload, options);
      if (result.success && (result.method === 'file-picker' || result.method === 'gm-download')) {
        updateStatus(statusEl, `Saved via ${result.method.replace('-', ' ')}.`);
        GMX.notification('Export saved.');
        return;
      }
      if (result.success) {
        updateStatus(statusEl, `Download attempted via ${result.method}. Waiting 15s for confirmation…`);
      } else if (result.method === 'gm-download' && result.error) {
        updateStatus(statusEl, 'Downloads appear disabled. Check your userscript manager download settings.');
      } else {
        updateStatus(statusEl, 'Unable to trigger a download.');
      }
      if (downloadDisabled && statusEl && result.method !== 'gm-download') {
        statusEl.textContent += ' (GM_download is disabled in your manager settings.)';
      }

      const timer = setTimeout(() => {
        renderFallbackActions(statusEl, {
          retry: () => tryDownload(currentPayload),
          copy: () => GMX.setClipboard(currentPayload.text),
          preview: () => openPreviewTab(currentPayload.text),
          split: () => downloadSplit(payload, options, statusEl),
          downloadDisabled,
        });
      }, 15000);

      statusEl.dataset.fallbackTimer = String(timer);
    };

    if (options.split) {
      await downloadSplit(payload, options, statusEl);
    } else {
      await tryDownload(payload);
    }
  }

  async function downloadSplit(payload, options, statusEl) {
    const files = payload.splitFiles;
    if (!files || !Object.keys(files).length) {
      updateStatus(statusEl, 'No split files available.');
      return;
    }

    updateStatus(statusEl, 'Downloading split files…');
    const baseName = payload.filename.replace(/\.txt$/, '');
    const entries = Object.entries(files);
    for (const [name, content] of entries) {
      const filePayload = {
        filename: `${baseName}-${name}`,
        mime: name.endsWith('.html') ? 'text/html;charset=utf-8' : 'application/json;charset=utf-8',
        text: content,
      };
      await saveReport(filePayload, options);
    }
    updateStatus(statusEl, 'Split download attempts completed.');
  }

  const renderPanel = () => {
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '10px';

    const text = document.createElement('p');
    text.textContent = 'Export DOM, scripts, styles, and performance data. Results open the fallback UI if a download is blocked.';
    text.style.margin = '0';
    text.style.fontSize = '13px';
    wrapper.appendChild(text);

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.flexWrap = 'wrap';
    buttons.style.gap = '8px';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.textContent = 'Export page info';
    exportBtn.style.padding = '8px 10px';
    exportBtn.style.borderRadius = '8px';
    exportBtn.style.border = '1px solid rgba(255,255,255,0.18)';
    exportBtn.style.background = '#1f2937';
    exportBtn.style.color = '#f8fafc';
    exportBtn.addEventListener('click', () => renderDialog());

    buttons.appendChild(exportBtn);
    wrapper.appendChild(buttons);
    return wrapper;
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
    if (!hasUnregister && state.menuIds.length) return;
    state.menuIds.push(GM_registerMenuCommand(
      `Toggle ${SCRIPT_TITLE} (${state.enabled ? 'ON' : 'OFF'})`,
      async () => { await setEnabled(!state.enabled); }
    ));
    if (state.enabled) {
      state.menuIds.push(GM_registerMenuCommand('Export page info…', () => renderDialog()));
    }
  };

  const stop = async () => {
    state.started = false;
    removeOverlay();
  };

  const start = async () => {
    if (state.started) return;
    state.started = true;
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
  // INITIALIZATION
  //////////////////////////////////////////////////////////////

  const init = async () => {
    state.enabled = await gmStore.get(ENABLE_KEY, true);
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
  };

  init().catch((err) => {
    log('error', 'fatal error', err);
  });
})();
