# Best Practices Research: Userscript Load Order and Dependencies

This document summarizes research into how other userscript projects handle load order, inter-script dependencies, and race conditions.

## Research Sources

Research conducted by examining:
- Popular userscript repositories on GitHub
- Greasy Fork documentation and featured scripts
- Tampermonkey documentation
- Violentmonkey documentation
- Stack Overflow discussions on userscript timing

## Common Patterns in Popular Userscripts

### Pattern 1: Event-Based Communication (Most Common)

**Used by:** Multiple script suites, framework scripts

**Approach:**
- Foundation script dispatches custom event when ready
- Dependent scripts listen for event before initializing
- Event carries reference to shared functionality

**Example:**
```javascript
// Foundation script
window.myFramework = { /* shared API */ };
document.dispatchEvent(new CustomEvent('frameworkReady', {
  detail: { api: window.myFramework }
}));

// Dependent script
document.addEventListener('frameworkReady', (e) => {
  const api = e.detail.api;
  // Use API safely
});
```

**Pros:**
- Decoupled - scripts don't need to know each other's internals
- Works regardless of load order
- Standard browser API

**Cons:**
- Event fires once - late-arriving scripts miss it
- Need to handle "already ready" case
- Can't await async initialization

**Our Implementation:** ✅ We use this pattern with `userscriptSharedUiReady` event

### Pattern 2: Global Ready Flag + Polling

**Used by:** Utility library scripts, jQuery-like frameworks

**Approach:**
- Foundation script sets `window.frameworkReady = true` when ready
- Dependent scripts poll or check flag before use
- Often combined with `DOMContentLoaded` listeners

**Example:**
```javascript
// Foundation script
window.myLib = { /* API */ };
window.myLib.ready = true;

// Dependent script
function checkReady() {
  if (window.myLib && window.myLib.ready) {
    init();
  } else {
    setTimeout(checkReady, 100);
  }
}
checkReady();
```

**Pros:**
- Simple to implement
- Late-arriving scripts can still check
- No event timing issues

**Cons:**
- Polling wastes CPU cycles
- Need timeout/retry limits
- Global namespace pollution

**Our Implementation:** ⚠️ We don't use polling - could add as fallback

### Pattern 3: Promise-Based API

**Used by:** Modern userscript frameworks, async-heavy scripts

**Approach:**
- Foundation script exposes async initialization API
- Dependent scripts await promise before use
- Can chain multiple async dependencies

**Example:**
```javascript
// Foundation script
window.framework = {
  ready: new Promise((resolve) => {
    // Initialize...
    resolve({ api: /* ... */ });
  })
};

// Dependent script
(async () => {
  const api = await window.framework.ready;
  // Use API safely
})();
```

**Pros:**
- Modern, clean async pattern
- Natural error handling with try/catch
- Can chain multiple dependencies
- No polling needed

**Cons:**
- Requires async/await support
- More complex for simple cases
- Need to handle promise rejection

**Our Implementation:** ❌ Not used - could improve our pattern

### Pattern 4: Registration Queue

**Used by:** Plugin systems, modular frameworks

**Approach:**
- Foundation script maintains queue of pending registrations
- Dependent scripts register themselves (push to queue)
- Foundation processes queue when ready
- New registrations processed immediately if already ready

**Example:**
```javascript
// Foundation script
window.pluginSystem = {
  plugins: [],
  ready: false,
  register(plugin) {
    if (this.ready) {
      this.init(plugin);
    } else {
      this.plugins.push(plugin);
    }
  },
  init(plugin) {
    plugin.initialize(this.api);
  }
};

// When ready:
window.pluginSystem.ready = true;
window.pluginSystem.plugins.forEach(p => window.pluginSystem.init(p));

// Dependent script
window.pluginSystem.register({
  name: 'MyPlugin',
  initialize(api) {
    // Use API safely
  }
});
```

**Pros:**
- Handles both early and late registration
- No timing issues
- Clean registration interface

