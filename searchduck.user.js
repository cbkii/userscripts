// ==UserScript==
// @name         DuckDuckGo Expert Search
// @namespace    https://github.com/cbkii/userscripts
// @author       cbkii
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkYxNDkzIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTEiIGN5PSIxMSIgcj0iOCIvPjxwYXRoIGQ9Im0yMSAyMS00LjM1LTQuMzUiLz48L3N2Zz4=
// @description  DuckDuckGo search helper with site filters, file-type filters, site exclusions, bangs, and smart dorks.
// @version      2025.12.30.0130
// @match        *://duckduckgo.com/*
// @match        *://*.duckduckgo.com/*
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/searchduck.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/searchduck.user.js
// @homepageURL  https://github.com/cbkii/userscripts
// @supportURL   https://github.com/cbkii/userscripts/issues
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-end
// @noframes
// ==/UserScript==

/*
  LOAD PRIORITY: 7 (Content Enhancement)
  Site-specific enhancement that runs at document-end after DOM is available.
  
  Feature summary:
  - Adds a DuckDuckGo search helper with site filters, file-type filters, site exclusions, bangs, and smart dorks.
  - All UI is integrated into the shared userscriptui.user.js modal (no standalone UI).
  - Site filters and file types apply as groups; Smart Dorks items are individually selectable.
  - Site exclusions allow filtering out noisy hosts like Pinterest, Facebook, etc.
  - Includes DuckDuckGo-specific features: !bang shortcuts, safe search toggles, region filters.
  - Properly handles both search field text and URL query-string parameters (df= for dates, kp= for safe search).

  How it works:
  - Registers with the shared UI manager to display a panel with collapsible filter categories.
  - Modifies the DuckDuckGo search query with selected filters and operators when user clicks Search.
  - URL parameters (like df for date filters, kp for safe search) are appended properly.
  - Stores selected filters in GM storage for persistence.

  DuckDuckGo-specific syntax (2025):
  - site:example.com - Restrict to a site
  - -site:example.com - Exclude a site
  - filetype:pdf - Filter by file type (supports: pdf, doc(x), xls(x), ppt(x), html)
  - intitle:word - Title contains word
  - inurl:word - URL contains word
  - "exact phrase" - Exact phrase match
  - +term - Boost a term
  - -term - Exclude a term
  - !bang - Jump to another search engine
  - \query - Jump to first result

  Limitations vs Google:
  - Fewer supported file types (no archives, video, audio, images, executables, source code)
  - No cache:, related:, info: operators (use !define bang for definitions)
  - Wildcard site matches (*.gov.au) not supported, use base domain instead

  Configuration:
  - Toggle enable/disable via shared UI or Tampermonkey menu.
  - Filter selections persist across sessions.
*/

