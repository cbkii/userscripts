// ==UserScript==
// @name         Download Timer Accelerator Pro
// @namespace    https://github.com/cbkii/userscripts
// @version      2026.01.03.0121
// @description  Accelerates download countdown timers with comprehensive file-host verification support (FreeDlink, Rapidgator, Uploaded, etc).
// @author       cbkii
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkYxNDkzIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cG9seWxpbmUgcG9pbnRzPSIxMiA2IDEyIDEyIDE2IDE0Ii8+PC9zdmc+
// @include      /^https?:\/\/(?:[^\/]+\.)*(?:(?:up|down|load|dl|mirror|drain|transfer)[a-z0-9-]*|[a-z0-9-]*(?:up|down|load|dl|mirror|drain|transfer))\.[a-z0-9-]{2,}(?::\d+)?(?:\/.*)?$/i
// @include      /^https?:\/\/(?:[^\/]+\.)*(?:(?:download|upload|share|file|cloud|drop|send|host|locker|mirror)[a-z0-9-]*|[a-z0-9-]*(?:download|upload|share|file|cloud|drop|send|host|locker|mirror))\.[a-z0-9-]{2,}(?::\d+)?(?:\/.*)?$/i
// @include      /^https?:\/\/(?:[^\/]+\.)*(?:(?:rapid|nitro|turbo|mega|fichier|uloz|bytez|kat|k2s)[a-z0-9-]*|[a-z0-9-]*(?:rapid|nitro|turbo|mega|fichier|uloz|bytez|kat|k2s))\.[a-z0-9-]{2,}(?::\d+)?(?:\/.*)?$/i
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/dlcountdown.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/dlcountdown.user.js
// @homepageURL  https://github.com/cbkii/userscripts
// @supportURL   https://github.com/cbkii/userscripts/issues
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      fredl.ru
// @connect      freedl.ink
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
  LOAD PRIORITY: 5 (Early Intervention)
  Bypasses download countdown timers by hooking timer functions at document-start.
  
  Feature summary:
  - Accelerates common download countdown timers.
  - Enables disabled download controls when timers finish.
  - Provides a menu toggle and keyboard shortcut (acceleration starts only when enabled).
  - FreeDlink/Freedl.ink support: Auto-calls createAds API to populate verification fields.
  - Generic file-host support: Handles common verification patterns (hidden fields, tokens, etc).
  - Works with antiadblock.user.js which handles adblock_detected field spoofing.
  - XBrowser compatible with localStorage fallback when GM APIs unavailable.

  How it works:
  - Hooks timers, detects countdown-like delays, and shortens them when enabled.
  - Scans the DOM for timer elements and updates them faster.
  - On FreeDlink: Automatically calls createAds API and populates adsOnlinehash/level fields.
  - Generic sites: Auto-populates common verification fields like wait_token, download_token, etc.
  - Ad-block detection spoofing is handled by the antiadblock script.

  Configuration:
  - Adjust ACCELERATION_FACTOR and related constants inside main().
  - Default state is disabled; use the userscript menu or shortcut to enable.
  - Site-specific verification is automatic (user still solves captchas manually).
*/

