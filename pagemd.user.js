// ==UserScript==
// @name         Easy Web Page to Markdown
// @namespace    https://github.com/cbkii/userscripts
// @version      2025.12.24.0620
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
// @grant        GM_setClipboard
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
  - The floating button is idempotent; remove or restyle it by editing BUTTON_STYLES below.
*/

(() => {
  'use strict';

  const DEBUG = false;
  const LOG_PREFIX = '[pagemd]';
  const BUTTON_ID = `pagemd-convert-button-${Math.random().toString(36).slice(2, 7)}`;
  const BUTTON_TEXT = 'Convert Page to Markdown';
  const DEFAULT_FILENAME = 'page.md';
  const POST_IDLE_DELAY_MS = 350;

  /**
   * Lightweight logger with optional DEBUG gating.
   */
  const log = (...args) => {
    if (DEBUG) {
      console.log(LOG_PREFIX, ...args);
    }
  };

  const warn = (...args) => console.warn(LOG_PREFIX, ...args);
  const error = (...args) => console.error(LOG_PREFIX, ...args);

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
      warn('Readability extraction failed', err);
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

  const triggerDownload = (markdown, filename) => {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || DEFAULT_FILENAME;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    requestAnimationFrame(() => {
      URL.revokeObjectURL(url);
      anchor.remove();
    });
  };

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
    try {
      await wait(POST_IDLE_DELAY_MS);
      const { node, title } = extractMainContent({ aggressiveClutter: options.aggressiveClutter });
      const markdown = buildMarkdownDocument(node, title);
      const filename = sanitizeFilename(title || document.title || DEFAULT_FILENAME);
      triggerDownload(markdown, filename);
      try {
        if (typeof GM_setClipboard === 'function') {
          GM_setClipboard(markdown, { type: 'text', mimetype: 'text/plain' });
        }
      } catch (clipErr) {
        warn('Clipboard copy failed', clipErr);
      }
      notify(`Markdown saved${markdown.length ? ` (${markdown.length} chars)` : ''}`);
      log('Conversion complete', { filename, length: markdown.length });
    } catch (err) {
      error('Conversion failed', err);
      notify('Convert Page to Markdown failed. See console for details.');
    }
  };

  const injectButton = () => {
    if (document.getElementById(BUTTON_ID)) return;
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = BUTTON_TEXT;
    button.setAttribute('aria-label', BUTTON_TEXT);
    button.setAttribute('title', BUTTON_TEXT);
    button.addEventListener('click', () => handleConvert({ aggressiveClutter: true }), { passive: true });
    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      handleConvert({ aggressiveClutter: false });
    });
    document.body.appendChild(button);
  };

  const BUTTON_STYLES = `
    #${BUTTON_ID} {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 2147483647;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 14px;
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      box-shadow: 0 8px 18px rgba(0,0,0,0.2);
      cursor: pointer;
    }
    #${BUTTON_ID}:active { transform: translateY(1px); }
    #${BUTTON_ID}:hover { background: #1d4ed8; }
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

  const main = () => {
    GM_addStyle(BUTTON_STYLES);
    injectButton();
    GM_registerMenuCommand(BUTTON_TEXT, () => handleConvert({ aggressiveClutter: true }));
    GM_registerMenuCommand(`${BUTTON_TEXT} (no cleanup)`, () => handleConvert({ aggressiveClutter: false }));
    log('Userscript ready');
  };

  try {
    main();
  } catch (err) {
    error('Initialization failed', err);
  }
})();
