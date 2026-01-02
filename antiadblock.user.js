// ==UserScript==
// @name         Universal Anti-AdBlock Detection
// @namespace    https://github.com/cbkii/userscripts
// @version      2026.01.02.0237
// @description  Mitigates anti-adblock overlays using rule lists and profiles.
// @author       cbkii
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkYxNDkzIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTEyIDIyczgtNCA4LTEwVjVsLTgtMy04IDN2N2MwIDYgOCAxMCA4IDEweiIvPjwvc3ZnPg==
// @match        *://*/*
// @exclude      *://*/login*
// @exclude      *://*/logout*
// @exclude      *://*/signin*
// @exclude      *://*/signup*
// @exclude      *://*/register*
// @exclude      *://*/checkout*
// @exclude      *://*/billing*
// @exclude      *://*/payment*
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/antiadblock.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/antiadblock.user.js
// @homepageURL  https://github.com/cbkii/userscripts
// @supportURL   https://github.com/cbkii/userscripts/issues
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      easylist-downloads.adblockplus.org
// @connect      raw.githubusercontent.com
// ==/UserScript==

/*
  LOAD PRIORITY: 3 (Early Intervention)
  Runs at document-start to block anti-adblock scripts before they load.
  
  Feature summary:
  - Detects and neutralizes common anti-adblock overlays and gating scripts.
  - Uses remote filter lists with optional legacy fallbacks.
  - Provides a simple on-screen UI to adjust profiles and settings.

  How it works:
  - Fetches and caches rule sources, then applies safe cosmetic fixes and scriptlets.
  - Includes multiple profiles (light/medium/nuclear) to scale aggressiveness.
  - Applies fixes at document-start and after DOM readiness for dynamic pages.

  Configuration:
  - Update DEFAULTS and profile settings inside main() to tune behavior.
*/

