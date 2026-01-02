# Testing Guide: Load Order and Race Condition Fixes

This guide provides step-by-step instructions for testing the race condition fixes implemented in dlcountdown.user.js, antiadblock.user.js, and adinteract.user.js.

## What Was Fixed

The issue: Scripts running at `document-start` tried to register with the shared UI (which loads at `document-idle`) before their own `renderPanel` and `setEnabled` functions were defined, causing the scripts to fail to load or register.

The solution: Implemented a deferred registration pattern that stores the registration callback and calls it after all required functions are defined.

## Prerequisites

- Tampermonkey or compatible userscript manager
- All userscripts from this repository installed
- Clean browser profile (or disable all other extensions for testing)

## Test 1: Verify Syntax

**Purpose:** Ensure no parse errors that would prevent scripts from loading.

```bash
cd /path/to/userscripts
node --check dlcountdown.user.js antiadblock.user.js adinteract.user.js
```

**Expected:** No output (exit code 0)

**If failed:** Syntax error in script - must be fixed before other tests.

## Test 2: Verify All Scripts Load

**Purpose:** Confirm all scripts initialize without errors.

### Steps:
1. Open browser DevTools (F12)
2. Go to Console tab
3. Clear console
4. Navigate to any page (e.g., `https://example.com`)
5. Look for userscript initialization messages

**Expected:**
- No red errors in console
- Scripts may log info messages (if DEBUG enabled)
- No "undefined is not a function" errors
- No "Cannot read property 'registerScript' of null" errors

**If failed:**
- Check console for exact error message
- Verify script is enabled in Tampermonkey dashboard
- Check @match/@include patterns match the URL

## Test 3: Verify Shared UI Registration

**Purpose:** Confirm all scripts register successfully with shared UI.

### Steps:
1. Navigate to any page
2. Wait 2-3 seconds for page to fully load
3. Click the hotpink dock button (bottom right corner)
4. Check the scripts list in the modal

**Expected:**
- All 12 scripts appear in the list
- Each script shows ON/OFF status
- Clicking a script name switches to its panel
- Toggle buttons work (Enable/Disable)

**Verify these specific scripts are present:**
- ✅ Download Timer Accelerator (dlcountdown)
- ✅ Anti-Adblock Bypasser (antiadblock)
- ✅ Ad Interaction Auto-Clicker (adinteract)

**If failed:**
- Open browser console and look for registration errors
- Check if `registrationAttempted` flag is being set incorrectly
- Verify `tryRegisterWithSharedUi()` is being called

## Test 4: Test Deferred Registration Timing

**Purpose:** Verify registration works even when shared UI loads after document-start scripts.

### Steps:
1. Disable `userscriptui.user.js` in Tampermonkey
2. Navigate to any page
3. Wait for page load
4. Enable `userscriptui.user.js`
5. Reload the page
6. Click hotpink button

**Expected:**
- All scripts appear in shared UI modal
- No console errors about undefined functions
- Scripts that ran at document-start (dlcountdown, antiadblock, adinteract) are registered

**If failed:**
- Check if `pendingRegistration` variable is being set
- Verify `userscriptSharedUiReady` event listener is active
- Check if event listener has `{ once: true }` causing issues

## Test 5: Test Fallback UI

**Purpose:** Verify scripts work without shared UI.

### Steps:
1. Disable `userscriptui.user.js` completely
2. Navigate to any page
3. Check for script-specific UI elements

**Expected for dlcountdown:**
- Small "⏱️ Timer: OFF" button appears (bottom right, just above where dock button would be)
- Clicking button toggles between ON/OFF
- Menu commands available in Tampermonkey menu

**Expected for antiadblock:**
- No visible UI (runs silently in background)
- Menu commands available in Tampermonkey menu

**Expected for adinteract:**
- No visible UI (runs silently in background)
- Menu commands available in Tampermonkey menu

**If failed:**
- Check `createFallbackUI()` function is being called
- Verify fallback UI creation has DOM ready checks

## Test 6: Test dlcountdown Functionality

**Purpose:** Verify dlcountdown actually accelerates timers.

### Steps:
1. Navigate to a file hosting site with countdown timer (e.g., any site matching the @include patterns)
2. Enable dlcountdown if not already enabled
3. Look for countdown timer on page
4. Observe timer behavior

**Expected:**
- Timer counts down much faster than normal (100x speed)
- Download button becomes available quickly
- Notification appears: "🚀 Download timers accelerated 100x!"
- Console shows timer acceleration logs (if DEBUG enabled)

**Test sites:**
- Any URL matching: `/upload/`, `/download/`, `/dl/`, `/mirror/`
- Any URL matching: `/share/`, `/file/`, `/cloud/`
- FreeDlink (fredl.ru, freedl.ink)

**If failed:**
- Check if script is enabled in shared UI or via menu
- Verify page URL matches @include patterns
- Check console for initialization errors
- Verify timer hooks are being installed

## Test 7: Test All Scripts Enabled Simultaneously

**Purpose:** Verify no conflicts when all scripts run together.

### Steps:
1. Enable all 12 userscripts
2. Navigate to a complex page (e.g., Google search results)
3. Open shared UI modal
4. Verify all scripts are listed
5. Enable/disable each script one by one
6. Check browser console for errors

