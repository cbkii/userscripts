# Quick Reference: Deferred Registration Pattern

This is a quick reference for implementing the deferred registration pattern in userscripts that run at `document-start` and need to register with the shared UI.

## When to Use This Pattern

Use this pattern when:
- Your script has `@run-at document-start`
- Your script registers with `userscriptui.user.js` (shared UI)
- Your script defines `renderPanel` and `setEnabled` functions later in the code

## The Pattern (Copy-Paste Template)

```javascript
// At top level, before main() or other functions
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

// Shared UI discovery (with helper)
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
      // Store tryRegister - DON'T call it yet!
      pendingRegistration = tryRegister;
    }
  });
  sharedUi = helper.sharedUi;
  sharedUiReady = helper.isReady;
} else {
  // Fallback: inline discovery
  const initSharedUi = (providedFactory) => {
    let factory = providedFactory;
    
    if (!factory && typeof window !== 'undefined' && window.__userscriptSharedUi) {
      factory = window.__userscriptSharedUi;
    }
    
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

  // Listen for shared UI ready event
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

// ... rest of your code (state, renderPanel, setEnabled) ...

// In your init() function, AFTER defining state/renderPanel/setEnabled:
const init = async () => {
  // ... initialize state ...
  
  // NOW safe to register with shared UI
  if (pendingRegistration && typeof pendingRegistration === 'function') {
    pendingRegistration(renderPanel, (next) => setEnabled(next), state.enabled);
    registrationAttempted = true;
  } else {
    tryRegisterWithSharedUi();
  }
  
  // ... rest of initialization ...
};
```

## Key Points

### ✅ Do This:
1. Declare variables at top level (before functions)
2. Store `tryRegister` callback in `pendingRegistration`
3. Call registration AFTER defining `renderPanel` and `setEnabled`
4. Use both helper path and fallback event path

### ❌ Don't Do This:
1. Don't call `tryRegister` immediately in `onReady`
2. Don't assume functions exist when registration is attempted
3. Don't forget to check `typeof fn === 'function'`
4. Don't skip the fallback event listener path

## Common Mistakes

### Mistake 1: Calling immediately
```javascript
// ❌ WRONG
onReady: (ui, tryRegister) => {
  tryRegister(renderPanel, setEnabled, state.enabled); // Undefined!
}
```

### Mistake 2: Not storing callback
```javascript
// ❌ WRONG
onReady: (ui, tryRegister) => {
  sharedUi = ui;
  // tryRegister is lost!
}
```

### Mistake 3: Forgetting to call later
```javascript
// ❌ WRONG
onReady: (ui, tryRegister) => {
  pendingRegistration = tryRegister; // ✅ Stored
}

// But never called in init()! ❌
```

### Mistake 4: Not checking function types
```javascript
// ❌ WRONG
if (sharedUi) {
  sharedUi.registerScript({ render: renderPanel }); // Might be undefined!
}

// ✅ CORRECT
if (sharedUi && typeof renderPanel === 'function') {
  sharedUi.registerScript({ render: renderPanel });
}
```

## Checklist

Before committing your script:

- [ ] Variables declared at top level
- [ ] `pendingRegistration` stores callback, doesn't call it
- [ ] `tryRegisterWithSharedUi()` checks if functions exist
- [ ] `init()` calls registration AFTER defining functions
- [ ] Both helper path and event listener path implemented
- [ ] `registrationAttempted` prevents duplicate registration
- [ ] Tested with shared UI disabled (fallback works)
- [ ] Tested installing scripts in different orders

## Testing

Quick test:
1. Disable `userscriptui.user.js`
2. Load your script
3. Enable `userscriptui.user.js`
4. Reload page
5. Click hotpink button - your script should appear

## Examples

See these scripts for working implementations:
- dlcountdown.user.js (v2026.01.02.0412+)
- antiadblock.user.js (v2026.01.02.0412+)
- adinteract.user.js (v2026.01.02.0412+)
- pageunlock.user.js (uses `attemptSharedUiRegistration()` variant)

## See Also

- [LOAD-ORDER.md](./LOAD-ORDER.md) - Full technical documentation
- [TESTING-LOAD-ORDER.md](./TESTING-LOAD-ORDER.md) - Testing procedures
- [BEST-PRACTICES-RESEARCH.md](./BEST-PRACTICES-RESEARCH.md) - Industry research
- [AGENTS.md](../AGENTS.md) - Development guidelines