**Cons:**
- More complex implementation
- Need queue management
- Global state to maintain

**Our Implementation:** ✅ Similar - we use `pendingRegistration` + deferred calling

### Pattern 5: Metadata Dependencies (@require)

**Used by:** Scripts with external library dependencies

**Approach:**
- Use `@require` to declare dependencies
- Tampermonkey loads them in order before script runs
- Only works for external URLs, not other userscripts

**Example:**
```javascript
// ==UserScript==
// @require https://code.jquery.com/jquery-3.6.0.min.js
// @require https://example.com/mylibrary.js
// ==/UserScript==

// jQuery and mylibrary are guaranteed to be loaded
$(document).ready(() => {
  // Safe to use
});
```

**Pros:**
- Explicit dependency declaration
- Manager handles load order
- No custom code needed

**Cons:**
- Only works for external URLs
- Can't use for inter-script dependencies
- No version resolution
- All-or-nothing loading

**Our Implementation:** ⚠️ Could use for external libs, not for inter-script deps

### Pattern 6: @run-at Coordination

**Used by:** Scripts that need specific timing

**Approach:**
- Foundation uses `@run-at document-idle` (loads last)
- Early scripts use `@run-at document-start`
- Middle scripts use `@run-at document-end`
- Combined with detection patterns

**Example:**
```javascript
// Foundation: @run-at document-idle
window.foundation = { /* API */ };

// Early script: @run-at document-start
// Can't use foundation yet - must defer

// Later script: @run-at document-end
// Still can't rely on foundation - must check
```

**Pros:**
- Leverages built-in timing mechanisms
- No custom code if timing aligns
- Predictable load order

**Cons:**
- Not reliable across browsers/managers
- Still need detection/deferral for safety
- Can't enforce inter-script order

**Our Implementation:** ✅ We use `@run-at` as hint + deferred registration

## Best Practices Summary

Based on research and our implementation:

### ✅ Do This:

1. **Use events for "ready" notification**
   - Decoupled, standard API
   - Works in all browsers
   - Our implementation: `userscriptSharedUiReady`

2. **Provide both early and late registration paths**
   - Check if already ready (synchronous path)
   - Listen for ready event (async path)
   - Our implementation: `pendingRegistration` + `tryRegisterWithSharedUi()`

3. **Defer registration until dependencies exist**
   - Store callback, don't call immediately
   - Check for required functions before registering
   - Our implementation: Check `typeof renderPanel === 'function'`

4. **Use unique namespaces**
   - Prefix all element IDs with script name
   - Use IIFE to avoid global pollution
   - Our implementation: All IDs use script-specific prefixes

5. **Provide fallback mechanisms**
   - Work without foundation script if possible
   - Offer degraded functionality as fallback
   - Our implementation: Fallback UI, menu commands

6. **Document load order assumptions**
   - Clear comments about LOAD PRIORITY
   - Document `@run-at` timing choices
   - Our implementation: LOAD-ORDER.md document

### ❌ Don't Do This:

1. **Don't poll indefinitely**
   - Wastes CPU, slows browser
   - Use events or promises instead
   - Our implementation: Event-based, no polling

2. **Don't rely on install order**
   - Users install in arbitrary order
   - Browsers may reorder scripts
   - Our implementation: Deferred registration handles any order

3. **Don't call undefined functions**
   - Always check `typeof fn === 'function'`
   - Defer calls until dependencies exist
   - Our implementation: Fixed in v2026.01.02.0412

4. **Don't assume synchronous initialization**
   - GM APIs may be async
   - DOM may not be ready
   - Our implementation: Async gmStore, DOM ready checks

5. **Don't pollute global namespace**
   - Use IIFE or modules
   - Prefix global variables if needed
   - Our implementation: All scripts use IIFE + `'use strict'`

6. **Don't use `@require` for inter-script deps**
   - Only works for external URLs
   - Can't reference other userscripts
   - Our implementation: Event-based discovery instead

## Comparison with Other Approaches

### Our Approach vs. Common Alternatives

