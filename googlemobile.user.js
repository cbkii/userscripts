// ==UserScript==
// @name         Google Extra Search (Mobile)
// @namespace    https://github.com/cbkii/userscripts
// @author       cbkii (mobile UI by Claude)
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkYxNDkzIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTEiIGN5PSIxMSIgcj0iOCIvPjxwYXRoIGQ9Im0yMSAyMS00LjM1LTQuMzUiLz48L3N2Zz4=
// @description  Mobile Google search helper with filters, dorks, and a compact UI.
// @version      2025.12.29.0725
// @require      https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js
// @require      https://ajax.googleapis.com/ajax/libs/jqueryui/1.13.2/jquery-ui.min.js
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
// @updateURL    https://raw.githubusercontent.com/cbkii/userscripts/main/googlemobile.user.js
// @downloadURL  https://raw.githubusercontent.com/cbkii/userscripts/main/googlemobile.user.js
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
  - Adds a mobile-friendly Google search helper with site, file-type, and dork filters.
  - Includes a floating action button, category panels, and dark mode styling.

  How it works:
  - Builds UI controls on Google search pages and modifies the query with
    selected filters and operators.

  Configuration:
  - Options are stored via GM_getValue/GM_setValue and can be adjusted in the UI.
*/

(() => {
  'use strict';

  //////////////////////////////////////////////////////////////
  // CONSTANTS & CONFIGURATION
  //////////////////////////////////////////////////////////////

  const DEBUG = false;
  const LOG_PREFIX = '[gsearch]';
  const LOG_STORAGE_KEY = 'userscript.logs.googlemobile';
  const LOG_MAX_ENTRIES = 200;
  const SCRIPT_ID = 'googlemobile';
  const SCRIPT_TITLE = 'Google Extra Search';
  const ENABLE_KEY = `${SCRIPT_ID}.enabled`;

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
    });
  }
  const state = {
    enabled: true,
    started: false,
    menuIds: []
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
  // CORE LOGIC - GOOGLE SEARCH ENHANCEMENTS
  //////////////////////////////////////////////////////////////

  function main() {

// ==========================
// DOMAIN URL ARRAYS
// ==========================

// File Sharing & Cloud Storage (merged comprehensive list)
var fileshareUrl = [
  '4shared.com','zippyshare.com','uploading.com','minus.com','filestube.com','filecrop.com','2shared.com',
  'mediafire.com','mega.nz','sendspace.com','uloz.to','rapidgator.net','nitroflare.com','filefactory.com',
  'racaty.net','bayfiles.com','filerio.in','pixeldrain.com','anonfiles.com','filemoon.sx','dood.pm',
  'dropbox.com','drive.google.com','onedrive.live.com','box.com','pcloud.com','icedrive.net','filen.io',
  'wetransfer.com','filemail.com','jumpshare.com','hightail.com','send-anywhere.com','turbobit.net',
  'uptobox.com','dropsend.com','files.fm','bit.ai','t-file.com','file.io','drop.me'
];

// Video streaming platforms
var videostreamUrl = [
  'netflix.com','primevideo.com','disneyplus.com','stan.com.au','binge.com.au','max.com','foxtel.com.au',
  'kayosports.com.au','sbs.com.au/ondemand','9now.com.au','7plus.com.au','abc.net.au/iview','kanopy.com','beamafilm.com',
  'tubitv.com','crackle.com','pluto.tv','plex.tv','popcorntime.app','putlocker.rs','fmovies.to','123movies.to',
  'yesmovies.ag','cinebloom.org','lookmovie.ag','movie4k.to','solarmovie.work','watchserieshd.cc','rainierland.to',
  'popcornflix.com','vidto.me','seriesfree.to','vodlocker.com','vidbull.com','oke.io',
  'youtube.com','vimeo.com','twitch.tv','dailymotion.com'
];

// Online shopping (AU-centric)
var onlineshoppingUrl = [
  'amazon.com.au','theiconic.com.au','ebay.com.au','woolworths.com.au','kmart.com.au','catch.com.au','mydeal.com.au',
  'goodguys.com.au','appliancesonline.com.au','petcircle.com.au','lyka.com.au','adorabeauty.com.au','countryroad.com.au',
  'birdsnest.com.au','cettire.com','heem.com.au','temu.com','shein.com','bigw.com.au','harveynorman.com.au'
];

// Blogging platforms
var blogUrl = [
  'wordpress.com','blogger.com','medium.com','substack.com','ghost.org','dev.to','hashnode.com',
  'livejournal.com','tumblr.com','write.as','blogspot.com'
];

// Auctions & Marketplace
var auctionUrl = [
  'ebay.com.au','grays.com.au','bidorbuy.com.au','govdeals.com.au','shopgoodwill.com','heritageauction.com',
  'ubid.com','onlineauction.com','propertyroom.com','facebook.com/marketplace','gumtree.com.au'
];

// Torrent sites
var torrentUrl = [
  'torrentgalaxy.to','thepiratebay.org','1337x.to','rarbg.to','zooqle.com','yts.mx','torlock.com','kickass.to'
];

// Adult content
var xvideoUrl = [
  'xvideos.com','pornhub.com','xhamster.com','redtube.com','tube8.com','youporn.com','spankwire.com'
];

// Academic & Research
var academicSites = [
  'nature.com','ncbi.nlm.nih.gov','jstor.org','sciencedirect.com','springer.com','arxiv.org','researchgate.net',
  'pubmed.ncbi.nlm.nih.gov','scholar.google.com','ieee.org','acm.org','cambridge.org','oup.com','wiley.com',
  'tandfonline.com','*.edu','*.edu.au'
];

// Government & Legal (AU-focused)
var govSites = [
  '*.gov.au','legislation.gov.au','austlii.edu.au','aec.gov.au','ato.gov.au','servicesaustralia.gov.au',
  'treasury.gov.au','rba.gov.au','aph.gov.au','pmc.gov.au','dfat.gov.au','health.gov.au','data.gov.au'
];

// Job Sites (AU-focused)
var jobSites = [
  'seek.com.au','linkedin.com/jobs','indeed.com.au','careerone.com.au','apsjobs.gov.au','ethicaljobs.com.au',
  'workforceaustralia.gov.au','spotjobs.com','glassdoor.com.au','jora.com','humanresourcesonline.net'
];

// Developer Resources
var devSites = [
  'stackoverflow.com','github.com','gitlab.com','dev.to','developer.mozilla.org','docs.python.org',
  'learn.microsoft.com','aws.amazon.com/documentation','kubernetes.io/docs','reactjs.org','nodejs.org'
];

// News & Media (AU + Major Subreddits)
var newsSites = [
  'abc.net.au','smh.com.au','theage.com.au','theaustralian.com.au','theguardian.com/australia-news',
  'news.com.au','sbs.com.au/news','crikey.com.au','afr.com','skynews.com.au',
  'reddit.com/r/australia','reddit.com/r/melbourne','reddit.com/r/sydney','reddit.com/r/brisbane',
  'reddit.com/r/perth','reddit.com/r/adelaide','reddit.com/r/canberra','reddit.com/r/ausfinance',
  'reddit.com/r/asx_bets','reddit.com/r/afl','reddit.com/r/nrl','reddit.com/r/australianpolitics',
  'reddit.com/r/askanaustralian','reddit.com/r/ausproperty','reddit.com/r/fiaustralia'
];

// Forums & Communities
var forumSites = [
  'reddit.com','whirlpool.net.au','ozbargain.com.au','stackoverflow.com','stackexchange.com',
  'quora.com','xda-developers.com','overclockers.com.au','productreview.com.au','choice.com.au',
  'discord.com','web.telegram.org','slack.com','teams.microsoft.com'
];

// ==========================
// SMART SEARCH DORKS
// ==========================

var indexDorks = [
  'intitle:"index of" (mp3|flac|wav|aac) "parent directory"',
  'intitle:"index of" (pdf|doc|docx) "parent directory"', 
  'intitle:"index of" (mp4|avi|mkv) "parent directory"',
  'intitle:"index of" "parent directory" "size" "last modified"'
];

var exposedFilesDorks = [
  'filetype:pdf site:*.gov.au',
  'filetype:xls OR filetype:xlsx "budget" site:*.gov.au',
  'inurl:admin OR inurl:login OR inurl:dashboard',
  'intitle:"curriculum vitae" OR intitle:"resume" filetype:pdf'
];

var timeDorks = [
  'qdr:d',  // Past 24 hours
  'qdr:w',  // Past week  
  'qdr:m',  // Past month
  'qdr:y'   // Past year
];

var audioDorks = [
  'intitle:"index of" (mp3|flac|wav|aac|ape|ogg) -inurl:(jsp|php|html|aspx|htm|lyrics)',
  '"parent directory" MP3 -xxx -html -htm -php',
  'site:soundcloud.com OR site:bandcamp.com OR site:audiomack.com',
  'filetype:mp3 OR filetype:flac OR filetype:wav OR filetype:m4a'
];

var specialDorks = [
  'cache:',  // Google's cached version
  'related:', // Related pages
  'info:', // Page info
  'define:' // Definitions
];

// ==========================
// FILE EXTENSION ARRAYS
// ==========================

var datasheetExt = ['xls','ods','xlsx','csv','tsv','dif','dbf','xlt','xlsm','xltx'];
var documentExt = ['doc','docx','rtf','txt','odt','pdf','md','json','yaml','yml'];
var presentationExt = ['ppt','pps','odp','key','pptx','potx'];
var csharpSourceExt = ['cs']; 
var javaSourceExt = ['java','jar','js']; 
var cppSourceExt = ['cpp','h','hpp','cxx'];
var basicSourceExt = ['bas','vbs','cls','frm','ctl']; 
var perlSourceExt = ['pl','pm','t','pod']; 
var pythonSourceExt = ['py','ipynb'];
var xmlExt = ['xml','xsd','xsl','svg','wsdl'];
var archiveExt = ['zip','rar','7z','tar','gz','bz2','iso','jar','apk','dmg','cab','arj'];
var videoExt = ['mp4','avi','mkv','mov','flv','webm','mpeg','mpg','m4v','3gp'];
var audioExt = ['mp3','wav','aac','flac','ogg','wma','m4a','ape','opus'];
var imageExt = ['jpg','jpeg','png','gif','bmp','tiff','svg','webp','heic'];
var execExt = ['exe','msi','bat','sh','cmd','bin','apk','app','deb','rpm'];
var fontExt = ['ttf','otf','woff','woff2','eot'];
var miscExt = ['torrent','md5','sha1','sfv','nfo','log','url','desktop','ini','conf','cfg'];

// ==========================
// GLOBAL VARIABLES
// ==========================

var searchString = '';
var urls = new Array(0);
var extensions = new Array(0);
var dorks = new Array(0);
var options = [urls, extensions, dorks];
var textbox; // Will be found dynamically in init()
var buttons;
var body = document.getElementsByTagName('body')[0];
var form; // Will be found dynamically in init()
var checkboxes = new Array(3);
var cbSearchRemember;

// Settings
var useCustomFontColor = false;
var colorCode = "#FFFFF0";
var rememberSearch = false;
var defaultCheckRemember = false;
var defaultSearchRemember = false;

// ==========================
// INITIALIZATION FUNCTIONS
// ==========================

function getButtons()
{
    // Look for Google search buttons more comprehensively
    var buttons = [];
    
    // Try different selectors for Google search buttons
    var searchButtons = document.querySelectorAll('input[type="submit"][value*="Search"], input[type="submit"][name="btnG"], button[type="submit"], input[type="submit"]:not([name="btnI"])');
    
    for (var i = 0; i < searchButtons.length; i++) {
        var btn = searchButtons[i];
        // Skip "I'm Feeling Lucky" button and other non-search buttons
        if (btn.name !== 'btnI' && !btn.value.includes('Lucky')) {
            buttons.push(btn);
        }
    }
    
    // Fallback to original method if no buttons found
    if (buttons.length === 0) {
        var node_list = document.getElementsByTagName('input');
        for (var i = 0; i < node_list.length; i++) {
            var node = node_list[i];
            if (node.getAttribute('type') == 'submit') {
                buttons.push(node);
            }
        }
    }
    
    return buttons;
}

function initUrls()
{
		urls.push([fileshareUrl, 'File Sharing & Cloud Storage', false]);
		urls.push([videostreamUrl, 'Video Streaming', false]);
		urls.push([onlineshoppingUrl,'Online Shopping',false]);
		urls.push([blogUrl,'Blogs & Writing',false]);
		urls.push([auctionUrl,'Auctions & Marketplace',false]);
		urls.push([torrentUrl,'Torrents',false]);
		urls.push([xvideoUrl,'Adult Content',false]);
		urls.push([academicSites,'Academic & Research',false]);
		urls.push([govSites,'Government & Legal',false]);
		urls.push([jobSites,'Job Sites',false]);
		urls.push([devSites,'Developer Resources',false]);
		urls.push([newsSites,'News & Media',false]);
		urls.push([forumSites,'Forums & Communities',false]);
}

function initDorks()
{
		dorks.push([indexDorks, 'Index Browsing', false]);
		dorks.push([exposedFilesDorks, 'Exposed Files', false]);
		dorks.push([timeDorks, 'Time-based Search', false]);
		dorks.push([audioDorks, 'Audio File Search', false]);
		dorks.push([specialDorks, 'Special Operators', false]);
}

function initExtensions()
{
		extensions.push([datasheetExt, 'Spreadsheets', false]);
		extensions.push([documentExt, 'Documents', false]);
		extensions.push([presentationExt, 'Presentations', false]);
		extensions.push([csharpSourceExt, 'C# Source', false]);
		extensions.push([javaSourceExt, 'Java Source', false]);
		extensions.push([cppSourceExt, 'C++ Source', false]);
		extensions.push([basicSourceExt, 'Basic Source', false]);
		extensions.push([perlSourceExt, 'Perl Source', false]);
		extensions.push([pythonSourceExt, 'Python Source', false]);
		extensions.push([xmlExt, 'XML Files', false]);
		extensions.push([videoExt, 'Video Files', false]);
		extensions.push([audioExt, 'Audio Files', false]);
		extensions.push([imageExt, 'Image Files', false]);
		extensions.push([archiveExt, 'Archives', false]);
		extensions.push([execExt, 'Executables', false]);
		extensions.push([fontExt, 'Font Files', false]);
		extensions.push([miscExt, 'Misc Files', false]);
}

function initCheckboxArray()
{
    var i;
	for(i = 0; i < checkboxes.length; i++)
	{
		checkboxes[i] = new Array(options[i].length);
	}
}

// ==========================
// UI CREATION FUNCTIONS
// ==========================

function appendCheckbox()
{
	// Remove old UI if it exists
	var existingUI = document.getElementById('google-expert-ui');
	if (existingUI) {
		existingUI.remove();
	}

	// Dynamic theme detection
	const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches ||
					   document.documentElement.getAttribute('data-theme') === 'dark' ||
					   document.body.classList.contains('dark') ||
					   getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)';

	const reinforceVisibility = () => {
		const containerNode = document.getElementById('google-expert-ui');
		if (containerNode && !document.body.contains(containerNode)) {
			document.body.appendChild(containerNode);
		}
		const fabNode = document.getElementById('google-expert-fab');
		if (fabNode) {
			const cs = getComputedStyle(fabNode);
			if (cs.display === 'none' || cs.visibility === 'hidden') {
				fabNode.style.setProperty('display', 'flex', 'important');
				fabNode.style.setProperty('visibility', 'visible', 'important');
				fabNode.style.setProperty('opacity', '1', 'important');
			}
		}
		const overlayNode = document.getElementById('google-expert-overlay');
		if (overlayNode) {
			const csOverlay = getComputedStyle(overlayNode);
			if (csOverlay.display === 'none') {
				overlayNode.style.setProperty('display', 'block', 'important');
			}
		}
		const panelNode = document.getElementById('google-expert-panel');
		if (panelNode) {
			const csPanel = getComputedStyle(panelNode);
			if (csPanel.display === 'none') {
				panelNode.style.setProperty('display', 'block', 'important');
			}
		}
	};

	// Mobile-first CSS with dark mode support
	GM_addStyle(`
		/* Floating Action Button */
		#google-expert-fab {
			position: fixed !important;
			bottom: 20px !important;
			right: 80px !important;
			width: 56px !important;
			height: 56px !important;
			border-radius: 50% !important;
			background: ${isDarkMode ? 'linear-gradient(135deg, #48bb78 0%, #38a169 100%)' : 'linear-gradient(135deg, #48bb78 0%, #38a169 100%)'} !important;
			box-shadow: 0 6px 20px rgba(0,0,0,0.3) !important;
			border: none !important;
			cursor: pointer !important;
			z-index: 10000 !important;
			display: flex !important;
			align-items: center !important;
			justify-content: center !important;
			transition: all 0.3s cubic-bezier(0.4, 0.0, 0.2, 1) !important;
			font-size: 24px !important;
			color: white !important;
		}
		
		#google-expert-fab:hover {
			transform: scale(1.1) !important;
			box-shadow: 0 8px 25px rgba(0,0,0,0.4) !important;
		}
		
		#google-expert-fab.active {
			background: ${isDarkMode ? 'linear-gradient(135deg, #f56565 0%, #e53e3e 100%)' : 'linear-gradient(135deg, #f56565 0%, #e53e3e 100%)'} !important;
			transform: none !important;
		}
		
		/* Main Panel Overlay */
		#google-expert-overlay {
			position: fixed !important;
			top: 0 !important;
			left: 0 !important;
			width: 100% !important;
			height: 100% !important;
			background: rgba(0, 0, 0, 0.5) !important;
			z-index: 9999 !important;
			opacity: 0 !important;
			visibility: hidden !important;
			transition: all 0.3s ease !important;
		}
		
		#google-expert-overlay.active {
			opacity: 1 !important;
			visibility: visible !important;
		}
		
		/* Main Panel */
		#google-expert-panel {
			position: fixed !important;
			bottom: 0 !important;
			left: 0 !important;
			right: 0 !important;
			max-height: 85vh !important;
			background: ${isDarkMode ? '#1a1a1a' : '#ffffff'} !important;
			border-radius: 20px 20px 0 0 !important;
			box-shadow: 0 -10px 30px rgba(0,0,0,0.3) !important;
			transform: translateY(100%) !important;
			transition: transform 0.4s cubic-bezier(0.4, 0.0, 0.2, 1) !important;
			overflow: hidden !important;
			color: ${isDarkMode ? '#ffffff' : '#333333'} !important;
		}
		
		#google-expert-overlay.active #google-expert-panel {
			transform: translateY(0) !important;
		}
		
		/* Panel Header */
		.expert-header {
			padding: 20px !important;
			background: ${isDarkMode ? 'linear-gradient(135deg, #2d3748 0%, #4a5568 100%)' : 'linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%)'} !important;
			border-bottom: 1px solid ${isDarkMode ? '#4a5568' : '#e2e8f0'} !important;
			display: flex !important;
			justify-content: space-between !important;
			align-items: flex-start !important;
			gap: 15px !important;
		}
		
		.expert-title {
			font-size: 18px !important;
			font-weight: 600 !important;
			margin: 0 !important;
			color: ${isDarkMode ? '#ffffff' : '#2d3748'} !important;
		}
		
		.expert-subtitle {
			font-size: 12px !important;
			opacity: 0.7 !important;
			margin: 2px 0 8px 0 !important;
		}
		
		/* Search Container */
		.expert-search-container {
			margin-top: 8px !important;
			width: 100% !important;
			max-width: 350px !important;
		}
		
		.expert-search-input {
			width: 100% !important;
			padding: 10px 12px !important;
			border: 2px solid ${isDarkMode ? '#4a5568' : '#e2e8f0'} !important;
			border-radius: 8px !important;
			background: ${isDarkMode ? '#1a202c' : '#ffffff'} !important;
			color: ${isDarkMode ? '#ffffff' : '#2d3748'} !important;
			font-size: 14px !important;
			transition: border-color 0.2s ease !important;
			box-sizing: border-box !important;
		}
		
		.expert-search-input:focus {
			outline: none !important;
			border-color: ${isDarkMode ? '#4299e1' : '#4285f4'} !important;
			box-shadow: 0 0 0 3px ${isDarkMode ? 'rgba(66, 153, 225, 0.1)' : 'rgba(66, 133, 244, 0.1)'} !important;
		}
		
		.expert-search-input::placeholder {
			color: ${isDarkMode ? '#a0aec0' : '#718096'} !important;
		}
		
		/* Action Buttons in Header */
		.expert-header-actions {
			display: flex !important;
			gap: 8px !important;
		}
		
		.expert-btn {
			padding: 8px 12px !important;
			border: none !important;
			border-radius: 20px !important;
			font-size: 12px !important;
			font-weight: 500 !important;
			cursor: pointer !important;
			transition: all 0.2s ease !important;
			background: ${isDarkMode ? '#4a5568' : '#e2e8f0'} !important;
			color: ${isDarkMode ? '#ffffff' : '#4a5568'} !important;
		}
		
		.expert-btn:hover {
			transform: translateY(-1px) !important;
			box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
		}
		
		.expert-btn.primary {
			background: ${isDarkMode ? '#4299e1' : '#4285f4'} !important;
			color: white !important;
		}
		
		.expert-btn.danger {
			background: ${isDarkMode ? '#f56565' : '#ea4335'} !important;
			color: white !important;
		}
		
		/* Panel Content */
		.expert-content {
			max-height: calc(85vh - 120px) !important;
			overflow-y: auto !important;
			padding: 0 !important;
		}
		
		/* Category Groups */
		.expert-category-group {
			border-bottom: 1px solid ${isDarkMode ? '#2d3748' : '#f7fafc'} !important;
		}
		
		.group-header {
			padding: 18px 20px !important;
			background: ${isDarkMode ? 'linear-gradient(135deg, #2d3748 0%, #4a5568 100%)' : 'linear-gradient(135deg, #4285f4 0%, #34a853 100%)'} !important;
			border: none !important;
			width: 100% !important;
			text-align: left !important;
			font-size: 17px !important;
			font-weight: 700 !important;
			color: #ffffff !important;
			cursor: pointer !important;
			display: flex !important;
			justify-content: space-between !important;
			align-items: center !important;
			transition: background 0.2s ease !important;
		}
		
		.group-header:hover {
			background: ${isDarkMode ? 'linear-gradient(135deg, #4a5568 0%, #718096 100%)' : 'linear-gradient(135deg, #34a853 0%, #1a73e8 100%)'} !important;
		}
		
		.group-content {
			max-height: calc(70vh - 200px) !important;
			overflow-y: auto !important;
			overflow-x: hidden !important;
			transition: max-height 0.3s ease !important;
			background: ${isDarkMode ? '#1a202c' : '#ffffff'} !important;
		}
		
		.group-content.collapsed {
			max-height: 0 !important;
			overflow: hidden !important;
		}
		
		.category-icon {
			font-size: 18px !important;
			transition: transform 0.3s ease !important;
		}
		
		.group-header.collapsed .category-icon {
			transform: rotate(-90deg) !important;
		}
		
		/* Individual Categories within Groups */
		.expert-category {
			border-bottom: none !important;
		}
		
		/* Checkbox Options */
		.expert-options {
			padding: 0 !important;
		}
		
		.expert-option {
			display: flex !important;
			align-items: center !important;
			padding: 14px 20px !important;
			margin: 0 !important;
			transition: background 0.2s ease !important;
			cursor: pointer !important;
			border-bottom: 1px solid ${isDarkMode ? 'rgba(74, 85, 104, 0.2)' : 'rgba(226, 232, 240, 0.3)'} !important;
		}
		
		.expert-option:last-child {
			border-bottom: none !important;
		}
		
		.expert-option:hover {
			background: ${isDarkMode ? 'rgba(74, 85, 104, 0.2)' : 'rgba(226, 232, 240, 0.3)'} !important;
		}
		
		.expert-option input[type="checkbox"] {
			width: 20px !important;
			height: 20px !important;
			margin-right: 12px !important;
			margin-left: 0 !important;
			cursor: pointer !important;
			accent-color: ${isDarkMode ? '#4299e1' : '#4285f4'} !important;
		}
		
		.expert-option-label {
			font-size: 15px !important;
			font-weight: 500 !important;
			color: ${isDarkMode ? '#e2e8f0' : '#4a5568'} !important;
			flex: 1 !important;
			cursor: pointer !important;
		}
		
		.expert-option-count {
			font-size: 12px !important;
			color: ${isDarkMode ? '#a0aec0' : '#718096'} !important;
			background: ${isDarkMode ? '#2d3748' : '#f7fafc'} !important;
			padding: 2px 8px !important;
			border-radius: 10px !important;
			margin-left: 8px !important;
			cursor: pointer !important;
			transition: all 0.2s ease !important;
		}
		
		.expert-option-count:hover {
			background: ${isDarkMode ? '#4299e1' : '#4285f4'} !important;
			color: white !important;
			transform: scale(1.05) !important;
		}
		
		/* Remember Search Toggle */
		.expert-remember {
			padding: 16px 20px !important;
			background: ${isDarkMode ? '#2d3748' : '#f8f9fa'} !important;
			border-top: 1px solid ${isDarkMode ? '#4a5568' : '#e2e8f0'} !important;
			display: flex !important;
			align-items: center !important;
			justify-content: space-between !important;
		}
		
		.expert-remember-label {
			font-size: 14px !important;
			font-weight: 500 !important;
			color: ${isDarkMode ? '#e2e8f0' : '#4a5568'} !important;
		}
		
		/* Help Icon */
		.expert-help-icon {
			font-size: 12px !important;
			color: ${isDarkMode ? '#a0aec0' : '#718096'} !important;
			background: ${isDarkMode ? '#2d3748' : '#f7fafc'} !important;
			padding: 4px 8px !important;
			border-radius: 50% !important;
			cursor: pointer !important;
			transition: all 0.2s ease !important;
			font-weight: bold !important;
			min-width: 16px !important;
			text-align: center !important;
		}
		
		.expert-help-icon:hover {
			background: ${isDarkMode ? '#4299e1' : '#4285f4'} !important;
			color: white !important;
			transform: scale(1.05) !important;
		}
		
		/* Toggle Switch */
		.expert-toggle {
			position: relative !important;
			width: 44px !important;
			height: 24px !important;
		}
		
		.expert-toggle input {
			opacity: 0 !important;
			width: 0 !important;
			height: 0 !important;
		}
		
		.expert-toggle-slider {
			position: absolute !important;
			cursor: pointer !important;
			top: 0 !important;
			left: 0 !important;
			right: 0 !important;
			bottom: 0 !important;
			background-color: ${isDarkMode ? '#4a5568' : '#cbd5e0'} !important;
			transition: 0.3s !important;
			border-radius: 24px !important;
		}
		
		.expert-toggle-slider:before {
			position: absolute !important;
			content: "" !important;
			height: 18px !important;
			width: 18px !important;
			left: 3px !important;
			bottom: 3px !important;
			background-color: white !important;
			transition: 0.3s !important;
			border-radius: 50% !important;
		}
		
		.expert-toggle input:checked + .expert-toggle-slider {
			background-color: ${isDarkMode ? '#4299e1' : '#4285f4'} !important;
		}
		
		.expert-toggle input:checked + .expert-toggle-slider:before {
			transform: translateX(20px) !important;
		}
		
		/* Animation for selected items */
		.expert-option input[type="checkbox"]:checked + .expert-option-label {
			color: ${isDarkMode ? '#4299e1' : '#4285f4'} !important;
			font-weight: 600 !important;
		}
		
		/* Pulse animation for FAB */
		@keyframes expert-pulse {
			0% { box-shadow: 0 6px 20px rgba(0,0,0,0.3), 0 0 0 0 rgba(66, 133, 244, 0.7); }
			70% { box-shadow: 0 6px 20px rgba(0,0,0,0.3), 0 0 0 10px rgba(66, 133, 244, 0); }
			100% { box-shadow: 0 6px 20px rgba(0,0,0,0.3), 0 0 0 0 rgba(66, 133, 244, 0); }
		}
		
		#google-expert-fab.pulse {
			animation: expert-pulse 2s infinite !important;
		}
		
		/* Popup Styles */
		#array-contents-popup {
			position: fixed !important;
			top: 0 !important;
			left: 0 !important;
			width: 100% !important;
			height: 100% !important;
			z-index: 10001 !important;
		}
		
		.popup-overlay {
			background: rgba(0, 0, 0, 0.7) !important;
			width: 100% !important;
			height: 100% !important;
			display: flex !important;
			align-items: center !important;
			justify-content: center !important;
			padding: 20px !important;
			box-sizing: border-box !important;
		}
		
		.popup-content {
			background: ${isDarkMode ? '#1a1a1a' : '#ffffff'} !important;
			border-radius: 12px !important;
			max-width: 90% !important;
			max-height: 80% !important;
			width: 600px !important;
			box-shadow: 0 10px 30px rgba(0,0,0,0.3) !important;
			overflow: hidden !important;
		}
		
		.popup-header {
			padding: 20px !important;
			border-bottom: 1px solid ${isDarkMode ? '#4a5568' : '#e2e8f0'} !important;
			display: flex !important;
			justify-content: space-between !important;
			align-items: center !important;
			background: ${isDarkMode ? '#2d3748' : '#f8f9fa'} !important;
		}
		
		.popup-header h3 {
			margin: 0 !important;
			color: ${isDarkMode ? '#ffffff' : '#2d3748'} !important;
			font-size: 18px !important;
		}
		
		.popup-close {
			background: none !important;
			border: none !important;
			font-size: 20px !important;
			cursor: pointer !important;
			color: ${isDarkMode ? '#a0aec0' : '#718096'} !important;
			padding: 5px !important;
		}
		
		.popup-body {
			padding: 20px !important;
			max-height: 400px !important;
			overflow-y: auto !important;
		}
		
		.array-items {
			display: flex !important;
			flex-wrap: wrap !important;
			gap: 8px !important;
		}
		
		.array-item {
			background: ${isDarkMode ? '#4a5568' : '#e2e8f0'} !important;
			color: ${isDarkMode ? '#ffffff' : '#4a5568'} !important;
			padding: 6px 12px !important;
			border-radius: 20px !important;
			font-size: 13px !important;
			font-family: monospace !important;
			word-break: break-all !important;
		}
		
		/* Responsive Design */
		@media screen and (max-width: 480px) {
			#google-expert-fab {
				right: 60px !important;
				bottom: 15px !important;
			}
			
			#google-expert-panel {
				max-height: 90vh !important;
			}
			
			.expert-option {
				padding: 12px 16px !important;
			}
			
			.group-header {
				padding: 16px !important;
				font-size: 16px !important;
			}
			
			.expert-option-label {
				font-size: 14px !important;
			}
			
			.group-content {
				max-height: calc(75vh - 200px) !important;
			}
		}
	`);

	// Create Floating Action Button
	var fab = document.createElement('button');
	fab.id = 'google-expert-fab';
	fab.innerHTML = '🔍';
	fab.title = 'Google Expert Search Options';
	
	// Create Overlay
	var overlay = document.createElement('div');
	overlay.id = 'google-expert-overlay';
	
	// Create Main Panel
	var panel = document.createElement('div');
	panel.id = 'google-expert-panel';
	
	// Panel Header with integrated search
	var header = document.createElement('div');
	header.className = 'expert-header';
	header.innerHTML = `
		<div style="flex: 1;">
			<div class="expert-title">Google Expert Search Pro</div>
			<div class="expert-subtitle">Advanced search filters & smart dorks</div>
			<div class="expert-search-container">
				<input type="text" id="expert-search-input" class="expert-search-input" placeholder="Enter search terms here (optional)..." />
			</div>
		</div>
		<div class="expert-header-actions">
			<button class="expert-btn danger" id="expert-clear-btn">Clear</button>
			<button class="expert-btn primary" id="expert-search-btn">Search</button>
		</div>
	`;
	
	// Panel Content Container
	var content = document.createElement('div');
	content.className = 'expert-content';
	
	// Create three-tier category organization (sorted alphabetically)
	var categoryGroups = [
		{
			groupName: 'Site Filters',
			groupIcon: '🌐',
			categories: [
				{ array: academicSites, label: 'Academic & Research', count: academicSites.length, type: 'urls' },
				{ array: auctionUrl, label: 'Auctions & Marketplace', count: auctionUrl.length, type: 'urls' },
				{ array: blogUrl, label: 'Blogs & Writing', count: blogUrl.length, type: 'urls' },
				{ array: devSites, label: 'Developer Resources', count: devSites.length, type: 'urls' },
				{ array: fileshareUrl, label: 'File Sharing & Cloud Storage', count: fileshareUrl.length, type: 'urls' },
				{ array: forumSites, label: 'Forums & Communities', count: forumSites.length, type: 'urls' },
				{ array: govSites, label: 'Government & Legal', count: govSites.length, type: 'urls' },
				{ array: jobSites, label: 'Job Sites', count: jobSites.length, type: 'urls' },
				{ array: newsSites, label: 'News & Media', count: newsSites.length, type: 'urls' },
				{ array: onlineshoppingUrl, label: 'Online Shopping', count: onlineshoppingUrl.length, type: 'urls' },
				{ array: torrentUrl, label: 'Torrents', count: torrentUrl.length, type: 'urls' },
				{ array: videostreamUrl, label: 'Video Streaming', count: videostreamUrl.length, type: 'urls' },
				{ array: xvideoUrl, label: 'XXX Adult', count: xvideoUrl.length, type: 'urls' }
			]
		},
		{
			groupName: 'File Types',
			groupIcon: '📁',
			categories: [
				{ array: archiveExt, label: 'Archives', count: archiveExt.length, type: 'extensions' },
				{ array: audioExt, label: 'Audio Files', count: audioExt.length, type: 'extensions' },
				{ array: basicSourceExt, label: 'Basic Source', count: basicSourceExt.length, type: 'extensions' },
				{ array: cppSourceExt, label: 'C++ Source', count: cppSourceExt.length, type: 'extensions' },
				{ array: csharpSourceExt, label: 'C# Source', count: csharpSourceExt.length, type: 'extensions' },
				{ array: documentExt, label: 'Documents', count: documentExt.length, type: 'extensions' },
				{ array: execExt, label: 'Executables', count: execExt.length, type: 'extensions' },
				{ array: fontExt, label: 'Font Files', count: fontExt.length, type: 'extensions' },
				{ array: imageExt, label: 'Image Files', count: imageExt.length, type: 'extensions' },
				{ array: javaSourceExt, label: 'Java Source', count: javaSourceExt.length, type: 'extensions' },
				{ array: miscExt, label: 'Misc Files', count: miscExt.length, type: 'extensions' },
				{ array: perlSourceExt, label: 'Perl Source', count: perlSourceExt.length, type: 'extensions' },
				{ array: presentationExt, label: 'Presentations', count: presentationExt.length, type: 'extensions' },
				{ array: pythonSourceExt, label: 'Python Source', count: pythonSourceExt.length, type: 'extensions' },
				{ array: datasheetExt, label: 'Spreadsheets', count: datasheetExt.length, type: 'extensions' },
				{ array: videoExt, label: 'Video Files', count: videoExt.length, type: 'extensions' },
				{ array: xmlExt, label: 'XML Files', count: xmlExt.length, type: 'extensions' }
			]
		},
		{
			groupName: 'Smart Dorks',
			groupIcon: '🔍',
			categories: [
				{ array: audioDorks, label: 'Audio File Search', count: audioDorks.length, type: 'dorks' },
				{ array: exposedFilesDorks, label: 'Exposed Files', count: exposedFilesDorks.length, type: 'dorks' },
				{ array: indexDorks, label: 'Index Browsing', count: indexDorks.length, type: 'dorks' },
				{ array: specialDorks, label: 'Special Operators', count: specialDorks.length, type: 'dorks' },
				{ array: timeDorks, label: 'Time-based Search', count: timeDorks.length, type: 'dorks' }
			]
		}
	];

	// Function to show array contents popup
	function showArrayContents(title, array) {
		var existingPopup = document.getElementById('array-contents-popup');
		if (existingPopup) {
			existingPopup.remove();
		}
		
		var popup = document.createElement('div');
		popup.id = 'array-contents-popup';
		popup.innerHTML = `
			<div class="popup-overlay">
				<div class="popup-content">
					<div class="popup-header">
						<h3>${title}</h3>
						<button class="popup-close">✕</button>
					</div>
					<div class="popup-body">
						<div class="array-items">
							${array.map(item => `<span class="array-item">${item}</span>`).join('')}
						</div>
					</div>
				</div>
			</div>
		`;
		
		document.body.appendChild(popup);
		
		popup.querySelector('.popup-close').addEventListener('click', () => popup.remove());
		popup.querySelector('.popup-overlay').addEventListener('click', (e) => {
			if (e.target === popup.querySelector('.popup-overlay')) {
				popup.remove();
			}
		});
	}

	categoryGroups.forEach((group, groupIndex) => {
		var groupDiv = document.createElement('div');
		groupDiv.className = 'expert-category-group';
		
		var groupHeader = document.createElement('button');
		groupHeader.className = groupIndex === 0 ? 'group-header' : 'group-header collapsed';
		groupHeader.innerHTML = `
			<span>${group.groupIcon} ${group.groupName}</span>
			<span class="category-icon">▼</span>
		`;
		
		var groupContent = document.createElement('div');
		groupContent.className = groupIndex === 0 ? 'group-content' : 'group-content collapsed';
		
		group.categories.forEach((category, categoryIndex) => {
			var categoryDiv = document.createElement('div');
			categoryDiv.className = 'expert-category';
			
			var optionDiv = document.createElement('label');
			optionDiv.className = 'expert-option';
			
			var checkbox = document.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.id = `expert-cb-${groupIndex}-${categoryIndex}`;
			
			var label = document.createElement('span');
			label.className = 'expert-option-label';
			label.textContent = category.label;
			
			var count = document.createElement('span');
			count.className = 'expert-option-count';
			count.textContent = category.count;
			count.title = 'Click to see what\'s included';
			
			count.addEventListener('click', function(e) {
				e.preventDefault();
				e.stopPropagation();
				showArrayContents(category.label, category.array);
			});
			
			optionDiv.appendChild(checkbox);
			optionDiv.appendChild(label);
			optionDiv.appendChild(count);
			categoryDiv.appendChild(optionDiv);
			groupContent.appendChild(categoryDiv);
			
			// Store reference for processing
			if (category.type === 'urls') {
				if (!checkboxes[0]) checkboxes[0] = [];
				checkboxes[0].push(checkbox);
				if (!urls[checkboxes[0].length - 1]) urls.push([category.array, category.label, false]);
			} else if (category.type === 'extensions') {
				if (!checkboxes[1]) checkboxes[1] = [];
				checkboxes[1].push(checkbox);
				if (!extensions[checkboxes[1].length - 1]) extensions.push([category.array, category.label, false]);
			} else if (category.type === 'dorks') {
				if (!checkboxes[2]) checkboxes[2] = [];
				checkboxes[2].push(checkbox);
				if (!dorks[checkboxes[2].length - 1]) dorks.push([category.array, category.label, false]);
			}
		});
		
		groupDiv.appendChild(groupHeader);
		groupDiv.appendChild(groupContent);
		content.appendChild(groupDiv);
		
		groupHeader.addEventListener('click', function() {
			groupHeader.classList.toggle('collapsed');
			groupContent.classList.toggle('collapsed');
		});
	});
	
	// Remember search section with help icon
	var rememberDiv = document.createElement('div');
	rememberDiv.className = 'expert-remember';
	rememberDiv.innerHTML = `
		<div style="display: flex; align-items: center; gap: 8px;">
			<span class="expert-help-icon" id="expert-help-icon" title="Click for help">?</span>
			<span class="expert-remember-label">Remember last search term</span>
		</div>
		<label class="expert-toggle">
			<input type="checkbox" id="expert-remember-toggle">
			<span class="expert-toggle-slider"></span>
		</label>
	`;
	
	// Function to show help popup
	function showHelpPopup() {
		// Re-detect dark mode for popup styling
		const isDarkModePopup = window.matchMedia('(prefers-color-scheme: dark)').matches ||
							   document.documentElement.getAttribute('data-theme') === 'dark' ||
							   document.body.classList.contains('dark') ||
							   getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)';
		
		var existingPopup = document.getElementById('help-popup');
		if (existingPopup) {
			existingPopup.remove();
		}
		
		var popup = document.createElement('div');
		popup.id = 'help-popup';
		popup.innerHTML = `
			<div class="popup-overlay">
				<div class="popup-content">
					<div class="popup-header">
						<h3>Remember Search Term Help</h3>
						<button class="popup-close">✕</button>
					</div>
					<div class="popup-body">
						<p style="color: ${isDarkModePopup ? '#e2e8f0' : '#4a5568'}; margin-bottom: 15px;"><strong>What this toggle does:</strong></p>
						<p style="color: ${isDarkModePopup ? '#e2e8f0' : '#4a5568'}; margin-bottom: 15px;">When enabled, the script will automatically save and restore your search terms when you return to Google, making it easier to continue previous searches.</p>
						
						<p style="color: ${isDarkModePopup ? '#e2e8f0' : '#4a5568'}; margin-bottom: 10px;"><strong>How it works:</strong></p>
						<ul style="margin: 0 0 15px 0; padding-left: 20px; color: ${isDarkModePopup ? '#cbd5e0' : '#718096'};">
							<li style="margin-bottom: 8px;"><strong>Toggle ON:</strong> Your search terms from both the built-in search bar and Google's main search box are automatically saved and will be restored when you visit Google again</li>
							<li style="margin-bottom: 8px;"><strong>Toggle OFF:</strong> Search terms are not saved and will be cleared when you leave the page</li>
						</ul>
						
						<p style="color: ${isDarkModePopup ? '#e2e8f0' : '#4a5568'}; margin-bottom: 10px;"><strong>Search integration:</strong></p>
						<ul style="margin: 0 0 15px 0; padding-left: 20px; color: ${isDarkModePopup ? '#cbd5e0' : '#718096'};">
							<li style="margin-bottom: 8px;">The built-in search bar above works together with Google's main search box</li>
							<li style="margin-bottom: 8px;">Both search inputs are combined with your selected filters when you click "Search"</li>
							<li style="margin-bottom: 8px;">Filters are automatically applied as Google search operators (site:, filetype:, special dorks, etc.)</li>
							<li style="margin-bottom: 8px;">The search is automatically executed - no need to manually click Google's search button</li>
						</ul>
						
						<p style="color: ${isDarkModePopup ? '#4299e1' : '#4285f4'}; font-size: 13px; font-style: italic;">💡 Tip: Enable this if you frequently return to Google and want to continue where you left off!</p>
					</div>
				</div>
			</div>
		`;
		
		// Apply popup-specific styles
		GM_addStyle(`
			#help-popup {
				position: fixed !important;
				top: 0 !important;
				left: 0 !important;
				width: 100% !important;
				height: 100% !important;
				z-index: 10002 !important;
			}
			
			#help-popup .popup-overlay {
				background: rgba(0, 0, 0, 0.7) !important;
				width: 100% !important;
				height: 100% !important;
				display: flex !important;
				align-items: center !important;
				justify-content: center !important;
				padding: 20px !important;
				box-sizing: border-box !important;
			}
			
			#help-popup .popup-content {
				background: ${isDarkModePopup ? '#1a1a1a' : '#ffffff'} !important;
				border-radius: 12px !important;
				max-width: 90% !important;
				max-height: 80% !important;
				width: 600px !important;
				box-shadow: 0 10px 30px rgba(0,0,0,0.3) !important;
				overflow: hidden !important;
			}
			
			#help-popup .popup-header {
				padding: 20px !important;
				border-bottom: 1px solid ${isDarkModePopup ? '#4a5568' : '#e2e8f0'} !important;
				display: flex !important;
				justify-content: space-between !important;
				align-items: center !important;
				background: ${isDarkModePopup ? '#2d3748' : '#f8f9fa'} !important;
			}
			
			#help-popup .popup-header h3 {
				margin: 0 !important;
				color: ${isDarkModePopup ? '#ffffff' : '#2d3748'} !important;
				font-size: 18px !important;
			}
			
			#help-popup .popup-close {
				background: none !important;
				border: none !important;
				font-size: 20px !important;
				cursor: pointer !important;
				color: ${isDarkModePopup ? '#a0aec0' : '#718096'} !important;
				padding: 5px !important;
				border-radius: 4px !important;
				transition: background 0.2s ease !important;
			}
			
			#help-popup .popup-close:hover {
				background: ${isDarkModePopup ? '#4a5568' : '#e2e8f0'} !important;
			}
			
			#help-popup .popup-body {
				padding: 20px !important;
				max-height: 400px !important;
				overflow-y: auto !important;
				line-height: 1.5 !important;
			}
		`);
		
		document.body.appendChild(popup);
		
		// Add event listeners for closing
		var closeBtn = popup.querySelector('.popup-close');
		var overlay = popup.querySelector('.popup-overlay');
		
		if (closeBtn) {
			closeBtn.addEventListener('click', function() {
				popup.remove();
			});
		}
		
		if (overlay) {
			overlay.addEventListener('click', function(e) {
				if (e.target === overlay) {
					popup.remove();
				}
			});
		}
		
		// Close on Escape key
		document.addEventListener('keydown', function escapeHandler(e) {
			if (e.key === 'Escape') {
				popup.remove();
				document.removeEventListener('keydown', escapeHandler);
			}
		});
	}
	
	cbSearchRemember = rememberDiv.querySelector('#expert-remember-toggle');
	cbSearchRemember.checked = defaultSearchRemember;
	
	// Help icon click handler
	var helpIcon = rememberDiv.querySelector('#expert-help-icon');
	if (helpIcon) {
		helpIcon.addEventListener('click', function(e) {
			e.preventDefault();
			e.stopPropagation();
			log('info', 'Help popup opened');
			showHelpPopup();
		});
	} else {
		log('warn', 'Help icon missing');
	}
	
	// Assemble panel
	panel.appendChild(header);
	panel.appendChild(content);
	panel.appendChild(rememberDiv);
	overlay.appendChild(panel);
	
	// Create container
	var container = document.createElement('div');
	container.id = 'google-expert-ui';
	container.appendChild(fab);
	container.appendChild(overlay);
	
	// Add to page
	document.body.appendChild(container);
	reinforceVisibility();
	setTimeout(reinforceVisibility, 250);
	setTimeout(reinforceVisibility, 1200);
	
	// Event listeners
	fab.addEventListener('click', function() {
		overlay.classList.toggle('active');
		fab.classList.toggle('active');
		if (overlay.classList.contains('active')) {
			fab.innerHTML = '▼';
			fab.classList.add('pulse');
		} else {
			fab.innerHTML = '🔍';
			fab.classList.remove('pulse');
		}
	});
	
	overlay.addEventListener('click', function(e) {
		if (e.target === overlay) {
			overlay.classList.remove('active');
			fab.classList.remove('active');
			fab.innerHTML = '🔍';
			fab.classList.remove('pulse');
		}
	});
	
	// Header button actions
	var searchInput = document.getElementById('expert-search-input');
	
	// Add keydown listener to search input
	if (searchInput) {
		searchInput.addEventListener('keydown', keyCheck, true);
	}
	
	document.getElementById('expert-clear-btn').addEventListener('click', function() {
		if (textbox) textbox.value = '';
		if (searchInput) searchInput.value = '';
		fab.classList.add('pulse');
		setTimeout(() => fab.classList.remove('pulse'), 2000);
	});
	
	document.getElementById('expert-search-btn').addEventListener('click', function() {
		var searchInput = document.getElementById('expert-search-input');
		
		// Only combine if built-in search has new content
		if (searchInput && searchInput.value.trim()) {
			var builtinTerm = searchInput.value.trim();
			var googleTerm = textbox.value.trim();
			
			// Avoid duplication - only add if not already present
			if (googleTerm && !googleTerm.includes(builtinTerm)) {
				textbox.value = builtinTerm + ' ' + googleTerm;
			} else if (!googleTerm) {
				textbox.value = builtinTerm;
			}
		}
		
		// Process filters and apply to search
		processOptions();
		
		// Close the overlay
		overlay.classList.remove('active');
		fab.classList.remove('active');
		fab.innerHTML = '🔍';
		fab.classList.remove('pulse');
		
		// Auto-trigger Google search
		setTimeout(function() {
			var searchButton = getButtons()[0];
			if (searchButton) {
				searchButton.click();
			} else {
				// Fallback: try to submit the form
				var forms = document.getElementsByTagName('form');
				for (var i = 0; i < forms.length; i++) {
					var form = forms[i];
					if (form.querySelector('input[name="q"]')) {
						form.submit();
						break;
					}
				}
			}
		}, 100);
	});
	
	// Load saved search terms
	if(GM_getValue("rememberSearch") == true) {
		var savedTerm = GM_getValue("searchTerm","");
		if (savedTerm) {
			// Try to separate built-in search from main search if possible
			textbox.value = savedTerm;
		}
	}
}