(function() {
    'use strict';

    //////////////////////////////////////////////////////////////
    // CONSTANTS & CONFIGURATION
    //////////////////////////////////////////////////////////////

    const DEBUG = false;
    const LOG_PREFIX = '[dlcnt]';
    const LOG_STORAGE_KEY = 'userscript.logs.dlcountdown';
    const LOG_MAX_ENTRIES = 200;
    const SCRIPT_ID = 'dlcountdown';
    const SCRIPT_TITLE = 'Download Timer Accelerator';
    const ENABLE_KEY = `${SCRIPT_ID}.enabled`;

    //////////////////////////////////////////////////////////////
    // UTILITIES & HELPERS
    //////////////////////////////////////////////////////////////

    const gmStore = {
        async get(key, fallback) {
            try { 
                if (typeof GM_getValue === 'function') {
                    return await GM_getValue(key, fallback);
                }
                // Fallback to localStorage for XBrowser compatibility
                const stored = localStorage.getItem(key);
                return stored !== null ? JSON.parse(stored) : fallback;
            } catch (_) { 
                return fallback; 
            }
        },
        async set(key, value) {
            try { 
                if (typeof GM_setValue === 'function') {
                    await GM_setValue(key, value);
                } else {
                    // Fallback to localStorage for XBrowser compatibility
                    localStorage.setItem(key, JSON.stringify(value));
                }
            } catch (_) {}
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
        menuIds: [],
        observer: null,
        rescanInterval: null,
        keyboardHandler: null,
        visibilityHandler: null
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
    // CORE LOGIC - TIMER ACCELERATION
    //////////////////////////////////////////////////////////////

    async function main() {

    // FreeDlink/Freedl.ink specific support
    const isFreeDlink = location.hostname.endsWith('fredl.ru') || location.hostname.endsWith('freedl.ink');
    
    // FreeDlink ad-verification helper
    const handleFreeDlinkVerification = async () => {
        if (!isFreeDlink) return;
        
        const doc = (typeof unsafeWindow !== 'undefined' && unsafeWindow.document) || document;
        const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        
        // Extract file code from URL (e.g., /6blvteuy9wqq)
        const fileCodeMatch = location.pathname.match(/\/([a-z0-9]{10,})/i);
        if (!fileCodeMatch) {
            log('info', 'FreeDlink: No file code found in URL');
            return;
        }
        
        const fileCode = fileCodeMatch[1];
        log('info', `FreeDlink: Processing file ${fileCode}`);
        
        // Wait for DOM to be ready
        const waitForElement = (selector, timeout = 5000) => {
            return new Promise((resolve) => {
                if (doc.querySelector(selector)) {
                    return resolve(doc.querySelector(selector));
                }
                
                const observer = new MutationObserver(() => {
                    if (doc.querySelector(selector)) {
                        observer.disconnect();
                        resolve(doc.querySelector(selector));
                    }
                });
                
                observer.observe(doc.body || doc.documentElement, {
                    childList: true,
                    subtree: true
                });
                
                setTimeout(() => {
                    observer.disconnect();
                    resolve(null);
                }, timeout);
            });
        };
        
        // Auto-populate ad verification fields
        if (typeof GM_xmlhttpRequest === 'function') {
            try {
                const createAdsUrl = `https://fredl.ru/createAds/${fileCode}/${Math.random()}`;
                log('info', `FreeDlink: Calling createAds API: ${createAdsUrl}`);
                
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: createAdsUrl,
                    onload: function(response) {
                        try {
                            const data = JSON.parse(response.responseText);
                            log('info', 'FreeDlink: createAds response received', data);
                            
                            if (data && data.status && data.message) {
                                // Wait for fields to exist before populating
                                setTimeout(() => {
                                    const hashField = doc.getElementById('adsOnlinehash');
                                    const levelField = doc.getElementById('level');
                                    
                                    if (hashField && data.message.hash) {
                                        hashField.value = data.message.hash;
                                        log('info', `FreeDlink: Set adsOnlinehash = ${data.message.hash}`);
                                    }
                                    
                                    if (levelField && data.message.level) {
                                        levelField.value = data.message.level;
                                        log('info', `FreeDlink: Set level = ${data.message.level}`);
                                    }
                                    
                                    // Optionally open ad link in background (commented out by default)
                                    // if (data.message.view_ad_link) {
                                    //     window.open(data.message.view_ad_link, '_blank');
                                    //     log('info', 'FreeDlink: Opened ad link');
                                    // }
                                }, 500);
                            }
                        } catch (e) {
                            log('error', 'FreeDlink: Error parsing createAds response', e);
                        }
                    },
                    onerror: function(error) {
                        log('error', 'FreeDlink: createAds request failed', error);
                    }
                });
            } catch (e) {
                log('error', 'FreeDlink: Error calling createAds', e);
            }
        } else {
            log('warn', 'FreeDlink: GM_xmlhttpRequest not available, cannot auto-populate ad verification');
        }
    };
    
    // Call FreeDlink handler if on FreeDlink site
    if (isFreeDlink) {
        log('info', 'FreeDlink: Detected FreeDlink site, enabling ad-verification support');
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                handleFreeDlinkVerification();
            }, { once: true });
        } else {
            handleFreeDlinkVerification();
        }
    }

    // Generic file-host verification field handler
    // Handles common verification patterns across multiple file hosting sites
    const handleGenericVerificationFields = () => {
        const doc = (typeof unsafeWindow !== 'undefined' && unsafeWindow.document) || document;
        
        // Common verification field patterns found in file hosting sites
        const verificationFields = [
            { id: 'wait_token', fallback: () => generateToken() },
            { id: 'download_token', fallback: () => generateToken() },
            { id: 'csrf_token', fallback: () => extractFromMeta('csrf-token') },
            { id: '_token', fallback: () => extractFromMeta('csrf-token') },
            { id: 'authenticity_token', fallback: () => generateToken() },
            { id: 'download_verify', fallback: () => '1' },
            { id: 'time', fallback: () => Date.now().toString() },
            { id: 'timestamp', fallback: () => Math.floor(Date.now() / 1000).toString() },
            { name: 'op', fallback: () => 'download2' },
            { name: 'method_free', fallback: () => 'Free Download' },
            { name: 'method_premium', fallback: () => '' },
            { id: 'free', fallback: () => '1' },
            { id: 'download_free', fallback: () => '1' }
        ];
        
        // Helper to generate a simple token
        const generateToken = () => {
            return Array.from({length: 32}, () => 
                Math.floor(Math.random() * 16).toString(16)
            ).join('');
        };
        
        // Helper to extract token from meta tags
        const extractFromMeta = (name) => {
            const meta = doc.querySelector(`meta[name="${name}"]`);
            return meta ? meta.getAttribute('content') : generateToken();
        };
        
        // Populate missing verification fields
        verificationFields.forEach(field => {
            try {
                let element = null;
                
                if (field.id) {
                    element = doc.getElementById(field.id);
                } else if (field.name) {
                    element = doc.querySelector(`input[name="${field.name}"]`);
                }
                
                if (element && element.tagName === 'INPUT' && !element.value) {
                    element.value = field.fallback();
                    log('info', `Auto-populated field: ${field.id || field.name} = ${element.value}`);
                }
            } catch (e) {
                // Ignore errors for individual fields
            }
        });
        
        // Look for dynamically required fields in data attributes or scripts
        const scripts = doc.querySelectorAll('script:not([src])');
        scripts.forEach(script => {
            try {
                const content = script.textContent;
                
                // Look for common patterns like: var download_token = "..."
                const tokenMatch = content.match(/(?:var|let|const)\s+(\w*token\w*)\s*=\s*["']([^"']+)["']/i);
                if (tokenMatch && tokenMatch[1] && tokenMatch[2]) {
                    const fieldName = tokenMatch[1];
                    const tokenValue = tokenMatch[2];
                    
                    const field = doc.getElementById(fieldName) || doc.querySelector(`input[name="${fieldName}"]`);
                    if (field && field.tagName === 'INPUT' && !field.value) {
                        field.value = tokenValue;
                        log('info', `Auto-populated from script: ${fieldName} = ${tokenValue}`);
                    }
                }
                
                // Look for session/download verification variables
                const sessionMatch = content.match(/(?:session|download)_?(?:id|key|verify)\s*[:=]\s*["']([^"']+)["']/i);
                if (sessionMatch && sessionMatch[1]) {
                    // Try to find corresponding hidden field
                    const hiddenFields = doc.querySelectorAll('input[type="hidden"][name*="session"], input[type="hidden"][name*="verify"]');
                    hiddenFields.forEach(field => {
                        if (!field.value) {
                            field.value = sessionMatch[1];
                            log('info', `Auto-populated session field: ${field.name} = ${sessionMatch[1]}`);
                        }
                    });
                }
            } catch (e) {
                // Ignore script parsing errors
            }
        });
    };
    
    // Run generic verification field handler
    const runGenericHandler = () => {
        handleGenericVerificationFields();
        
        // Also watch for dynamically added fields
        const fieldObserver = new MutationObserver(() => {
            handleGenericVerificationFields();
        });
        
        if (document.body) {
            fieldObserver.observe(document.body, { 
                childList: true, 
                subtree: true,
                attributes: true,
                attributeFilter: ['disabled', 'readonly']
            });
            
            // Disconnect after 30 seconds to avoid performance issues
            setTimeout(() => fieldObserver.disconnect(), 30000);
        }
    };
    
    // Run immediately and on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runGenericHandler, { once: true });
    } else {
        runGenericHandler();
    }

    // Configuration
    const ACCELERATION_FACTOR = 100;  // 100x speed (1000ms becomes 10ms)
    const MIN_INTERVAL_MS = 10;       // Minimum interval to prevent browser throttling
    const MAX_INTERVAL_MS = 1000;     // Maximum interval we'll consider a timer
    const STORAGE_KEY = ENABLE_KEY;
    state.enabled = await gmStore.get(STORAGE_KEY, false);
    
    // Function tracking for restoration
    const originalFunctions = new Map();
    const activeIntervals = new Map();
    const activeTimeouts = new Map();
    const processedElements = new WeakSet();
    
    // Safe window access
    const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    const doc = win.document;
    
    // Utility functions
    const utils = {
        // Check if a delay looks like a countdown timer
        isTimerDelay(delay) {
            return delay >= 100 && delay <= MAX_INTERVAL_MS;
        },
        
        // Get accelerated delay while preserving timer behavior
        getAcceleratedDelay(originalDelay) {
            if (!state.enabled || !this.isTimerDelay(originalDelay)) {
                return originalDelay;
            }
            
            // Accelerate but ensure minimum delay for browser compatibility
            const accelerated = Math.max(MIN_INTERVAL_MS, Math.floor(originalDelay / ACCELERATION_FACTOR));
            return accelerated;
        },
        
        // Safely store original function
        storeOriginal(name, func) {
            if (!originalFunctions.has(name)) {
                originalFunctions.set(name, func);
            }
        },
        
        // Check if callback looks like a countdown function
        isCountdownCallback(callback) {
            if (typeof callback === 'string') {
                return /countdown|timer|second|minute|wait/i.test(callback);
            }
            if (typeof callback === 'function') {
                const funcStr = callback.toString();
                return /countdown|timer|second|minute|wait|--|\-\-|getElementById|innerHTML|textContent/i.test(funcStr);
            }
            return false;
        },
        
        // DOM element manipulation for timer displays
        findAndAccelerateTimerElements() {
            if (!state.enabled) return;
            
            // Common timer element selectors
            const timerSelectors = [
                '[id*="timer"]', '[id*="countdown"]', '[id*="wait"]',
                '[class*="timer"]', '[class*="countdown"]', '[class*="wait"]',
                '.seconds', '.minutes', '#timer', '#countdown',
                '.time-left', '.remaining', '.download-timer'
            ];
            
            timerSelectors.forEach(selector => {
                try {
                    const elements = doc.querySelectorAll(selector);
                    elements.forEach(el => {
                        if (!processedElements.has(el) && el.textContent.match(/\d+/)) {
                            this.accelerateElementTimer(el);
                            processedElements.add(el);
                        }
                    });
                } catch (e) {
                    // Ignore selector errors
                }
            });
        },
        
        // Accelerate timer displayed in DOM element
        accelerateElementTimer(element) {
            const originalText = element.textContent;
            const timeMatch = originalText.match(/(\d+)/);
            
            if (timeMatch) {
                let seconds = parseInt(timeMatch[1]);
                
                if (seconds > 1) {
                    const acceleratedInterval = setInterval(() => {
                        seconds = Math.max(0, seconds - 1);
                        element.textContent = originalText.replace(/\d+/, seconds);
                        
                        if (seconds <= 0) {
                            clearInterval(acceleratedInterval);
                            activeIntervals.delete(acceleratedInterval);
                            // Trigger any completion events
                            this.triggerTimerCompletion(element);
                        }
                    }, Math.max(10, Math.floor(1000 / ACCELERATION_FACTOR)));
                    activeIntervals.set(acceleratedInterval, { internal: true });
                }
            }
        },
        
        // Trigger events when timer completes
        triggerTimerCompletion(element) {
            // Look for download buttons to enable
            const downloadSelectors = [
                'input[type="submit"]', 'button', 'a[href*="download"]',
                '.download', '.btn', '.button', '[class*="download"]'
            ];
            
            downloadSelectors.forEach(selector => {
                try {
                    const buttons = doc.querySelectorAll(selector);
                    buttons.forEach(btn => {
                        // Enable disabled buttons
                        if (btn.disabled) btn.disabled = false;
                        
                        // Remove disabled classes
                        if (btn.classList.contains('disabled')) {
                            btn.classList.remove('disabled');
                        }
                        
                        // Add active/enabled classes
                        if (!btn.classList.contains('active') && !btn.classList.contains('enabled')) {
                            btn.classList.add('enabled');
                        }
                        
                        // Make visible if hidden
                        if (btn.style.display === 'none') btn.style.display = '';
                        if (btn.style.visibility === 'hidden') btn.style.visibility = 'visible';
                    });
                } catch (e) {
                    // Ignore errors
                }
            });
            
            // Dispatch custom event for other scripts to detect completion
            try {
                win.dispatchEvent(new CustomEvent('timerCompleted', { 
                    detail: { element, timestamp: Date.now() } 
                }));
            } catch (e) {
                // Ignore event errors
            }
        }
    };

    // Core timer acceleration system
    const timerAccelerator = {
        
        // Hook setTimeout with smart detection
        hookSetTimeout() {
            if (originalFunctions.has('setTimeout')) return;
            
            const originalSetTimeout = win.setTimeout;
            utils.storeOriginal('setTimeout', originalSetTimeout);
            
            win.setTimeout = function(callback, delay, ...args) {
                // Only accelerate if it looks like a timer and we're enabled
                if (state.enabled && utils.isTimerDelay(delay) && utils.isCountdownCallback(callback)) {
                    delay = utils.getAcceleratedDelay(delay);
                }
                
                const timeoutId = originalSetTimeout.call(this, callback, delay, ...args);
                
                // Track timeout for potential manipulation
                if (utils.isTimerDelay(arguments[1])) {
                    activeTimeouts.set(timeoutId, {
                        callback: arguments[0],
                        originalDelay: arguments[1],
                        acceleratedDelay: delay,
                        timestamp: Date.now()
                    });
                }
                
                return timeoutId;
            };
            
            // Preserve function appearance
            win.setTimeout.toString = () => originalSetTimeout.toString();
        },
        
        // Hook setInterval with countdown detection
        hookSetInterval() {
            if (originalFunctions.has('setInterval')) return;
            
            const originalSetInterval = win.setInterval;
            utils.storeOriginal('setInterval', originalSetInterval);
            
            win.setInterval = function(callback, delay, ...args) {
                const originalDelay = delay;
                
                // Accelerate countdown intervals
                if (state.enabled && utils.isTimerDelay(delay) && utils.isCountdownCallback(callback)) {
                    delay = utils.getAcceleratedDelay(delay);
                }
                
                const intervalId = originalSetInterval.call(this, callback, delay, ...args);
                
                // Track interval for potential direct manipulation
                if (utils.isTimerDelay(originalDelay)) {
                    activeIntervals.set(intervalId, {
                        callback: arguments[0],
                        originalDelay: originalDelay,
                        acceleratedDelay: delay,
                        timestamp: Date.now()
                    });
                }
                
                return intervalId;
            };
            
            // Preserve function appearance  
            win.setInterval.toString = () => originalSetInterval.toString();
        },
        
        // Hook clearInterval to clean up tracking
        hookClearInterval() {
            if (originalFunctions.has('clearInterval')) return;
            
            const originalClearInterval = win.clearInterval;
            utils.storeOriginal('clearInterval', originalClearInterval);
            
            win.clearInterval = function(intervalId) {
                activeIntervals.delete(intervalId);
                return originalClearInterval.call(this, intervalId);
            };
            
            win.clearInterval.toString = () => originalClearInterval.toString();
        },
        
        // Hook clearTimeout to clean up tracking
        hookClearTimeout() {
            if (originalFunctions.has('clearTimeout')) return;
            
            const originalClearTimeout = win.clearTimeout;
            utils.storeOriginal('clearTimeout', originalClearTimeout);
            
            win.clearTimeout = function(timeoutId) {
                activeTimeouts.delete(timeoutId);
                return originalClearTimeout.call(this, timeoutId);
            };
            
            win.clearTimeout.toString = () => originalClearTimeout.toString();
        },
        
        // Advanced: Search for global timer variables and manipulate them
        accelerateGlobalTimers() {
            if (!state.enabled) return;
            
            try {
                // Common global timer variable names
                const timerVariables = [
                    'seconds', 'countdown', 'timer', 'wait', 'remaining',
                    'sec', 'secs', 'timeLeft', 'waitTime', 'downloadTimer'
                ];
                
                timerVariables.forEach(varName => {
                    if (win[varName] && typeof win[varName] === 'number' && win[varName] > 1) {
                        // Set to 1 so it completes on next interval
                        win[varName] = 1;
                    }
                });
            } catch (e) {
                // Ignore errors accessing global variables
            }
        },
        
        // Search for obfuscated timer functions
        findObfuscatedTimers() {
            if (!state.enabled) return;
            
            try {
                // Look for functions that might be timers
                Object.keys(win).forEach(key => {
                    if (typeof win[key] === 'function' && 
                        /timer|countdown|wait|delay/i.test(key) &&
                        !processedElements.has(win[key])) {
                        
                        const original = win[key];
                        processedElements.add(original);
                        
                        // Wrap function to accelerate any timers it creates
                        win[key] = function(...args) {
                            const result = original.apply(this, args);
                            
                            // If this function likely starts a timer, accelerate DOM updates
                            setTimeout(() => utils.findAndAccelerateTimerElements(), 100);
                            
                            return result;
                        };
                    }
                });
            } catch (e) {
                // Ignore errors
            }
        },
        
        // Handle common download site patterns
        handleCommonPatterns() {
            if (!state.enabled) return;
            
            try {
                // Pattern 1: Only hide wait elements with specific timer text patterns
                // Don't hide ALL elements with "wait" - be selective
                const waitElements = doc.querySelectorAll('[class*="wait"], [id*="wait"]');
                waitElements.forEach(el => {
                    // Only hide if it contains countdown text like "seconds", "wait", etc.
                    if (el.textContent && /\d+\s*(second|sec|minute|min|wait)/i.test(el.textContent)) {
                        if (el.style) el.style.display = 'none';
                    }
                });
                
                // Pattern 2: Enable disabled download elements (but not all disabled elements)
                // Only target elements that look like download buttons
                const downloadSelectors = [
                    'button[disabled][class*="download"]',
                    'button[disabled][id*="download"]',
                    'a.disabled[href*="download"]',
                    'input[type="submit"][disabled][value*="download" i]'
                ];
                
                downloadSelectors.forEach(selector => {
                    try {
                        const elements = doc.querySelectorAll(selector);
                        elements.forEach(el => {
                            if (el.classList && el.classList.contains('disabled')) {
                                el.classList.remove('disabled');
                                el.classList.add('enabled');
                            }
                            if (el.disabled) el.disabled = false;
                        });
                    } catch (e) {
                        // Ignore selector errors
                    }
                });
                
                // Pattern 3: Show hidden download links (only actual download links)
                const hiddenDownloads = doc.querySelectorAll('a[style*="display"][href*="download"], a[style*="visibility"][href*="download"]');
                hiddenDownloads.forEach(el => {
                    if (el.href && el.href.includes('download')) {
                        el.style.display = '';
                        el.style.visibility = 'visible';
                    }
                });
                
            } catch (e) {
                // Ignore errors
            }
        },
        
        // Monitor DOM for new timers
        observeTimerElements() {
            try {
                if (state.observer) {
                    try { state.observer.disconnect(); } catch (_) {}
                    state.observer = null;
                }
                const observer = new MutationObserver((mutations) => {
                    if (!state.enabled) return;
                    
                    mutations.forEach((mutation) => {
                        if (mutation.type === 'childList') {
                            mutation.addedNodes.forEach((node) => {
                                if (node.nodeType === 1) { // Element node
                                    // Check if new element is a timer
                                    if (node.textContent && node.textContent.match(/\d+.*second|wait|countdown/i)) {
                                        utils.accelerateElementTimer(node);
                                    }
                                    
                                    // Check for new timers in child elements
                                    try {
                                        const timerElements = node.querySelectorAll && node.querySelectorAll('[id*="timer"], [class*="countdown"]');
                                        if (timerElements) {
                                            timerElements.forEach(el => {
                                                if (!processedElements.has(el)) {
                                                    utils.accelerateElementTimer(el);
                                                }
                                            });
                                        }
                                    } catch (e) {
                                        // Ignore query errors
                                    }
                                }
                            });
                        }
                    });
                });
                
                // Start observing when DOM is available
                const startObserving = () => observer.observe(doc.body, { 
                    childList: true, 
                    subtree: true,
                    attributes: false,
                    characterData: false 
                });
                if (doc.body) {
                    startObserving();
                } else {
                    doc.addEventListener('DOMContentLoaded', startObserving, { once: true });
                }
                state.observer = observer;
            } catch (e) {
                // Ignore observer setup errors
            }
        },
        
        // Initialize all acceleration methods
        initializeAcceleration() {
            this.hookSetTimeout();
            this.hookSetInterval();
            this.hookClearInterval();
            this.hookClearTimeout();
            this.observeTimerElements();
            
            // Delayed execution for DOM-dependent features
            if (doc.readyState === 'loading') {
                doc.addEventListener('DOMContentLoaded', () => {
                    setTimeout(() => {
                        utils.findAndAccelerateTimerElements();
                        this.accelerateGlobalTimers();
                        this.findObfuscatedTimers();
                        this.handleCommonPatterns();
                    }, 100);
                });
            } else {
                setTimeout(() => {
                    utils.findAndAccelerateTimerElements();
                    this.accelerateGlobalTimers();
                    this.findObfuscatedTimers();
                    this.handleCommonPatterns();
                }, 100);
            }
        }
    };
    
    // UI and control functions
    const removeNotifications = () => {
        try {
            const existingNotifications = doc.querySelectorAll('.timer-accelerator-notification');
            existingNotifications.forEach((n) => n.remove());
        } catch (_) {}
    };

    function showNotification(message, type = 'info') {
        try {
            removeNotifications();
            const notification = doc.createElement('div');
            notification.className = 'timer-accelerator-notification';
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                z-index: 999999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 14px;
                font-weight: 500;
                box-shadow: 0 4px 20px rgba(0,0,0,0.15);
                animation: slideInRight 0.3s ease-out;
                max-width: 300px;
                word-wrap: break-word;
            `;
            if (!doc.getElementById('timer-accelerator-styles')) {
                const styleSheet = doc.createElement('style');
                styleSheet.id = 'timer-accelerator-styles';
                styleSheet.textContent = `
                    @keyframes slideInRight {
                        from { transform: translateX(100%); opacity: 0; }
                        to { transform: translateX(0); opacity: 1; }
                    }
                    @keyframes slideOutRight {
                        from { transform: translateX(0); opacity: 1; }
                        to { transform: translateX(100%); opacity: 0; }
                    }
                `;
                (doc.head || doc.documentElement).appendChild(styleSheet);
            }
            notification.textContent = message;
            (doc.body || doc.documentElement).appendChild(notification);
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.style.animation = 'slideOutRight 0.3s ease-in';
                    setTimeout(() => {
                        if (notification.parentNode) notification.remove();
                    }, 300);
                }
            }, 4000);
        } catch (e) {
            log('info', 'State update', message);
        }
    }

    const restoreOriginalFunctions = () => {
        originalFunctions.forEach((fn, name) => {
            try { win[name] = fn; } catch (_) {}
        });
        originalFunctions.clear();
    };

    const stop = async () => {
        if (!state.started) return;
        state.started = false;
        if (state.rescanInterval) {
            clearInterval(state.rescanInterval);
            state.rescanInterval = null;
        }
        if (state.observer) {
            try { state.observer.disconnect(); } catch (_) {}
            state.observer = null;
        }
        if (state.keyboardHandler) {
            doc.removeEventListener('keydown', state.keyboardHandler);
            state.keyboardHandler = null;
        }
        if (state.visibilityHandler) {
            doc.removeEventListener('visibilitychange', state.visibilityHandler);
            state.visibilityHandler = null;
        }
        activeIntervals.forEach((_, id) => {
            try { clearInterval(id); } catch (_) {}
        });
        activeIntervals.clear();
        activeTimeouts.forEach((_, id) => {
            try { clearTimeout(id); } catch (_) {}
        });
        activeTimeouts.clear();
        restoreOriginalFunctions();
        removeNotifications();
    };

    const start = async () => {
        if (state.started) return;
        state.started = true;
        timerAccelerator.initializeAcceleration();
        state.keyboardHandler = (e) => {
            if (e.ctrlKey && e.altKey && e.key === 'T') {
                e.preventDefault();
                setEnabled(!state.enabled);
            }
        };
        doc.addEventListener('keydown', state.keyboardHandler);
        
        // Helper to start/restart the rescan interval
        const startRescanInterval = () => {
            if (state.rescanInterval) clearInterval(state.rescanInterval);
            state.rescanInterval = setInterval(() => {
                if (state.enabled && !doc.hidden) {
                    utils.findAndAccelerateTimerElements();
                    timerAccelerator.accelerateGlobalTimers();
                }
            }, 2000);
        };
        
        // Pause interval when tab is hidden to save resources
        state.visibilityHandler = () => {
            if (doc.hidden) {
                if (state.rescanInterval) {
                    clearInterval(state.rescanInterval);
                    state.rescanInterval = null;
                }
            } else if (state.enabled && state.started) {
                startRescanInterval();
            }
        };
        doc.addEventListener('visibilitychange', state.visibilityHandler);
        
        startRescanInterval();
        
        if (state.enabled) {
            setTimeout(() => {
                if (state.enabled) {
                    showNotification(`🚀 Download timers running at ${ACCELERATION_FACTOR}x speed`, 'success');
                }
            }, 1000);
        }
        log('info', `Status: ${state.enabled ? 'enabled' : 'disabled'}`);
        log('info', 'Toggle: Ctrl+Alt+T or userscript menu');
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
        if (!hasUnregister && state.menuIds.length) {
            return;
        }
        state.menuIds.push(GM_registerMenuCommand(
            `[Download Countdown] ${state.enabled ? '✓' : '✗'} Enable`,
            async () => { await setEnabled(!state.enabled); }
        ));
        if (state.enabled) {
            state.menuIds.push(GM_registerMenuCommand('[Download Countdown] ⟳ Rescan timers', () => {
                utils.findAndAccelerateTimerElements();
                timerAccelerator.accelerateGlobalTimers();
                timerAccelerator.handleCommonPatterns();
            }));
        }
    };

    const setEnabled = async (value) => {
        state.enabled = !!value;
        await gmStore.set(STORAGE_KEY, state.enabled);
        if (sharedUi) {
            sharedUi.setScriptEnabled(SCRIPT_ID, state.enabled);
        }
        if (!state.enabled) {
            await stop();
            showNotification('⏱️ Timer acceleration disabled - normal speed', 'info');
        } else {
            await start();
            showNotification(`🚀 Download timers accelerated ${ACCELERATION_FACTOR}x!`, 'success');
            setTimeout(() => {
                if (state.enabled) {
                    utils.findAndAccelerateTimerElements();
                    timerAccelerator.accelerateGlobalTimers();
                    timerAccelerator.handleCommonPatterns();
                }
            }, 120);
        }
        registerMenu();
    };

    //////////////////////////////////////////////////////////////
    // UI COMPONENTS
    //////////////////////////////////////////////////////////////

    const renderPanel = () => {
        const wrapper = doc.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.gap = '10px';

        const status = doc.createElement('div');
        status.textContent = state.enabled
            ? `Running at ${ACCELERATION_FACTOR}x speed`
            : 'Disabled (normal timers)';
        status.style.fontSize = '13px';
        status.style.color = '#cbd5e1';
        wrapper.appendChild(status);

        const buttons = doc.createElement('div');
        buttons.style.display = 'flex';
        buttons.style.gap = '8px';
        buttons.style.flexWrap = 'wrap';

        const toggleBtn = doc.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.textContent = state.enabled ? 'Disable' : 'Enable';
        toggleBtn.style.padding = '8px 12px';
        toggleBtn.style.borderRadius = '6px';
        toggleBtn.style.border = '1px solid rgba(255,255,255,0.18)';
        toggleBtn.style.background = '#1f2937';
        toggleBtn.style.color = '#f8fafc';
        toggleBtn.style.cursor = 'pointer';
        toggleBtn.style.fontSize = '13px';
        toggleBtn.addEventListener('click', () => setEnabled(!state.enabled));
        buttons.appendChild(toggleBtn);

        const rescanBtn = doc.createElement('button');
        rescanBtn.type = 'button';
        rescanBtn.textContent = 'Rescan timers';
        rescanBtn.style.padding = '8px 12px';
        rescanBtn.style.borderRadius = '6px';
        rescanBtn.style.border = '1px solid rgba(255,255,255,0.18)';
        rescanBtn.style.background = '#1f2937';
        rescanBtn.style.color = '#f8fafc';
        rescanBtn.style.cursor = 'pointer';
        rescanBtn.style.fontSize = '13px';
        rescanBtn.addEventListener('click', () => {
            utils.findAndAccelerateTimerElements();
            timerAccelerator.accelerateGlobalTimers();
            timerAccelerator.handleCommonPatterns();
            showNotification('🔍 Rescanning timers...', 'info');
            log('info', 'Manual rescan triggered');
        });
        rescanBtn.disabled = !state.enabled;
        buttons.appendChild(rescanBtn);

        const stopBtn = doc.createElement('button');
        stopBtn.type = 'button';
        stopBtn.textContent = 'Stop acceleration';
        stopBtn.style.padding = '8px 12px';
        stopBtn.style.borderRadius = '6px';
        stopBtn.style.border = '1px solid rgba(255,255,255,0.18)';
        stopBtn.style.background = '#991b1b';
        stopBtn.style.color = '#f8fafc';
        stopBtn.style.cursor = 'pointer';
        stopBtn.style.fontSize = '13px';
        stopBtn.addEventListener('click', async () => {
            await stop();
            showNotification('⏱️ Timer acceleration stopped', 'info');
            log('info', 'Timer acceleration manually stopped');
        });
        stopBtn.disabled = !state.enabled || !state.started;
        buttons.appendChild(stopBtn);

        wrapper.appendChild(buttons);
        return wrapper;
    };

    //////////////////////////////////////////////////////////////
    // INITIALIZATION
    //////////////////////////////////////////////////////////////

    // Try registration now that state/renderPanel/setEnabled are defined
    if (pendingRegistration && typeof pendingRegistration === 'function') {
        // Use the helper's tryRegister function if available
        pendingRegistration(renderPanel, (next) => setEnabled(next), state.enabled);
        registrationAttempted = true;
    } else {
        // Direct registration if shared UI is already available
        tryRegisterWithSharedUi();
    }
    
    // Fallback UI for XBrowser/environments without GM_registerMenuCommand
    // Create a simple toggle button when neither shared UI nor menu commands are available
    const createFallbackUI = () => {
        if (typeof GM_registerMenuCommand !== 'function' && !sharedUi) {
            // Wait for body to be available
            const injectButton = () => {
                const doc = (typeof unsafeWindow !== 'undefined' && unsafeWindow.document) || document;
                if (doc.getElementById('dlcnt-toggle')) return; // Already exists
                
                const toggle = doc.createElement('button');
                toggle.id = 'dlcnt-toggle';
                toggle.textContent = state.enabled ? '⏱️ Timer: ON' : '⏱️ Timer: OFF';
                toggle.style.cssText = `
                    position: fixed;
                    bottom: 10px;
                    right: 10px;
                    z-index: 999999;
                    font-size: 12px;
                    padding: 8px 12px;
                    background: ${state.enabled ? '#4CAF50' : '#f44336'};
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    font-weight: 500;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                `;
                toggle.addEventListener('click', async () => {
                    await setEnabled(!state.enabled);
                    toggle.textContent = state.enabled ? '⏱️ Timer: ON' : '⏱️ Timer: OFF';
                    toggle.style.background = state.enabled ? '#4CAF50' : '#f44336';
                });
                (doc.body || doc.documentElement).appendChild(toggle);
            };
            
            if (document.body) {
                injectButton();
            } else {
                document.addEventListener('DOMContentLoaded', injectButton, { once: true });
            }
        }
    };
    
    createFallbackUI();

    await setEnabled(state.enabled);

    }

    main().catch((err) => {
        log('error', 'fatal error', err);
    });
})();