(() => {
  'use strict';

  //////////////////////////////////////////////////////////////
  // CONSTANTS & CONFIGURATION
  //////////////////////////////////////////////////////////////

  const LOG_PREFIX = '[aab]';
  const LOG_STORAGE_KEY = 'userscript.logs.antiadblock';
  const LOG_MAX_ENTRIES = 200;
  let DEBUG = false;
  const SCRIPT_ID = 'antiadblock';
  const SCRIPT_TITLE = 'Anti-AdBlock Neutralizer';
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
  // Try to use helper from userscriptui.user.js if available, otherwise use fallback
  let sharedUi = null;
  let sharedUiReady = false;
  let registrationAttempted = false;

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
        if (typeof state !== 'undefined' && typeof renderPanel === 'function' && typeof setEnabled === 'function') {
          tryRegister(renderPanel, (next) => setEnabled(next), state.enabled);
        }
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

    // Try immediate detection
    initSharedUi();

    // Listen for shared UI ready event with proper detail consumption
    document.addEventListener('userscriptSharedUiReady', (event) => {
      setTimeout(() => {
        // Try to get factory from event detail first
        const providedFactory = event?.detail?.sharedUi;
        
        if (!sharedUiReady) {
          initSharedUi(providedFactory);
        }
        
        // Register/re-register if ready and not already done
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
          }
        }
      }, 0);
    }, { once: true });
  }
  const state = {
    enabled: true,
    started: false,
    alwaysRun: false,
    menuIds: [],
    // Resource tracking for cleanup
    resources: {
      intervals: [],
      timeouts: [],
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
  const dbg = (...args) => log('debug', ...args);

  //////////////////////////////////////////////////////////////
  // CORE LOGIC - ANTI-ADBLOCK DETECTION & NEUTRALIZATION
  //////////////////////////////////////////////////////////////

  function main() {

  /* -----------------------------
     Version / Keys
  ----------------------------- */
  const SCRIPT_ID = 'uAAB_v82';
  const STORAGE_PREFIX = `${SCRIPT_ID}.`;
  const VERSION = '8.2.0';

  const HOST = String(location.hostname || '').toLowerCase();
  const URL_HREF = String(location.href || '');

  /* -----------------------------
     Defaults
  ----------------------------- */
  const DEFAULTS = Object.freeze({
    globalEnabled: true,
    globalProfile: 'medium', // light | medium | nuclear
    debug: false,

    ui: {
      showButton: true,        // floating AAB button
      buttonCorner: 'br',      // br|bl|tr|tl
      showPanelByDefault: false,
      panelWidth: 330,
      panelCorner: 'br'
    },

    // Remote sources: prefer maintained ABP lists.
    // NOTE: Only a conservative subset is parsed (cosmetic selectors + a small set of safe scriptlets).
    remote: {
      autoUpdateHours: 24,
      timeoutMs: 12000,
      sources: {
        // These provide anti-adblock overlays/defusers.
        packs: [
          { type: 'abp', url: 'https://easylist-downloads.adblockplus.org/antiadblockfilters.txt', trust: 'high' },
          { type: 'abp', url: 'https://raw.githubusercontent.com/AdguardTeam/AdguardFilters/master/BaseFilter/sections/antiadblock.txt', trust: 'high' }
        ],
        // These provide "unbreak"/exceptions/safe-mode hints.
        excludes: [
          { type: 'abp', url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt', trust: 'high' }
        ],

        // v7 legacy JSON endpoints (optional)
        // - packsJsonUrl: custom maintained JSON packs schema (v7)
        // - excludesJsonUrl: custom maintained JSON excludes schema (v7)
        packsJsonUrl: '',
        excludesJsonUrl: ''
      }
    },

    // Legacy fallback
    legacyFallback: {
      enableLegacyHandlersWhenNoPack: true,
      allowLegacyAlongsidePacks: true
    },

    // Nuclear-only toggles (extra-dangerous)
    nuclear: {
      enableDomHardening: true,        // v7 optional (not recommended)
      enableBroadOverlaySelectors: true,
      enableBroadNetworkStubs: true,    // v7/legacy network stubs
      enableEvalFunctionHooks: true,
      enableAggressiveUxBlocks: true,   // alert/prompt/beforeunload suppression
      enableFingerprintTweaks: false,
      allowScriptlets: true,            // safe scriptlets subset
      enableGlobalCosmetics: true        // allow global "##selector" rules
    }
  });

  /* -----------------------------
     Profiles (feature sets)
  ----------------------------- */
  const PROFILE_ORDER = ['light', 'medium', 'nuclear'];
  const PROFILE_FEATURES = Object.freeze({
    light: Object.freeze({
      overlay: true,
      overlayHeuristics: false,
      bait: true,
      antiAdblockLibs: true,
      popups: false,
      network: false,
      broadNetwork: false,
      evalFunctionHooks: false,
      aggressiveUxBlocks: false,
      fingerprintTweaks: false,
      domHardening: false,
      broadOverlaySelectors: false,
      scriptlets: false
    }),
    medium: Object.freeze({
      overlay: true,
      overlayHeuristics: true,
      bait: true,
      antiAdblockLibs: true,
      popups: true,
      network: true,
      broadNetwork: false,
      evalFunctionHooks: false,
      aggressiveUxBlocks: false,
      fingerprintTweaks: false,
      domHardening: false,
      broadOverlaySelectors: false,
      scriptlets: true
    }),
    nuclear: Object.freeze({
      overlay: true,
      overlayHeuristics: true,
      bait: true,
      antiAdblockLibs: true,
      popups: true,
      network: true,
      broadNetwork: true,
      evalFunctionHooks: true,
      aggressiveUxBlocks: true,
      fingerprintTweaks: true,
      domHardening: true,
      broadOverlaySelectors: true,
      scriptlets: true
    })
  });

  const clampProfile = (profile) => PROFILE_FEATURES[profile] ? profile : 'nuclear';

  /* -----------------------------
     GM helpers
  ----------------------------- */
  const gmGet = (k, defVal) => {
    try { return GM_getValue(STORAGE_PREFIX + k, defVal); } catch (_) { return defVal; }
  };
  const gmSet = (k, v) => {
    try { GM_setValue(STORAGE_PREFIX + k, v); } catch (_) {}
  };
  const gmDel = (k) => {
    try { GM_deleteValue(STORAGE_PREFIX + k); } catch (_) {}
  };

  /* ------------------------------------------------------------------
     Pattern helpers (legacy/internal approach)
  ------------------------------------------------------------------ */
  const isRegexLiteralString = (s) => typeof s === 'string' && s.length >= 2 && s[0] === '/' && s.lastIndexOf('/') > 0;

  const compilePattern = (pat, { anchorHost = true } = {}) => {
    if (!pat) return null;

    if (pat instanceof RegExp) {
      const re = pat;
      if (String(re.source).includes('...')) return null;
      return {
        source: `re:${re.toString()}`,
        testHost: (h) => re.test(h),
        testUrl: (u) => re.test(u)
      };
    }

    if (isRegexLiteralString(pat)) {
      const lastSlash = pat.lastIndexOf('/');
      const body = pat.slice(1, lastSlash);
      const flags = pat.slice(lastSlash + 1);
      if (body.includes('...')) return null;
      try {
        const re = new RegExp(body, flags);
        return {
          source: `re:${pat}`,
          testHost: (h) => re.test(h),
          testUrl: (u) => re.test(u)
        };
      } catch (_) {
        return null;
      }
    }

    if (typeof pat === 'string') {
      const s = pat.trim().toLowerCase();
      if (!s) return null;
      if (s.includes('...')) return null;

      const wildcardToRe = (w) => {
        const esc = w.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        const reBody = esc.replace(/\*/g, '.*');
        return new RegExp(anchorHost ? `^${reBody}$` : reBody, 'i');
      };

      if (s.includes('*')) {
        const re = wildcardToRe(s);
        return {
          source: `wc:${s}`,
          testHost: (h) => re.test(h),
          testUrl: (u) => re.test(u)
        };
      }

      const re = new RegExp(`(^|\\.)${s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      return {
        source: `host:${s}`,
        testHost: (h) => re.test(h),
        testUrl: (u) => re.test(u)
      };
    }

    return null;
  };

  const matchAny = (patterns, host, url) => {
    if (!Array.isArray(patterns)) return false;
    for (const p of patterns) {
      const compiled = compilePattern(p, { anchorHost: true });
      if (!compiled) continue;
      if (compiled.testHost(host) || compiled.testUrl(url)) return true;
    }
    return false;
  };

  const hostMatches = (domain) => {
    if (!domain) return false;
    domain = String(domain).toLowerCase();
    if (domain.includes(',')) {
      return domain.split(',').some(d => hostMatches(d.trim()));
    }
    if (domain.startsWith('*.')) {
      const d = domain.slice(2);
      return HOST === d || HOST.endsWith('.' + d);
    }
    return HOST === domain || HOST.endsWith('.' + domain);
  };

  /* ------------------------------------------------------------------
     State storage (sites map)
  ------------------------------------------------------------------ */
  const getConfig = () => {
    const raw = gmGet('config', null);
    const cfg = mergeDeep(JSON.parse(JSON.stringify(DEFAULTS)), (raw && typeof raw === 'object') ? raw : {});
    DEBUG = !!cfg.debug;
    log.setDebug(DEBUG);
    return cfg;
  };

  const setConfig = (patch) => {
    const cfg = getConfig();
    const next = mergeDeep(cfg, patch || {});
    gmSet('config', next);
    DEBUG = !!next.debug;
    log.setDebug(DEBUG);
    return next;
  };

  const getSiteMap = () => gmGet('sites', {}) || {};
  const setSiteMap = (map) => gmSet('sites', map || {});

  const getSiteSetting = (host) => {
    const map = getSiteMap();
    return map[host] || {};
  };
  const setSiteSetting = (host, patch) => {
    const map = getSiteMap();
    const cur = map[host] || {};
    map[host] = mergeDeep(cur, patch || {});
    setSiteMap(map);
    return map[host];
  };

  function mergeDeep(target, source) {
    if (!source || typeof source !== 'object') return target;
    for (const k of Object.keys(source)) {
      const sv = source[k];
      const tv = target[k];
      if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
        target[k] = mergeDeep(tv, sv);
      } else {
        target[k] = sv;
      }
    }
    return target;
  }

  function computeEffectiveState() {
    const cfg = getConfig();
    const site = getSiteSetting(HOST);
    const enabled = (site.enabled !== false) && !!cfg.globalEnabled;
    const profile = clampProfile(site.profile || cfg.globalProfile);
    return {
      cfg,
      site,
      enabled,
      profile,
      features: PROFILE_FEATURES[profile]
    };
  }

  /* ------------------------------------------------------------------
     Minimal menu: global toggle only
  ------------------------------------------------------------------ */
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Toggle antiads-ALL (Global)', () => {
      const cfg = getConfig();
      setConfig({ globalEnabled: !cfg.globalEnabled });
      location.reload();
    });
  }

  /* ------------------------------------------------------------------
     UI: floating button + configuration panel
  ------------------------------------------------------------------ */

  //////////////////////////////////////////////////////////////
  // UI COMPONENTS
  //////////////////////////////////////////////////////////////

  function addStyles() {
    if (typeof GM_addStyle !== 'function') return;
    GM_addStyle(`
      #uAAB-btn{position:fixed;z-index:98769876987;border:0;border-radius:999px;
        padding:9px 11px;font:12px/1.1 system-ui,-apple-system,Segoe UI,Roboto,Arial;
        background:rgba(20,20,20,.80);color:#fff;box-shadow:0 8px 20px rgba(0,0,0,.25);opacity:.88}
      #uAAB-btn[data-off="1"]{background:rgba(120,120,120,.55);}
      #uAAB-panel{position:fixed;z-index:98769876987;background:rgba(18,18,18,.95);color:#fff;
        border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.35);font:12px/1.25 system-ui,-apple-system,Segoe UI,Roboto,Arial;
        max-height:78vh;overflow:auto;border:1px solid rgba(255,255,255,.10)}
      #uAAB-panel h3{margin:0 0 8px 0;font-size:14px}
      #uAAB-panel .row{display:flex;gap:8px;align-items:center;margin:6px 0}
      #uAAB-panel .row label{flex:1;opacity:.95}
      #uAAB-panel input[type="text"], #uAAB-panel textarea, #uAAB-panel select{
        width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.15);
        background:rgba(255,255,255,.08);color:#fff;padding:8px;outline:none
      }
      #uAAB-panel textarea{min-height:82px;resize:vertical}
      #uAAB-panel button{
        border:0;border-radius:10px;padding:8px 10px;background:rgba(255,255,255,.12);color:#fff
      }
      #uAAB-panel button.primary{background:rgba(50,160,255,.35)}
      #uAAB-panel button.danger{background:rgba(255,80,80,.35)}
      #uAAB-panel .muted{opacity:.75}
      #uAAB-backdrop{position:fixed;inset:0;z-index:98769876987;background:rgba(0,0,0,.25)}
    `);
  }

  function placeCorner(el, corner, padPx) {
    const pad = `${padPx}px`;
    el.style.top = el.style.right = el.style.bottom = el.style.left = 'auto';
    switch (corner) {
      case 'tl': el.style.top = pad; el.style.left = pad; break;
      case 'tr': el.style.top = pad; el.style.right = pad; break;
      case 'bl': el.style.bottom = pad; el.style.left = pad; break;
      default: el.style.bottom = pad; el.style.right = pad; break;
    }
  }

  function toast(msg) {
    try {
      if (!document.documentElement) return;
      const el = document.createElement('div');
      el.textContent = msg;
      el.style.cssText = `
        position:fixed;left:50%;bottom:18px;transform:translateX(-50%);
        background:rgba(0,0,0,.85);color:#fff;padding:10px 12px;border-radius:10px;
        font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Arial;
        z-index:98769876987;max-width:92vw;white-space:pre-wrap;
      `;
      document.documentElement.appendChild(el);
      setTimeout(() => { try { el.remove(); } catch (_) {} }, 1600);
    } catch (_) {}
  }

  function ensureUi() {
    const state = computeEffectiveState();
    const { cfg } = state;

    if (!cfg.ui.showButton) return;

    const attach = () => {
      addStyles();
      if (document.getElementById('uAAB-btn')) return;

      const btn = document.createElement('button');
      btn.id = 'uAAB-btn';
      btn.type = 'button';
      btn.dataset.off = state.enabled ? '0' : '1';
      btn.textContent = state.enabled ? `AAB ${state.profile}` : 'AAB OFF';
      placeCorner(btn, cfg.ui.buttonCorner || 'br', 12);

      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        // Short tap: toggle site, long press: open panel
      });

      let pressTimer = null;
      btn.addEventListener('pointerdown', () => {
        pressTimer = setTimeout(() => {
          pressTimer = null;
          openPanel();
        }, 420);
      }, true);

      const clearPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
      btn.addEventListener('pointerup', () => {
        if (pressTimer) {
          clearPress();
          // toggle site on short press
          const cur = getSiteSetting(HOST);
          const eff = computeEffectiveState();
          const nextEnabled = !(eff.enabled && (cur.enabled !== false));
          setSiteSetting(HOST, { enabled: nextEnabled });
          toast(`AAB ${nextEnabled ? 'enabled' : 'disabled'} for ${HOST}. Reloading...`);
          setTimeout(() => location.reload(), 350);
        }
      }, true);
      btn.addEventListener('pointercancel', clearPress, true);
      btn.addEventListener('pointerleave', clearPress, true);

      document.documentElement.appendChild(btn);

      if (cfg.ui.showPanelByDefault) openPanel();
    };

    if (document.documentElement) attach();
    else {
      const t = setInterval(() => {
        if (document.documentElement) { clearInterval(t); attach(); }
      }, 25);
      setTimeout(() => clearInterval(t), 5000);
    }
  }

  function openPanel() {
    if (!document.documentElement) return;
    if (document.getElementById('uAAB-panel')) return;

    const state = computeEffectiveState();
    const { cfg, site } = state;

    const backdrop = document.createElement('div');
    backdrop.id = 'uAAB-backdrop';
    backdrop.addEventListener('click', closePanel, true);

    const panel = document.createElement('div');
    panel.id = 'uAAB-panel';
    panel.style.width = `${Math.max(260, Math.min(420, cfg.ui.panelWidth || 330))}px`;
    placeCorner(panel, cfg.ui.panelCorner || 'br', 14);

    const packsJson = JSON.stringify(cfg.remote.sources.packs || [], null, 2);
    const excludesJson = JSON.stringify(cfg.remote.sources.excludes || [], null, 2);

    const lastPacksTs = gmGet('remote.abp.packs.ts', 0);
    const lastExclTs  = gmGet('remote.abp.excludes.ts', 0);

    panel.innerHTML = `
      <div style="padding:12px 12px 10px 12px;">
        <h3>antiads-ALL v${VERSION}</h3>
        <div class="muted">Host: ${HOST}</div>
        <div class="row"><label>Global enabled</label><input id="uAAB-global" type="checkbox" ${cfg.globalEnabled ? 'checked' : ''}></div>
        <div class="row"><label>Site enabled</label><input id="uAAB-site" type="checkbox" ${(site.enabled !== false) ? 'checked' : ''}></div>
        <div class="row"><label>Profile</label>
          <select id="uAAB-profile">
            ${PROFILE_ORDER.map(p => `<option value="${p}" ${state.profile === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
        </div>
        <div class="row"><label>Debug</label><input id="uAAB-debug" type="checkbox" ${cfg.debug ? 'checked' : ''}></div>

        <hr style="border:0;border-top:1px solid rgba(255,255,255,.10);margin:10px 0">

        <div><b>Remote sources</b></div>
        <div class="muted" style="margin:4px 0 6px 0;">Packs last update: ${lastPacksTs ? new Date(lastPacksTs).toLocaleString() : 'never'}</div>
        <textarea id="uAAB-packs" spellcheck="false">${escapeHtml(packsJson)}</textarea>

        <div class="muted" style="margin:8px 0 6px 0;">Excludes last update: ${lastExclTs ? new Date(lastExclTs).toLocaleString() : 'never'}</div>
        <textarea id="uAAB-excludes" spellcheck="false">${escapeHtml(excludesJson)}</textarea>

        <div class="row"><label>Legacy packsJsonUrl</label><input id="uAAB-packsJsonUrl" type="text" value="${escapeHtml(cfg.remote.sources.packsJsonUrl || '')}"></div>
        <div class="row"><label>Legacy excludesJsonUrl</label><input id="uAAB-excludesJsonUrl" type="text" value="${escapeHtml(cfg.remote.sources.excludesJsonUrl || '')}"></div>

        <div class="row" style="justify-content:space-between;">
          <button id="uAAB-close">Close</button>
          <button id="uAAB-refresh" class="primary">Update lists now</button>
          <button id="uAAB-save" class="primary">Save</button>
        </div>

        <div class="row" style="justify-content:space-between;">
          <button id="uAAB-clearCache" class="danger">Clear caches</button>
          <button id="uAAB-reset" class="danger">Reset settings</button>
        </div>

        <div class="muted" style="margin-top:8px;">
          Tap button = toggle site. Long-press button = open this panel.
        </div>
      </div>
    `;

    function closePanel() {
      try { backdrop.remove(); } catch (_) {}
      try { panel.remove(); } catch (_) {}
    }

    panel.querySelector('#uAAB-close').onclick = closePanel;

    panel.querySelector('#uAAB-save').onclick = () => {
      const nextCfg = getConfig();
      nextCfg.globalEnabled = !!panel.querySelector('#uAAB-global').checked;
      nextCfg.debug = !!panel.querySelector('#uAAB-debug').checked;

      const nextSites = getSiteMap();
      nextSites[HOST] = nextSites[HOST] || {};
      nextSites[HOST].enabled = !!panel.querySelector('#uAAB-site').checked;
      nextSites[HOST].profile = panel.querySelector('#uAAB-profile').value;

      const packsTxt = panel.querySelector('#uAAB-packs').value;
      const exclTxt = panel.querySelector('#uAAB-excludes').value;

      try {
        const packs = JSON.parse(packsTxt);
        if (!Array.isArray(packs)) throw new Error('packs must be array');
        nextCfg.remote.sources.packs = packs;
      } catch (e) {
        toast('Invalid packs JSON (must be an array of {type,url,trust}).');
        return;
      }

      try {
        const exc = JSON.parse(exclTxt);
        if (!Array.isArray(exc)) throw new Error('excludes must be array');
        nextCfg.remote.sources.excludes = exc;
      } catch (e) {
        toast('Invalid excludes JSON (must be an array of {type,url,trust}).');
        return;
      }

      nextCfg.remote.sources.packsJsonUrl = panel.querySelector('#uAAB-packsJsonUrl').value.trim();
      nextCfg.remote.sources.excludesJsonUrl = panel.querySelector('#uAAB-excludesJsonUrl').value.trim();

      gmSet('config', nextCfg);
      gmSet('sites', nextSites);
      toast('Saved. Reloading…');
      setTimeout(() => location.reload(), 350);
    };

    panel.querySelector('#uAAB-refresh').onclick = async () => {
      toast('Updating lists…');
      try {
        await updateAllRemotes(true);
        toast('Lists updated. Reloading…');
        setTimeout(() => location.reload(), 450);
      } catch (_) {
        toast('Update failed (see console if debug).');
      }
    };

    panel.querySelector('#uAAB-clearCache').onclick = () => {
      clearCaches();
      toast('Caches cleared.');
    };

    panel.querySelector('#uAAB-reset').onclick = () => {
      gmDel('config');
      gmDel('sites');
      clearCaches();
      toast('Reset done. Reloading…');
      setTimeout(() => location.reload(), 450);
    };

    document.documentElement.appendChild(backdrop);
    document.documentElement.appendChild(panel);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  /* ------------------------------------------------------------------
     Remote fetch (ETag/Last-Modified, per-source) + caching
  ------------------------------------------------------------------ */
  const gmRequest = (opts) => new Promise((resolve, reject) => {
    if (typeof GM_xmlhttpRequest !== 'function') return reject(new Error('GM_xmlhttpRequest not available'));
    try {
      GM_xmlhttpRequest({
        method: 'GET',
        url: opts.url,
        headers: opts.headers || {},
        timeout: opts.timeoutMs || 12000,
        responseType: 'text',
        onload: (resp) => resolve(resp),
        onerror: (e) => reject(e),
        ontimeout: (e) => reject(e)
      });
    } catch (e) {
      reject(e);
    }
  });

  const parseHeader = (headersText, name) => {
    if (!headersText) return '';
    const re = new RegExp(`^${name}:\\s*(.+)$`, 'im');
    const m = headersText.match(re);
    return m ? String(m[1]).trim() : '';
  };

  const safeJsonParse = (txt) => {
    try { return JSON.parse(txt); } catch (_) { return null; }
  };

  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }

  function clearCaches() {
    // wipe known cache namespaces
    for (const k of Object.keys(gmGet(null, {}) || {})) { /* noop */ }
    // Tampermonkey doesn't provide "list keys". We'll clear our known keys using prefixes.
    // (We keep this minimal and deterministic.)
    const prefixes = [
      'remote.abp.packs.',
      'remote.abp.excludes.',
      'remote.json.packs.',
      'remote.json.excludes.',
      'cache.host.'
    ];
    // We can't enumerate keys reliably; keep a dedicated index.
    const idx = gmGet('cache.index', []);
    if (Array.isArray(idx)) {
      for (const key of idx) gmDel(key);
    }
    gmDel('cache.index');
    // Also remove known timestamps
    gmDel('remote.abp.packs.ts'); gmDel('remote.abp.excludes.ts');
    gmDel('remote.json.packs.ts'); gmDel('remote.json.excludes.ts');
  }

  function cacheIndexAdd(key) {
    const idx = gmGet('cache.index', []);
    if (Array.isArray(idx) && !idx.includes(key)) {
      idx.push(key);
      gmSet('cache.index', idx);
    }
  }

  async function fetchTextWithCache(namespace, url, timeoutMs, force) {
    const etagKey = `${namespace}.etag.${hashStr(url)}`;
    const lmKey = `${namespace}.lm.${hashStr(url)}`;
    const dataKey = `${namespace}.data.${hashStr(url)}`;
    const tsKey = `${namespace}.ts`;

    cacheIndexAdd(etagKey); cacheIndexAdd(lmKey); cacheIndexAdd(dataKey); cacheIndexAdd(tsKey);

    const cfg = getConfig();
    const maxAge = (cfg.remote.autoUpdateHours || 24) * 3600000;

    if (!force) {
      const lastTs = gmGet(tsKey, 0);
      if (lastTs && (Date.now() - lastTs) < maxAge) {
        const cached = gmGet(dataKey, '');
        if (cached) return { ok: true, updated: false, text: cached, etag: gmGet(etagKey, ''), lm: gmGet(lmKey, '') };
      }
    }

    const headers = {};
    const oldEtag = gmGet(etagKey, '');
    const oldLm = gmGet(lmKey, '');
    if (oldEtag) headers['If-None-Match'] = oldEtag;
    if (oldLm) headers['If-Modified-Since'] = oldLm;

    let resp;
    try {
      resp = await gmRequest({ url, headers, timeoutMs: timeoutMs || cfg.remote.timeoutMs });
    } catch (e) {
      dbg('fetchTextWithCache failed', url, e);
      const cached = gmGet(dataKey, '');
      if (cached) return { ok: true, updated: false, text: cached, stale: true };
      return { ok: false, reason: 'fetch-failed' };
    }

    const status = Number(resp.status || 0);
    if (status === 304) {
      gmSet(tsKey, Date.now());
      return { ok: true, updated: false, text: gmGet(dataKey, ''), etag: oldEtag, lm: oldLm };
    }

    const txt = String(resp.responseText || '');
    if (!txt) return { ok: false, reason: 'empty' };

    const etag = parseHeader(resp.responseHeaders, 'etag');
    const lm = parseHeader(resp.responseHeaders, 'last-modified');

    gmSet(dataKey, txt);
    gmSet(tsKey, Date.now());
    if (etag) gmSet(etagKey, etag);
    if (lm) gmSet(lmKey, lm);

    return { ok: true, updated: true, text: txt, etag, lm };
  }

  /* ------------------------------------------------------------------
     ABP/uBO/AdGuard parsing (conservative)
     - Cosmetic rules:
         domain##selector   -> remove selector (site-scoped)
         ##selector         -> global cosmetic (NUCLEAR only, configurable)
         domain#@#selector  -> exception: excludes selector for that domain
     - uBO scriptlets:
         domain##+js(name,arg1,arg2,...)
     - AdGuard scriptlets (basic):
         domain#%#//scriptlet('name', 'arg1', 'arg2')
  ------------------------------------------------------------------ */

  function splitCsvDomain(dom) {
    return String(dom || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  function parseUboJsArgs(rest) {
    // rest is content inside (...)
    // allow commas inside quoted strings minimally
    const out = [];
    let cur = '';
    let q = null;
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (q) {
        cur += ch;
        if (ch === q && rest[i - 1] !== '\\') q = null;
      } else {
        if (ch === '"' || ch === "'") { q = ch; cur += ch; }
        else if (ch === ',') { out.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
    }
    if (cur.trim()) out.push(cur.trim());
    // strip surrounding quotes
    return out.map(s => s.replace(/^['"]|['"]$/g, ''));
  }

  function parseABP(text) {
    const lines = text.split(/\r?\n/);
    const res = {
      selectorsByDomain: new Map(),     // domain -> Set(selectors)
      globalSelectors: new Set(),       // ##selector
      exceptionsByDomain: new Map(),    // domain -> Set(selectors)
      scriptletsByDomain: new Map(),    // domain -> [{name,args[]}]
      globalScriptlets: [],             // no-domain scriptlets (rare)
      hostHints: new Set()              // best-effort: domains seen
    };

    const addSel = (map, d, sel) => {
      if (!d || !sel) return;
      const key = d.toLowerCase();
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(sel);
    };

    const addScriptlet = (map, d, obj) => {
      const key = (d || '').toLowerCase();
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(obj);
    };

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('!')) continue;

      // Exception cosmetic
      if (line.includes('#@#')) {
        const [dom, sel] = line.split('#@#');
        if (sel) {
          const domains = splitCsvDomain(dom);
          for (const d of domains) {
            addSel(res.exceptionsByDomain, d, sel.trim());
            res.hostHints.add(d);
          }
        }
        continue;
      }

      // uBO scriptlet: domain##+js(...)
      if (line.includes('##+js(')) {
        const [dom, rest0] = line.split('##+js(');
        const rest = rest0.endsWith(')') ? rest0.slice(0, -1) : rest0;
        const args = parseUboJsArgs(rest);
        const name = args.shift();
        if (name) {
          const domains = splitCsvDomain(dom);
          if (!domains.length) {
            res.globalScriptlets.push({ name, args });
          } else {
            for (const d of domains) { addScriptlet(res.scriptletsByDomain, d, { name, args }); res.hostHints.add(d); }
          }
        }
        continue;
      }

      // AdGuard scriptlet: domain#%#//scriptlet('name', 'a', 'b')
      if (line.includes('#%#//scriptlet(')) {
        const [dom, rest0] = line.split('#%#//scriptlet(');
        let rest = rest0.trim();
        if (rest.endsWith(')')) rest = rest.slice(0, -1);
        // args are quoted, comma-separated
        const args = parseUboJsArgs(rest);
        const name = args.shift();
        if (name) {
          const domains = splitCsvDomain(dom);
          if (!domains.length) {
            res.globalScriptlets.push({ name, args });
          } else {
            for (const d of domains) { addScriptlet(res.scriptletsByDomain, d, { name, args }); res.hostHints.add(d); }
          }
        }
        continue;
      }

      // Cosmetic: domain##selector OR ##selector
      if (line.includes('##')) {
        const [dom, sel] = line.split('##');
        if (!sel) continue;
        const selector = sel.trim();
        if (!selector) continue;

        const domains = splitCsvDomain(dom);
        if (!domains.length) {
          res.globalSelectors.add(selector);
        } else {
          for (const d of domains) {
            addSel(res.selectorsByDomain, d, selector);
            res.hostHints.add(d);
          }
        }
        continue;
      }
    }

    return res;
  }

  /* ------------------------------------------------------------------
     Scriptlets (SAFE WHITELIST)
     - We DO NOT execute arbitrary remote JS.
     - We execute a small, explicit set of safe operations.
  ------------------------------------------------------------------ */
  const SCRIPTLETS = {
    'set-constant': (args) => {
      // args: [path, value]
      const path = args[0];
      const valueRaw = args[1];
      if (!path) return;
      // interpret value: true/false/null/number/string
      let value = valueRaw;
      if (valueRaw === 'true') value = true;
      else if (valueRaw === 'false') value = false;
      else if (valueRaw === 'null') value = null;
      else if (valueRaw === 'undefined') value = undefined;
      else if (typeof valueRaw === 'string' && valueRaw !== '' && !isNaN(Number(valueRaw))) value = Number(valueRaw);

      const parts = String(path).split('.').filter(Boolean);
      let obj = window;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        if (!(k in obj)) obj[k] = {};
        obj = obj[k];
      }
      const last = parts[parts.length - 1];
      try { obj[last] = value; } catch (_) {}
    },

    'abort-on-property-read': (args) => {
      const path = args[0];
      if (!path) return;
      const parts = String(path).split('.').filter(Boolean);
      let obj = window;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        if (!(k in obj)) obj[k] = {};
        obj = obj[k];
      }
      const last = parts[parts.length - 1];
      try {
        Object.defineProperty(obj, last, {
          configurable: true,
          get() { throw new Error('uAAB abort-on-property-read'); }
        });
      } catch (_) {}
    },

    'abort-on-property-write': (args) => {
      const path = args[0];
      if (!path) return;
      const parts = String(path).split('.').filter(Boolean);
      let obj = window;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        if (!(k in obj)) obj[k] = {};
        obj = obj[k];
      }
      const last = parts[parts.length - 1];
      try {
        Object.defineProperty(obj, last, {
          configurable: true,
          set() { throw new Error('uAAB abort-on-property-write'); }
        });
      } catch (_) {}
    }
  };

  function applyScriptlets(list) {
    for (const s of list) {
      const fn = SCRIPTLETS[s.name];
      if (!fn) continue;
      try { fn(s.args || []); } catch (e) { dbg('scriptlet failed', s, e); }
    }
  }

  /* ------------------------------------------------------------------
     Remote loading orchestration
     - ABP packs/excludes from sources arrays
     - Legacy JSON (v7) optional
     - Parsed cache stored; per-host match cache stored
  ------------------------------------------------------------------ */

  async function loadAbpKind(kind, force) {
    const state = computeEffectiveState();
    const { cfg } = state;

    const sources = (cfg.remote.sources && cfg.remote.sources[kind]) || [];
    const namespace = `remote.abp.${kind}`;

    const parsedAll = [];
    const metas = [];

    for (const src of sources) {
      if (!src || !src.url || src.type !== 'abp') continue;
      const r = await fetchTextWithCache(namespace, src.url, cfg.remote.timeoutMs, !!force);
      if (r.ok && r.text) {
        parsedAll.push(parseABP(r.text));
        metas.push({ url: src.url, etag: r.etag || '', lm: r.lm || '', updated: !!r.updated });
      }
    }

    gmSet(`${namespace}.meta`, metas);
    gmSet(`${namespace}.ts`, Date.now());
    cacheIndexAdd(`${namespace}.meta`);
    cacheIndexAdd(`${namespace}.ts`);

    return { parsedAll, metas };
  }

  async function loadLegacyJson(kind, force) {
    const state = computeEffectiveState();
    const { cfg } = state;

    const url = kind === 'packs' ? (cfg.remote.sources.packsJsonUrl || '') : (cfg.remote.sources.excludesJsonUrl || '');
    if (!url) return { ok: false, reason: 'no-url', data: null };

    const namespace = `remote.json.${kind}`;
    const r = await fetchTextWithCache(namespace, url, cfg.remote.timeoutMs, !!force);
    if (!r.ok || !r.text) return { ok: false, reason: r.reason || 'fetch-failed', data: null };

    const json = safeJsonParse(r.text);
    if (!json) return { ok: false, reason: 'bad-json', data: null };

    gmSet(`${namespace}.ts`, Date.now());
    cacheIndexAdd(`${namespace}.ts`);
    return { ok: true, updated: !!r.updated, data: json };
  }

  async function updateAllRemotes(force) {
    await loadAbpKind('packs', force);
    await loadAbpKind('excludes', force);
    await loadLegacyJson('packs', force);
    await loadLegacyJson('excludes', force);
  }

  function buildSignature() {
    const cfg = getConfig();
    const s = JSON.stringify(cfg.remote.sources || {}, null, 0) + '|' + String(gmGet('remote.abp.packs.ts', 0)) + '|' + String(gmGet('remote.abp.excludes.ts', 0)) + '|' + String(gmGet('remote.json.packs.ts', 0)) + '|' + String(gmGet('remote.json.excludes.ts', 0));
    return hashStr(s);
  }

  function getHostCacheKey() {
    return `cache.host.${HOST}.${buildSignature()}`;
  }

  /* ------------------------------------------------------------------
     DOM actions
  ------------------------------------------------------------------ */
  function removeSelectors(selectors) {
    if (!selectors || !selectors.length) return;
    for (const sel of selectors) {
      try { document.querySelectorAll(sel).forEach(el => el.remove()); } catch (_) {}
    }
  }

  function unfreezeScroll() {
    try {
      document.documentElement.style.overflow = 'auto';
      if (document.body) document.body.style.overflow = 'auto';
    } catch (_) {}
  }

  /* ------------------------------------------------------------------
     v6/v7 legacy handlers (fallback)
     NOTE: kept as-is from v7, but destructive actions remain a known risk.
  ------------------------------------------------------------------ */
  const noop = () => {};

  const LEGACY_HANDLERS = [
    {
      pattern: /(^|\.)?(1fichier|uptobox|katfile|turbobit|nitroflare|uploadhaven|rockfile|megaup|megadl|zippyshare|krakenfiles|hexupload|anonfiles|send\.cm|mirrorace|clicknupload|clicksud|racaty|dropapk|gigapeta|1dl|dl-rapid|up-load|upload-4ever|uploadrar|upfiles|upfion|upfichiers|file-upload|linkbox|upstore|mixrootmod|temp\.sh|filelions|dlfree|upcloud)\.(com|net|org|io|to|cloud|sh|xyz)$/i,
      handler: () => {
        const selectors = [
          '#adBlockModal', '#disable-adblock', '.adblock-warning', '.adblock-popup',
          '#adblock-modal', '.adblock-overlay', '#overlay',
          '.popupOverlay', '.popupWrapper', '.modal-backdrop',
          '.blockAdblock', '.AntiAdBlock', '#noadblock', '.ab-overlay'
        ];
        selectors.forEach(sel => { try { document.querySelectorAll(sel).forEach(el => el.remove()); } catch (_) {} });
        try { document.body && (document.body.style.overflow = 'auto'); } catch (_) {}
        try { document.documentElement.style.overflow = 'auto'; } catch (_) {}

        try {
          document.querySelectorAll('button[disabled], input[disabled]').forEach(el => {
            el.disabled = false;
            el.style.pointerEvents = 'auto';
            el.style.opacity = '1';
          });
        } catch (_) {}
      }
    },
    {
      pattern: /(^|\.)?(upfiles|upfion|megaup|upload-4ever|uploadrar|dl-rapid|up-load|uploadhaven|1dl)\.(com|net|org|io|cloud)$/i,
      handler: () => {
        const form = document.querySelector('#free-download-form');
        if (form && form.querySelector('.alert-danger')) {
          const btn = document.createElement('button');
          btn.type = 'submit';
          btn.className = 'btn btn-success btn-lg';
          btn.textContent = 'Continue Download';
          form.innerHTML = '';
          form.appendChild(btn);
        }
      }
    },
    {
      pattern: /(^|\.)?(upfiles|upfion|uploadrar|dl-rapid|up-load|uploadhaven|rockfile|upcloud)\.(com|net|org|io|cloud)$/i,
      handler: () => {
        try {
          history.pushState = () => {};
          history.replaceState = () => {};
          window.onpopstate = null;
        } catch (_) {}
      }
    },
    {
      pattern: /(^|\.)?(streamtape|dood|fembed|streamsb|streamlare|vidcloud|voe|upstream|vidhide|filemoon|mixdrop)\.(com|net|org|to|io)$/i,
      handler: () => {
        // WARNING: destructive; kept for legacy compatibility only (runs only in NUCLEAR profile by default)
        try { localStorage.clear(); sessionStorage.clear(); } catch (_) {}
      }
    },
    {
      pattern: /(^|\.)?(streamwish|youwatch|exashare|videomega|watchers|clipwatching|flashx|openload|oload|streamango|vidtodo|vidlox|rapidvideo|thevideo|vidstream|vidmoly|voe|netu|mp4upload|streamlare|dood|streamtape)\.(com|org|net|to|io)$/i,
      handler: () => {
        window.adsShowPopup1 = 1;
        window.popAdsLoaded = true;
        window.disablePopunder = true;
        window.isBlockAds2 = false;
        window.blockAdBlock = undefined;
        window.FuckAdBlock = undefined;
      }
    },
    { pattern: /(^|\.)?(kissanime)\.com$/i, handler: () => { window.DoDetect2 = null; } },
    {
      pattern: /(^|\.)?(9anime|an1me|animeflv|animekisa|gogoanime|animixplay)\.(to|se|tv|ru|com|io)$/i,
      handler: () => { window.isBlockAds2 = false; window.blockAdBlock = null; }
    },
    {
      pattern: /(^|\.)?(mega\.nz)$/i,
      handler: () => {
        try { document.querySelectorAll('#overlay,.adblock-overlay').forEach(n => n.remove()); } catch (_) {}
        try { document.querySelectorAll('button[disabled]').forEach(b => b.disabled = false); } catch (_) {}
      }
    },
    { pattern: /(^|\.)?(rapidgator\.net)$/i, handler: () => { try { document.querySelectorAll('.adblock-popup,#adblock-modal').forEach(n => n.remove()); } catch (_) {} } },
    {
      pattern: /(^|\.)?(blogspot\.com)$/i,
      handler: () => {
        try {
          if (location.pathname.indexOf('/ncr/') === -1) {
            const blog = location.host.split('.')[0];
            location.href = `http://${blog}.blogspot.com/ncr/${location.pathname.slice(1)}`;
          }
        } catch (_) {}
      }
    },
    { pattern: /(^|\.)?(hentaihaven\.org)$/i, handler: () => { try { localStorage.setItem('hh_ppndr1','1'); localStorage.setItem('hh_ppndr2','1'); } catch (_) {} } },
    { pattern: /(^|\.)?(binbucks\.com)$/i, handler: () => { window.testJuicyPay = true; window.testSensePay = true; } },
    {
      pattern: /(^|\.)?(vipleague\.)/i,
      handler: () => {
        window.iExist = true;
        try { localStorage.setItem('xclsvip', '1'); } catch (_) {}
        try { document.querySelectorAll('.vip_052x003, .vip_09x827').forEach(el => el.style.height = '1px'); } catch (_) {}
        try { document.querySelector('#overlay')?.remove(); } catch (_) {}
      }
    },
    {
      pattern: /(^|\.)?(mixrootmod\.com)$/i,
      handler: () => {
        try { document.getElementById('adBlockModal')?.remove(); } catch (_) {}
        window.AdBDetected = noop;
        window.AdBPageReload = noop;
      }
    }
  ];

  const LEGACY_SAFE_MODE_REGEX = /(^|\.)?(upfiles|upfion|upfichiers|upload-4ever|uploadrar|dl-rapid|up-load|uploadhaven|megaup|1dl|temp\.sh|anonfiles)\.(com|net|org|io|cloud|sh)$/i;

  function runLegacyHandlers(profile) {
    // By policy: only run destructive legacy parts in NUCLEAR unless user explicitly wants otherwise.
    const state = computeEffectiveState();
    const cfg = state.cfg;

    for (const entry of LEGACY_HANDLERS) {
      if (!entry || !entry.pattern || typeof entry.handler !== 'function') continue;
      try {
        if (entry.pattern.test(HOST)) {
          if (profile !== 'nuclear') {
            // skip clearly dangerous ones outside nuclear (storage clears)
            if (String(entry.pattern).includes('streamtape') || String(entry.pattern).includes('streamwish')) continue;
          }
          entry.handler();
        }
      } catch (e) { dbg('Legacy handler error', e); }
    }

    if (profile === 'nuclear' && cfg.nuclear.enableBroadOverlaySelectors) {
      removeSelectors(['#adblock', '.adblock', '.adblock-modal', '.overlay', '.modal-backdrop']);
      unfreezeScroll();
    }
  }

  /* ------------------------------------------------------------------
     Main rule application (primary + fallback)
  ------------------------------------------------------------------ */
  function computeHostRulesFromParsed(parsedPacks, parsedExcludes) {
    const state = computeEffectiveState();
    const { cfg, profile, features } = state;

    // Safe-mode clamp based on v7 legacy SAFE_MODE regex + excludes lists host hints
    const safeModeHost = LEGACY_SAFE_MODE_REGEX.test(HOST);

    // Build effective selectors/scriptlets
    const selectors = new Set();
    const scriptlets = [];

    // Exclusions: treat exclude lists as "safe mode hints" only (do not try to parse unbreak fully).
    let safeByRemote = false;
    for (const ex of parsedExcludes) {
      for (const d of (ex.hostHints || new Set())) {
        if (hostMatches(d)) { safeByRemote = true; break; }
      }
      if (safeByRemote) break;
    }

    const clampToLight = (safeModeHost || safeByRemote) && !getSiteSetting(HOST).profile;
    const effectiveProfile = clampToLight ? 'light' : profile;
    const effFeatures = PROFILE_FEATURES[effectiveProfile];

    // Packs
    for (const pack of parsedPacks) {
      // domain-specific selectors
      for (const [dom, sels] of pack.selectorsByDomain.entries()) {
        if (!hostMatches(dom)) continue;

        // subtract exceptions (domain-specific)
        const exc = pack.exceptionsByDomain.get(dom) || new Set();
        for (const s of sels.values()) if (!exc.has(s)) selectors.add(s);
      }

      // global cosmetics only in nuclear (and user enabled)
      if (effectiveProfile === 'nuclear' && cfg.nuclear.enableGlobalCosmetics) {
        for (const s of pack.globalSelectors.values()) selectors.add(s);
      }

      // scriptlets
      if (effFeatures.scriptlets && (effectiveProfile === 'nuclear' ? cfg.nuclear.allowScriptlets : true)) {
        for (const [dom, lst] of pack.scriptletsByDomain.entries()) {
          if (!hostMatches(dom)) continue;
          for (const s of lst) scriptlets.push(s);
        }
        // global scriptlets only in nuclear
        if (effectiveProfile === 'nuclear' && cfg.nuclear.allowScriptlets) {
          for (const s of pack.globalScriptlets) scriptlets.push(s);
        }
      }
    }

    // Heuristic broad selectors (medium+), but keep conservative
    const heurSelectors = [];
    if (effFeatures.overlayHeuristics) {
      heurSelectors.push('[class*="adblock"]', '[id*="adblock"]');
    }

    // Nuclear broad overlays
    const nuclearBroad = [];
    if (effectiveProfile === 'nuclear' && cfg.nuclear.enableBroadOverlaySelectors) {
      nuclearBroad.push('#adblock', '.adblock', '.adblock-modal', '[data-adblock]');
    }

    return {
      effectiveProfile,
      features: effFeatures,
      selectors: Array.from(selectors),
      heurSelectors,
      nuclearBroad,
      scriptlets,
      clampToLight
    };
  }

  async function computeAndCacheHostRules(forceUpdate) {
    const state = computeEffectiveState();
    const { cfg } = state;

    const cacheKey = getHostCacheKey();
    cacheIndexAdd(cacheKey);

    if (!forceUpdate) {
      const cached = gmGet(cacheKey, null);
      if (cached && cached.host === HOST && cached.signature === buildSignature()) return cached.rules;
    }

    // ensure remote caches are fresh when needed
    await updateAllRemotes(!!forceUpdate);

    // Load ABP parsed data (by re-parsing from cached source blobs each time would be expensive;
    // but we already keep per-source cached texts; compute rules now from fetched text via loadAbpKind)
    const packs = await loadAbpKind('packs', false);
    const excl  = await loadAbpKind('excludes', false);

    const parsedPacks = packs.parsedAll || [];
    const parsedExcl  = excl.parsedAll || [];

    const rules = computeHostRulesFromParsed(parsedPacks, parsedExcl);

    gmSet(cacheKey, {
      host: HOST,
      signature: buildSignature(),
      rules
    });

    return rules;
  }

  /* ------------------------------------------------------------------
     Execute actions for this document
  ------------------------------------------------------------------ */
  function applyOverlayFixes(rules) {
    if (!rules) return;
    removeSelectors(rules.selectors);
    removeSelectors(rules.heurSelectors);
    removeSelectors(rules.nuclearBroad);
    unfreezeScroll();
  }

  /* ------------------------------------------------------------------
     Entry
  ------------------------------------------------------------------ */
  ensureUi();

  const state0 = computeEffectiveState();
  const { enabled, cfg, profile } = state0;

  if (!enabled) return;

  (async () => {
    try {
      const rules = await computeAndCacheHostRules(false);

      // Apply scriptlets as early as possible (document-start), before DOM may change
      if (rules && rules.scriptlets && rules.scriptlets.length) {
        const st = computeEffectiveState();
        if (st.profile === 'nuclear' ? st.cfg.nuclear.allowScriptlets : st.features.scriptlets) {
          applyScriptlets(rules.scriptlets);
        }
      }

      // Apply overlays/cosmetics immediately, and again after DOM loads
      if (rules) applyOverlayFixes(rules);

      // Legacy JSON packs/excludes (v7 schema) + legacy handlers fallback
      const legacyPacks = (await loadLegacyJson('packs', false)).data;
      const legacyExcl  = (await loadLegacyJson('excludes', false)).data;

      // Decide if we have "any pack match" from ABP rules
      const hadPackMatch = rules && (rules.selectors.length || rules.scriptlets.length || rules.heurSelectors.length || rules.nuclearBroad.length);

      // Apply legacy packs if present (best-effort, v7 schema)
      // Expected pack schema (v7): { packs: [ { name, match:[...], profileMin, actions:{ removeSelectors:[...], ... } } ] }
      if (legacyPacks && legacyPacks.packs && Array.isArray(legacyPacks.packs)) {
        for (const p of legacyPacks.packs) {
          try {
            if (!p) continue;
            const patterns = p.match || p.matches || p.patterns || [];
            const matched = matchAny(patterns, HOST, URL_HREF);
            if (!matched) continue;
            if (p.actions && p.actions.removeSelectors) removeSelectors(p.actions.removeSelectors);
            if (p.actions && p.actions.unfreezeScroll) unfreezeScroll();
          } catch (e) { dbg('legacy pack apply error', e); }
        }
      }

      // Legacy fallback handlers
      const allowLegacy = cfg.legacyFallback.allowLegacyAlongsidePacks;
      const doLegacy = cfg.legacyFallback.enableLegacyHandlersWhenNoPack && (!hadPackMatch || allowLegacy);
      if (doLegacy) runLegacyHandlers(profile);

      // Retry overlay fixes after DOM has content
      const once = () => { try { applyOverlayFixes(rules); } catch (_) {} };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', once, { once: true, capture: true });
        window.addEventListener('load', once, { once: true, capture: true });
        setTimeout(once, 800);
        setTimeout(once, 2500);
      } else {
        once();
        setTimeout(once, 1200);
      }

      // FreeDlink-specific: Spoof adblock detection
      if (HOST.endsWith('fredl.ru') || HOST.endsWith('freedl.ink')) {
        const spoofAdblockDetection = () => {
          try {
            const adblockField = document.getElementById('adblock_detected');
            if (adblockField && adblockField.value !== '0') {
              adblockField.value = '0';
              dbg('FreeDlink: Set adblock_detected = 0');
            }
          } catch (_) {}
        };
        
        // Run immediately and on DOM changes
        spoofAdblockDetection();
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', spoofAdblockDetection, { once: true });
        }
        
        // Also watch for field being added dynamically
        const adblockObserver = new MutationObserver(() => {
          spoofAdblockDetection();
        });
        
        if (document.body) {
          adblockObserver.observe(document.body, { childList: true, subtree: true });
        } else {
          document.addEventListener('DOMContentLoaded', () => {
            if (document.body) {
              adblockObserver.observe(document.body, { childList: true, subtree: true });
            }
          }, { once: true });
        }
      }

    } catch (e) {
      dbg('Fatal error', e);
    }
  })();

  }

  //////////////////////////////////////////////////////////////
  // STATE MANAGEMENT
  //////////////////////////////////////////////////////////////

  const renderPanel = () => {
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '10px';

    const info = document.createElement('p');
    info.textContent = 'Neutralises anti-adblock overlays using cached lists and profiles. Disabling mid-session may leave existing page changes until reload.';
    info.style.margin = '0';
    info.style.fontSize = '13px';
    info.style.color = '#cbd5e1';
    wrapper.appendChild(info);

    const cfg = getConfig();
    const globalToggle = document.createElement('div');
    globalToggle.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px; background: rgba(255,255,255,0.03); border-radius: 6px;';
    
    const toggleLabel = document.createElement('span');
    toggleLabel.textContent = 'Global anti-adblock (all sites)';
    toggleLabel.style.cssText = 'flex: 1; color: #cbd5e1; font-size: 13px;';
    
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.textContent = cfg.globalEnabled ? 'ON' : 'OFF';
    toggleBtn.style.cssText = `padding: 4px 12px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.2); cursor: pointer; font-size: 11px; font-weight: 700; ${cfg.globalEnabled ? 'background: #10b981; color: #111;' : 'background: #374151; color: #9ca3af;'}`;
    toggleBtn.addEventListener('click', () => {
      const currentCfg = getConfig();
      const nextEnabled = !currentCfg.globalEnabled;
      setConfig({ globalEnabled: nextEnabled });
      toggleBtn.textContent = nextEnabled ? 'ON' : 'OFF';
      toggleBtn.style.background = nextEnabled ? '#10b981' : '#374151';
      toggleBtn.style.color = nextEnabled ? '#111' : '#9ca3af';
      setTimeout(() => location.reload(), 300);
    });
    
    globalToggle.appendChild(toggleLabel);
    globalToggle.appendChild(toggleBtn);
    wrapper.appendChild(globalToggle);

    const runBtn = document.createElement('button');
    runBtn.type = 'button';
    runBtn.textContent = 'Run fixes now';
    runBtn.style.padding = '8px 12px';
    runBtn.style.borderRadius = '6px';
    runBtn.style.border = '1px solid rgba(255,255,255,0.18)';
    runBtn.style.background = '#1f2937';
    runBtn.style.color = '#f8fafc';
    runBtn.style.cursor = 'pointer';
    runBtn.style.fontSize = '13px';
    runBtn.addEventListener('click', () => {
      if (state.enabled) start();
    });
    wrapper.appendChild(runBtn);

    return wrapper;
  };

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
      `[Anti-Adblock] ${state.enabled ? '✓' : '✗'} Enable`,
      async () => { await setEnabled(!state.enabled); }
    ));
    state.menuIds.push(GM_registerMenuCommand(
      `[Anti-Adblock] ↻ Always Run (${state.alwaysRun ? 'ON' : 'OFF'})`,
      async () => { await setAlwaysRun(!state.alwaysRun); }
    ));
    if (state.enabled) {
      state.menuIds.push(GM_registerMenuCommand('[Anti-Adblock] ▶ Run fixes now', () => start()));
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
      state.resources.intervals.forEach(id => { try { clearInterval(id); } catch (_) {} });
      state.resources.intervals = [];
      state.resources.timeouts.forEach(id => { try { clearTimeout(id); } catch (_) {} });
      state.resources.timeouts = [];
      state.resources.injectedNodes.forEach(node => { try { node.remove(); } catch (_) {} });
      state.resources.injectedNodes = [];
    }
    // Remove injected UI elements
    try {
      const btn = document.getElementById('uAAB-btn');
      if (btn) btn.remove();
      const panel = document.getElementById('uAAB-panel');
      if (panel) panel.remove();
      const backdrop = document.getElementById('uAAB-backdrop');
      if (backdrop) backdrop.remove();
    } catch (_) {}
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
    
    // Register with shared UI
    if (sharedUi && !registrationAttempted) {
      registrationAttempted = true;
      sharedUi.registerScript({
        id: SCRIPT_ID,
        title: SCRIPT_TITLE,
        enabled: state.enabled,
        render: renderPanel,
        onToggle: (next) => setEnabled(next)
      });
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