// ==========================
// SEARCH PROCESSING FUNCTIONS
// ==========================

function processOptions()
{	
	var first = true;
	var searchInput = document.getElementById('expert-search-input');
	
	// Start with original search terms (don't duplicate)
	var originalGoogleSearch = textbox.value.trim();
	var builtinSearch = searchInput ? searchInput.value.trim() : '';
	
	// Combine search terms only if they're different
	var combinedSearch = '';
	if (builtinSearch && originalGoogleSearch) {
		// Check if builtin search is already in Google search to avoid duplication
		if (!originalGoogleSearch.includes(builtinSearch)) {
			combinedSearch = builtinSearch + ' ' + originalGoogleSearch;
		} else {
			combinedSearch = originalGoogleSearch;
		}
	} else if (builtinSearch) {
		combinedSearch = builtinSearch;
	} else {
		combinedSearch = originalGoogleSearch;
	}
	
	searchString = combinedSearch;
	
	// Save search terms if remember is enabled
	if(cbSearchRemember && cbSearchRemember.checked) {
		GM_setValue("rememberSearch", true); 
		GM_setValue("searchTerm", combinedSearch); 
		if (searchInput) {
			GM_setValue("builtinSearchTerm", searchInput.value);
		}
	} else {
		GM_setValue("rememberSearch", false);
	}
	
	var i, j, k;
	
	// Process selected filters
	for(i = 0; i < options.length; i++)
	{
		if(checkboxes[i]) {
			for(j = 0; j < checkboxes[i].length && j < options[i].length; j++)
			{
				if(checkboxes[i][j] && checkboxes[i][j].checked)
				{
					var currentArray = options[i][j][0];
					
					if(options[i] == urls)
					{
						for(k = 0; k < currentArray.length; k++)
						{
							if (!first)
							{
								searchString += ' OR';
							}
							else{first = false;}
							searchString = searchString + ' site:' + currentArray[k];
						}
					}
					else if(options[i] == extensions)
					{
						for(k = 0; k < currentArray.length; k++)
						{	
							if (!first)
							{
								searchString += ' OR';
							}
							else{first = false;}
							searchString = searchString + ' filetype:' + currentArray[k];
						}
					}
					else if(options[i] == dorks)
					{
						for(k = 0; k < currentArray.length; k++)
						{	
							if (!first)
							{
								searchString += ' OR';
							}
							else{first = false;}
							
							var dorkPattern = currentArray[k];
							
							if(dorkPattern.startsWith('qdr:')) {
								searchString = searchString + ' ' + dorkPattern;
							}
							else if(['cache:', 'related:', 'info:', 'define:'].some(op => dorkPattern.startsWith(op))) {
								searchString = dorkPattern + searchString;
								first = false;
							}
							else {
								searchString = searchString + ' ' + dorkPattern;
							}
						}
					}
				}
			}
		}
	}
	
	// Update the Google search box with final search string
	textbox.value = searchString;
}

