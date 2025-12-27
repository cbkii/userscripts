// ==UserScript==
// @name         Easy Web Page to Markdown
// @namespace    https://github.com/cbkii/userscripts
// @version      2025.12.27.1519
// @description  Extracts the main article content and saves it as clean Markdown with a single click.
// @author       cbkii
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/pagemd.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/pagemd.user.js
// @homepageURL  https://github.com/cbkii/userscripts
// @supportURL   https://github.com/cbkii/userscripts/issues
// @run-at       document-idle
// @noframes
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_download
// @require      https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/turndown/7.1.2/turndown.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/turndown-plugin-gfm/1.0.2/turndown-plugin-gfm.min.js
// @license      AGPL-3.0
// ==/UserScript==

/*
  Feature summary:
  - Extracts the primary article/content block, filters out nav/ads/comments, and rewrites relative URLs to absolute ones.
  - Converts the cleaned content to Markdown with GFM (tables, fenced code, strikethrough, task lists) using Turndown.
  - Provides a Tampermonkey menu item and a floating "Convert Page to Markdown" button that triggers an .md download.

  How it works:
  - Tries Mozilla Readability first for article extraction; falls back to heuristics that pick the densest main section.
  - Cleans clutter, normalizes links/images, converts HTML to Markdown, and downloads a file named after the page title.
  - Logs minimal debug info when DEBUG is true and shows user-friendly notifications for success/failure states.

  Configuration:
  - Toggle DEBUG to true to see console logs.
  - Controls live inside the shared modal panel; a fallback floating button is available when the shared UI is unavailable.
*/

