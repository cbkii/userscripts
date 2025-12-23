// ==UserScript==
// @name         Router Contrast Dark Mode
// @namespace    https://github.com/cbkii/userscripts
// @version      2.5
// @description  High-contrast dark mode for the VX230V router UI.
// @match        http://192.168.1.1/*
// @match        https://192.168.1.1/*
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/vxdark.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/vxdark.user.js
// @homepageURL  https://github.com/cbkii/userscripts
// @supportURL   https://github.com/cbkii/userscripts/issues
// @run-at       document-end
// @noframes
// @grant        GM_addStyle
// ==/UserScript==

/*
  Feature summary:
  - Applies a high-contrast dark theme to the router UI.
  - Keeps map icons readable and maintains dark background overrides.

  How it works:
  - Injects CSS for dark styling and observes DOM changes to reapply styles.

  Configuration:
  - No user settings; edit the CSS in main() if needed.
*/

(function () {
  'use strict';

  const DEBUG = false;
  const LOG_PREFIX = '[vxdark]';

  function main() {

  /************ Global CSS Styles ************/
  GM_addStyle(`
    html, body, top {
      background-color: #121212 !important;
      color: #ffffff !important;
      text-shadow: none !important;
    }

    input, select, textarea, button {
      background-color: #2c2c2c !important;
      color: #ffffff !important;
      border: 1px solid #333 !important;
    }

    div.active, div.clicked, div.sel, div.selected,
    span.active, span.clicked, span.sel, span.selected,
    a.active, a.clicked, a.sel, a.selected,
    button.active, button.clicked, button.sel, button.selected,
    input.active, input.clicked, input.sel, input.selected,
    select.active, select.clicked, select.sel, select.selected,
    textarea.active, textarea.clicked, textarea.sel, textarea.selected,
    div:active, span:active, a:active, button:active,
    input:active, select:active, textarea:active,
    div:focus, span:focus, a:focus, button:focus,
    input:focus, select:focus, textarea:focus {
      color: #4acbd6 !important;
    }

    input[readonly], input[disabled], select[disabled] {
      color: #e8e8e8 !important;
      padding-left: 8px !important;
      border-style: dashed !important;
    }

    .gbar-parent { background-color: #333 !important; }
    .gbar-perf, .gbar { background-color: #4acbd6 !important; }

    .T_basic, .T_adv {
      background-color: #121212 !important;
      color: #ffffff !important;
      transition: all 0.2s ease;
      border-bottom: 2px solid transparent !important;
    }

    .T_basic:hover, .T_adv:hover {
      background-color: #333 !important;
      color: #ffffff !important;
    }

    .clicked, .click.sel.clicked, .sel.clicked,
    .T_basic.clicked, .T_adv.clicked,
    .T_basic.sel, .T_adv.sel,
    .T_basic.selected, .T_adv.selected,
    .T_basic.active, .T_adv.active {
      background-color: #2b2b2b !important;
      color: #4acbd6 !important;
      font-weight: bold !important;
      border-bottom: 2px solid #48c7a5 !important;
    }

    hr, .line, .separator {
      border-color: #666 !important;
      background-color: #666 !important;
    }

    a { color: #4acbd6 !important; }
    a:hover, .hover, li:hover, button:hover {
      background-color: #333 !important;
      color: #48c7a5 !important;
    }

    .map-icon, .map-icon-num, span.map-icon-num, .icon {
        color: #000000 !important;
    }

    ::-webkit-scrollbar { width: 12px; }
    ::-webkit-scrollbar-track { background: #1e1e1e; }
    ::-webkit-scrollbar-thumb { background: #555; }
    ::-webkit-scrollbar-thumb:hover { background: #777; }
  `);

  /************ DOM Override: map-icon text colour ************/
  const observers = [];

  function forceMapIconColor(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.matches && node.matches('.map-icon, .map-icon-num')) {
      node.style.setProperty('color', '#000000', 'important');
    }
  }

  // Initial scan for existing elements
  document.querySelectorAll('.map-icon, .map-icon-num').forEach(forceMapIconColor);

  // Watch for dynamic updates
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) {
            if (n.matches?.('.map-icon, span.map-icon-num, .map-icon-num')) forceMapIconColor(n);
            n.querySelectorAll?.('.map-icon, .map-icon-num').forEach(forceMapIconColor);
          }
        });
      } else if (m.type === 'attributes') {
        if (m.target.matches?.('.map-icon, span.map-icon-num, .map-icon-num')) forceMapIconColor(m.target);
      }
    }
  });

  mo.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style']
  });
  observers.push(mo);

  /************ Keep #main background override ************/
  const main = document.getElementById('main');
  if (main) {
    const applyMainStyle = () => {
      main.style.backgroundColor = '#1a1a1a';
      main.style.backgroundImage = 'none';
    };
    applyMainStyle();
    const mainObserver = new MutationObserver(applyMainStyle);
    mainObserver.observe(main, { attributes: true, childList: true, subtree: false });
    observers.push(mainObserver);
  }

  window.addEventListener('beforeunload', () => {
    observers.forEach((observer) => {
      try { observer.disconnect(); } catch (_) {}
    });
  });

  }

  try {
    main();
  } catch (err) {
    console.error(LOG_PREFIX, 'fatal error', err);
  }
})();