function keyCheck(e)
{
	if(e.keyCode == 13 && e.shiftKey)
    {    
        e.preventDefault();    
        if(buttons.length > 1) {
            buttons[1].click();
        }
    }
    else if (e.keyCode == 13)
    {
		var searchInput = document.getElementById('expert-search-input');
		
		// If the enter key was pressed in the built-in search input
		if (searchInput && e.target === searchInput) {
			e.preventDefault();
			
			// Combine search terms without duplication
			var builtinTerm = searchInput.value.trim();
			var googleTerm = textbox.value.trim();
			
			if (builtinTerm && googleTerm && !googleTerm.includes(builtinTerm)) {
				textbox.value = builtinTerm + ' ' + googleTerm;
			} else if (builtinTerm && !googleTerm) {
				textbox.value = builtinTerm;
			}
			
			// Process options and auto-search
			processOptions();
			
			setTimeout(function() {
				var searchButton = getButtons()[0];
				if (searchButton) {
					searchButton.click();
				}
			}, 100);
		} else {
			// Normal enter key processing for Google search box
			processOptions();
		}
    }
}

function searchButtonModify()
{
    var i;
	for(i=0;i<buttons.length;i++)
	{
		buttons[i].addEventListener('click',processOptions, false);
	}
	
	window.addEventListener('keydown', keyCheck, true);
}

