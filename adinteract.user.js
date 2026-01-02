// ==UserScript==
// @name         Ad Interaction Gate Unlocker
// @namespace    https://github.com/cbkii/userscripts
// @version      2026.01.02.0412
// @description  Unlocks ad interaction gates after repeated clicks with optional auto-actions.
// @author       cbkii
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkYxNDkzIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTMgM2w3LjA3IDE2Ljk3IDIuNTEtNy4zOSA3LjM5LTIuNTFMMyAzeiIvPjxwYXRoIGQ9Ik0xMyAxM2w2IDYiLz48L3N2Zz4=
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
// @grant        GM_unregisterMenuCommand
// @connect      easylist-downloads.adblockplus.org
// @connect      raw.githubusercontent.com
// ==/UserScript==

/*
  LOAD PRIORITY: 4 (Early Intervention)
  Should load after pageunlock.user.js if both are enabled to avoid addEventListener conflicts.
  
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

    //////////////////////////////////////////////////////////////
    // CONSTANTS & CONFIGURATION
    //////////////////////////////////////////////////////////////

    const DEBUG = false;
    const LOG_PREFIX = '[adint]';
    const LOG_STORAGE_KEY = 'userscript.logs.adinteract';
    const LOG_MAX_ENTRIES = 200;
    const logConfig = { debugMode: false, logLevel: 'info' };
    const SCRIPT_ID = 'adinteract';
    const SCRIPT_TITLE = 'Ad Interaction Unlock';
    const ENABLE_KEY = `${SCRIPT_ID}.enabled`;
    const ALWAYS_RUN_KEY = `${SCRIPT_ID}.alwaysRun`;

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
    // Deferred registration pattern for document-start scripts
    let sharedUi = null;
    let sharedUiReady = false;
    let registrationAttempted = false;
    let pendingRegistration = null;

    // Deferred registration function to be called after state/renderPanel/setEnabled are defined
    const tryRegisterWithSharedUi = () => {
      if (registrationAttempted || !sharedUi) return;
      
      // Only register if we have all required components
      if (typeof state !== 'undefined' && typeof renderPanel === 'function' && typeof setEnabled === 'function') {
        registrationAttempted = true;
        sharedUi.registerScript({
          id: SCRIPT_ID,
          title: SCRIPT_TITLE,
          enabled: state.enabled,
          render: renderPanel,
          onToggle: (next) => setEnabled(next)
        });
      }
    };

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
          // Store the tryRegister function for deferred use
          pendingRegistration = tryRegister;
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

      const tryRegisterScript = () => {
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
            // Clean up resources after successful registration
            clearPollTimeout();
            removeEventListener();
          }
        }
      };

      // Try immediate detection (for scripts that load after userscriptui.user.js)
      if (initSharedUi()) {
        tryRegisterScript();
      }

      let eventListenerRef = null;
      const removeEventListener = () => {
        if (eventListenerRef) {
          document.removeEventListener('userscriptSharedUiReady', eventListenerRef);
          eventListenerRef = null;
        }
      };

      // Listen for shared UI ready event - REMOVED { once: true } to handle multiple events
      // and race conditions with load order
      eventListenerRef = (event) => {
        // Try to get factory from event detail first
        const providedFactory = event?.detail?.sharedUi;
        
        if (!sharedUiReady) {
          initSharedUi(providedFactory);
        }
        
        // Always try registration when event fires (idempotent)
        tryRegisterScript();
      };
      document.addEventListener('userscriptSharedUiReady', eventListenerRef);
      
      // Polling fallback for race conditions where event already fired
      // or userscriptui.user.js loads after this script
      let pollAttempts = 0;
      const maxPollAttempts = 20; // Poll for up to 2 seconds
      const pollInterval = 100;
      let pollTimeoutId = null;

      const clearPollTimeout = () => {
        if (pollTimeoutId !== null) {
          clearTimeout(pollTimeoutId);
          pollTimeoutId = null;
        }
      };

      const pollForSharedUi = () => {
        if (sharedUiReady || pollAttempts >= maxPollAttempts) {
          clearPollTimeout();
          removeEventListener(); // Clean up event listener on timeout
          return;
        }
        pollAttempts++;
        if (initSharedUi()) {
          tryRegisterScript();
        } else {
          pollTimeoutId = setTimeout(pollForSharedUi, pollInterval);
        }
      };
      pollTimeoutId = setTimeout(pollForSharedUi, pollInterval);
    }
    const state = {
        enabled: true,
        started: false,
        alwaysRun: false,
        menuIds: [],
        // Resource tracking for cleanup
        resources: {
            eventListeners: [],
            injectedNodes: []
        }
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
    // CORE LOGIC - AD INTERACTION GATE UNLOCKING
    //////////////////////////////////////////////////////////////

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
    logConfig.debugMode = !!config.debugMode;
    logConfig.logLevel = config.logLevel || 'info';
    log.setDebug(DEBUG || logConfig.debugMode || logConfig.logLevel === 'debug');
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
        log('info', 'Spoofing element', el);
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
        const MAX_DOMAINS = 5000; // prevent storage quota issues
        const arr = Array.from(domains).slice(0, MAX_DOMAINS);
        try {
            GM_setValue(EXCLUDE_CACHE_KEY, arr);
            GM_setValue(EXCLUDE_TS_KEY, Date.now());
            return true;
        } catch (_) {
            // Do NOT advance the timestamp if the cache write fails; keep refresh eligible.
            try { GM_deleteValue?.(EXCLUDE_CACHE_KEY); } catch (_) {}
            return false;
        }
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
                log('warn', 'Exclusion fetch failed', { url: source.url, error: err });
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
                log('info', 'Auto-actions enabled');
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
        // Guard: Don't patch if already patched by this or another script
        if (EventTarget.prototype.addEventListener.__adinteractPatched) {
            log('debug', 'addEventListener already patched, skipping');
            return;
        }
        const origAdd = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function(type, listener, options) {
            if (type === 'click' && fuzzySelectors.some(sel => this.matches(sel))) {
                log('debug', 'Patched click listener', this);
            }
            return origAdd.call(this, type, listener, options);
        };
        // Mark as patched
        EventTarget.prototype.addEventListener.__adinteractPatched = true;
    };

    // Initialize
    const init = () => {
        log('info', 'Init');
        injectCSS();
        patchEvents();
        document.addEventListener('click', handleManualClick, true);
        log('info', 'Ready: click 3+ times to unlock');
    };

    const bootstrap = async () => {
        const cached = loadCachedExclusions();
        if (cached.size && isExcludedHost(cached)) {
            log('info', 'Excluded host', HOST);
            return;
        }

        if (shouldRefreshExclusions()) {
            const fresh = await refreshExclusions();
            if (fresh.size && isExcludedHost(fresh)) {
                log('info', 'Excluded host after refresh', HOST);
                return;
            }
        }

        init();
    };
bootstrap().catch((err) => {
    log('warn', 'Bootstrap failed; skipping exclusions', err);
    init();
});
    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Refresh ad-interaction exclusion list', () => {
            refreshExclusions().then(() => {
                showToast('Exclusion list refreshed');
            });
        });
    }
    }

    //////////////////////////////////////////////////////////////
    // UI COMPONENTS
    //////////////////////////////////////////////////////////////

    const renderPanel = () => {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.gap = '10px';

        const info = document.createElement('p');
        info.textContent = 'Unlock ad interaction gates after repeated clicks. Disabling mid-session may require a reload to fully revert page patches.';
        info.style.margin = '0';
        info.style.fontSize = '13px';
        info.style.color = '#cbd5e1';
        wrapper.appendChild(info);

        const runBtn = document.createElement('button');
        runBtn.type = 'button';
        runBtn.textContent = 'Force run now';
        runBtn.style.padding = '8px 12px';
        runBtn.style.borderRadius = '6px';
        runBtn.style.border = '1px solid rgba(255,255,255,0.18)';
        runBtn.style.background = '#1f2937';
        runBtn.style.color = '#f8fafc';
        runBtn.style.cursor = 'pointer';
        runBtn.style.fontSize = '13px';
        runBtn.addEventListener('click', () => {
            if (state.enabled) {
                start();
            }
        });
        wrapper.appendChild(runBtn);

        const refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.textContent = 'Refresh ad-interaction exclusion list';
        refreshBtn.style.padding = '8px 12px';
        refreshBtn.style.borderRadius = '6px';
        refreshBtn.style.border = '1px solid rgba(255,255,255,0.18)';
        refreshBtn.style.background = '#1f2937';
        refreshBtn.style.color = '#f8fafc';
        refreshBtn.style.cursor = 'pointer';
        refreshBtn.style.fontSize = '13px';
        refreshBtn.addEventListener('click', () => {
            refreshExclusions().then(() => {
                showToast('Exclusion list refreshed');
            });
        });
        wrapper.appendChild(refreshBtn);

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
            `[Ad Interact] ${state.enabled ? '✓' : '✗'} Enable`,
            async () => { await setEnabled(!state.enabled); }
        ));
        state.menuIds.push(GM_registerMenuCommand(
            `[Ad Interact] ↻ Always Run (${state.alwaysRun ? 'ON' : 'OFF'})`,
            async () => { await setAlwaysRun(!state.alwaysRun); }
        ));
        if (state.enabled) {
            state.menuIds.push(GM_registerMenuCommand('[Ad Interact] ▶ Run ad unlocker now', () => main()));
        }
    };

    const setAlwaysRun = async (value) => {
        state.alwaysRun = !!value;
        await gmStore.set(ALWAYS_RUN_KEY, state.alwaysRun);
        registerMenu();
    };

    const stop = async () => {
        state.started = false;
        // Clean up resources
        if (state.resources) {
            state.resources.eventListeners.forEach(({ target, type, handler, options }) => {
                try { target.removeEventListener(type, handler, options); } catch (_) {}
            });
            state.resources.eventListeners = [];
            state.resources.injectedNodes.forEach(node => { try { node.remove(); } catch (_) {} });
            state.resources.injectedNodes = [];
        }
    };

    const start = async () => {
        if (state.started) return;
        state.started = true;
        main();
    };

    const setEnabled = async (value) => {
        state.enabled = !!value;
        await gmStore.set(ENABLE_KEY, state.enabled);
        if (sharedUi) {
            sharedUi.setScriptEnabled(SCRIPT_ID, state.enabled);
        }
        if (!state.enabled) {
            await stop();
        }
        // Don't auto-start on enable - respect dormant-by-default
        registerMenu();
    };

    //////////////////////////////////////////////////////////////
    // INITIALIZATION
    //////////////////////////////////////////////////////////////

    const init = async () => {
        state.enabled = await gmStore.get(ENABLE_KEY, true);
        state.alwaysRun = await gmStore.get(ALWAYS_RUN_KEY, false);
        
        // Try registration now that state/renderPanel/setEnabled are defined
        if (pendingRegistration && typeof pendingRegistration === 'function') {
            // Use the helper's tryRegister function if available
            pendingRegistration(renderPanel, (next) => setEnabled(next), state.enabled);
            registrationAttempted = true;
        } else {
            // Direct registration if shared UI is already available
            tryRegisterWithSharedUi();
        }
        
        // Register menu commands (always available)
        registerMenu();
        
        // Only auto-start if Always Run is enabled (dormant by default)
        if (state.enabled && state.alwaysRun) {
            await start();
        }
    };

    init().catch((err) => {
        log('error', 'fatal error', err);
    });
})();
