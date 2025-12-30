// ==UserScript==
// @name         Google Expert Search
// @namespace    https://github.com/cbkii/userscripts
// @author       cbkii
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkYxNDkzIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTEiIGN5PSIxMSIgcj0iOCIvPjxwYXRoIGQ9Im0yMSAyMS00LjM1LTQuMzUiLz48L3N2Zz4=
// @description  Google search helper with site filters, file-type filters, site exclusions, and smart dorks.
// @version      2025.12.29.2354
// @match        *://www.google.*/search*
// @match        *://google.*/search*
// @exclude      *://www.google.*/imghp*
// @exclude      *://www.google.*/analytics*
// @exclude      *://www.google.*/preferences*
// @exclude      *://www.google.*/advanced_search*
// @exclude      *://www.google.*/language_tools*
// @exclude      *://www.google.*/ig*
// @exclude      *://www.google.*/support*
// @exclude      *://www.google.*/webhp*
// @exclude      *://*maps.google.*
// @exclude      *://google.*/maps*
// @exclude      *://*translate.google.*
// @exclude      *://google*/ig*
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/searchgoogle.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/searchgoogle.user.js
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
  Feature summary:
  - Adds a Google search helper with site filters, file-type filters, site exclusions, and smart dorks.
  - All UI is integrated into the shared userscriptui.user.js modal (no standalone UI).
  - Site filters and file types apply as groups; Smart Dorks items are individually selectable.
  - Site exclusions allow filtering out noisy hosts like Pinterest, Facebook, etc.
  - Properly handles both search field text and URL query-string parameters.

  How it works:
  - Registers with the shared UI manager to display a panel with collapsible filter categories.
  - Modifies the Google search query with selected filters and operators when user clicks Search.
  - URL parameters (like time filters) are appended to the search URL, not the query string.
  - Stores selected filters in GM storage for persistence.

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
  const LOG_PREFIX = '[gsearch]';
  const LOG_STORAGE_KEY = 'userscript.logs.searchgoogle';
  const LOG_MAX_ENTRIES = 200;
  const SCRIPT_ID = 'searchgoogle';
  const SCRIPT_TITLE = 'Google Expert Search';
  const ENABLE_KEY = `${SCRIPT_ID}.enabled`;
  const SELECTIONS_KEY = `${SCRIPT_ID}.selections`;

  //////////////////////////////////////////////////////////////
  // FILTER DATA - Domain URLs, Extensions, Exclusions, and Dorks
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
      '4shared.com','zippyshare.com','uploading.com','minus.com','filestube.com','filecrop.com','2shared.com',
      'mediafire.com','mega.nz','sendspace.com','uloz.to','rapidgator.net','nitroflare.com','filefactory.com',
      'racaty.net','bayfiles.com','filerio.in','pixeldrain.com','anonfiles.com','filemoon.sx','dood.pm',
      'dropbox.com','drive.google.com','onedrive.live.com','box.com','pcloud.com','icedrive.net','filen.io',
      'wetransfer.com','filemail.com','jumpshare.com','hightail.com','send-anywhere.com','turbobit.net',
      'uptobox.com','dropsend.com','files.fm','bit.ai','t-file.com','file.io','drop.me'
    ],
    'Video Streaming': [
      'netflix.com','primevideo.com','disneyplus.com','stan.com.au','binge.com.au','max.com','foxtel.com.au',
      'kayosports.com.au','sbs.com.au/ondemand','9now.com.au','7plus.com.au','abc.net.au/iview','kanopy.com','beamafilm.com',
      'tubitv.com','crackle.com','pluto.tv','plex.tv','popcorntime.app','putlocker.rs','fmovies.to','123movies.to',
      'yesmovies.ag','cinebloom.org','lookmovie.ag','movie4k.to','solarmovie.work','watchserieshd.cc','rainierland.to',
      'popcornflix.com','vidto.me','seriesfree.to','vodlocker.com','vidbull.com','oke.io',
      'youtube.com','vimeo.com','twitch.tv','dailymotion.com'
    ],
    'Online Shopping (AU)': [
      'amazon.com.au','theiconic.com.au','ebay.com.au','woolworths.com.au','kmart.com.au','catch.com.au','mydeal.com.au',
      'goodguys.com.au','appliancesonline.com.au','petcircle.com.au','lyka.com.au','adorabeauty.com.au','countryroad.com.au',
      'birdsnest.com.au','cettire.com','heem.com.au','temu.com','shein.com','bigw.com.au','harveynorman.com.au'
    ],
    'Blogs & Writing': [
      'wordpress.com','blogger.com','medium.com','substack.com','ghost.org','dev.to','hashnode.com',
      'livejournal.com','tumblr.com','write.as','blogspot.com'
    ],
    'Auctions & Marketplace': [
      'ebay.com.au','grays.com.au','bidorbuy.com.au','govdeals.com.au','shopgoodwill.com','heritageauction.com',
      'ubid.com','onlineauction.com','propertyroom.com','facebook.com/marketplace','gumtree.com.au'
    ],
    'Torrents': [
      'torrentgalaxy.to','thepiratebay.org','1337x.to','rarbg.to','zooqle.com','yts.mx','torlock.com','kickass.to'
    ],
    'Adult Content': [
      'xvideos.com','pornhub.com','xhamster.com','redtube.com','tube8.com','youporn.com','spankwire.com'
    ],
    'Academic & Research': [
      'nature.com','ncbi.nlm.nih.gov','jstor.org','sciencedirect.com','springer.com','arxiv.org','researchgate.net',
      'pubmed.ncbi.nlm.nih.gov','scholar.google.com','ieee.org','acm.org','cambridge.org','oup.com','wiley.com',
      'tandfonline.com','*.edu','*.edu.au'
    ],
    'Government & Legal (AU)': [
      '*.gov.au','legislation.gov.au','austlii.edu.au','aec.gov.au','ato.gov.au','servicesaustralia.gov.au',
      'treasury.gov.au','rba.gov.au','aph.gov.au','pmc.gov.au','dfat.gov.au','health.gov.au','data.gov.au'
    ],
    'Job Sites (AU)': [
      'seek.com.au','linkedin.com/jobs','indeed.com.au','careerone.com.au','apsjobs.gov.au','ethicaljobs.com.au',
      'workforceaustralia.gov.au','spotjobs.com','glassdoor.com.au','jora.com','humanresourcesonline.net'
    ],
    'Developer Resources': [
      'stackoverflow.com','github.com','gitlab.com','dev.to','developer.mozilla.org','docs.python.org',
      'learn.microsoft.com','aws.amazon.com/documentation','kubernetes.io/docs','reactjs.org','nodejs.org'
    ],
    'News & Media (AU)': [
      'abc.net.au','smh.com.au','theage.com.au','theaustralian.com.au','theguardian.com/australia-news',
      'news.com.au','sbs.com.au/news','crikey.com.au','afr.com','skynews.com.au',
      'reddit.com/r/australia','reddit.com/r/melbourne','reddit.com/r/sydney','reddit.com/r/brisbane',
      'reddit.com/r/perth','reddit.com/r/adelaide','reddit.com/r/canberra','reddit.com/r/ausfinance',
      'reddit.com/r/asx_bets','reddit.com/r/afl','reddit.com/r/nrl','reddit.com/r/australianpolitics'
    ],
    'Forums & Communities': [
      'reddit.com','whirlpool.net.au','ozbargain.com.au','stackoverflow.com','stackexchange.com',
      'quora.com','xda-developers.com','overclockers.com.au','productreview.com.au','choice.com.au',
      'discord.com','web.telegram.org','slack.com','teams.microsoft.com'
    ]
  };

  const fileTypeFilters = {
    'Spreadsheets': ['xls','ods','xlsx','csv','tsv','dif','dbf','xlt','xlsm','xltx'],
    'Documents': ['doc','docx','rtf','txt','odt','pdf','md','json','yaml','yml'],
    'Presentations': ['ppt','pps','odp','key','pptx','potx'],
    'C# Source': ['cs'],
    'Java/JS Source': ['java','jar','js'],
    'C++ Source': ['cpp','h','hpp','cxx'],
    'Basic Source': ['bas','vbs','cls','frm','ctl'],
    'Perl Source': ['pl','pm','t','pod'],
    'Python Source': ['py','ipynb'],
    'XML Files': ['xml','xsd','xsl','svg','wsdl'],
    'Archives': ['zip','rar','7z','tar','gz','bz2','iso','jar','apk','dmg','cab','arj'],
    'Video Files': ['mp4','avi','mkv','mov','flv','webm','mpeg','mpg','m4v','3gp'],
    'Audio Files': ['mp3','wav','aac','flac','ogg','wma','m4a','ape','opus'],
    'Image Files': ['jpg','jpeg','png','gif','bmp','tiff','svg','webp','heic'],
    'Executables': ['exe','msi','bat','sh','cmd','bin','apk','app','deb','rpm'],
    'Font Files': ['ttf','otf','woff','woff2','eot'],
    'Misc Files': ['torrent','md5','sha1','sfv','nfo','log','url','desktop','ini','conf','cfg']
  };

  const smartDorks = {
    'Index Browsing': [
      { label: 'Audio index', dork: 'intitle:"index of" (mp3|flac|wav|aac) "parent directory"' },
      { label: 'Document index', dork: 'intitle:"index of" (pdf|doc|docx) "parent directory"' },
      { label: 'Video index', dork: 'intitle:"index of" (mp4|avi|mkv) "parent directory"' },
      { label: 'Generic index', dork: 'intitle:"index of" "parent directory" "size" "last modified"' }
    ],
    'Exposed Files': [
      { label: 'Gov AU PDFs', dork: 'filetype:pdf site:*.gov.au' },
      { label: 'Gov AU budgets', dork: 'filetype:xls OR filetype:xlsx "budget" site:*.gov.au' },
      { label: 'Admin panels', dork: 'inurl:admin OR inurl:login OR inurl:dashboard' },
      { label: 'Resumes/CVs', dork: 'intitle:"curriculum vitae" OR intitle:"resume" filetype:pdf' }
    ],
    'Time Filters': [
      { label: 'Past 24 hours', dork: 'qdr:d', isUrlParam: true },
      { label: 'Past week', dork: 'qdr:w', isUrlParam: true },
      { label: 'Past month', dork: 'qdr:m', isUrlParam: true },
      { label: 'Past year', dork: 'qdr:y', isUrlParam: true }
    ],
    'Audio Search': [
      { label: 'Audio index dirs', dork: 'intitle:"index of" (mp3|flac|wav|aac|ape|ogg) -inurl:(jsp|php|html|aspx|htm|lyrics)' },
      { label: 'MP3 parent dirs', dork: '"parent directory" MP3 -xxx -html -htm -php' },
      { label: 'Audio platforms', dork: 'site:soundcloud.com OR site:bandcamp.com OR site:audiomack.com' },
      { label: 'Audio filetypes', dork: 'filetype:mp3 OR filetype:flac OR filetype:wav OR filetype:m4a' }
    ],
    'Special Operators': [
      { label: 'Cached version', dork: 'cache:', isPrefix: true },
      { label: 'Related pages', dork: 'related:', isPrefix: true },
      { label: 'Page info', dork: 'info:', isPrefix: true },
      { label: 'Definitions', dork: 'define:', isPrefix: true }
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
      exclusions: {}
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

  const getGoogleSearchBox = () => {
    return document.querySelector('input[name="q"]') ||
           document.querySelector('textarea[name="q"]') ||
           document.querySelector('#sb_form_q') ||
           document.getElementsByName('q')[0];
  };

  const buildSearchQuery = (baseQuery) => {
    let query = baseQuery.trim();
    const siteParts = [];
    const fileTypeParts = [];
    const exclusionParts = [];
    const dorkParts = [];
    let urlParams = {};
    let prefixOperator = null;

    // Collect site filters - all selected sites should be ORed together
    Object.entries(state.selections.sites).forEach(([category, selected]) => {
      if (selected && siteFilters[category]) {
        siteFilters[category].forEach(site => {
          siteParts.push(`site:${site}`);
        });
      }
    });

    // Collect file type filters - all selected file types should be ORed together
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

    // Collect dorks
    Object.entries(state.selections.dorks).forEach(([category, dorkSelections]) => {
      if (dorkSelections && typeof dorkSelections === 'object') {
        Object.entries(dorkSelections).forEach(([dorkLabel, selected]) => {
          if (selected) {
            const categoryDorks = smartDorks[category];
            if (categoryDorks) {
              const dorkItem = categoryDorks.find(d => d.label === dorkLabel);
              if (dorkItem) {
                if (dorkItem.isUrlParam) {
                  // URL parameters go in &tbs= for Google
                  // Ensure time-based filters are correctly formatted as qdr:<code>, e.g. qdr:d
                  const tbsValue = typeof dorkItem.dork === 'string' && dorkItem.dork.startsWith('qdr:')
                    ? dorkItem.dork
                    : `qdr:${dorkItem.dork}`;
                  urlParams.tbs = tbsValue;
                } else if (dorkItem.isPrefix) {
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

    // Sites: combine all with OR, wrap in parentheses
    if (siteParts.length > 0) {
      queryParts.push(`(${siteParts.join(' OR ')})`);
    }

    // File types: combine all with OR, wrap in parentheses
    if (fileTypeParts.length > 0) {
      queryParts.push(`(${fileTypeParts.join(' OR ')})`);
    }

    // Dorks: add each as separate term; wrap complex OR expressions in parentheses
    dorkParts.forEach(dork => {
      const trimmed = typeof dork === 'string' ? dork.trim() : dork;
      // If the dork contains an OR operator and is not already wrapped in parentheses,
      // wrap it to avoid ambiguous precedence when combined with other terms.
      const hasOrOperator = typeof trimmed === 'string' && /\sOR\s/i.test(trimmed);
      const isWrapped =
        typeof trimmed === 'string' &&
        trimmed.startsWith('(') &&
        trimmed.endsWith(')');
      if (hasOrOperator && !isWrapped) {
        queryParts.push(`(${trimmed})`);
      } else {
        queryParts.push(dork);
      }
    });

    // Exclusions: add each as separate -site: term
    exclusionParts.forEach(exclusion => {
      queryParts.push(exclusion);
    });

    // Apply prefix operator if any
    if (prefixOperator) {
      query = prefixOperator + query;
    }

    // Combine query with filter parts (space = AND in Google)
    if (queryParts.length > 0) {
      query = query + ' ' + queryParts.join(' ');
    }

    return { query: query.trim(), urlParams };
  };

  const executeSearch = (customQuery) => {
    const textbox = getGoogleSearchBox();
    const baseQuery = customQuery !== undefined ? customQuery : (textbox ? textbox.value : '');
    const { query, urlParams } = buildSearchQuery(baseQuery);

    if (!query) {
      log('warn', 'No search query provided');
      return;
    }

    // Build search URL with proper parameter handling
    let url = 'https://www.google.com/search?q=' + encodeURIComponent(query);
    
    // Append URL parameters (like tbs for time filters)
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
        exclusions: saved.exclusions || {}
      };
    }
    log('debug', 'Selections loaded', state.selections);
  };

  const renderPanel = () => {
    const panel = document.createElement('div');
    panel.style.cssText = 'padding: 12px; color: #e5e7eb; font-family: system-ui, sans-serif; font-size: 13px; max-height: 550px; overflow-y: auto;';

    const title = document.createElement('h3');
    title.textContent = 'Google Expert Search';
    title.style.cssText = 'margin: 0 0 4px 0; font-size: 16px; font-weight: 700; color: #f8fafc;';
    panel.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.textContent = 'Advanced search filters, exclusions & smart dorks';
    subtitle.style.cssText = 'margin: 0 0 12px 0; font-size: 11px; color: #94a3b8;';
    panel.appendChild(subtitle);

    const searchSection = document.createElement('div');
    searchSection.style.cssText = 'margin-bottom: 14px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 6px;';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Enter search terms...';
    searchInput.id = 'gsearch-query-input';
    searchInput.style.cssText = 'width: 100%; padding: 8px; background: #1f2937; color: #e5e7eb; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; font-size: 13px; margin-bottom: 8px; box-sizing: border-box;';

    const textbox = getGoogleSearchBox();
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
    searchBtn.textContent = '🔍 Search with Filters';
    searchBtn.style.cssText = 'flex: 1; padding: 8px 12px; background: #3b82f6; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;';
    searchBtn.addEventListener('click', () => executeSearch(searchInput.value));
    searchBtn.addEventListener('mouseenter', () => { searchBtn.style.background = '#2563eb'; });
    searchBtn.addEventListener('mouseleave', () => { searchBtn.style.background = '#3b82f6'; });

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear All';
    clearBtn.style.cssText = 'padding: 8px 12px; background: #6b7280; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;';
    clearBtn.addEventListener('click', async () => {
      searchInput.value = '';
      state.selections = { sites: {}, fileTypes: {}, dorks: {}, exclusions: {} };
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
      checkbox.style.cssText = 'margin-right: 8px; accent-color: #3b82f6;';
      checkbox.addEventListener('change', () => onChange(checkbox.checked));

      const text = document.createElement('span');
      text.textContent = label;
      text.style.cssText = 'font-size: 12px; color: #cbd5e1;';

      row.appendChild(checkbox);
      row.appendChild(text);
      return row;
    };

    // Site Exclusions section (new!)
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
    panel.appendChild(createSection('🚫', 'Site Exclusions (Remove Noise)', exclusionContent));

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
    panel.appendChild(createSection('📁', 'File Types', fileContent));

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
    panel.appendChild(createSection('🔍', 'Smart Dorks (Individual)', dorksContent));

    const helpText = document.createElement('div');
    helpText.style.cssText = 'margin-top: 12px; padding: 8px; background: rgba(59,130,246,0.1); border-radius: 4px; font-size: 11px; color: #93c5fd;';
    const helpStrong = document.createElement('strong');
    helpStrong.textContent = 'How to use:';
    helpText.appendChild(helpStrong);
    helpText.appendChild(document.createElement('br'));
    helpText.appendChild(document.createTextNode('• Site Exclusions remove noisy results'));
    helpText.appendChild(document.createElement('br'));
    helpText.appendChild(document.createTextNode('• Site Filters & File Types apply as groups'));
    helpText.appendChild(document.createElement('br'));
    helpText.appendChild(document.createTextNode('• Smart Dorks are individually selectable'));
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
      `[Google Search] ${state.enabled ? '✓' : '✗'} Enable`,
      async () => { await setEnabled(!state.enabled); }
    ));
    if (state.enabled) {
      state.menuIds.push(GM_registerMenuCommand('[Google Search] 🔍 Open Filter Panel', () => {
        if (sharedUi) {
          sharedUi.switchPanel(SCRIPT_ID);
          sharedUi.toggleModal();
        }
      }));
      state.menuIds.push(GM_registerMenuCommand('[Google Search] 🗑️ Clear All Filters', async () => {
        state.selections = { sites: {}, fileTypes: {}, dorks: {}, exclusions: {} };
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
    log('info', 'Google Expert Search ready');
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