// ==========================
// MAIN INITIALIZATION
// ==========================

function init()
{	 
	setTimeout(function() {
		// Find the search input more reliably across different Google pages
		textbox = document.querySelector('input[name="q"]') || 
				  document.querySelector('textarea[name="q"]') || 
				  document.querySelector('#sb_form_q') ||
				  document.getElementsByName('q')[0];
		
		if (!textbox) {
			log('warn', 'Search box missing');
			return;
		}
		
		form = textbox.closest('form') || document.getElementsByTagName('form')[0];
		
		initUrls();
		initDorks();
		initExtensions();
		initCheckboxArray();
		
		buttons = getButtons();
		searchButtonModify();
		
		appendCheckbox();
		
		// Load saved search terms
		if(GM_getValue("rememberSearch") == true) {
			var savedTerm = GM_getValue("searchTerm","");
			var savedBuiltinTerm = GM_getValue("builtinSearchTerm","");
			
			if (savedTerm && !textbox.value) {
				textbox.value = savedTerm;
			}
			
			// Load saved built-in search term if available
			setTimeout(function() {
				var searchInput = document.getElementById('expert-search-input');
				if (searchInput && savedBuiltinTerm) {
					searchInput.value = savedBuiltinTerm;
				}
			}, 100);
		}
		
		setTimeout(function() {
			var fab = document.getElementById('google-expert-fab');
			if (fab) {
				fab.classList.add('pulse');
				setTimeout(() => fab.classList.remove('pulse'), 3000);
			}
		}, 1000);
	}, 500);
}

