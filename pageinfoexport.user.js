// ==UserScript==
// @name         Export Full Page Info (XBrowser)
// @namespace    https://github.com/cbkii/userscripts
// @author       cbkii
// @version      2025.12.23.1605
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
// @grant        GM_setClipboard
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

  const DEBUG = false;
  const LOG_PREFIX = '[pageinfo-export]';

  const DEFAULT_OPTIONS = {
    mode: 'full',
    split: false,
    includeShadow: true,
    includeIframes: true,
    delayMs: 0,
    dataUrlMaxChars: 800000,
    revokeDelayMs: 120000,
  };

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

  const log = (...args) => {
    if (DEBUG) {
      console.log(LOG_PREFIX, ...args);
    }
  };

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

  function toBase64Utf8(text) {
    const utf8 = new TextEncoder().encode(text);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < utf8.length; i += chunkSize) {
      const chunk = utf8.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function createBlobUrl(text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    return { blob, url };
  }

  async function saveWithFilePicker(filename, text, mime) {
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
      await writable.write(new Blob([text], { type: mime }));
      await writable.close();
      return { attempted: true, success: true, method: 'file-picker' };
    } catch (err) {
      return { attempted: true, success: false, error: err, method: 'file-picker' };
    }
  }

  async function saveWithGMDownload(filename, text, mime, revokeDelayMs) {
    const info = GMX.info();
    if (!GMX.hasDownload) {
      return { attempted: false };
    }
    if (info && info.downloadMode === 'disabled') {
      return { attempted: true, success: false, method: 'gm-download', error: new Error('Downloads disabled') };
    }
    try {
      const { url } = createBlobUrl(text, mime);
      const downloadPromise = GMX.download({
        url,
        name: filename,
        saveAs: true,
      });
      if (downloadPromise && typeof downloadPromise.then === 'function') {
        await downloadPromise;
      }
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {
          // no-op
        }
      }, revokeDelayMs);
      return { attempted: true, success: true, method: 'gm-download' };
    } catch (err) {
      return { attempted: true, success: false, method: 'gm-download', error: err };
    }
  }

  function saveWithAnchor(filename, text, mime, revokeDelayMs) {
    try {
      const { url } = createBlobUrl(text, mime);
      const anchor = GMX.addElement(document.body, 'a', {
        href: url,
        download: filename,
      });
      anchor.style.display = 'none';
      anchor.click();
      anchor.remove();
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {
          // no-op
        }
      }, revokeDelayMs);
      return { attempted: true, success: true, method: 'anchor-blob' };
    } catch (err) {
      return { attempted: true, success: false, method: 'anchor-blob', error: err };
    }
  }

  function saveWithDataUrl(filename, text, maxChars) {
    if (text.length > maxChars) {
      return { attempted: false };
    }
    try {
      const dataUrl = `data:text/plain;charset=utf-8;base64,${toBase64Utf8(text)}`;
      const anchor = GMX.addElement(document.body, 'a', {
        href: dataUrl,
        download: filename,
      });
      anchor.style.display = 'none';
      anchor.click();
      anchor.remove();
      return { attempted: true, success: true, method: 'data-url' };
    } catch (err) {
      return { attempted: true, success: false, method: 'data-url', error: err };
    }
  }

  async function saveReport(payload, options) {
    const { filename, mime, text } = payload;
    let lastResult = null;
    const picker = await saveWithFilePicker(filename, text, mime);
    if (picker.attempted) {
      if (picker.success) {
        return picker;
      }
      lastResult = picker;
    }

    const gmResult = await saveWithGMDownload(filename, text, mime, options.revokeDelayMs);
    if (gmResult.attempted) {
      if (gmResult.success) {
        return gmResult;
      }
      lastResult = gmResult;
    }

    const anchorResult = saveWithAnchor(filename, text, mime, options.revokeDelayMs);
    if (anchorResult.success) {
      return anchorResult;
    }
    lastResult = anchorResult;

    const dataResult = saveWithDataUrl(filename, text, options.dataUrlMaxChars);
    if (dataResult.attempted) {
      if (dataResult.success) {
        return dataResult;
      }
      lastResult = dataResult;
    }

    return lastResult || { attempted: false, success: false, method: 'none' };
  }
      return picker;
    }

    const gmResult = await saveWithGMDownload(filename, text, mime, options.revokeDelayMs);
    if (gmResult.attempted) {
      return gmResult;
    }

    const anchorResult = saveWithAnchor(filename, text, mime, options.revokeDelayMs);
    if (anchorResult.success) {
      return anchorResult;
    }

    const dataResult = saveWithDataUrl(filename, text, options.dataUrlMaxChars);
    if (dataResult.attempted) {
      return dataResult;
    }

    return { attempted: false, success: false, method: 'none' };
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
    const { url } = createBlobUrl(html, 'text/html;charset=utf-8');
    GMX.openInTab(url, { background: false });
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {
        // no-op
      }
    }, DEFAULT_OPTIONS.revokeDelayMs);
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

  function main() {
    GMX.registerMenuCommand('Export page info…', () => {
      renderDialog();
    });
  }

  try {
    main();
  } catch (err) {
    console.error(LOG_PREFIX, 'fatal error', err);
  }
})();
