// ==UserScript==
// @name         Export Full Page Info (XBrowser)
// @namespace    https://github.com/cbkii/userscripts
// @author       cbkii
// @version      1.2.2
// @description  Exports HTML, scripts, styles, and resource timing to a text file.
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/pageinfoexport.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/pageinfoexport.user.js
// @homepageURL  https://github.com/cbkii/userscripts
// @supportURL   https://github.com/cbkii/userscripts/issues
// @run-at       tools-menu
// @noframes
// @grant        none
// ==/UserScript==

/*
  Feature summary:
  - Exports full page HTML, script/style details, and performance resources.
  - Saves output to a timestamped text file from the tools menu.

  How it works:
  - Collects DOM and performance data, then downloads it as a .txt file.

  Configuration:
  - No user settings; run from the tools menu when needed.
*/

(function () {
  'use strict';

  const DEBUG = false;
  const LOG_PREFIX = '[pageinfo-export]';

  function main() {

  const pad = n => (n < 10 ? '0' : '') + n;
  const nowStamp = () => {
    const d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  };

  const safeStr = v => {
    try { return v == null ? '' : String(v); }
    catch (_) { return ''; }
  };

  const section = t => `\n=== ${t} ===\n`;

  const collectScripts = () => {
    const out = [];
    const scripts = document.getElementsByTagName('script');
    for (let i = 0; i < scripts.length; i++) {
      const s = scripts[i];
      let src = '';
      try { src = s.src || s.getAttribute('src') || ''; } catch (_) {}
      out.push(`--- SCRIPT #${i + 1} ---`);
      out.push(`type: ${safeStr(s.type)}`);
      out.push(`async: ${!!s.async}`);
      out.push(`defer: ${!!s.defer}`);
      out.push(`noModule: ${!!s.noModule}`);
      out.push(`nonce: ${safeStr(s.nonce)}`);
      out.push(`referrerpolicy: ${safeStr(s.referrerPolicy)}`);

      if (src) {
        out.push('src: ' + src);
      } else {
        let code = '';
        try { code = s.textContent || ''; } catch (_) {}
        out.push('inline: true');
        out.push('content:\n' + code);
      }
      out.push('');
    }
    return out.join('\n');
  };

  const collectStyles = () => {
    const out = [];

    const links = document.querySelectorAll('link[rel~="stylesheet"]');
    links.forEach((l, i) => {
      out.push(`--- STYLESHEET LINK #${i + 1} ---`);
      out.push(`href: ${safeStr(l.href)}`);
      out.push(`media: ${safeStr(l.media)}`);
      out.push(`type: ${safeStr(l.type)}`);
      out.push('');
    });

    const styles = document.getElementsByTagName('style');
    Array.from(styles).forEach((st, j) => {
      let css = '';
      try { css = st.textContent || ''; } catch (_) {}
      out.push(`--- INLINE STYLE #${j + 1} ---`);
      out.push(`media: ${safeStr(st.media)}`);
      out.push(`nonce: ${safeStr(st.nonce)}`);
      out.push(`content:\n${css}`);
      out.push('');
    });

    return out.join('\n');
  };

  const collectPerformanceResources = () => {
    const out = [];
    let entries = [];
    try {
      entries = performance.getEntriesByType('resource') || [];
    } catch (_) {}

    out.push('count: ' + entries.length);
    out.push('');
    entries.forEach((e, i) => {
      out.push(`--- RESOURCE #${i + 1} ---`);
      out.push(`name: ${safeStr(e.name)}`);
      out.push(`initiatorType: ${safeStr(e.initiatorType)}`);
      out.push(`startTime: ${safeStr(e.startTime)}`);
      out.push(`duration: ${safeStr(e.duration)}`);
      out.push(`transferSize: ${safeStr(e.transferSize)}`);
      out.push(`encodedBodySize: ${safeStr(e.encodedBodySize)}`);
      out.push(`decodedBodySize: ${safeStr(e.decodedBodySize)}`);
      out.push('');
    });

    return out.join('\n');
  };

  const buildReportText = () => {
    const parts = [];
    parts.push('Export generated: ' + new Date().toISOString());
    parts.push('Page URL: ' + safeStr(location.href));
    parts.push('Title: ' + safeStr(document.title));
    parts.push('User-Agent: ' + safeStr(navigator.userAgent));
    parts.push('Referrer: ' + safeStr(document.referrer || ''));
    parts.push('');

    parts.push(section('FULL HTML SOURCE'));
    try {
      parts.push(document.documentElement?.outerHTML || '');
    } catch (_) {
      parts.push('');
    }

    parts.push(section('SCRIPTS'));
    parts.push(collectScripts());

    parts.push(section('STYLESHEETS AND INLINE STYLES'));
    parts.push(collectStyles());

    parts.push(section('PERFORMANCE RESOURCES (resource entries)'));
    parts.push(collectPerformanceResources());

    return parts.join('\n');
  };

  const toBase64Utf8 = str => {
    const utf8 = new TextEncoder().encode(str);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < utf8.length; i += chunkSize) {
      const chunk = utf8.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  };

  const tryAnchorDownloadBlob = (text, filename) => {
    try {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => {
        try { URL.revokeObjectURL(blobUrl); } catch (_) {}
      }, 10000);
      return true;
    } catch (e) {
      console.log('[export-page-info] anchor download failed:', e);
      return false;
    }
  };

  const tryDataUrlDownload = (text, filename) => {
    try {
      const b64 = toBase64Utf8(text);
      const dataUrl = 'data:text/plain;charset=utf-8;base64,' + b64;
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    } catch (e) {
      console.log('[export-page-info] data: URL download failed:', e);
      return false;
    }
  };

  const exportNow = () => {
    try {
      const text = buildReportText();
      const filename = 'full-page-info-' + nowStamp() + '.txt';

      if (tryAnchorDownloadBlob(text, filename)) {
        console.log('[export-page-info] Exported via Blob');
        return;
      }

      if (tryDataUrlDownload(text, filename)) {
        console.log('[export-page-info] Exported via data URL');
        return;
      }

      alert('Export failed: Unable to save file. This browser may not support Blob or Data URL downloads.');
    } catch (err) {
      console.error('[export-page-info] Export error:', err);
      alert('An error occurred during export.');
    }
  };

  exportNow();

  }

  try {
    main();
  } catch (err) {
    console.error(LOG_PREFIX, 'fatal error', err);
  }
})();
