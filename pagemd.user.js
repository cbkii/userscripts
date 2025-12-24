// ==UserScript==
// @name         Easy Web Page to Markdown
// @namespace    https://github.com/cbkii/userscripts
// @version      2025.12.24.0041
// @description  Converts a selected page element to Markdown with preview/export.
// @author       cbkii (fork of shiquda)
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/pagemd.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/pagemd.user.js
// @homepageURL  https://github.com/cbkii/userscripts
// @supportURL   https://github.com/cbkii/userscripts/issues
// @run-at       document-end
// @noframes
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @require      https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js
// @require      https://ajax.googleapis.com/ajax/libs/jqueryui/1.13.2/jquery-ui.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/turndown/7.1.2/turndown.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/turndown-plugin-gfm/1.0.2/turndown-plugin-gfm.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.0/marked.min.js
// @license      AGPL-3.0
// ==/UserScript==

/*
  Feature summary:
  - Selects any element on the page and converts it to Markdown.
  - Shows a live preview with copy/download options and optional Obsidian export.

  How it works:
  - Uses tap-friendly controls to pick an element, then converts HTML to Markdown
    and renders a preview modal for copy or download.

  Configuration:
  - Edit obsidianUserConfig to set vault paths. Activate via the userscript menu.
*/


(function () {
    'use strict';

    const DEBUG = false;
    const LOG_PREFIX = '[pmd]';
    const LOG_STORAGE_KEY = 'userscript.logs.pagemd';
    const LOG_MAX_ENTRIES = 200;

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
      const writePromise = writeEntry(level, msg, sanitized);
      if (writePromise && typeof writePromise.catch === 'function') {
        writePromise.catch(() => {});
      }
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

    function main() {

    // Obsidian
    const obsidianUserConfig = {
        /* Example:
            "my note": [
                "Inbox/Web/",
                "Collection/Web/Reading/"
            ]
        */
    }

    const guide = `
- Tap an element to highlight it
- Use the on-screen toolbar to move the selection:
    - Parent, Child, Prev, Next
- Tap "Use selection" to export, or "Cancel" to exit
    `

    // Global state
    var isSelecting = false;
    var selectedElement = null;
    var selectionToolbar = null;
    let obsidianConfig;
    // Initialize Obsidian configuration
    let storedObsidianConfig = GM_getValue('obsidianConfig');
    if (Object.keys(obsidianUserConfig).length !== 0) {
        GM_setValue('obsidianConfig', JSON.stringify(obsidianUserConfig));
        obsidianConfig = obsidianUserConfig;
    } else if (storedObsidianConfig) {
        obsidianConfig = JSON.parse(storedObsidianConfig);
    }



    // HTML to Markdown
    function convertToMarkdown(element) {
        var html = element.outerHTML;
        let turndownMd = turndownService.turndown(html);
        turndownMd = turndownMd.replaceAll('[\n\n]', '[]'); // Temporary workaround for nested <a> elements
        return turndownMd;
    }


    // Preview
    function showMarkdownModal(markdown) {
        var $modal = $(`
                    <div class="h2m-modal-overlay">
                        <div class="h2m-modal">
                            <textarea>${markdown}</textarea>
                            <div class="h2m-preview">${marked.parse(markdown)}</div>
                            <div class="h2m-buttons">
                                <button class="h2m-copy">Copy to clipboard</button>
                                <button class="h2m-download">Download as MD</button>
                                <select class="h2m-obsidian-select">Send to Obsidian</select>
                            </div>
                            <button class="h2m-close">X</button>
                        </div>
                    </div>
                `);


        $modal.find('.h2m-obsidian-select').append($('<option>').val('').text('Send to Obsidian'));
        for (const vault in obsidianConfig) {
            for (const path of obsidianConfig[vault]) {
                // Insert elements
                const $option = $('<option>')
                    .val(`obsidian://advanced-uri?vault=${vault}&filepath=${path}`)
                    .text(`${vault}: ${path}`);
                $modal.find('.h2m-obsidian-select').append($option);
            }
        }

        $modal.find('textarea').on('input', function () {
            // console.log("Input event triggered");
            var markdown = $(this).val();
            var html = marked.parse(markdown);
            // console.log("Markdown:", markdown);
            // console.log("HTML:", html);
            $modal.find('.h2m-preview').html(html);
        });

        $modal.on('keydown', function (e) {
            if (e.key === 'Escape') {
                $modal.remove();
            }
        });


        $modal.find('.h2m-copy').on('click', function () { // Copy to clipboard
            GM_setClipboard($modal.find('textarea').val());
            $modal.find('.h2m-copy').text('Copied!');
            setTimeout(() => {
                $modal.find('.h2m-copy').text('Copy to clipboard');
            }, 1000);
        });

        $modal.find('.h2m-download').on('click', function () { // Download
            var markdown = $modal.find('textarea').val();
            var blob = new Blob([markdown], { type: 'text/markdown' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            // Page title + timestamp
            a.download = `${document.title}-${new Date().toISOString().replace(/:/g, '-')}.md`;
            a.click();
        });

        $modal.find('.h2m-obsidian-select').on('change', function () { // Send to Obsidian
            const val = $(this).val();
            if (!val) return;
            const markdown = $modal.find('textarea').val();
            GM_setClipboard(markdown);
            const title = document.title.replaceAll(/[\\/:*?"<>|]/g, '_'); // File names cannot contain: * " \\ / < > : | ?
            const url = `${val}${title}.md&clipboard=true`;
            window.open(url);
        });

        $modal.find('.h2m-close').on('click', function () { // Close button
            $modal.remove();
        });

        // Sync scrolling
        // Get both elements
        var $textarea = $modal.find('textarea');
        var $preview = $modal.find('.h2m-preview');
        var isScrolling = false;

        // When the textarea scrolls, sync the preview position
        $textarea.on('scroll', function () {
            if (isScrolling) {
                isScrolling = false;
                return;
            }
            var scrollPercentage = this.scrollTop / (this.scrollHeight - this.offsetHeight);
            $preview[0].scrollTop = scrollPercentage * ($preview[0].scrollHeight - $preview[0].offsetHeight);
            isScrolling = true;
        });

        // When the preview scrolls, sync the textarea position
        $preview.on('scroll', function () {
            if (isScrolling) {
                isScrolling = false;
                return;
            }
            var scrollPercentage = this.scrollTop / (this.scrollHeight - this.offsetHeight);
            $textarea[0].scrollTop = scrollPercentage * ($textarea[0].scrollHeight - $textarea[0].offsetHeight);
            isScrolling = true;
        });

        $(document).on('keydown', function (e) {
            if (e.key === 'Escape' && $('.h2m-modal-overlay').length > 0) {
                $('.h2m-modal-overlay').remove();
            }
        });

        $('body').append($modal);
    }

    // Start selection
    function updateSelection(element) {
        if (!element) return;
        if (selectedElement) {
            $(selectedElement).removeClass('h2m-selection-box');
        }
        selectedElement = element;
        $(selectedElement).addClass('h2m-selection-box');
    }

    function normalizeSelection(element) {
        if (!element) return null;
        if (element.tagName === 'HTML') {
            return document.body || element;
        }
        if (element.tagName === 'BODY') {
            return element.firstElementChild || element;
        }
        return element;
    }

    function moveSelection(direction) {
        if (!selectedElement) return;
        let next = selectedElement;
        switch (direction) {
            case 'parent':
                next = selectedElement.parentElement || selectedElement;
                break;
            case 'child':
                next = selectedElement.firstElementChild || selectedElement;
                break;
            case 'prev': {
                let prev = selectedElement.previousElementSibling;
                while (!prev && selectedElement.parentElement) {
                    selectedElement = selectedElement.parentElement;
                    prev = selectedElement.previousElementSibling;
                }
                next = prev || selectedElement;
                break;
            }
            case 'next': {
                let nextEl = selectedElement.nextElementSibling;
                while (!nextEl && selectedElement.parentElement) {
                    selectedElement = selectedElement.parentElement;
                    nextEl = selectedElement.nextElementSibling;
                }
                next = nextEl || selectedElement;
                break;
            }
            default:
                break;
        }
        updateSelection(normalizeSelection(next));
    }

    function buildToolbar() {
        if (selectionToolbar) return;
        selectionToolbar = $(`
            <div class="h2m-toolbar">
                <button class="h2m-btn-parent">Parent</button>
                <button class="h2m-btn-child">Child</button>
                <button class="h2m-btn-prev">Prev</button>
                <button class="h2m-btn-next">Next</button>
                <button class="h2m-btn-use">Use selection</button>
                <button class="h2m-btn-cancel">Cancel</button>
            </div>
        `);

        selectionToolbar.find('.h2m-btn-parent').on('click', () => moveSelection('parent'));
        selectionToolbar.find('.h2m-btn-child').on('click', () => moveSelection('child'));
        selectionToolbar.find('.h2m-btn-prev').on('click', () => moveSelection('prev'));
        selectionToolbar.find('.h2m-btn-next').on('click', () => moveSelection('next'));
        selectionToolbar.find('.h2m-btn-use').on('click', () => {
            if (!selectedElement) return;
            const markdown = convertToMarkdown(selectedElement);
            showMarkdownModal(markdown);
            endSelecting();
        });
        selectionToolbar.find('.h2m-btn-cancel').on('click', () => endSelecting());

        $('body').append(selectionToolbar);
    }

    function startSelecting() {
        $('body').addClass('h2m-no-scroll'); // Prevent page scrolling
        isSelecting = true;
        const initial = normalizeSelection(document.activeElement || document.body);
        updateSelection(initial);
        buildToolbar();
        // Instructions
        tip(marked.parse(guide));
    }

    // End selection
    function endSelecting() {
        isSelecting = false;
        $('.h2m-selection-box').removeClass('h2m-selection-box');
        $('body').removeClass('h2m-no-scroll');
        $('.h2m-tip').remove();
        if (selectionToolbar) {
            selectionToolbar.remove();
            selectionToolbar = null;
        }
    }

    function tip(message, timeout = null) {
        var $tipElement = $('<div>')
            .addClass('h2m-tip')
            .html(message)
            .appendTo('body')
            .hide()
            .fadeIn(200);
        if (timeout === null) {
            return;
        }
        setTimeout(function () {
            $tipElement.fadeOut(200, function () {
                $tipElement.remove();
            });
        }, timeout);
    }

    // Turndown configuration
    var turndownPluginGfm = TurndownPluginGfmService;
    var turndownService = new TurndownService({ codeBlockStyle: 'fenced' });

    turndownPluginGfm.gfm(turndownService); // Enable all plugins
    // turndownService.addRule('strikethrough', {
    //     filter: ['del', 's', 'strike'],
    //     replacement: function (content) {
    //         return '~' + content + '~'
    //     }
    // });

    // turndownService.addRule('latex', {
    //     filter: ['mjx-container'],
    //     replacement: function (content, node) {
    //         const text = node.querySelector('img')?.title;
    //         const isInline = !node.getAttribute('display');
    //         if (text) {
    //             if (isInline) {
    //                 return '$' + text + '$'
    //             }
    //             else {
    //                 return '$$' + text + '$$'
    //             }
    //         }
    //         return '';
    //     }
    // });




    // Add CSS styles
    GM_addStyle(`
        .h2m-selection-box {
            border: 2px dashed #f00;
            background-color: rgba(255, 0, 0, 0.2);
        }
        .h2m-no-scroll {
            overflow: hidden;
            z-index: 9997;
        }
        .h2m-modal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 80%;
            height: 80%;
            background: white;
            border-radius: 10px;
            display: flex;
            flex-direction: row;
            z-index: 9999;
        }
        .h2m-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9998;
        }
        .h2m-modal textarea,
        .h2m-modal .h2m-preview {
            width: 50%;
            height: 100%;
            padding: 20px;
            box-sizing: border-box;
            overflow-y: auto;
        }
        .h2m-modal .h2m-buttons {
            position: absolute;
            bottom: 10px;
            right: 10px;
        }
        .h2m-modal .h2m-buttons button,
        .h2m-modal .h2m-obsidian-select {
            margin-left: 10px;
            background-color: #4CAF50; /* Green */
            border: none;
            color: white;
            padding: 13px 16px;
            border-radius: 10px;
            text-align: center;
            text-decoration: none;
            display: inline-block;
            font-size: 16px;
            transition-duration: 0.4s;
            cursor: pointer;
        }
        .h2m-modal .h2m-buttons button:hover,
        .h2m-modal .h2m-obsidian-select:hover {
            background-color: #45a049;
        }
        .h2m-modal .h2m-close {
            position: absolute;
            top: 10px;
            right: 10px;
            cursor: pointer;
            width: 25px;
            height: 25px;
            background-color: #f44336;
            color: white;
            font-size: 16px;
            border-radius: 50%;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .h2m-tip {
            position: fixed;
            top: 22%;
            left: 82%;
            transform: translate(-50%, -50%);
            background-color: white;
            border: 1px solid black;
            padding: 8px;
            z-index: 9999;
            border-radius: 10px;
            box-shadow: 5px 5px 10px rgba(0, 0, 0, 0.5);
            background-color: rgba(255, 255, 255, 0.7);
        }
        .h2m-toolbar {
            position: fixed;
            bottom: 12px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 9999;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            background: rgba(0, 0, 0, 0.75);
            padding: 10px 12px;
            border-radius: 12px;
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
        }
        .h2m-toolbar button {
            border: none;
            border-radius: 10px;
            padding: 10px 12px;
            font-size: 14px;
            color: #fff;
            background: #4CAF50;
            cursor: pointer;
        }
        .h2m-toolbar .h2m-btn-cancel {
            background: #f44336;
        }
        .h2m-toolbar .h2m-btn-use {
            background: #2196f3;
        }
    `);

    // Register triggers
    GM_registerMenuCommand('Convert to Markdown', function () {
        startSelecting()
    });


    const handleSelectEvent = function (e) {
        if (!isSelecting) return;
        if ($(e.target).closest('.h2m-toolbar, .h2m-modal, .h2m-modal-overlay, .h2m-tip').length) return;
        e.preventDefault();
        updateSelection(normalizeSelection(e.target));
    };

    $(document)
        .on('touchstart.h2m-select', handleSelectEvent)
        .on('mousedown.h2m-select', handleSelectEvent);

    }

    try {
        main();
    } catch (err) {
        log('error', 'fatal error', err);
    }
})();