(() => {
  'use strict';

  const DEBUG = false;
  const LOG_PREFIX = '[pagemd]';
  const LOG_STORAGE_KEY = 'userscript.logs.pagemd';
  const LOG_MAX_ENTRIES = 200;
  const SCRIPT_ID = 'pagemd';
  const SCRIPT_TITLE = 'Page ➜ Markdown';
  const ENABLE_KEY = `${SCRIPT_ID}.enabled`;
  const FALLBACK_BUTTON_ID = 'pagemd-convert-button';
  const FALLBACK_BUTTON_TEXT = 'Page → Markdown';
  const DEFAULT_FILENAME = 'page.md';
  const POST_IDLE_DELAY_MS = 350;

  /**
   * Structured logger compatible with userscriptlogs.user.js storage.
   */
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

  const logger = createLogger({
    prefix: LOG_PREFIX,
    storageKey: LOG_STORAGE_KEY,
    maxEntries: LOG_MAX_ENTRIES,
    debug: DEBUG,
  });
  const logInfo = (msg, meta) => logger('info', msg, meta);
  const logWarn = (msg, meta) => logger('warn', msg, meta);
  const logError = (msg, meta) => logger('error', msg, meta);
  const logDebug = (msg, meta) => logger('debug', msg, meta);

  /**
   * Turndown setup with GitHub-flavored Markdown support and a few focused rules
   * to keep code fences and alt text intact.
   */
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    bulletListMarker: '-',
    hr: '---',
  });

  // Enable GitHub-flavored Markdown extensions (tables, task lists, strikethrough).
  turndownPluginGfm.gfm(turndownService);

  // Preserve figure captions and handle pre>code blocks with language classes.
  turndownService.keep(['figure', 'figcaption']);
  turndownService.addRule('codeBlocksWithLanguage', {
    filter: (node) =>
      node.nodeName === 'PRE' &&
      node.firstElementChild &&
      node.firstElementChild.nodeName === 'CODE',
    replacement: (_content, node) => {
      const codeEl = node.firstElementChild;
      const languageMatch = (codeEl.className || '').match(/language-([\w-]+)/i);
      const language = languageMatch ? languageMatch[1] : '';
      const codeText = codeEl.textContent || '';
      return `\n\n\`\`\`${language}\n${codeText}\n\`\`\`\n\n`;
    },
  });

  turndownService.addRule('betterImages', {
    filter: 'img',
    replacement: (_content, node) => {
      const alt = node.getAttribute('alt') || '';
      const src = node.getAttribute('src') || '';
      return src ? `![${alt}](${src})` : '';
    },
  });

  // Keep table header separators tidy for GFM tables even when cells contain pipes.
  turndownService.addRule('escapePipesInTables', {
    filter: (node) =>
      (node.nodeName === 'TD' || node.nodeName === 'TH') &&
      node.closest('table'),
    replacement: (content) => content.replace(/\|/g, '\\|'),
  });

  // Ensure header separator rows exist even if stripped by the site.
  turndownService.addRule('tableHeaderSeparators', {
    filter: (node) => node.nodeName === 'THEAD',
    replacement: (_content, node) => {
      const headRow = node.querySelector('tr');
      if (!headRow) return '';
      const cells = Array.from(headRow.children).map((cell) => cell.textContent.trim() || ' ');
      const header = `| ${cells.join(' | ')} |\n`;
      const separator = `| ${cells.map(() => '---').join(' | ')} |`;
      return `\n\n${header}${separator}\n`;
    },
  });

  // Preserve inline code that may be wrapped in spans (common in docs sites).
  turndownService.addRule('inlineCodeSpans', {
    filter: (node) =>
      node.nodeName === 'SPAN' &&
      !node.closest('pre,code') &&
      node.matches('[class*=\"code\" i],[class*=\"mono\" i],[class*=\"tt\" i]'),
    replacement: (content) => `\`${content}\``,
  });

  /**
   * Helper utilities.
   */
  const sanitizeFilename = (title) => {
    if (!title) return DEFAULT_FILENAME;
    const safe = title.trim().replace(/[\s]+/g, ' ').replace(/[\\/:*?"<>|]+/g, '_');
    return safe ? `${safe}.md` : DEFAULT_FILENAME;
  };

  const toAbsoluteUrl = (url) => {
    if (!url) return url;
    try {
      return new URL(url, location.href).href;
    } catch (_) {
      return url;
    }
  };

  const removeElements = (root, selectors) => {
    selectors.forEach((selector) => {
      root.querySelectorAll(selector).forEach((node) => node.remove());
    });
  };

  const rewriteRelativeUrls = (root) => {
    root.querySelectorAll('a[href]').forEach((anchor) => {
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;
      anchor.setAttribute('href', toAbsoluteUrl(href));
    });

    const setSrc = (el, attr) => {
      const value = el.getAttribute(attr);
      if (value) el.setAttribute(attr, toAbsoluteUrl(value));
    };

    root.querySelectorAll('img[src], source[src], video[src], audio[src], iframe[src]').forEach((el) => {
      setSrc(el, 'src');
    });

    root.querySelectorAll('img[srcset], source[srcset]').forEach((el) => {
      const srcset = el.getAttribute('srcset');
      if (!srcset) return;
      const absoluteSet = srcset
        .split(',')
        .map((entry) => {
          const [urlPart, descriptor] = entry.trim().split(/\s+/);
          return [toAbsoluteUrl(urlPart), descriptor].filter(Boolean).join(' ');
        })
        .join(', ');
      el.setAttribute('srcset', absoluteSet);
    });
  };

  const stripClutter = (root, { aggressive } = { aggressive: true }) => {
    removeElements(root, [
      'script',
      'style',
      'noscript',
      'template',
      'iframe',
      'canvas',
      'svg',
      'form',
      'input',
      'button',
      'select',
      'option',
      'label',
      'textarea',
      'aside',
      'footer',
      'header',
      'nav',
      '[role="navigation"]',
      '[aria-label*="breadcrumb" i]',
      '[aria-label*="comment" i]',
      '[id*="comment" i]',
      '[class*="comment" i]',
      '[class*="breadcrumb" i]',
      '[class*="advert" i]',
      '[id*="advert" i]',
    ]);
    if (aggressive) {
      removeElements(root, [
        '[class*="share" i]',
        '[class*="signup" i]',
        '[class*="modal" i]',
        '[data-testid*="share" i]',
      ]);
    }
  };

  const pickLargestNode = (candidates) => {
    let best = null;
    let bestScore = 0;
    candidates.forEach((node) => {
      const text = (node.textContent || '').trim();
      const score = text.length;
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    });
    return best;
  };

  const extractWithReadability = () => {
    if (typeof Readability === 'undefined') return null;
    const clonedDoc = document.implementation.createHTMLDocument(document.title || '');
    const htmlClone = document.documentElement.cloneNode(true);
    clonedDoc.replaceChild(clonedDoc.importNode(htmlClone, true), clonedDoc.documentElement);
    try {
      const article = new Readability(clonedDoc, { keepClasses: false }).parse();
      if (article && article.content) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = article.content;
        stripClutter(wrapper, { aggressive: false });
        rewriteRelativeUrls(wrapper);
        return { node: wrapper, title: article.title || document.title };
      }
    } catch (err) {
      logWarn('Readability extraction failed', { error: err?.message || String(err) });
    }
    return null;
  };

  const extractWithHeuristics = ({ aggressiveClutter } = { aggressiveClutter: true }) => {
    const workingRoot = document.body.cloneNode(true);
    stripClutter(workingRoot, { aggressive: aggressiveClutter });
    const candidateSelectors = [
      'article',
      'main',
      '#main',
      '#main-content',
      '#mainContent',
      '[role="main"]',
      '.article',
      '.article__content',
      '.article__body',
      '.article__main',
      '.post',
      '.post-article',
      '.entry-content',
      '.content',
      '#content',
      '.markdown-body',
      '.documentation',
      '.doc-content',
      '.doc-main',
      '.doc-body',
      '.docs-content',
      '.docs-main',
      '.docs-body',
      '.guide-content',
      '.guide-body',
      '.guide-main',
      '.page-content',
      '.page-body',
      '.page-main',
      '.blog-post',
      '.blog-content',
      '.story-body',
      '.story-content',
      '.article-body',
      '.article-content',
      '.post-content',
      '.post-body',
      '.post__content',
      '.entry',
      '.entry-body',
      '.entry-text',
      '.reader-content',
      '.read__content',
      '.rich-text',
      '.richtext',
      '.prose',
      '[itemprop="articleBody"], [itemprop="mainEntityOfPage"]',
      '[data-article-body]',
      '[data-testid*="article" i]',
      'section',
    ];

    const candidates = candidateSelectors
      .map((selector) => Array.from(workingRoot.querySelectorAll(selector)))
      .flat();

    const best = pickLargestNode(candidates.filter(Boolean)) || workingRoot;
    const node = best.cloneNode(true);
    return { node, title: document.title };
  };

  const extractMainContent = (opts = {}) =>
    extractWithReadability() || extractWithHeuristics({ aggressiveClutter: opts.aggressiveClutter !== false });

  const buildMarkdownDocument = (htmlNode, title) => {
    const workingNode = htmlNode.cloneNode(true);
    stripClutter(workingNode, { aggressive: true });
    rewriteRelativeUrls(workingNode);
    const markdownBody = turndownService.turndown(workingNode).trim();
    const header = title ? `# ${title}\n\n` : '';
    const sourceLine = `\n\n---\nSource: ${location.href}`;
    return `${header}${markdownBody}${sourceLine}`;
  };

  const gmDownloadLegacy = typeof GM_download === 'function' ? GM_download : null;
  const gmDownloadAsync = typeof GM !== 'undefined' && GM && typeof GM.download === 'function'
    ? GM.download.bind(GM)
    : null;
  const DOWNLOAD_ANCHOR_DELAY_MS = 500;
  const BLOB_STALE_MS = 10000;
  const BLOB_REVOKE_MS = 120000;

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

  const downloadViaAnchor = (resource, filename) => {
    try {
      const url = resource.getUrl();
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename || DEFAULT_FILENAME;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(() => {
        anchor.remove();
        resource.cleanup(DOWNLOAD_ANCHOR_DELAY_MS);
      }, DOWNLOAD_ANCHOR_DELAY_MS);
      return true;
    } catch (err) {
      logError('Anchor download failed', { error: err?.message || String(err) });
      return false;
    }
  };

  const downloadViaDataUrl = (resource, filename) => {
    try {
      const blob = resource.getBlob();
      const reader = new FileReader();
      reader.onload = () => {
        const href = typeof reader.result === 'string' ? reader.result : '';
        if (!href) {
          resource.cleanup(DOWNLOAD_ANCHOR_DELAY_MS);
          return;
        }
        const anchor = document.createElement('a');
        anchor.href = href;
        anchor.download = filename || DEFAULT_FILENAME;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        setTimeout(() => {
          anchor.remove();
          resource.cleanup(DOWNLOAD_ANCHOR_DELAY_MS);
        }, DOWNLOAD_ANCHOR_DELAY_MS);
      };
      reader.onerror = () => {
        resource.cleanup(DOWNLOAD_ANCHOR_DELAY_MS);
      };
      reader.readAsDataURL(blob);
      return true;
    } catch (err) {
      logError('Data URL download failed', { error: err?.message || String(err) });
      return false;
    }
  };

  const downloadViaGM = async (resource, filename, fallback) => {
    if (!gmDownloadLegacy && !gmDownloadAsync) return false;
    const detail = {
      url: resource.getUrl(),
      name: filename,
      saveAs: true,
      onload: () => resource.cleanup(DOWNLOAD_ANCHOR_DELAY_MS),
      onerror: (err) => {
        resource.markStale();
        fallback(err);
      },
    };
    try {
      const result = gmDownloadAsync ? gmDownloadAsync(detail) : gmDownloadLegacy(detail);
      if (result && typeof result.then === 'function') {
        await result.then(() => resource.cleanup(DOWNLOAD_ANCHOR_DELAY_MS)).catch((err) => {
          resource.markStale();
          fallback(err);
        });
      } else {
        setTimeout(() => resource.cleanup(DOWNLOAD_ANCHOR_DELAY_MS), DOWNLOAD_ANCHOR_DELAY_MS);
      }
      return true;
    } catch (err) {
      resource.markStale();
      fallback(err);
      return false;
    }
  };

  const triggerDownload = async (markdown, filename) => {
    const resource = createDownloadResource(markdown, 'text/markdown;charset=utf-8');
    const safeName = filename || DEFAULT_FILENAME;
    const fallback = () => {
      if (downloadViaAnchor(resource, safeName)) return;
      downloadViaDataUrl(resource, safeName);
    };
    const gmSuccess = await downloadViaGM(resource, safeName, fallback);
    if (!gmSuccess) {
      fallback();
    }
  };

  const TOAST_STYLES = `
    #pagemd-toast {
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.85);
      color: #fff;
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 13px;
      z-index: 2147483647;
      box-shadow: 0 6px 16px rgba(0,0,0,0.25);
    }
  `;

  const gmStore = {
    async get(key, fallback) {
      try { return await GM_getValue(key, fallback); } catch (_) { return fallback; }
    },
    async set(key, value) {
      try { await GM_setValue(key, value); } catch (_) {}
    }
  };

  const sharedUi = (typeof window !== 'undefined' && window.__userscriptSharedUi)
    ? window.__userscriptSharedUi.getInstance({
      get: (key, fallback) => gmStore.get(key, fallback),
      set: (key, value) => gmStore.set(key, value)
    })
    : null;

  const state = {
    enabled: true,
    started: false,
    menuIds: []
  };

  const hasUnregister = typeof GM_unregisterMenuCommand === 'function';

  const notify = (message) => {
    const existing = document.getElementById('pagemd-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'pagemd-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  };

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const handleConvert = async (options = {}) => {
    if (!state.enabled) {
      logInfo('Conversion skipped because script is disabled');
      return;
    }
    try {
      await wait(POST_IDLE_DELAY_MS);
      const { node, title } = extractMainContent({ aggressiveClutter: options.aggressiveClutter });
      const markdown = buildMarkdownDocument(node, title);
      const filename = sanitizeFilename(title || document.title || DEFAULT_FILENAME);
      await triggerDownload(markdown, filename);
      try {
        if (typeof GM_setClipboard === 'function') {
          GM_setClipboard(markdown, { type: 'text', mimetype: 'text/plain' });
        }
      } catch (clipErr) {
        logWarn('Clipboard copy failed', { error: clipErr?.message || String(clipErr) });
      }
      notify(`Markdown saved${markdown.length ? ` (${markdown.length} chars)` : ''}`);
      logInfo('Conversion complete', { filename, length: markdown.length });
    } catch (err) {
      logError('Conversion failed', { error: err?.message || String(err) });
      notify('Convert Page to Markdown failed. See console for details.');
    }
  };

  const renderPanel = () => {
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '10px';

    const description = document.createElement('p');
    description.textContent = 'Convert the current page to Markdown. Hold for a clean extract or include raw HTML.';
    description.style.margin = '0';
    description.style.fontSize = '13px';
    description.style.lineHeight = '1.4';
    wrapper.appendChild(description);

    const buttonsRow = document.createElement('div');
    buttonsRow.style.display = 'flex';
    buttonsRow.style.gap = '8px';
    buttonsRow.style.flexWrap = 'wrap';

    const makeButton = (label, opts) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.style.padding = '8px 10px';
      btn.style.borderRadius = '8px';
      btn.style.border = '1px solid rgba(255,255,255,0.16)';
      btn.style.background = '#1f2937';
      btn.style.color = '#f8fafc';
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', () => handleConvert(opts));
      return btn;
    };

    buttonsRow.appendChild(makeButton('Convert (clean)', { aggressiveClutter: true }));
    buttonsRow.appendChild(makeButton('Convert (raw)', { aggressiveClutter: false }));
    wrapper.appendChild(buttonsRow);

    return wrapper;
  };

  const teardown = () => {
    state.started = false;
    const toast = document.getElementById('pagemd-toast');
    if (toast) toast.remove();
    const fallbackBtn = document.getElementById(FALLBACK_BUTTON_ID);
    if (fallbackBtn) fallbackBtn.remove();
  };

  const start = async () => {
    if (state.started) return;
    state.started = true;
    try { GM_addStyle(TOAST_STYLES); } catch (_) {}
    logInfo('Userscript ready');
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
        try { GM_unregisterMenuCommand(id); } catch (_) { /* no-op */ }
      });
      state.menuIds = [];
    }
    state.menuIds.push(GM_registerMenuCommand(
      `Toggle ${SCRIPT_TITLE} (${state.enabled ? 'ON' : 'OFF'})`,
      async () => { await setEnabled(!state.enabled); }
    ));
    if (state.enabled) {
      state.menuIds.push(GM_registerMenuCommand('Convert Page to Markdown', () => handleConvert({ aggressiveClutter: true })));
      state.menuIds.push(GM_registerMenuCommand('Convert (no cleanup)', () => handleConvert({ aggressiveClutter: false })));
    }
  };

  const injectFallbackButton = () => {
    if (sharedUi) return;
    if (document.getElementById(FALLBACK_BUTTON_ID)) return;
    const button = document.createElement('button');
    button.id = FALLBACK_BUTTON_ID;
    button.type = 'button';
    button.textContent = FALLBACK_BUTTON_TEXT;
    button.title = 'Tap to save cleaned Markdown; long-press for raw HTML kept';
    button.style.cssText = `
      position: fixed;
      bottom: 14px;
      right: 14px;
      z-index: 2147483647;
      background: linear-gradient(145deg, #0d0d12, #151528);
      color: #f8fafc;
      border: 1px solid #ff70c6;
      border-radius: 12px;
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 700;
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      box-shadow: 0 14px 28px rgba(0,0,0,0.48);
      cursor: pointer;
      letter-spacing: 0.01em;
    `;
    button.addEventListener('click', () => handleConvert({ aggressiveClutter: true }), { passive: true });
    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      handleConvert({ aggressiveClutter: false });
    });
    const append = () => document.body && document.body.appendChild(button);
    if (document.body) {
      append();
    } else {
      document.addEventListener('DOMContentLoaded', append, { once: true });
    }
  };

  const init = async () => {
    state.enabled = await gmStore.get(ENABLE_KEY, true);
    if (sharedUi) {
      sharedUi.registerScript({
        id: SCRIPT_ID,
        title: SCRIPT_TITLE,
        enabled: state.enabled,
        render: renderPanel,
        onToggle: (next) => setEnabled(next)
      });
    }
    if (state.enabled) {
      await start();
    }
    registerMenu();
    if (state.enabled) {
      injectFallbackButton();
    }
  };

  init().catch((err) => {
    logError('Initialization failed', { error: err?.message || String(err) });
  });
})();