**Expected:**
- All scripts load successfully
- No JavaScript errors
- No element ID conflicts
- No global variable conflicts
- Each script's toggle works independently
- Page remains functional

**If failed:**
- Check console for specific conflict errors
- Look for duplicate element IDs
- Check for timer hook conflicts (dlcountdown vs other scripts)
- Verify scripts use IIFE and don't pollute global scope

## Test 8: Test Cross-Browser Compatibility

**Purpose:** Verify fixes work in different browsers/managers.

### Browsers to test:
- ✅ Chrome/Chromium + Tampermonkey
- ✅ Firefox + Tampermonkey
- ✅ Firefox + Violentmonkey
- ✅ Android XBrowser (priority)

### Steps for each:
1. Install userscripts
2. Run Tests 1-7 above
3. Check for browser-specific issues

**XBrowser specific checks:**
- Fallback UI appears and works
- localStorage fallback works when GM APIs unavailable
- Touch events work correctly
- Mobile viewport is handled properly

**If failed:**
- Check for browser-specific console errors
- Verify GM API polyfills work
- Test localStorage fallback explicitly
- Check touch event handling

## Test 9: Test Installation Order

**Purpose:** Verify scripts work regardless of install order.

### Steps:
1. Uninstall all userscripts
2. Install in reverse priority order:
   - userscriptlogs.user.js (12)
   - pageinfoexport.user.js (11)
   - chatgptmd.user.js (10)
   - ... down to ...
   - userscriptui.user.js (1)
3. Navigate to test page
4. Verify all scripts registered

**Expected:**
- All scripts appear in shared UI
- Load order doesn't matter due to deferred registration
- No registration errors

**Then reverse:**
1. Uninstall all again
2. Install in priority order (1 → 12)
3. Test again

**If failed:**
- Check if registration depends on install order
- Verify event listeners fire regardless of timing
- Check if `pendingRegistration` pattern handles all cases

## Test 10: Test Disable/Re-enable Cycle

**Purpose:** Verify scripts handle state changes correctly.

### Steps:
1. Enable all scripts
2. Navigate to test page
3. Disable each document-start script via shared UI
4. Re-enable each script
5. Check for memory leaks or duplicate registrations

**Expected:**
- Scripts cleanly disable (stop processing)
- Scripts cleanly re-enable (resume processing)
- No duplicate UI elements created
- `registrationAttempted` flag reset correctly
- Observers and timers cleaned up on disable

**If failed:**
- Check teardown code in `stop()` functions
- Verify observers are disconnected
- Check for event listener cleanup
- Look for duplicate registrations in console

## Test 11: Stress Test - Rapid Toggle

**Purpose:** Verify no race conditions during rapid state changes.

### Steps:
1. Open shared UI modal
2. Rapidly click Enable/Disable on dlcountdown (10+ times quickly)
3. Do same for antiadblock and adinteract
4. Check console for errors

**Expected:**
- No errors or warnings
- Script state matches button state
- No orphaned observers or timers
- No duplicate registrations

**If failed:**
- Add debouncing to toggle handlers
- Check for race conditions in enable/disable logic
- Verify `registrationAttempted` flag prevents duplicates

## Success Criteria

All tests must pass for the fix to be considered complete:

- [x] No syntax errors (Test 1)
- [x] All scripts load without errors (Test 2)
- [x] All scripts register with shared UI (Test 3)
- [x] Deferred registration works (Test 4)
- [x] Fallback UI works (Test 5)
- [x] dlcountdown accelerates timers (Test 6)
- [x] No conflicts with all scripts enabled (Test 7)
- [ ] Works in all browsers/managers (Test 8)
- [ ] Install order doesn't matter (Test 9)
- [ ] Enable/disable cycles work cleanly (Test 10)
- [ ] No race conditions on rapid toggle (Test 11)

## Debugging Tips

If tests fail, check these common issues:

### Registration fails
```javascript
// In browser console:
// Check if factory exists
console.log(window.__userscriptSharedUi);
console.log(unsafeWindow.__userscriptSharedUi);

// Check if helper is available
console.log(typeof window.__userscriptSharedUi?.createDiscoveryHelper);

// Check registration state
console.log({
  sharedUi: window.sharedUi,
  sharedUiReady: window.sharedUiReady,
  registrationAttempted: window.registrationAttempted
});
```

### Functions undefined
```javascript
// Check if functions exist when registration is attempted
console.log({
  state: typeof state,
  renderPanel: typeof renderPanel,
  setEnabled: typeof setEnabled
});
```

### Event not firing
```javascript
// Listen for shared UI ready event
document.addEventListener('userscriptSharedUiReady', (e) => {
  console.log('Shared UI ready event fired', e.detail);
});
```

## Reporting Issues

If any test fails, report the issue with:

1. Test number and name
2. Browser and version
3. Userscript manager and version
4. Full console error output
5. Steps to reproduce
6. Expected vs actual behavior

## See Also

- [LOAD-ORDER.md](./LOAD-ORDER.md) - Load order and race condition documentation
- [AGENTS.md](../AGENTS.md) - Developer guidelines
- [API-doc.md](../API-doc.md) - API best practices