| Feature | Our Implementation | Event Only | Polling | Promise-Based | @require Only |
|---------|-------------------|------------|---------|---------------|---------------|
| No race conditions | ✅ | ⚠️ (event timing) | ✅ | ✅ | ❌ (not for userscripts) |
| Works any load order | ✅ | ✅ | ✅ | ✅ | ✅ |
| CPU efficient | ✅ | ✅ | ❌ (polling) | ✅ | ✅ |
| Late registration | ✅ | ❌ (event once) | ✅ | ✅ | N/A |
| Clean async API | ⚠️ (could improve) | ❌ | ❌ | ✅ | ❌ |
| Fallback support | ✅ | ❌ | ❌ | ❌ | ❌ |
| XBrowser compatible | ✅ | ✅ | ✅ | ⚠️ (ES2017+) | ⚠️ (limited) |

**Conclusion:** Our hybrid approach (event + deferred registration + fallback) is competitive with best practices found in other projects.

## Recommendations for Future Improvements

Based on research, consider these enhancements:

### 1. Promise-Based Registration API

```javascript
// In userscriptui.user.js
window.__userscriptSharedUi.ready = new Promise((resolve) => {
  // When UI is ready:
  resolve(instance);
});

// In dependent scripts
const sharedUi = await window.__userscriptSharedUi.ready;
sharedUi.registerScript({ /* ... */ });
```

**Benefit:** Cleaner async code, natural error handling

### 2. Registration Queue in Shared UI

```javascript
// Add to userscriptui.user.js
const registrationQueue = [];
const processRegistration = (config) => {
  if (isReady) {
    registerScript(config);
  } else {
    registrationQueue.push(config);
  }
};

// When ready:
registrationQueue.forEach(registerScript);
```

**Benefit:** Handles any timing scenario automatically

### 3. Helper Method for Safe Registration

```javascript
// Add to factory
createSafeRegistration(config) {
  const { scriptId, renderFn, toggleFn, stateFn } = config;
  
  return () => {
    // Only register when all functions exist
    if (typeof renderFn() === 'function' &&
        typeof toggleFn() === 'function' &&
        typeof stateFn() !== 'undefined') {
      this.getInstance().registerScript({
        id: scriptId,
        render: renderFn(),
        onToggle: toggleFn(),
        enabled: stateFn()
      });
    }
  };
}
```

**Benefit:** Reduces code duplication across scripts

### 4. Dependency Declaration Metadata

```javascript
// Add custom metadata
// @userscript-depends userscriptui.user.js

// Parser in dependent scripts
const dependencies = GM_info.script.meta['userscript-depends'];
if (dependencies) {
  // Wait for dependencies before registering
}
```

**Benefit:** Self-documenting dependencies, could enable automatic ordering

### 5. Health Check API

```javascript
// In shared UI
window.__userscriptSharedUi.healthCheck = () => {
  return {
    ready: isReady,
    scriptsRegistered: scripts.size,
    version: '2026.01.02'
  };
};

// In scripts
const health = window.__userscriptSharedUi?.healthCheck?.();
console.log('Shared UI health:', health);
```

**Benefit:** Easier debugging, runtime diagnostics

## References

- Tampermonkey Documentation: https://www.tampermonkey.net/documentation.php
- Greasy Fork Best Practices: https://greasyfork.org/en/help/writing-user-scripts
- Violentmonkey Documentation: https://violentmonkey.github.io/
- MDN Custom Events: https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent
- GitHub Userscript Collections (reviewed multiple popular repos)

## Conclusion

Our deferred registration pattern aligns with industry best practices:
- ✅ Event-based discovery (Pattern 1)
- ✅ Deferred execution (Pattern 4 variant)
- ✅ @run-at coordination (Pattern 6)
- ✅ Fallback mechanisms (our addition)
- ✅ No global pollution (common best practice)

The fixes in v2026.01.02.0412 bring our implementation in line with how mature userscript projects handle load order and dependencies.
