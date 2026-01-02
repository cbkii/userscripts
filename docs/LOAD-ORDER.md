# Userscript Load Order and Inter-Script Dependencies

This document explains how userscripts in this repository handle load order, inter-script dependencies, and race conditions to ensure reliable operation regardless of browser or install order.

## Problem Statement

Userscripts can load in different orders depending on:
- Browser implementation (Tampermonkey, Violentmonkey, XBrowser)
- Install order and timing
- `@run-at` timing (`document-start`, `document-end`, `document-idle`)
- Network conditions affecting script download

This creates race conditions when scripts depend on each other, particularly when:
- Document-start scripts need to register with the shared UI (which loads at document-idle)
- Scripts try to use functions that haven't been defined yet

## Load Priority System

Scripts use `LOAD PRIORITY` comments to document their intended load order:

| Priority | Timing | Scripts | Purpose |
|----------|--------|---------|---------|
| 1 | document-idle | userscriptui.user.js | Foundation - provides shared UI framework |
| 2 | document-start | pageunlock.user.js | Early - patches native APIs |
| 3 | document-start | antiadblock.user.js | Early - spoofs ad-block detection |
| 4 | document-start | adinteract.user.js | Early - auto-interacts with UI elements |
| 5 | document-start | dlcountdown.user.js | Early - hooks timer functions |
| 6-8 | document-end | searchgoogle, vxdark, searchduck | Content enhancement |
| 9-11 | document-idle | pagemd, chatgptmd, pageinfoexport | Document processing |
| 12 | document-idle | userscriptlogs.user.js | Utilities - load last |

**Important:** LOAD PRIORITY numbers are documentation only - actual load order is determined by `@run-at` timing and browser behavior.

### @run-at Timing (Actual Load Order)

1. **document-start** - Scripts inject immediately, before DOM exists
   - Can run before `userscriptui.user.js` is loaded
   - Must handle deferred registration with shared UI
   - Used for: pageunlock, antiadblock, adinteract, dlcountdown

2. **document-end** - Scripts run at/after DOMContentLoaded
   - Body exists but resources may still be loading
   - Used for: searchgoogle, searchduck, vxdark

3. **document-idle** - Scripts run after page is fully loaded (default if omitted)
   - Safest for heavy operations
   - Used for: userscriptui, pagemd, chatgptmd, pageinfoexport, userscriptlogs

## Deferred Registration Pattern

Scripts that run at `document-start` cannot immediately register with the shared UI because:
1. `userscriptui.user.js` runs at `document-idle` (loads later)
2. Their own `renderPanel` and `setEnabled` functions are defined later in the script

### Solution: Deferred Registration

All document-start scripts use this pattern:

```javascript
// At script top level (before main() or other functions)
let sharedUi = null;
let sharedUiReady = false;
let registrationAttempted = false;
let pendingRegistration = null;

// Deferred registration function
const tryRegisterWithSharedUi = () => {
  if (registrationAttempted || !sharedUi) return;
  
  // Only register if we have all required components
  if (typeof state !== 'undefined' && 
      typeof renderPanel === 'function' && 
      typeof setEnabled === 'function') {
    registrationAttempted = true;
    sharedUi.registerScript({
      id: SCRIPT_ID,
      title: SCRIPT_TITLE,
      enabled: state.enabled,
      render: renderPanel,
      onToggle: (next) => setEnabled(next)
    });
  }
};

// Shared UI discovery
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
      // Store tryRegister for deferred use - DON'T call it yet
      pendingRegistration = tryRegister;
    }
  });
  sharedUi = helper.sharedUi;
  sharedUiReady = helper.isReady;
} else {
  // Fallback with event listener
  document.addEventListener('userscriptSharedUiReady', (event) => {
    setTimeout(() => {
      const providedFactory = event?.detail?.sharedUi;
      if (!sharedUiReady) {
        initSharedUi(providedFactory);
      }
      // Attempt deferred registration
      tryRegisterWithSharedUi();
    }, 0);
  }, { once: true });
}

// Later, in initialization (AFTER state/renderPanel/setEnabled are defined)
const init = async () => {
  // ... state initialization ...
  
  // NOW safe to register with shared UI
  if (pendingRegistration && typeof pendingRegistration === 'function') {
    pendingRegistration(renderPanel, (next) => setEnabled(next), state.enabled);
    registrationAttempted = true;
  } else {
    tryRegisterWithSharedUi();
  }
};
```

