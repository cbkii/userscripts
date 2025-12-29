#!/usr/bin/env node
/**
 * Lint script for userscripts
 * - Runs node --check on all *.user.js files
 * - Validates metadata blocks
 * - Checks for common issues
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const USERSCRIPT_PATTERN = /\.user\.js$/;

// Canonical CDN URLs for dependency hygiene  
// Note: unpkg used for Turndown to avoid CommonJS build issues with jsdelivr
const CANONICAL_CDNS = {
  jquery: 'https://ajax.googleapis.com/ajax/libs/jquery/',
  jqueryui: 'https://ajax.googleapis.com/ajax/libs/jqueryui/',
  readability: 'https://cdn.jsdelivr.net/npm/@mozilla/readability@',
  turndown: 'https://unpkg.com/turndown@',
  'turndown-plugin-gfm': 'https://unpkg.com/turndown-plugin-gfm@'
};

// Required metadata fields
const REQUIRED_META = ['@name', '@namespace', '@version', '@description', '@author', '@icon'];
const MATCH_REQUIRED = ['@match', '@include']; // At least one of these

let errors = 0;
let warnings = 0;

function log(level, file, msg) {
  const prefix = level === 'error' ? '❌ ERROR' : level === 'warn' ? '⚠️  WARN' : 'ℹ️  INFO';
  console.log(`${prefix}: [${file}] ${msg}`);
  if (level === 'error') errors++;
  if (level === 'warn') warnings++;
}

function getUserscripts() {
  return fs.readdirSync(ROOT)
    .filter(f => USERSCRIPT_PATTERN.test(f))
    .map(f => path.join(ROOT, f));
}

function parseMetadata(content) {
  const metaMatch = content.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
  if (!metaMatch) return null;
  
  const meta = {};
  const lines = metaMatch[1].split('\n');
  
  for (const line of lines) {
    const match = line.match(/\/\/\s*(@\w+)\s+(.*)/);
    if (match) {
      const [, key, value] = match;
      if (!meta[key]) meta[key] = [];
      meta[key].push(value.trim());
    }
  }
  
  return meta;
}

function checkSyntax(filepath) {
  const filename = path.basename(filepath);
  try {
    execSync(`node --check "${filepath}"`, { stdio: 'pipe' });
    return true;
  } catch (e) {
    log('error', filename, `Syntax error: ${e.stderr?.toString() || 'Parse failed'}`);
    return false;
  }
}

function checkMetadata(filepath, meta) {
  const filename = path.basename(filepath);
  
  if (!meta) {
    log('error', filename, 'Missing or invalid metadata block');
    return false;
  }
  
  // Check required fields
  for (const field of REQUIRED_META) {
    if (!meta[field] || !meta[field].length) {
      log('error', filename, `Missing required metadata: ${field}`);
    }
  }
  
  // Check for @match or @include
  const hasMatch = MATCH_REQUIRED.some(f => meta[f]?.length > 0);
  if (!hasMatch) {
    log('error', filename, 'Script must have at least one @match or @include');
  }
  
  // Check namespace
  if (meta['@namespace']?.[0] !== 'https://github.com/cbkii/userscripts') {
    log('warn', filename, `Non-standard namespace: ${meta['@namespace']?.[0] || '(none)'}`);
  }
  
  // Check @run-at (prefer document-idle)
  const runAt = meta['@run-at']?.[0];
  if (runAt === 'document-start') {
    log('warn', filename, '@run-at document-start should be used sparingly; prefer document-idle with guards');
  }
  
  return true;
}

function checkDependencies(filepath, meta, content) {
  const filename = path.basename(filepath);
  const requires = meta?.['@require'] || [];
  
  // Track libraries for consistency check
  const usedLibraries = new Map();
  
  for (const url of requires) {
    // Check for non-canonical CDN URLs
    // Sort by key length descending to match longer keys first (e.g., 'turndown-plugin-gfm' before 'turndown')
    const sortedEntries = Object.entries(CANONICAL_CDNS).sort((a, b) => b[0].length - a[0].length);
    
    for (const [lib, canonical] of sortedEntries) {
      // Only match if the URL starts with the canonical URL
      if (url.startsWith(canonical)) {
        usedLibraries.set(lib, url);
        break;
      }
      // Also match by library name in URL path (but exclude false matches)
      const urlLower = url.toLowerCase();
      // Check if the library name appears in the URL and it doesn't start with canonical
      if (urlLower.includes(`/${lib}`) || urlLower.includes(`/${lib}@`) || urlLower.includes(`/${lib}.`)) {
        if (!url.startsWith(canonical)) {
          log('warn', filename, `Non-canonical CDN for ${lib}: ${url}`);
          log('warn', filename, `  Expected: ${canonical}*`);
        }
        usedLibraries.set(lib, url);
        break;
      }
    }
  }
  
  return true;
}

function checkWildcardScript(filepath, meta, content) {
  const filename = path.basename(filepath);
  const matches = meta?.['@match'] || [];
  
  const isWildcard = matches.some(m => 
    m === '*://*/*' || 
    m === 'http://*/*' || 
    m === 'https://*/*' ||
    m === '*://*.*/*'
  );
  
  if (isWildcard) {
    // userscriptui.user.js is the shared UI manager - it should always run
    // to provide infrastructure for other scripts
    if (filename === 'userscriptui.user.js') {
      return true;
    }
    
    // Check for "Always Run" / dormant-by-default patterns
    // Look for ALWAYS_RUN or dormant configuration
    const hasAlwaysRunSetting = /ALWAYS_RUN|alwaysRun|always[_-]?run/i.test(content);
    const hasDormantPattern = /dormant|on[_-]?demand|user[_-]?trigger/i.test(content);
    
    if (!hasAlwaysRunSetting && !hasDormantPattern) {
      log('warn', filename, 'Wildcard @match script should implement "Dormant by default" with Always Run toggle');
    }
  }
  
  return true;
}

function main() {
  console.log('🔍 Linting userscripts...\n');
  
  const scripts = getUserscripts();
  console.log(`Found ${scripts.length} userscript(s)\n`);
  
  for (const filepath of scripts) {
    const filename = path.basename(filepath);
    const content = fs.readFileSync(filepath, 'utf-8');
    const meta = parseMetadata(content);
    
    console.log(`Checking: ${filename}`);
    
    // Phase 0: Syntax check
    checkSyntax(filepath);
    
    // Metadata validation
    checkMetadata(filepath, meta);
    
    // Phase 4: Dependency check
    checkDependencies(filepath, meta, content);
    
    // Phase 1: Wildcard script check
    checkWildcardScript(filepath, meta, content);
    
    console.log('');
  }
  
  console.log('─'.repeat(50));
  console.log(`\n✅ Lint complete: ${errors} error(s), ${warnings} warning(s)`);
  
  if (errors > 0) {
    process.exit(1);
  }
}

main();
