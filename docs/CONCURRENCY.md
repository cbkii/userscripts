# Concurrency and Load Order Analysis

This document provides a detailed analysis of concurrency issues when multiple userscripts run simultaneously on the same page, and documents the mitigation strategies implemented.

## Overview

When 12+ userscripts run concurrently on a single page, several categories of conflicts can occur:

1. **Race conditions** - Scripts depending on shared resources that may not be ready
2. **Native API conflicts** - Multiple scripts patching the same browser APIs
3. **Event listener duplication** - Multiple handlers for the same events
4. **Resource exhaustion** - Unbounded observers/timers consuming memory
5. **Global namespace pollution** - Scripts overwriting each other's globals

## Identified Issues and Mitigations

### 1. Shared UI Discovery Race Condition

**Issue:** Scripts attempt to register with `userscriptui.user.js` before it has loaded and exposed its factory.

**Mitigation:** Three-tier discovery pattern with idempotency guards and graceful degradation.

**Status:** ✅ Mitigated in all scripts

---

### 2. Native API Patching Conflicts

**Issue:** Both `pageunlock.user.js` and `adinteract.user.js` patch `EventTarget.prototype.addEventListener`.

**Mitigation:** Load order priority + patch detection guards + proper reference chaining.

**Status:** ✅ Fixed with guard in `adinteract.user.js`

---

### 3. Event Listener Accumulation

**Issue:** Multiple scripts add event listeners without cleanup.

**Mitigation:** Event fires once, scripts check `registrationAttempted` flag.

**Status:** ✅ Implemented - All scripts now use `{ once: true }` option for automatic cleanup

---

### 4. MutationObserver Lifecycle Management

**Issue:** Observers don't always disconnect when disabled.

**Mitigation:** One-time observers disconnect after completion. Heavy observers use dormant-by-default pattern.

**Status:** ✅ Implemented - Long-running observers tracked and disconnected on script disable

---

### 5. Global Namespace Pollution

**Mitigation:** All scripts use IIFEs, only intentional globals exposed.

**Status:** ✅ All scripts properly isolated

---

### 6. Storage Key Conflicts

**Mitigation:** All scripts use namespaced keys with script ID prefix.

**Status:** ✅ No conflicts, proper namespacing

---

### 7. Concurrent Network Requests

**Mitigation:** Requests cached with expiry, no coordination needed.

**Status:** ✅ Acceptable, no conflicts observed

---

### 8. Timer/Interval Resource Management

**Mitigation:** Dormant-by-default prevents heavy polling. Intervals are bounded.

**Status:** ⚠️ Acceptable for current use cases, no cleanup mechanism

---

## Load Order Dependencies

### Critical Dependencies

1. **userscriptui.user.js (Priority 1)** - Must load first to expose shared UI factory
2. **pageunlock.user.js (Priority 2)** - Must load before adinteract.user.js

### Load Order Rationale

- **Early (document-start):** Intercept page initialization, patch APIs
- **Middle (document-end):** Site-specific enhancements after DOM ready
- **Late (document-idle):** Heavy processing after page fully interactive

---

## Testing Recommendations

1. **All scripts enabled** - Verify shared UI shows all, no console errors
2. **Load order verification** - Enable DEBUG, check timestamps
3. **Aggressive mode conflict** - Test both pageunlock and adinteract in aggressive mode
4. **SPA navigation** - Verify no duplicate UI/listeners
5. **Disable/enable cycling** - Check for orphaned resources

---

## Future Improvements

- [x] Add `{ once: true }` to userscriptSharedUiReady listeners
- [x] Implement MutationObserver disconnect on script disable
- [ ] Add timer/interval tracking and cleanup
- [ ] Create shared mutex for API patching
- [ ] Add performance monitoring

---

**Last Updated:** 2025-12-30  
**Version:** 1.1  
**Maintained by:** cbkii
