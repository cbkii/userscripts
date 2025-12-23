// ==UserScript==
// @name         ChatGPT Exporter for Android (md + txt)
// @namespace    https://github.com/cbkii/userscripts
// @version      2025.01.31.1200
// @description  Exports ChatGPT conversations to Markdown or plain text with on-page buttons.
// @author       cbcoz
// @match        *://chat.openai.com/*
// @match        *://chatgpt.com/*
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/chatgptmd.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/chatgptmd.user.js
// @homepageURL  https://github.com/cbkii/userscripts
// @supportURL   https://github.com/cbkii/userscripts/issues
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
  Feature summary:
  - Adds export buttons to save ChatGPT chats as Markdown or plain text.
  - Provides a quick export button and an options popup.

  How it works:
  - Waits for the input area, injects buttons, then converts message HTML
    to Markdown before downloading via a data URI.

  Configuration:
  - No user settings; behavior is controlled by the on-page buttons.
*/

(function () {
    'use strict';

    const DEBUG = false;
    const LOG_PREFIX = '[chatgpt-exporter]';

    function main() {

    // ✅ Minimal Turndown-like HTML → Markdown
    class TurndownService {
        constructor() {
            this.rules = [
                { filter: ['strong', 'b'], replacement: c => `**${c}**` },
                { filter: ['em', 'i'], replacement: c => `*${c}*` },
                { filter: 'code', replacement: c => `\`${c}\`` },
                { filter: 'pre', replacement: c => `\n\`\`\`\n${c}\n\`\`\`\n` },
                { filter: 'a', replacement: (c, n) => `[${c}](${n.href})` },
                { filter: 'img', replacement: (c, n) => n.src ? `![${n.alt || ''}](${n.src})` : '' },
                { filter: 'br', replacement: () => '\n' },
                { filter: ['h1','h2','h3','h4'], replacement: (c, n) => `${'#'.repeat(parseInt(n.tagName[1]))} ${c}\n` },
                { filter: 'p', replacement: c => `${c}\n` },
                { filter: 'li', replacement: c => {
                    const trimmed = c.trim();
                    return trimmed ? `- ${trimmed}\n` : '';
                }},
                { filter: 'ul', replacement: c => `\n${c}\n` },
                { filter: 'ol', replacement: content => {
                    return '\n' + content
                        .split('\n')
                        .filter(Boolean)
                        .map((line, i) => `${i + 1}. ${line.replace(/^[-*]\s/, '')}`)
                        .join('\n') + '\n';
                }},
                { filter: 'blockquote', replacement: c => `> ${c}\n` }
            ];
        }

        turndown(html) {
            const el = document.createElement('div');
            el.innerHTML = html;

            const recurse = node => {
                if (node.nodeType === 3) return node.nodeValue;
                if (node.nodeType !== 1) return '';

                const rule = this.rules.find(r =>
                    typeof r.filter === 'string' ? r.filter === node.tagName.toLowerCase() :
                    Array.isArray(r.filter) ? r.filter.includes(node.tagName.toLowerCase()) :
                    r.filter(node)
                );

                const content = [...node.childNodes].map(recurse).join('');
                return rule ? rule.replacement(content, node) : content;
            };

            return recurse(el).replace(/\n{3,}/g, '\n\n').trim();
        }
    }

    const turndown = new TurndownService();

    const findInputWrapper = () => document.querySelector("form")?.parentElement || null;

    let ensureScheduled = false;
    const scheduleEnsureButtons = () => {
        if (ensureScheduled) return;
        ensureScheduled = true;
        requestAnimationFrame(() => {
            ensureScheduled = false;
            ensureButtons();
        });
    };

    const ensureButtons = () => {
        if (document.querySelector("#exporter-buttons")) return;
        const inputWrapper = findInputWrapper();
        if (inputWrapper) {
            injectButtons(inputWrapper);
        }
    };

    const observeUiChanges = () => {
        const observer = new MutationObserver(scheduleEnsureButtons);
        observer.observe(document.documentElement, { childList: true, subtree: true });
    };

    const wrapHistory = (method) => {
        const original = history[method];
        if (!original) return;
        history[method] = function (...args) {
            const result = original.apply(this, args);
            scheduleEnsureButtons();
            return result;
        };
    };

    wrapHistory('pushState');
    wrapHistory('replaceState');
    window.addEventListener('popstate', scheduleEnsureButtons);
    observeUiChanges();
    scheduleEnsureButtons();

    // 📦 Inject export buttons
    function injectButtons(container) {
        if (!container) {
            console.warn("⚠️ Input container not found. Injecting export buttons at top of page.");
            container = document.body;
        }

        const wrapper = document.createElement("div");
        wrapper.id = "exporter-buttons";
        wrapper.style.cssText = "margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-start;z-index:9999;background:#f1f1f1;padding:8px;border-bottom:1px solid #ccc;";

        const quickBtn = document.createElement("button");
        quickBtn.innerText = "⬇️ Quick Export (.md)";
        quickBtn.style.cssText = btnStyle();
        quickBtn.onclick = () => exportChat("md");

        const moreBtn = document.createElement("button");
        moreBtn.innerText = "⚙️ More Options";
        moreBtn.style.cssText = btnStyle();
        moreBtn.onclick = showOptionsDialog;

        wrapper.appendChild(quickBtn);
        wrapper.appendChild(moreBtn);

        if (container === document.body) {
            container.insertBefore(wrapper, container.firstChild);
        } else {
            container.appendChild(wrapper);
        }
    }

    // 🎨 Button style
    function btnStyle() {
        return `
            padding: 8px 12px;
            font-size: 14px;
            border-radius: 6px;
            border: none;
            background: #10a37f;
            color: white;
            cursor: pointer;
            font-weight: bold;
        `;
    }

    // 📋 Show export popup
    function showOptionsDialog() {
        if (document.getElementById("export-popup")) return;

        const popup = document.createElement("div");
        popup.id = "export-popup";
        popup.style.cssText = `
            position: fixed;
            bottom: 90px;
            left: 10%;
            right: 10%;
            background: #fff;
            border: 2px solid #10a37f;
            border-radius: 10px;
            padding: 15px;
            z-index: 9999;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            font-size: 16px;
            text-align: center;
        `;

        const title = document.createElement("div");
        title.textContent = "📤 Export Chat As";
        title.style.cssText = "margin-bottom: 12px; font-weight: bold;";

        const mdBtn = document.createElement("button");
        mdBtn.textContent = "📄 Markdown (.md)";
        mdBtn.style.cssText = btnStyle();
        mdBtn.addEventListener('click', () => exportChat("md"));

        const txtBtn = document.createElement("button");
        txtBtn.textContent = "📝 Plain Text (.txt)";
        txtBtn.style.cssText = `${btnStyle()} margin-top:8px;`;
        txtBtn.addEventListener('click', () => exportChat("txt"));

        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "❌ Cancel";
        cancelBtn.style.cssText = `${btnStyle()} background:#ccc; color:#000; margin-top:12px;`;
        cancelBtn.addEventListener('click', () => popup.remove());

        popup.appendChild(title);
        popup.appendChild(mdBtn);
        popup.appendChild(txtBtn);
        popup.appendChild(cancelBtn);

        document.body.appendChild(popup);
    }

    // 🧠 Export chat content
    function exportChat(format) {
        const messages = [...document.querySelectorAll(".text-base")];
        if (!messages.length) {
            alert("❗ No chat messages found!");
            return;
        }

        const lines = [];

        messages.forEach(msg => {
            const roleEl = msg.querySelector(".whitespace-nowrap");
            const role = roleEl?.innerText?.trim().toLowerCase() || "";
            const speaker = role.includes("you") ? "**User:**" : "**ChatGPT:**";

            const html = msg.querySelector(".markdown")?.innerHTML || msg.innerHTML;
            let markdown = turndown.turndown(html);

            // Final cleanup for formatting
            markdown = markdown
              .replace(/\n{3,}/g, '\n\n')
              .replace(/(\n\s*\n)+(?=- )/g, '\n')
              .replace(/(- .+)\n\n(?=- )/g, '$1\n')
              .replace(/([^\n])\n(#+ )/g, '$1\n\n$2')
              .replace(/(#+ .+)\n{2,}/g, '$1\n')
              .replace(/^\s+|\s+$/g, '');

            lines.push(`${speaker}\n${markdown}\n`);
        });

        let output = lines.join("\n---\n\n");
        if (format === "txt") {
            output = output.replace(/\*\*/g, '');
        }

        const ext = format === "md" ? "md" : "txt";
        const mimeType = format === "md" ? "text/markdown" : "text/plain";
        const filename = `chatgpt-export-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;

        mobileDownload(output, filename, mimeType);

        const popup = document.getElementById("export-popup");
        if (popup) popup.remove();
    }

    // 💾 Mobile-friendly base64 downloader
    function mobileDownload(content, filename, mimeType = "text/plain") {
        try {
            const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = blobUrl;
            link.download = filename;
            link.style.cssText = "position:absolute;left:-9999px;top:-9999px;opacity:0;";
            document.body.appendChild(link);

            const clickEvent = new MouseEvent("click", {
                view: window,
                bubbles: true,
                cancelable: true
            });
            link.dispatchEvent(clickEvent);

            setTimeout(() => {
                link.remove();
                try { URL.revokeObjectURL(blobUrl); } catch (_) {}
            }, 500);
            return true;
        } catch (err) {
            try {
                const base64Content = btoa(unescape(encodeURIComponent(content)));
                const dataUri = `data:${mimeType};base64,${base64Content}`;
                const link = document.createElement("a");
                link.href = dataUri;
                link.download = filename;
                link.style.cssText = "position:absolute;left:-9999px;top:-9999px;opacity:0;";
                document.body.appendChild(link);

                const clickEvent = new MouseEvent("click", {
                    view: window,
                    bubbles: true,
                    cancelable: true
                });
                link.dispatchEvent(clickEvent);
                setTimeout(() => link.remove(), 500);
                return true;
            } catch (fallbackErr) {
                console.error("Download failed:", fallbackErr);
                alert("❗ Download failed. Try copying manually.");
                return false;
            }
        }
    }

    }

    try {
        main();
    } catch (err) {
        console.error(LOG_PREFIX, 'fatal error', err);
    }
})();