// Enhanced initialization for mobile
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

  }

  //////////////////////////////////////////////////////////////
  // UI COMPONENTS (Refactored for Shared UI Standards)
  //////////////////////////////////////////////////////////////

  const renderPanel = () => {
    if (!state.started && state.enabled) {
      start();
    }

    const panel = document.createElement('div');
    panel.style.cssText = 'padding: 12px; color: #e5e7eb; font-family: system-ui, sans-serif; font-size: 13px; max-height: 600px; overflow-y: auto;';

    // Title
    const title = document.createElement('h3');
    title.textContent = 'Google Expert Search Pro';
    title.style.cssText = 'margin: 0 0 4px 0; font-size: 16px; font-weight: 700; color: #f8fafc;';
    panel.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.textContent = 'Advanced search filters & smart dorks';
    subtitle.style.cssText = 'margin: 0 0 12px 0; font-size: 11px; color: #94a3b8;';
    panel.appendChild(subtitle);

    // Search input section
    const searchSection = document.createElement('div');
    searchSection.style.cssText = 'margin-bottom: 14px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 6px;';
    
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Enter search terms here (optional)...';
    searchInput.id = 'expert-search-input-shared';
    searchInput.style.cssText = 'width: 100%; padding: 8px; background: #1f2937; color: #e5e7eb; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; font-size: 13px; margin-bottom: 8px;';
    searchSection.appendChild(searchInput);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 6px;';
    
    const searchBtn = document.createElement('button');
    searchBtn.textContent = 'Search';
    searchBtn.style.cssText = 'flex: 1; padding: 6px 12px; background: #3b82f6; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;';
    searchBtn.addEventListener('click', () => {
      const query = document.getElementById('expert-search-input-shared').value;
      if (query) {
        window.location.href = 'https://www.google.com/search?q=' + encodeURIComponent(query);
      }
    });
    searchBtn.addEventListener('mouseenter', () => { searchBtn.style.background = '#2563eb'; });
    searchBtn.addEventListener('mouseleave', () => { searchBtn.style.background = '#3b82f6'; });
    
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.style.cssText = 'padding: 6px 12px; background: #6b7280; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;';
    clearBtn.addEventListener('click', () => {
      document.getElementById('expert-search-input-shared').value = '';
    });
    clearBtn.addEventListener('mouseenter', () => { clearBtn.style.background = '#4b5563'; });
    clearBtn.addEventListener('mouseleave', () => { clearBtn.style.background = '#6b7280'; });
    
    btnRow.appendChild(searchBtn);
    btnRow.appendChild(clearBtn);
    searchSection.appendChild(btnRow);
    panel.appendChild(searchSection);

    // Helper to create category button
    const createCategoryBtn = (label, count, onClick) => {
      const btn = document.createElement('button');
      btn.textContent = `${label} (${count})`;
      btn.style.cssText = 'display: block; width: 100%; text-align: left; padding: 8px 10px; margin: 4px 0; background: rgba(255,255,255,0.05); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.2s;';
      btn.addEventListener('click', onClick);
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(59,130,246,0.2)';
        btn.style.borderColor = 'rgba(59,130,246,0.4)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'rgba(255,255,255,0.05)';
        btn.style.borderColor = 'rgba(255,255,255,0.1)';
      });
      return btn;
    };

    // Helper to show array contents in a modal
    const showArrayModal = (title, array, type) => {
      // Remove existing modal if any
      const existing = document.getElementById('google-expert-modal-shared');
      if (existing) existing.remove();

      const modal = document.createElement('div');
      modal.id = 'google-expert-modal-shared';
      modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 2147483646; display: flex; align-items: center; justify-content: center; padding: 20px;';
      
      const content = document.createElement('div');
      content.style.cssText = 'background: #1f2937; border-radius: 8px; max-width: 600px; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column;';
      
      const header = document.createElement('div');
      header.style.cssText = 'padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center;';
      const headerTitle = document.createElement('h3');
      headerTitle.textContent = title;
      headerTitle.style.cssText = 'margin: 0; font-size: 16px; color: #f8fafc; font-weight: 600;';
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = 'background: none; border: none; color: #9ca3af; font-size: 20px; cursor: pointer; padding: 0; width: 28px; height: 28px;';
      closeBtn.addEventListener('click', () => modal.remove());
      header.appendChild(headerTitle);
      header.appendChild(closeBtn);
      
      const body = document.createElement('div');
      body.style.cssText = 'padding: 16px; overflow-y: auto; flex: 1;';
      
      array.forEach(item => {
        const chip = document.createElement('span');
        chip.textContent = item;
        chip.style.cssText = 'display: inline-block; margin: 4px; padding: 6px 10px; background: rgba(59,130,246,0.2); color: #93c5fd; border-radius: 4px; font-size: 11px; border: 1px solid rgba(59,130,246,0.3);';
        body.appendChild(chip);
      });
      
      content.appendChild(header);
      content.appendChild(body);
      modal.appendChild(content);
      document.body.appendChild(modal);
      
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
      });
    };

    // Render category groups
    const categoryGroups = [
      {
        groupName: 'Site Filters',
        groupIcon: '🌐',
        categories: [
          { array: academicSites, label: 'Academic & Research', type: 'urls' },
          { array: auctionUrl, label: 'Auctions & Marketplace', type: 'urls' },
          { array: blogUrl, label: 'Blogs & Writing', type: 'urls' },
          { array: devSites, label: 'Developer Resources', type: 'urls' },
          { array: fileshareUrl, label: 'File Sharing & Cloud Storage', type: 'urls' },
          { array: forumSites, label: 'Forums & Communities', type: 'urls' },
          { array: govSites, label: 'Government & Legal', type: 'urls' },
          { array: jobSites, label: 'Job Sites', type: 'urls' },
          { array: newsSites, label: 'News & Media', type: 'urls' },
          { array: onlineshoppingUrl, label: 'Online Shopping', type: 'urls' },
          { array: torrentUrl, label: 'Torrents', type: 'urls' },
          { array: videostreamUrl, label: 'Video Streaming', type: 'urls' },
          { array: xvideoUrl, label: 'XXX Adult', type: 'urls' }
        ]
      },
      {
        groupName: 'File Types',
        groupIcon: '📁',
        categories: [
          { array: archiveExt, label: 'Archives', type: 'extensions' },
          { array: audioExt, label: 'Audio Files', type: 'extensions' },
          { array: basicSourceExt, label: 'Basic Source', type: 'extensions' },
          { array: cppSourceExt, label: 'C++ Source', type: 'extensions' },
          { array: csharpSourceExt, label: 'C# Source', type: 'extensions' },
          { array: documentExt, label: 'Documents', type: 'extensions' },
          { array: execExt, label: 'Executables', type: 'extensions' },
          { array: fontExt, label: 'Font Files', type: 'extensions' },
          { array: imageExt, label: 'Image Files', type: 'extensions' },
          { array: javaSourceExt, label: 'Java Source', type: 'extensions' },
          { array: miscExt, label: 'Misc Files', type: 'extensions' },
          { array: perlSourceExt, label: 'Perl Source', type: 'extensions' },
          { array: presentationExt, label: 'Presentations', type: 'extensions' },
          { array: pythonSourceExt, label: 'Python Source', type: 'extensions' },
          { array: datasheetExt, label: 'Spreadsheets', type: 'extensions' },
          { array: videoExt, label: 'Video Files', type: 'extensions' },
          { array: xmlExt, label: 'XML Files', type: 'extensions' }
        ]
      },
      {
        groupName: 'Smart Dorks',
        groupIcon: '🔍',
        categories: [
          { array: audioDorks, label: 'Audio File Search', type: 'dorks' },
          { array: exposedFilesDorks, label: 'Exposed Files', type: 'dorks' },
          { array: indexDorks, label: 'Index Browsing', type: 'dorks' },
          { array: specialDorks, label: 'Special Operators', type: 'dorks' },
          { array: timeDorks, label: 'Time-based Search', type: 'dorks' }
        ]
      }
    ];

    categoryGroups.forEach(group => {
      const groupSection = document.createElement('div');
      groupSection.style.cssText = 'margin-bottom: 16px;';
      
      const groupHeader = document.createElement('div');
      groupHeader.textContent = `${group.groupIcon} ${group.groupName}`;
      groupHeader.style.cssText = 'font-size: 14px; font-weight: 600; color: #f8fafc; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.1);';
      groupSection.appendChild(groupHeader);
      
      group.categories.forEach(cat => {
        const btn = createCategoryBtn(cat.label, cat.array.length, () => {
          showArrayModal(`${group.groupIcon} ${cat.label}`, cat.array, cat.type);
        });
        groupSection.appendChild(btn);
      });
      
      panel.appendChild(groupSection);
    });

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
      `[Google Mobile] ${state.enabled ? '✓' : '✗'} Enable`,
      async () => { await setEnabled(!state.enabled); }
    ));
    if (state.enabled) {
      state.menuIds.push(GM_registerMenuCommand('[Google Mobile] 🔍 Show search helper', () => {
        if (sharedUi) {
          sharedUi.switchPanel(SCRIPT_ID);
          sharedUi.toggleModal();
        } else {
          // Fallback: ensure the native UI is visible
          if (!state.started) {
            start();
          }
        }
      }));
    }
  };

  const stop = async () => {
    state.started = false;
    const container = document.getElementById('google-expert-ui');
    if (container && container.parentNode) {
      try { container.parentNode.removeChild(container); } catch (_) {}
    }
    const panel = document.getElementById('google-expert-panel');
    if (panel && panel.parentNode) {
      try { panel.parentNode.removeChild(panel); } catch (_) {}
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
