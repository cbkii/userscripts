// ==UserScript==
// @name         Download Timer Accelerator Pro
// @namespace    https://github.com/cbkii/userscripts
// @version      2025.01.31.1200
// @description  Accelerates download countdown timers and enables download controls.
// @author       cbkii
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
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
  Feature summary:
  - Accelerates common download countdown timers.
  - Enables disabled download controls when timers finish.
  - Provides a menu toggle and keyboard shortcut (acceleration starts only when enabled).

  How it works:
  - Hooks timers, detects countdown-like delays, and shortens them when enabled.
  - Scans the DOM for timer elements and updates them faster.

  Configuration:
  - Adjust ACCELERATION_FACTOR and related constants inside main().
  - Default state is disabled; use the userscript menu or shortcut to enable.
*/

(function() {
    'use strict';

    const DEBUG = false;
    const LOG_PREFIX = '[dlcountdown]';

    function main() {

    // Configuration
    const ACCELERATION_FACTOR = 100;  // 100x speed (1000ms becomes 10ms)
    const MIN_INTERVAL_MS = 10;       // Minimum interval to prevent browser throttling
    const MAX_INTERVAL_MS = 1000;     // Maximum interval we'll consider a timer
    const STORAGE_KEY = 'download_timer_accelerator_enabled';
    
    // State management
    let isEnabled = GM_getValue(STORAGE_KEY, false);
    let menuCommandId = null;
    
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
            if (!isEnabled || !this.isTimerDelay(originalDelay)) {
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
            if (!isEnabled) return;
            
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
                            // Trigger any completion events
                            this.triggerTimerCompletion(element);
                        }
                    }, Math.max(10, Math.floor(1000 / ACCELERATION_FACTOR)));
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
                if (isEnabled && utils.isTimerDelay(delay) && utils.isCountdownCallback(callback)) {
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
                if (isEnabled && utils.isTimerDelay(delay) && utils.isCountdownCallback(callback)) {
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
            if (!isEnabled) return;
            
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
            if (!isEnabled) return;
            
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
            if (!isEnabled) return;
            
            try {
                // Pattern 1: Direct DOM manipulation for common sites
                const commonPatterns = [
                    // Disable waiting and enable download buttons
                    () => {
                        const waitElements = doc.querySelectorAll('[class*="wait"], [id*="wait"]');
                        waitElements.forEach(el => {
                            if (el.style) el.style.display = 'none';
                        });
                    },
                    
                    // Enable disabled download elements
                    () => {
                        const disabledElements = doc.querySelectorAll('.disabled, [disabled]');
                        disabledElements.forEach(el => {
                            if (el.classList.contains('disabled')) {
                                el.classList.remove('disabled');
                                el.classList.add('enabled');
                            }
                            if (el.disabled) el.disabled = false;
                        });
                    },
                    
                    // Show hidden download links
                    () => {
                        const hiddenDownloads = doc.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"]');
                        hiddenDownloads.forEach(el => {
                            if (el.href && el.href.includes('download')) {
                                el.style.display = '';
                                el.style.visibility = 'visible';
                            }
                        });
                    }
                ];
                
                // Apply patterns with delay to ensure DOM is ready
                setTimeout(() => {
                    commonPatterns.forEach(pattern => {
                        try { pattern(); } catch (e) { /* ignore */ }
                    });
                }, 500);
                
            } catch (e) {
                // Ignore errors
            }
        },
        
        // Monitor DOM for new timers
        observeTimerElements() {
            try {
                const observer = new MutationObserver((mutations) => {
                    if (!isEnabled) return;
                    
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
                if (doc.body) {
                    observer.observe(doc.body, { 
                        childList: true, 
                        subtree: true,
                        attributes: false,
                        characterData: false 
                    });
                } else {
                    doc.addEventListener('DOMContentLoaded', () => {
                        observer.observe(doc.body, { 
                            childList: true, 
                            subtree: true,
                            attributes: false,
                            characterData: false 
                        });
                    });
                }
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
    function showNotification(message, type = 'info') {
        try {
            // Remove any existing notifications
            const existingNotifications = doc.querySelectorAll('.timer-accelerator-notification');
            existingNotifications.forEach(n => n.remove());
            
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
            
            // Add animation styles if not already present
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
            
            // Auto-remove notification
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.style.animation = 'slideOutRight 0.3s ease-in';
                    setTimeout(() => {
                        if (notification.parentNode) notification.remove();
                    }, 300);
                }
            }, 4000);
            
        } catch (e) {
            console.log('Timer Accelerator:', message);
        }
    }
    
    function toggleAcceleration() {
        isEnabled = !isEnabled;
        GM_setValue(STORAGE_KEY, isEnabled);
        
        updateMenuCommand();
        
        if (isEnabled) {
            showNotification(`🚀 Download timers accelerated ${ACCELERATION_FACTOR}x!`, 'success');
            
            // Re-scan for existing timers
            setTimeout(() => {
                utils.findAndAccelerateTimerElements();
                timerAccelerator.accelerateGlobalTimers();
                timerAccelerator.handleCommonPatterns();
            }, 100);
        } else {
            showNotification('⏱️ Timer acceleration disabled - normal speed', 'info');
        }
    }
    
    function updateMenuCommand() {
        if (menuCommandId) {
            GM_unregisterMenuCommand(menuCommandId);
        }
        
        const commandText = isEnabled ? 
            `🟢 Timer Accelerator (${ACCELERATION_FACTOR}x ON)` : 
            '🔴 Timer Accelerator (OFF)';
            
        menuCommandId = GM_registerMenuCommand(commandText, toggleAcceleration);
    }
    
    // Initialize the script
    function initialize() {
        console.log('Download Timer Accelerator Pro v2.5.0 initializing...');
        
        // Initialize core acceleration system
        timerAccelerator.initializeAcceleration();
        
        // Set up menu command
        updateMenuCommand();
        
        // Keyboard shortcut: Ctrl+Alt+T
        doc.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.altKey && e.key === 'T') {
                e.preventDefault();
                toggleAcceleration();
            }
        });
        
        console.log(`Timer Accelerator initialized. Status: ${isEnabled ? 'ENABLED' : 'DISABLED'}`);
        console.log('Use Ctrl+Alt+T to toggle, or use the Tampermonkey menu');
        
        // Show status on enabled sites
        if (isEnabled) {
            setTimeout(() => {
                showNotification(`🚀 Download timers running at ${ACCELERATION_FACTOR}x speed`, 'success');
            }, 1000);
        }
        
        // Periodic re-scan for new timers
        setInterval(() => {
            if (isEnabled) {
                utils.findAndAccelerateTimerElements();
                timerAccelerator.accelerateGlobalTimers();
            }
        }, 2000);
    }
    
    // Start immediately
    initialize();

    }

    try {
        main();
    } catch (err) {
        console.error(LOG_PREFIX, 'fatal error', err);
    }
})();
