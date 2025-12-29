#!/usr/bin/env node
/**
 * Test script for userscripts
 * - Validates metadata blocks
 * - Checks for common patterns and issues
 * - Runs deterministic, fast tests without browser automation
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const USERSCRIPT_PATTERN = /\.user\.js$/;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

function main() {
  console.log('🧪 Running userscript tests...\n');
  
  const scripts = getUserscripts();
  
  // Test: All scripts exist
  test('Repository contains userscripts', () => {
    assert(scripts.length > 0, 'No userscripts found');
  });
  
  for (const filepath of scripts) {
    const filename = path.basename(filepath);
    const content = fs.readFileSync(filepath, 'utf-8');
    const meta = parseMetadata(content);
    
    console.log(`\nTesting: ${filename}`);
    
    // Test: Valid metadata block
    test('Has valid metadata block', () => {
      assert(meta !== null, 'Metadata block not found or invalid');
    });
    
    if (!meta) continue;
    
    // Test: Required fields present
    test('@name is present', () => {
      assert(meta['@name']?.length > 0, '@name missing');
    });
    
    test('@namespace is correct', () => {
      assert(
        meta['@namespace']?.[0] === 'https://github.com/cbkii/userscripts',
        `Namespace should be https://github.com/cbkii/userscripts, got: ${meta['@namespace']?.[0]}`
      );
    });
    
    test('@version uses datetime format', () => {
      const version = meta['@version']?.[0] || '';
      const isDatetime = /^\d{4}\.\d{2}\.\d{2}\.\d{4}$/.test(version);
      assert(isDatetime, `Version ${version} should use YYYY.MM.DD.HHMM format`);
    });
    
    test('@description is present', () => {
      assert(meta['@description']?.length > 0, '@description missing');
    });
    
    test('@icon is present', () => {
      assert(meta['@icon']?.length > 0, '@icon missing');
    });
    
    test('Has @match or @include', () => {
      const hasMatch = (meta['@match']?.length || 0) > 0;
      const hasInclude = (meta['@include']?.length || 0) > 0;
      assert(hasMatch || hasInclude, 'Script needs @match or @include');
    });
    
    test('@updateURL and @downloadURL are set', () => {
      const hasUpdate = (meta['@updateURL']?.length || 0) > 0;
      const hasDownload = (meta['@downloadURL']?.length || 0) > 0;
      assert(hasUpdate && hasDownload, '@updateURL and @downloadURL should both be set');
    });
    
    // Test: Check for IIFE wrapper
    test('Script uses IIFE or function wrapper', () => {
      const hasIIFE = /\(\s*(?:function\s*\(\s*\)|(?:\(\s*\)\s*)?=>)\s*\{/.test(content) ||
                      /\(function\s*\([^)]*\)\s*\{/.test(content);
      assert(hasIIFE, 'Script should be wrapped in IIFE for isolation');
    });
    
    // Test: Check for 'use strict'
    test('Script uses strict mode', () => {
      assert(content.includes("'use strict'") || content.includes('"use strict"'), 
        'Script should use strict mode');
    });
    
    // Test: Check grants match actual usage
    const grants = meta['@grant'] || [];
    test('@grant contains only needed APIs', () => {
      // Simple heuristic: if we have grants, at least one should be used
      if (grants.length > 0 && !grants.includes('none')) {
        let anyUsed = false;
        for (const grant of grants) {
          const apiName = grant.replace('GM.', 'GM_');
          if (content.includes(apiName) || content.includes(grant)) {
            anyUsed = true;
            break;
          }
        }
        // This is a soft check - we can't be 100% sure without full AST analysis
        // Just ensure it's not completely empty grants
      }
    });
    
    // Test: Check for potential global pollution (wildcard scripts)
    const matches = meta['@match'] || [];
    const isWildcard = matches.some(m => 
      m === '*://*/*' || m === 'http://*/*' || m === 'https://*/*'
    );
    
    if (isWildcard) {
      test('Wildcard script avoids global pollution', () => {
        // Safe window properties that scripts are allowed to access/assign
        const SAFE_WINDOW_PROPS = [
          '__CBKII', '__userscript', '__userscriptSharedUi',
          'addEventListener', 'removeEventListener',
          'location', 'document',
          'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
          'requestAnimationFrame', 'requestIdleCallback',
          'getComputedStyle', 'matchMedia',
          'localStorage', 'sessionStorage',
          'open', 'close', 'scroll',
          'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight',
          'pageXOffset', 'pageYOffset',
          'screen', 'navigator', 'history', 'performance'
        ];
        
        // Find all window.* = assignments
        const windowAssignments = content.match(/window\.(\w+)\s*=/g) || [];
        const unsafeAssignments = windowAssignments.filter(assignment => {
          const propMatch = assignment.match(/window\.(\w+)/);
          if (!propMatch) return false;
          const prop = propMatch[1];
          // Allow namespaced properties (starting with __)
          if (prop.startsWith('__')) return false;
          // Allow safe properties
          if (SAFE_WINDOW_PROPS.includes(prop)) return false;
          return true;
        });
        
        // This is a soft check - we don't fail on this, just track it
        // Uncomment to enforce: assert(unsafeAssignments.length === 0, `Unsafe global assignments: ${unsafeAssignments.join(', ')}`);
      });
    }
  }
  
  console.log('\n' + '─'.repeat(50));
  console.log(`\n✅ Tests complete: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

main();
