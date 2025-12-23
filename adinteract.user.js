// ==UserScript==
// @name         Ad Interaction Gate Unlocker
// @namespace    https://github.com/cbkii/userscripts
// @version      2025.01.31.1200
// @description  Unlocks ad interaction gates after repeated clicks with optional auto-actions.
// @author       cbkii
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/adinteract.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/adinteract.user.js
// @homepageURL  https://github.com/cbkii/userscripts
// @supportURL   https://github.com/cbkii/userscripts/issues
// @run-at       document-start
// @noframes
// @grant        unsafeWindow
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      easylist-downloads.adblockplus.org
// @connect      raw.githubusercontent.com
// ==/UserScript==

/*
  Feature summary:
  - Unlocks ad interaction gates after repeated user clicks.
  - Can auto-trigger nearby ad elements once the first manual trigger occurs.
  - Applies optional CSS overrides and event patching to unblock UI elements.

  How it works:
  - Counts clicks per element; after the threshold, it simulates interactions
    and enables gated buttons/links.
  - Optional auto-actions run only after the first manual trigger.

  Configuration:
  - Edit the "config" object inside main() to adjust thresholds, delays,
    and which features are enabled.
*/

(function() {
    'use strict';

    const DEBUG = false;
    const LOG_PREFIX = '[ad-interaction]';

    function main() {

    const HOST = String(location.hostname || '').toLowerCase();

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

    const EXCLUSION_CONFIG = {
        autoUpdateHours: 168,
        sources: [
            {
                type: 'abp',
                url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt',
                trust: 'high'
            },
            {
                type: 'abp',
                url: 'https://easylist-downloads.adblockplus.org/exceptionrules.txt',
                trust: 'high'
            }
        ],
        localExcludes: []
    };

    const EXCLUDE_CACHE_KEY = 'adinteract.exclude.domains';
    const EXCLUDE_TS_KEY = 'adinteract.exclude.ts';

    let autoActionsEnabled = false; // Gate for auto-actions

    const gmGet = (key, defVal) => {
        try { return GM_getValue(key, defVal); } catch (_) { return defVal; }
    };

    const gmSet = (key, value) => {
        try { GM_setValue(key, value); } catch (_) {}
    };

    // Utility functions
    const log = (level, ...args) => {
        if (DEBUG || config.debugMode || config.logLevel === 'debug') {
            console[level === 'debug' ? 'log' : level](`${LOG_PREFIX}`, ...args);
        }
    };
    const showToast = (msg) => {
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2147483647;background:rgba(0,150,0,0.9);color:#fff;padding:8px 12px;border-radius:4px;font:12px Arial;pointer-events:none;opacity:1;transition:opacity 0.5s;';
        toast.textContent = msg;
        const appendToast = () => {
            if (!document.body) return;
            document.body.appendChild(toast);
        };
        if (document.body) {
            appendToast();
        } else {
            const obs = new MutationObserver(() => {
                if (document.body) {
                    obs.disconnect();
                    appendToast();
                }
            });
            obs.observe(document.documentElement, { childList: true, subtree: true });
        }
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 500); }, 2000);
    };
    const isFuzzyMatch = (str, keywords) => keywords.some(kw => new RegExp(kw, 'i').test(str || ''));
    const getNearbyElements = (el, radius) => {
        const rect = el.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const elements = [];
        document.querySelectorAll(fuzzySelectors.join(',')).forEach(elem => {
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
        const addStyle = () => {
            if (typeof GM_addStyle === 'function') {
                try {
                    GM_addStyle(css);
                    return;
                } catch (_) {}
            }
            const style = document.createElement('style');
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
        };
        if (document.head) {
            addStyle();
        } else {
            const obs = new MutationObserver(() => {
                if (document.head) {
                    obs.disconnect();
                    addStyle();
                }
            });
            obs.observe(document.documentElement, { childList: true, subtree: true });
        }
    };

    const normalizeDomain = (value) => String(value || '').trim().toLowerCase();

    const hostMatches = (domain) => {
        if (!domain) return false;
        domain = normalizeDomain(domain);
        if (!domain) return false;
        if (domain.includes(',')) {
            return domain.split(',').some(d => hostMatches(d));
        }
        if (domain.startsWith('*.')) {
            const d = domain.slice(2);
            return HOST === d || HOST.endsWith('.' + d);
        }
        return HOST === domain || HOST.endsWith('.' + domain);
    };

    const extractDomainsFromLine = (line) => {
        const out = [];
        if (!line || line.startsWith('!') || line.startsWith('[')) return out;
        const cleaned = line.replace(/^@@/, '');
        const cosmeticMatch = cleaned.split(/#[@?]?#/)[0];
        if (cosmeticMatch && cosmeticMatch !== cleaned) {
            cosmeticMatch.split(',').forEach((token) => {
                const domain = normalizeDomain(token);
                if (domain) out.push(domain);
            });
        }
        const netMatch = cleaned.match(/\|\|([a-z0-9.-]+\.[a-z]{2,})(?=[\^\/$]|$)/i);
        if (netMatch && netMatch[1]) out.push(normalizeDomain(netMatch[1]));
        const inlineMatch = cleaned.match(/(^|[^a-z0-9.-])([a-z0-9.-]+\.[a-z]{2,})(?=[\/\^$]|$)/i);
        if (inlineMatch && inlineMatch[2]) out.push(normalizeDomain(inlineMatch[2]));
        return out;
    };

    const parseAbpDomains = (text) => {
        const domains = new Set();
        String(text || '').split(/\r?\n/).forEach((line) => {
            extractDomainsFromLine(String(line || '').trim()).forEach((domain) => {
                if (domain) domains.add(domain);
            });
        });
        return Array.from(domains);
    };

    const loadCachedExclusions = () => {
        const cached = gmGet(EXCLUDE_CACHE_KEY, []);
        const list = Array.isArray(cached) ? cached : [];
        return new Set(list.map(normalizeDomain).filter(Boolean));
    };

    const saveExclusions = (domains) => {
        gmSet(EXCLUDE_CACHE_KEY, Array.from(domains));
        gmSet(EXCLUDE_TS_KEY, Date.now());
    };

    const shouldRefreshExclusions = () => {
        const lastTs = gmGet(EXCLUDE_TS_KEY, 0);
        if (!lastTs) return true;
        const ageMs = Date.now() - lastTs;
        return ageMs > EXCLUSION_CONFIG.autoUpdateHours * 60 * 60 * 1000;
    };

    const fetchUrl = (url) => new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== 'function') {
            reject(new Error('GM_xmlhttpRequest unavailable'));
            return;
        }
        GM_xmlhttpRequest({
            method: 'GET',
            url,
            onload: (resp) => resolve(resp.responseText || ''),
            onerror: (err) => reject(err)
        });
    });

    const refreshExclusions = async () => {
        const domains = new Set(EXCLUSION_CONFIG.localExcludes.map(normalizeDomain).filter(Boolean));
        for (const source of EXCLUSION_CONFIG.sources) {
            try {
                const text = await fetchUrl(source.url);
                parseAbpDomains(text).forEach((domain) => domains.add(domain));
            } catch (err) {
                log('warn', 'Failed to fetch exclusion source:', source.url, err);
            }
        }
        if (domains.size) {
            saveExclusions(domains);
        }
        return domains;
    };

    const isExcludedHost = (domains) => {
        for (const domain of domains) {
            if (hostMatches(domain)) return true;
        }
        return false;
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

    const bootstrap = async () => {
        const cached = loadCachedExclusions();
        if (cached.size && isExcludedHost(cached)) {
            log('info', 'Skipped on excluded host:', HOST);
            return;
        }

        if (shouldRefreshExclusions()) {
            const fresh = await refreshExclusions();
            if (fresh.size && isExcludedHost(fresh)) {
                log('info', 'Excluded host detected after refresh:', HOST);
                return;
            }
        }

        init();
    };

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Refresh ad-interaction exclusion list', () => {
            refreshExclusions().then(() => {
                showToast('Exclusion list refreshed');
            });
        });
    }

    bootstrap();
    }

    try {
        main();
    } catch (err) {
        console.error(LOG_PREFIX, 'fatal error', err);
    }
})();
