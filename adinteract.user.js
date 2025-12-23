// ==UserScript==
// @name         Ad Interaction Gate Unlocker
// @namespace    https://example.com/universal-ad-interaction-bypass-proximity
// @version      2025.2.2
// @description  Bypasses ad interaction gates and locks via user clicks (3+ times, multiple triggers allowed). Intelligently finds nearby ad-containing elements if clicked area is blocked. Gated auto-actions (scans, timers) run only after first trigger. Expanded from GreasyFork, Reddit, GitHub.
// @author       cbkii
// @grant        unsafeWindow
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // Configuration
    const config = {
        debugMode: false,
        enableAutoSpoof: true, // Enabled but gated after user trigger
        enableTimerSpoof: true, // Gated
        enableCSSOverrides: true,
        enableLinkSpoofing: true,
        enableEventPatching: true,
        enableSemiAuto: true, // Primary: 3+ clicks, multiple triggers
        fuzzyMatchThreshold: 3,
        proximityRadius: 200, // Pixels to search nearby elements
        timerDelay: 3000, // After trigger
        logLevel: 'info'
    };

    let autoActionsEnabled = false; // Gate for auto-actions

    // Utility functions
    const log = (level, ...args) => {
        if (config.debugMode || config.logLevel === 'debug') {
            console[level === 'debug' ? 'log' : level](`[Ad Gate Bypass]`, ...args);
        }
    };
    const showToast = (msg) => {
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;background:rgba(0,150,0,0.9);color:#fff;padding:8px 12px;border-radius:4px;font:12px Arial;pointer-events:none;opacity:1;transition:opacity 0.5s;';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 500); }, 2000);
    };
    const isFuzzyMatch = (str, keywords) => keywords.some(kw => new RegExp(kw, 'i').test(str || ''));
    const getNearbyElements = (el, radius) => {
        const rect = el.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const elements = [];
        document.querySelectorAll('*').forEach(elem => {
            if (elem === el) return;
            const eRect = elem.getBoundingClientRect();
            const eCenterX = eRect.left + eRect.width / 2;
            const eCenterY = eRect.top + eRect.height / 2;
            const distance = Math.sqrt((centerX - eCenterX) ** 2 + (centerY - eCenterY) ** 2);
            if (distance <= radius && isFuzzyMatch(elem.className || elem.id, ['ad', 'click', 'gate', 'banner', 'unlock', 'overlay', 'wall'])) {
                elements.push({ elem, distance });
            }
        });
        return elements.sort((a, b) => a.distance - b.distance); // Closest first
    };

    // Expanded selectors and flags
    const fuzzySelectors = [
        '[class*="ad" i]', '[id*="ad" i]', '[class*="click" i]', '[id*="click" i]',
        '[class*="gate" i]', '[id*="gate" i]', '[class*="banner" i]', '[id*="banner" i]',
        '[class*="unlock" i]', '[id*="unlock" i]', '[class*="proceed" i]', '[id*="proceed" i]',
        '[class*="engage" i]', '[id*="engage" i]', 'img[src*="ad" i]', 'a[href*="ad" i]',
        '[class*="wall" i]', '[id*="wall" i]', '[class*="overlay" i]', '[id*="overlay" i]',
        '[class*="modal" i]', '[id*="modal" i]', '[class*="popup" i]', '[id*="popup" i]',
        '[class*="advertisement" i]', '[id*="advertisement" i]', '.pro_btn', '#bottomButton'
    ];
    const interactionFlags = [
        'adClicked', 'interactionCompleted', 'adEngaged', 'gateUnlocked', 'clickVerified',
        'adInteractionDone', 'proceedEnabled', 'hasInteracted', 'adGatePassed', 'userInteracted',
        'adShown', 'gateBypassed', 'clickToProceedDone'
    ];

    // Spoof interaction
    const spoofInteraction = (el) => {
        log('info', 'Spoofing:', el);
        // Simulate click
        try {
            const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
            el.dispatchEvent(clickEvent);
        } catch (e) {
            const evt = document.createEvent('MouseEvents');
            evt.initEvent('click', true, true);
            el.dispatchEvent(evt);
        }
        // Patch flags
        interactionFlags.forEach(flag => {
            if (typeof window[flag] !== 'undefined') window[flag] = true;
            if (window.unsafeWindow && typeof window.unsafeWindow[flag] !== 'undefined') window.unsafeWindow[flag] = true;
        });
        // Enable content
        const lockedSels = ['button:disabled', 'a:disabled', '[class*="disabled" i]', '.pro_btn:not(.enabled)', '#bottomButton:not(.enabled)'];
        lockedSels.forEach(sel => {
            document.querySelectorAll(sel).forEach(btn => {
                btn.disabled = false;
                btn.classList.remove('disabled');
                btn.classList.add('enabled');
                btn.style.pointerEvents = 'auto';
                btn.style.opacity = '1';
            });
        });
        // Link spoofing
        if (config.enableLinkSpoofing) {
            document.querySelectorAll('a[href*="gate" i], a[href*="ad" i]').forEach(link => {
                link.style.pointerEvents = 'auto';
                link.removeAttribute('disabled');
            });
        }
        showToast('Unlocked!');
    };

    // CSS overrides
    const injectCSS = () => {
        if (!config.enableCSSOverrides) return;
        const css = `
            ${fuzzySelectors.join(', ')} { pointer-events: auto !important; }
            button:disabled, a:disabled { pointer-events: auto !important; opacity: 1 !important; }
            [class*="overlay" i], [id*="overlay" i] { display: none !important; }
            [class*="wall" i], [id*="wall" i] { display: none !important; }
        `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    };

    // Gated auto-actions (run after first trigger)
    const runGatedAutoActions = () => {
        if (!autoActionsEnabled) return;
        // Auto-spoof
        if (config.enableAutoSpoof) {
            fuzzySelectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => {
                    if (el.offsetWidth > 0 && el.offsetHeight > 0) spoofInteraction(el);
                });
            });
        }
        // Timer spoof
        if (config.enableTimerSpoof) {
            setTimeout(() => {
                fuzzySelectors.forEach(sel => {
                    document.querySelectorAll(sel).forEach(el => spoofInteraction(el));
                });
            }, config.timerDelay);
        }
    };

    // Primary trigger: Click tracking with proximity and multiple triggers
    const clickTracker = new Map();
    const handleManualClick = (event) => {
        if (!config.enableSemiAuto) return;
        const el = event.target;
        const count = (clickTracker.get(el) || 0) + 1;
        clickTracker.set(el, count);
        if (count >= config.fuzzyMatchThreshold) {
            // Enable gated auto-actions on first trigger
            if (!autoActionsEnabled) {
                autoActionsEnabled = true;
                runGatedAutoActions();
                log('info', 'Gated auto-actions enabled.');
            }
            // Spoof clicked element and nearby
            spoofInteraction(el);
            const nearby = getNearbyElements(el, config.proximityRadius);
            nearby.slice(0, 3).forEach(({ elem }) => spoofInteraction(elem)); // Top 3 closest
            clickTracker.delete(el);
        }
    };

    // Event patching
    const patchEvents = () => {
        if (!config.enableEventPatching) return;
        const origAdd = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
            if (type === 'click' && fuzzySelectors.some(sel => this.matches(sel))) {
                log('debug', 'Patched click listener on:', this);
            }
            return origAdd.call(this, type, listener, options);
        };
    };

    // Initialize
    const init = () => {
        log('info', 'Initializing Proximity + Multi-Trigger + Gated Auto Bypass...');
        injectCSS();
        patchEvents();
        document.addEventListener('click', handleManualClick, true);
        log('info', 'Ready. Click elements 3+ times (multiple triggers allowed) to unlock and enable gated auto-actions.');
    };

    init();
})();