### Key Points

1. **Store, don't call**: `onReady` callback stores `tryRegister` in `pendingRegistration` variable
2. **Check before use**: `tryRegisterWithSharedUi()` checks if functions exist before registering
3. **Call after definition**: Initialization code calls deferred registration after defining all required functions
4. **Handle both paths**: Works whether helper is available or using fallback event listener

## Scripts Using Deferred Registration

| Script | Status | Notes |
|--------|--------|-------|
| dlcountdown.user.js | ✅ Fixed (v2026.01.02.0412) | Now uses deferred registration |
| antiadblock.user.js | ✅ Fixed (v2026.01.02.0412) | Now uses deferred registration |
| adinteract.user.js | ✅ Fixed (v2026.01.02.0412) | Now uses deferred registration |
| pageunlock.user.js | ✅ Already correct | Uses `attemptSharedUiRegistration()` helper |

## Testing Load Order

To test that scripts handle load order correctly:

1. **Install in reverse order**: Install scripts starting with highest priority number first
2. **Disable and re-enable**: Disable userscriptui.user.js, reload page, then re-enable
3. **Mixed timing**: Have some scripts at document-start, others at document-idle
4. **Check registration**: Verify all scripts appear in shared UI modal
5. **Check fallback**: Verify scripts work without shared UI (fallback UI appears)

## Common Pitfalls

### ❌ Wrong: Immediate Registration

```javascript
// BAD - renderPanel not defined yet
const helper = factory.createDiscoveryHelper({
  onReady: (ui, tryRegister) => {
    tryRegister(renderPanel, setEnabled, state.enabled); // ❌ undefined!
  }
});
```

### ✅ Correct: Deferred Registration

```javascript
// GOOD - store for later use
const helper = factory.createDiscoveryHelper({
  onReady: (ui, tryRegister) => {
    pendingRegistration = tryRegister; // ✅ Store it
  }
});

// Later, after renderPanel is defined:
if (pendingRegistration) {
  pendingRegistration(renderPanel, setEnabled, state.enabled); // ✅ Now safe
}
```

## Fallback Mechanisms

All scripts should provide fallback UI when shared UI is unavailable:

1. **Menu commands**: `GM_registerMenuCommand` for basic controls
2. **Fallback buttons**: Simple fixed-position toggle buttons (XBrowser compatibility)
3. **Graceful degradation**: Core functionality works without UI

Example (dlcountdown.user.js):
```javascript
const createFallbackUI = () => {
  if (typeof GM_registerMenuCommand !== 'function' && !sharedUi) {
    // Inject simple toggle button for XBrowser
    const toggle = document.createElement('button');
    toggle.id = 'dlcnt-toggle';
    // ... styling and click handlers ...
    document.body.appendChild(toggle);
  }
};
```

## Browser-Specific Notes

### Tampermonkey (Desktop)
- Respects `@run-at` timing reliably
- `createDiscoveryHelper` usually available immediately
- Event-based discovery works well

### XBrowser (Android)
- Built-in userscript manager with basic GM API support
- May have timing differences vs desktop
- Fallback UI critical for compatibility
- Use localStorage in addition to GM_getValue/GM_setValue

### Violentmonkey
- Similar to Tampermonkey but may have subtle timing differences
- Test deferred registration pattern thoroughly
- May require both `window.__userscriptSharedUi` and `unsafeWindow.__userscriptSharedUi` checks

## Debugging Load Order Issues

If a script fails to load or register:

1. **Check browser console** for errors about undefined functions
2. **Verify @run-at timing** - document-start scripts load very early
3. **Check registrationAttempted flag** - should only be set after successful registration
4. **Look for race conditions** - functions used before they're defined
5. **Test with shared UI disabled** - fallback should work
6. **Check event listeners** - `userscriptSharedUiReady` should fire only once

## Future Improvements

Potential enhancements to load order handling:

1. **Explicit dependencies**: Metadata like `@requires userscriptui.user.js`
2. **Registration queue**: Central queue for late-arriving scripts
3. **Polled registration**: Retry registration with exponential backoff
4. **Load coordinator**: Single script that manages load order explicitly

## See Also

- [AGENTS.md](../AGENTS.md) - Developer guidelines for userscripts
- [API-doc.md](../API-doc.md) - API usage and best practices
- [CONCURRENCY.md](./CONCURRENCY.md) - Handling concurrent script execution