(() => {
  'use strict';

  //////////////////////////////////////////////////////////////
  // CONSTANTS & CONFIGURATION
  //////////////////////////////////////////////////////////////

  const DEBUG = false;
  const LOG_PREFIX = '[ddgsearch]';
  const LOG_STORAGE_KEY = 'userscript.logs.searchduck';
  const LOG_MAX_ENTRIES = 200;
  const SCRIPT_ID = 'searchduck';
  const SCRIPT_TITLE = 'DuckDuckGo Expert Search';
  const ENABLE_KEY = `${SCRIPT_ID}.enabled`;
  const SELECTIONS_KEY = `${SCRIPT_ID}.selections`;

  //////////////////////////////////////////////////////////////
  // FILTER DATA - Domain URLs, Extensions, Exclusions, Bangs, and Dorks
  //////////////////////////////////////////////////////////////

  // Noisy sites to exclude from search results
  const siteExclusions = {
    'Social Media Noise': [
      'pinterest.com', 'pinterest.co.uk', 'pinterest.ca', 'pinterest.com.au',
      'facebook.com', 'fb.com', 'instagram.com',
      'twitter.com', 'x.com',
      'tiktok.com',
      'linkedin.com',
      'snapchat.com'
    ],
    'Content Farms & Aggregators': [
      'buzzfeed.com', 'boredpanda.com', 'diply.com', 'ranker.com',
      'screenrant.com', 'cbr.com', 'gamerant.com',
      'thethings.com', 'therichest.com', 'theclever.com',
      'listverse.com', 'list25.com',
      'brightside.me', 'shareably.net',
      'thoughtcatalog.com', 'elitedaily.com'
    ],
    'Recipe Spam Sites': [
      'allrecipes.com', 'food.com', 'yummly.com',
      'delish.com', 'tasty.co', 'epicurious.com',
      'foodnetwork.com', 'myrecipes.com'
    ],
    'SEO Spam & Low Quality': [
      'quora.com', 'answers.com', 'ask.com',
      'ehow.com', 'wikihow.com', 'about.com',
      'livestrong.com', 'healthline.com', 'webmd.com',
      'verywellhealth.com', 'medicalnewstoday.com'
    ],
    'Shopping Spam': [
      'aliexpress.com', 'wish.com', 'dhgate.com',
      'banggood.com', 'gearbest.com',
      'shopify.com', 'etsy.com'
    ],
    'Fandom & Wiki Spam': [
      'fandom.com', 'wikia.com', 'wiki.gg',
      'fextralife.com', 'ign.com/wikis'
    ],
    'AI/Clickbait Tech Sites': [
      'makeuseof.com', 'howtogeek.com', 'lifehacker.com',
      'gizmodo.com', 'kotaku.com', 'lifewire.com',
      'pocket-lint.com', 'digitaltrends.com',
      'techradar.com', 'tomsguide.com', 'cnet.com'
    ]
  };

  const siteFilters = {
    'File Sharing & Cloud': [
      '4shared.com','mediafire.com','mega.nz','sendspace.com','uloz.to','rapidgator.net','nitroflare.com','filefactory.com',
      'dropbox.com','drive.google.com','onedrive.live.com','box.com','pcloud.com','icedrive.net','filen.io',
      'wetransfer.com','filemail.com','jumpshare.com','hightail.com','send-anywhere.com',
      'pixeldrain.com','file.io'
    ],
    'Video Streaming': [
      'netflix.com','primevideo.com','disneyplus.com','stan.com.au','binge.com.au','max.com','foxtel.com.au',
      'youtube.com','vimeo.com','twitch.tv','dailymotion.com',
      'tubitv.com','crackle.com','pluto.tv','plex.tv','kanopy.com'
    ],
    'Online Shopping (AU)': [
      'amazon.com.au','theiconic.com.au','ebay.com.au','woolworths.com.au','kmart.com.au','catch.com.au','mydeal.com.au',
      'goodguys.com.au','appliancesonline.com.au','petcircle.com.au',
      'bigw.com.au','harveynorman.com.au','temu.com','shein.com'
    ],
    'Blogs & Writing': [
      'wordpress.com','blogger.com','medium.com','substack.com','ghost.org','dev.to','hashnode.com',
      'livejournal.com','tumblr.com','write.as','blogspot.com'
    ],
    'Auctions & Marketplace': [
      'ebay.com.au','grays.com.au','govdeals.com.au','shopgoodwill.com',
      'gumtree.com.au'
    ],
    'Torrents': [
      'torrentgalaxy.to','thepiratebay.org','1337x.to','yts.mx','torlock.com'
    ],
    'Academic & Research': [
      'nature.com','ncbi.nlm.nih.gov','jstor.org','sciencedirect.com','springer.com','arxiv.org','researchgate.net',
      'pubmed.ncbi.nlm.nih.gov','scholar.google.com','ieee.org','acm.org','cambridge.org','oup.com','wiley.com'
    ],
    'Government & Legal (AU)': [
      'gov.au','legislation.gov.au','austlii.edu.au','aec.gov.au','ato.gov.au','servicesaustralia.gov.au',
      'treasury.gov.au','rba.gov.au','aph.gov.au','pmc.gov.au','dfat.gov.au','health.gov.au','data.gov.au'
    ],
    'Job Sites (AU)': [
      'seek.com.au','indeed.com.au','careerone.com.au','apsjobs.gov.au','ethicaljobs.com.au',
      'workforceaustralia.gov.au','glassdoor.com.au','jora.com'
    ],
    'Developer Resources': [
      'stackoverflow.com','github.com','gitlab.com','dev.to','developer.mozilla.org','docs.python.org',
      'learn.microsoft.com','kubernetes.io/docs','reactjs.org','nodejs.org'
    ],
    'News & Media (AU)': [
      'abc.net.au','smh.com.au','theage.com.au','theaustralian.com.au','theguardian.com/australia-news',
      'news.com.au','sbs.com.au/news','crikey.com.au','afr.com'
    ],
    'Forums & Communities': [
      'reddit.com','whirlpool.net.au','ozbargain.com.au','stackoverflow.com','stackexchange.com',
      'xda-developers.com','productreview.com.au','choice.com.au','discord.com'
    ]
  };

  // DuckDuckGo supports fewer file types than Google
  // Officially supported: pdf, doc(x), xls(x), ppt(x), html
  // Note: Other file types may work but are not officially documented
  const fileTypeFilters = {
    'Documents': ['pdf', 'doc', 'docx'],
    'Spreadsheets': ['xls', 'xlsx'],
    'Presentations': ['ppt', 'pptx'],
    'Web Pages': ['html']
  };

  // DuckDuckGo !Bang shortcuts
  const bangShortcuts = {
    'Search Engines': [
      { label: 'Google', bang: '!g' },
      { label: 'Bing', bang: '!b' },
      { label: 'Yahoo', bang: '!y' },
      { label: 'Ecosia', bang: '!ec' }
    ],
    'Reference': [
      { label: 'Wikipedia', bang: '!w' },
      { label: 'Wiktionary', bang: '!wt' },
      { label: 'Dictionary', bang: '!dict' },
      { label: 'Thesaurus', bang: '!th' }
    ],
    'Developer': [
      { label: 'GitHub', bang: '!gh' },
      { label: 'Stack Overflow', bang: '!so' },
      { label: 'MDN', bang: '!mdn' },
      { label: 'npm', bang: '!npm' },
      { label: 'Python Docs', bang: '!py' }
    ],
    'Social & Forums': [
      { label: 'Reddit', bang: '!r' },
      { label: 'Twitter/X', bang: '!tw' },
      { label: 'YouTube', bang: '!yt' },
      { label: 'LinkedIn', bang: '!li' }
    ],
    'Shopping': [
      { label: 'Amazon', bang: '!a' },
      { label: 'eBay', bang: '!ebay' },
      { label: 'Amazon AU', bang: '!aau' }
    ],
    'Maps & Local': [
      { label: 'Google Maps', bang: '!gm' },
      { label: 'OpenStreetMap', bang: '!osm' },
      { label: 'Yelp', bang: '!yelp' }
    ],
    'Academic': [
      { label: 'Google Scholar', bang: '!scholar' },
      { label: 'arXiv', bang: '!arxiv' },
      { label: 'PubMed', bang: '!pubmed' }
    ]
  };

  // DuckDuckGo-adapted smart dorks
  // Note: DDG supports intitle:, inurl:, site:, filetype:, "exact phrase", +boost, -exclude
  // DDG does NOT support: cache:, related:, info:, define: (use !define bang instead)
  const smartDorks = {
    'Index Browsing': [
      { label: 'Audio index', dork: 'intitle:"index of" (mp3 OR flac OR wav) "parent directory"' },
      { label: 'Document index', dork: 'intitle:"index of" (pdf OR doc) "parent directory"' },
      { label: 'Video index', dork: 'intitle:"index of" (mp4 OR avi OR mkv) "parent directory"' },
      { label: 'Generic index', dork: 'intitle:"index of" "parent directory"' }
    ],
    'Exposed Files': [
      { label: 'Gov AU PDFs', dork: 'filetype:pdf site:gov.au' },
      { label: 'Gov AU budgets', dork: '(filetype:xls OR filetype:xlsx) "budget" site:gov.au' },
      { label: 'Admin panels', dork: 'inurl:admin OR inurl:login OR inurl:dashboard' },
      { label: 'Resumes/CVs', dork: '(intitle:"curriculum vitae" OR intitle:"resume") filetype:pdf' }
    ],
    'Policy & Docs': [
      { label: 'Privacy policies', dork: '"privacy policy" filetype:pdf' },
      { label: 'Terms of service', dork: '"terms of service" OR "terms and conditions" filetype:pdf' },
      { label: 'Data retention', dork: '"data retention" policy filetype:pdf' }
    ],
    'Audio Search': [
      { label: 'Audio index dirs', dork: 'intitle:"index of" (mp3 OR flac OR wav OR ogg) -inurl:php -inurl:html' },
      { label: 'MP3 parent dirs', dork: '"parent directory" MP3 -html -php' },
      { label: 'Audio platforms', dork: 'site:soundcloud.com OR site:bandcamp.com OR site:audiomack.com' }
    ],
    'Time Filters': [
      { label: 'Past day', dork: 'd', isUrlParam: true, paramKey: 'df' },
      { label: 'Past week', dork: 'w', isUrlParam: true, paramKey: 'df' },
      { label: 'Past month', dork: 'm', isUrlParam: true, paramKey: 'df' },
      { label: 'Past year', dork: 'y', isUrlParam: true, paramKey: 'df' }
    ],
    'Safe Search': [
      { label: 'Safe Search ON', dork: '1', isUrlParam: true, paramKey: 'kp' },
      { label: 'Safe Search OFF', dork: '-2', isUrlParam: true, paramKey: 'kp' }
    ],
    'Region': [
      { label: 'Australia', dork: 'au-en', isUrlParam: true, paramKey: 'kl' },
      { label: 'United States', dork: 'us-en', isUrlParam: true, paramKey: 'kl' },
      { label: 'United Kingdom', dork: 'uk-en', isUrlParam: true, paramKey: 'kl' },
      { label: 'No Region', dork: 'wt-wt', isUrlParam: true, paramKey: 'kl' }
    ],
    'Content Type': [
      { label: 'Images only', dork: 'images', isUrlParam: true, paramKey: 'ia' },
      { label: 'Videos only', dork: 'videos', isUrlParam: true, paramKey: 'ia' },
      { label: 'News only', dork: 'news', isUrlParam: true, paramKey: 'ia' },
      { label: 'Maps', dork: 'maps', isUrlParam: true, paramKey: 'ia' }
    ],
    'Quick Actions': [
      { label: 'Jump to first result', dork: '\\', isPrefix: true },
      { label: 'Define (via bang)', dork: '!define ', isPrefix: true }
    ]
  };

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

  let sharedUi = null;
  let sharedUiReady = false;
  let registrationAttempted = false;

  const factory = (typeof window !== 'undefined' && window.__userscriptSharedUi) ||
                   (typeof unsafeWindow !== 'undefined' && unsafeWindow.__userscriptSharedUi);

  if (factory && typeof factory.createDiscoveryHelper === 'function') {
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
    const initSharedUi = (providedFactory) => {
      let f = providedFactory;
      if (!f && typeof window !== 'undefined' && window.__userscriptSharedUi) {
        f = window.__userscriptSharedUi;
      }
      if (!f && typeof unsafeWindow !== 'undefined' && unsafeWindow.__userscriptSharedUi) {
        f = unsafeWindow.__userscriptSharedUi;
      }
      if (f && typeof f.getInstance === 'function') {
        sharedUi = f.getInstance({
          get: (key, fallback) => gmStore.get(key, fallback),
          set: (key, value) => gmStore.set(key, value)
        });
        sharedUiReady = true;
        return true;
      }
      return false;
    };

    initSharedUi();

    document.addEventListener('userscriptSharedUiReady', (event) => {
      setTimeout(() => {
        const providedFactory = event?.detail?.sharedUi;
        if (!sharedUiReady) {
          initSharedUi(providedFactory);
        }
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
    });
  }

  const state = {
    enabled: true,
    started: false,
    menuIds: [],
    selections: {
      sites: {},
      fileTypes: {},
      dorks: {},
      exclusions: {},
      bangs: {}
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
    const scrubValue = (value, depth = 0) => {
      if (value == null) return value;
      if (typeof value === 'string') return scrubString(value);
      if (value instanceof Error) {
        return { name: value.name, message: scrubString(value.message) };
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
  // CORE LOGIC - SEARCH QUERY BUILDING
  //////////////////////////////////////////////////////////////

  const getDDGSearchBox = () => {
    return document.querySelector('input[name="q"]') ||
           document.querySelector('#search_form_input') ||
           document.querySelector('#search_form_input_homepage') ||
           document.querySelector('input[type="text"]');
  };

  const buildSearchQuery = (baseQuery) => {
    let query = baseQuery.trim();
    const siteParts = [];
    const fileTypeParts = [];
    const exclusionParts = [];
    const dorkParts = [];
    const bangParts = [];
    let urlParams = {};

    // Collect site filters - all selected sites should be space-separated (DDG uses implicit OR for site:)
    Object.entries(state.selections.sites).forEach(([category, selected]) => {
      if (selected && siteFilters[category]) {
        siteFilters[category].forEach(site => {
          siteParts.push(`site:${site}`);
        });
      }
    });

    // Collect file type filters - DDG supports fewer types
    Object.entries(state.selections.fileTypes).forEach(([category, selected]) => {
      if (selected && fileTypeFilters[category]) {
        fileTypeFilters[category].forEach(ext => {
          fileTypeParts.push(`filetype:${ext}`);
        });
      }
    });

    // Collect site exclusions - these use -site: syntax
    Object.entries(state.selections.exclusions).forEach(([category, selected]) => {
      if (selected && siteExclusions[category]) {
        siteExclusions[category].forEach(site => {
          exclusionParts.push(`-site:${site}`);
        });
      }
    });

    // Collect bangs
    Object.entries(state.selections.bangs).forEach(([category, bangSelections]) => {
      if (bangSelections && typeof bangSelections === 'object') {
        Object.entries(bangSelections).forEach(([bangLabel, selected]) => {
          if (selected) {
            const categoryBangs = bangShortcuts[category];
            if (categoryBangs) {
              const bangItem = categoryBangs.find(b => b.label === bangLabel);
              if (bangItem) {
                bangParts.push(bangItem.bang);
              }
            }
          }
        });
      }
    });

    // Collect dorks
    // Note: prefixOperator stores only the last selected prefix operator since these are
    // mutually exclusive (e.g., \ for "jump to first" vs !define for definitions).
    // If multiple prefix operators are selected, last one wins by design.
    let prefixOperator = '';
    Object.entries(state.selections.dorks).forEach(([category, dorkSelections]) => {
      if (dorkSelections && typeof dorkSelections === 'object') {
        Object.entries(dorkSelections).forEach(([dorkLabel, selected]) => {
          if (selected) {
            const categoryDorks = smartDorks[category];
            if (categoryDorks) {
              const dorkItem = categoryDorks.find(d => d.label === dorkLabel);
              if (dorkItem) {
                if (dorkItem.isUrlParam && dorkItem.paramKey) {
                  // URL parameters for DDG. Avoid overwriting an existing, possibly conflicting value.
                  const existingValue = urlParams[dorkItem.paramKey];
                  if (existingValue === undefined) {
                    urlParams[dorkItem.paramKey] = dorkItem.dork;
                  } else if (existingValue === dorkItem.dork) {
                    // Same value already set; nothing to change.
                  } else {
                    // Conflicting value already set for this key; keep the first one.
                  }
                } else if (dorkItem.isPrefix) {
                  // Prefix operators are prepended to the query (e.g., \ or !define)
                  prefixOperator = dorkItem.dork;
                } else {
                  dorkParts.push(dorkItem.dork);
                }
              }
            }
          }
        });
      }
    });

    // Build query parts
    const queryParts = [];

    // Bangs must be at the very beginning of the DDG query, before any other terms.
    // Prepend them directly to the base query instead of treating them as regular filters.
    if (bangParts.length > 0) {
      const bangPrefix = bangParts.join(' ');
      if (typeof baseQuery === 'string' && baseQuery.trim().length > 0) {
        baseQuery = `${bangPrefix} ${baseQuery}`;
      } else {
        // If there was no base query, the bangs themselves become the query.
        baseQuery = bangPrefix;
      }
    }

    // Sites: in DDG, multiple site: operators must be explicitly ORed (unlike Google in some contexts)
    if (siteParts.length > 0) {
      // For DDG, build (site:a OR site:b) with explicit OR operators between site: filters
      queryParts.push(`(${siteParts.join(' OR ')})`);
    }

    // File types: combine with OR
    if (fileTypeParts.length > 0) {
      queryParts.push(`(${fileTypeParts.join(' OR ')})`);
    }

    // Dorks: add each as separate term
    dorkParts.forEach(dork => {
      queryParts.push(dork);
    });

    // Exclusions: add each as separate -site: term
    exclusionParts.forEach(exclusion => {
      queryParts.push(exclusion);
    });

    // Apply prefix operator if any (e.g., \ for jump-to-first or !define)
    if (prefixOperator) {
      query = prefixOperator + query;
    }

    // Combine query with filter parts
    if (queryParts.length > 0) {
      query = query + ' ' + queryParts.join(' ');
    }

    return { query: query.trim(), urlParams };
  };

  const executeSearch = (customQuery) => {
    const textbox = getDDGSearchBox();
    const baseQuery = customQuery !== undefined ? customQuery : (textbox ? textbox.value : '');
    const { query, urlParams } = buildSearchQuery(baseQuery);

    if (!query) {
      log('warn', 'No search query provided');
      return;
    }

    // Build search URL with proper parameter handling
    let url = 'https://duckduckgo.com/?q=' + encodeURIComponent(query);
    
    // Append URL parameters (df for date filter, kp for safe search, kl for region, ia for content type)
    Object.entries(urlParams).forEach(([key, value]) => {
      if (value) {
        url += `&${key}=${encodeURIComponent(value)}`;
      }
    });

    log('info', 'Executing search', { query, urlParams });
    window.location.href = url;
  };

  //////////////////////////////////////////////////////////////
  // UI COMPONENTS - Shared UI Panel
  //////////////////////////////////////////////////////////////

  const saveSelections = async () => {
    await gmStore.set(SELECTIONS_KEY, state.selections);
    log('debug', 'Selections saved', state.selections);
  };

  const loadSelections = async () => {
    const saved = await gmStore.get(SELECTIONS_KEY, null);
    if (saved && typeof saved === 'object') {
      state.selections = {
        sites: saved.sites || {},
        fileTypes: saved.fileTypes || {},
        dorks: saved.dorks || {},
        exclusions: saved.exclusions || {},
        bangs: saved.bangs || {}
      };
    }
    log('debug', 'Selections loaded', state.selections);
  };

  const renderPanel = () => {
    const panel = document.createElement('div');
    panel.style.cssText = 'padding: 12px; color: #e5e7eb; font-family: system-ui, sans-serif; font-size: 13px; max-height: 550px; overflow-y: auto;';

    const title = document.createElement('h3');
    title.textContent = 'DuckDuckGo Expert Search';
    title.style.cssText = 'margin: 0 0 4px 0; font-size: 16px; font-weight: 700; color: #f8fafc;';
    panel.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.textContent = 'Advanced filters, exclusions, !bangs & dorks';
    subtitle.style.cssText = 'margin: 0 0 12px 0; font-size: 11px; color: #94a3b8;';
    panel.appendChild(subtitle);

    const searchSection = document.createElement('div');
    searchSection.style.cssText = 'margin-bottom: 14px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 6px;';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Enter search terms...';
    searchInput.id = 'ddg-query-input';
    searchInput.style.cssText = 'width: 100%; padding: 8px; background: #1f2937; color: #e5e7eb; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; font-size: 13px; margin-bottom: 8px; box-sizing: border-box;';

    const textbox = getDDGSearchBox();
    if (textbox && textbox.value) {
      searchInput.value = textbox.value;
    }

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeSearch(searchInput.value);
      }
    });
    searchSection.appendChild(searchInput);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 6px;';

    const searchBtn = document.createElement('button');
    searchBtn.textContent = '🦆 Search with Filters';
    searchBtn.style.cssText = 'flex: 1; padding: 8px 12px; background: #de5833; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;';
    searchBtn.addEventListener('click', () => executeSearch(searchInput.value));
    searchBtn.addEventListener('mouseenter', () => { searchBtn.style.background = '#c94a2a'; });
    searchBtn.addEventListener('mouseleave', () => { searchBtn.style.background = '#de5833'; });

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear All';
    clearBtn.style.cssText = 'padding: 8px 12px; background: #6b7280; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;';
    clearBtn.addEventListener('click', async () => {
      searchInput.value = '';
      state.selections = { sites: {}, fileTypes: {}, dorks: {}, exclusions: {}, bangs: {} };
      await saveSelections();
      const allCheckboxes = panel.querySelectorAll('input[type="checkbox"]');
      allCheckboxes.forEach(cb => { cb.checked = false; });
    });
    clearBtn.addEventListener('mouseenter', () => { clearBtn.style.background = '#4b5563'; });
    clearBtn.addEventListener('mouseleave', () => { clearBtn.style.background = '#6b7280'; });

    btnRow.appendChild(searchBtn);
    btnRow.appendChild(clearBtn);
    searchSection.appendChild(btnRow);
    panel.appendChild(searchSection);

    const createSection = (icon, sectionTitle, content, collapsed = true) => {
      const section = document.createElement('div');
      section.style.cssText = 'margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; overflow: hidden;';

      const header = document.createElement('button');
      header.type = 'button';
      header.style.cssText = 'width: 100%; padding: 10px 12px; background: rgba(255,255,255,0.05); color: #f8fafc; border: none; cursor: pointer; font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: space-between;';
      
      const headerText = document.createElement('span');
      headerText.textContent = `${icon} ${sectionTitle}`;
      const collapseIcon = document.createElement('span');
      collapseIcon.textContent = collapsed ? '▶' : '▼';
      collapseIcon.className = 'collapse-icon';
      header.appendChild(headerText);
      header.appendChild(collapseIcon);

      const body = document.createElement('div');
      body.style.cssText = 'max-height: 200px; overflow-y: auto; padding: 8px; background: rgba(0,0,0,0.2);';
      body.style.display = collapsed ? 'none' : 'block';
      body.appendChild(content);

      header.addEventListener('click', () => {
        const isCollapsed = body.style.display === 'none';
        body.style.display = isCollapsed ? 'block' : 'none';
        collapseIcon.textContent = isCollapsed ? '▼' : '▶';
      });

      section.appendChild(header);
      section.appendChild(body);
      return section;
    };

    const createCheckboxRow = (label, checked, onChange) => {
      const row = document.createElement('label');
      row.style.cssText = 'display: flex; align-items: center; padding: 6px 4px; cursor: pointer; border-radius: 4px;';
      row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.05)'; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!checked;
      checkbox.style.cssText = 'margin-right: 8px; accent-color: #de5833;';
      checkbox.addEventListener('change', () => onChange(checkbox.checked));

      const text = document.createElement('span');
      text.textContent = label;
      text.style.cssText = 'font-size: 12px; color: #cbd5e1;';

      row.appendChild(checkbox);
      row.appendChild(text);
      return row;
    };

    // Site Exclusions section
    const exclusionContent = document.createElement('div');
    Object.keys(siteExclusions).sort().forEach(category => {
      const count = siteExclusions[category].length;
      const row = createCheckboxRow(
        `${category} (${count} sites)`,
        state.selections.exclusions[category],
        async (checked) => {
          state.selections.exclusions[category] = checked;
          await saveSelections();
        }
      );
      exclusionContent.appendChild(row);
    });
    panel.appendChild(createSection('🚫', 'Site Exclusions (Remove Noise)', exclusionContent, false));

    // !Bang Shortcuts section
    const bangContent = document.createElement('div');
    Object.keys(bangShortcuts).forEach(category => {
      const categoryHeader = document.createElement('div');
      categoryHeader.textContent = category;
      categoryHeader.style.cssText = 'font-size: 11px; font-weight: 600; color: #9ca3af; margin: 8px 0 4px 0; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.1);';
      if (bangContent.children.length > 0) {
        categoryHeader.style.marginTop = '12px';
      }
      bangContent.appendChild(categoryHeader);

      bangShortcuts[category].forEach(bangItem => {
        if (!state.selections.bangs[category]) {
          state.selections.bangs[category] = {};
        }

        const row = createCheckboxRow(
          `${bangItem.label} (${bangItem.bang})`,
          state.selections.bangs[category][bangItem.label],
          async (checked) => {
            if (!state.selections.bangs[category]) {
              state.selections.bangs[category] = {};
            }
            state.selections.bangs[category][bangItem.label] = checked;
            await saveSelections();
          }
        );
        bangContent.appendChild(row);
      });
    });
    panel.appendChild(createSection('💥', '!Bang Shortcuts', bangContent));

    // Site Filters section
    const siteContent = document.createElement('div');
    Object.keys(siteFilters).sort().forEach(category => {
      const count = siteFilters[category].length;
      const row = createCheckboxRow(
        `${category} (${count} sites)`,
        state.selections.sites[category],
        async (checked) => {
          state.selections.sites[category] = checked;
          await saveSelections();
        }
      );
      siteContent.appendChild(row);
    });
    panel.appendChild(createSection('🌐', 'Site Filters (Include Only)', siteContent));

    // File Type Filters section
    const fileContent = document.createElement('div');
    Object.keys(fileTypeFilters).sort().forEach(category => {
      const count = fileTypeFilters[category].length;
      const row = createCheckboxRow(
        `${category} (${count} types)`,
        state.selections.fileTypes[category],
        async (checked) => {
          state.selections.fileTypes[category] = checked;
          await saveSelections();
        }
      );
      fileContent.appendChild(row);
    });
    panel.appendChild(createSection('📁', 'File Types (DDG supported)', fileContent));

    // Smart Dorks section
    const dorksContent = document.createElement('div');
    Object.keys(smartDorks).forEach(category => {
      const categoryHeader = document.createElement('div');
      categoryHeader.textContent = category;
      categoryHeader.style.cssText = 'font-size: 11px; font-weight: 600; color: #9ca3af; margin: 8px 0 4px 0; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.1);';
      if (dorksContent.children.length > 0) {
        categoryHeader.style.marginTop = '12px';
      }
      dorksContent.appendChild(categoryHeader);

      smartDorks[category].forEach(dorkItem => {
        if (!state.selections.dorks[category]) {
          state.selections.dorks[category] = {};
        }

        const row = createCheckboxRow(
          dorkItem.label,
          state.selections.dorks[category][dorkItem.label],
          async (checked) => {
            if (!state.selections.dorks[category]) {
              state.selections.dorks[category] = {};
            }
            state.selections.dorks[category][dorkItem.label] = checked;
            await saveSelections();
          }
        );
        dorksContent.appendChild(row);
      });
    });
    panel.appendChild(createSection('🔍', 'Smart Dorks & Settings', dorksContent));

    const helpText = document.createElement('div');
    helpText.style.cssText = 'margin-top: 12px; padding: 8px; background: rgba(222,88,51,0.1); border-radius: 4px; font-size: 11px; color: #fca5a5;';
    const helpStrong = document.createElement('strong');
    helpStrong.textContent = 'DuckDuckGo Tips:';
    helpText.appendChild(helpStrong);
    helpText.appendChild(document.createElement('br'));
    helpText.appendChild(document.createTextNode('• !Bangs redirect to other search engines'));
    helpText.appendChild(document.createElement('br'));
    helpText.appendChild(document.createTextNode('• File types: pdf, doc(x), xls(x), ppt(x), html only'));
    helpText.appendChild(document.createElement('br'));
    helpText.appendChild(document.createTextNode('• Use exclusions to filter noisy sites'));
    helpText.appendChild(document.createElement('br'));
    helpText.appendChild(document.createTextNode('• Click "Search with Filters" to apply'));
    panel.appendChild(helpText);

    return panel;
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
      `[DDG Search] ${state.enabled ? '✓' : '✗'} Enable`,
      async () => { await setEnabled(!state.enabled); }
    ));
    if (state.enabled) {
      state.menuIds.push(GM_registerMenuCommand('[DDG Search] 🦆 Open Filter Panel', () => {
        if (sharedUi) {
          sharedUi.switchPanel(SCRIPT_ID);
          sharedUi.toggleModal();
        }
      }));
      state.menuIds.push(GM_registerMenuCommand('[DDG Search] 🗑️ Clear All Filters', async () => {
        state.selections = { sites: {}, fileTypes: {}, dorks: {}, exclusions: {}, bangs: {} };
        await saveSelections();
        log('info', 'All filters cleared');
      }));
    }
  };

  const stop = async () => {
    state.started = false;
  };

  const start = async () => {
    if (state.started) return;
    state.started = true;
    await loadSelections();
    log('info', 'DuckDuckGo Expert Search ready');
  };

  const setEnabled = async (value) => {
    state.enabled = !!value;
    await gmStore.set(ENABLE_KEY, state.enabled);
    if (sharedUi) {
      sharedUi.setScriptEnabled(SCRIPT_ID, state.enabled);
    }
    if (!state.enabled) {
      await stop();
    } else if (!state.started) {
      await start();
    }
    registerMenu();
  };

  //////////////////////////////////////////////////////////////
  // INITIALIZATION
  //////////////////////////////////////////////////////////////

  const initToggle = async () => {
    state.enabled = await gmStore.get(ENABLE_KEY, true);
    await loadSelections();

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
    await setEnabled(state.enabled);
  };

  initToggle().catch((err) => {
    log('error', 'fatal error', err);
  });
})();
