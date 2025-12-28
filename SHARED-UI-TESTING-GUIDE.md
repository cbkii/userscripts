# Shared UI Testing Guide

## Overview
This document describes how to test the shared UI framework and verify that all userscripts are properly integrated.

## Prerequisites
- Tampermonkey or compatible userscript manager installed
- All 11 userscripts installed from this repository:
  1. userscriptui.user.js (Shared UI Manager)
  2. adinteract.user.js
  3. antiadblock.user.js
  4. chatgptmd.user.js
  5. dlcountdown.user.js
  6. googlemobile.user.js
  7. pageinfoexport.user.js
  8. pagemd.user.js
  9. pageunlock.user.js (fully integrated)
  10. userscriptlogs.user.js
  11. vxdark.user.js

## What Was Fixed

### The Problem
The shared UI manager was exposing itself on `unsafeWindow.__userscriptSharedUi` (when running in Tampermonkey's sandboxed context), but individual scripts were only checking `window.__userscriptSharedUi`. This created a sandbox boundary mismatch where scripts could never discover the shared UI.

### The Solution
1. **Shared UI Manager (`userscriptui.user.js`)**:
   - Now exposes `__userscriptSharedUi` on BOTH `window` and `unsafeWindow`
   - Dispatches `userscriptSharedUiReady` event with `sharedUi` in `event.detail`

2. **All Individual Scripts**:
   - Updated to check 3 locations for shared UI:
     - `event.detail.sharedUi` (from the ready event)
     - `window.__userscriptSharedUi` (sandboxed context)
     - `unsafeWindow.__userscriptSharedUi` (page context)
   - Added `registrationAttempted` flag to prevent duplicate tab registrations
   - All registrations are now idempotent

## Testing Procedures

### Test 1: Basic Shared UI Visibility
**Goal**: Verify the shared UI appears and is interactive

1. Navigate to any web page
2. Look for a **hotpink circular button** in the bottom-right corner (or bottom-left if position was flipped)
3. Click the button
4. Verify a dark modal opens showing "Userscripts" header
5. Verify there's a "Flip" button in the header
6. Click "Flip" and verify the dock moves to the opposite side

**Expected Result**: ✅ Hotpink dock appears, modal opens/closes smoothly, position flip works

### Test 2: Script Tab Registration
**Goal**: Verify scripts register their tabs correctly

1. Open the shared UI modal
2. Look for the tab list at the top of the modal
3. Count visible tabs (should see tabs for scripts that match the current page)
4. Verify each tab shows:
   - Script name
   - ON/OFF state label
   - Enable/Disable button

**Expected Tabs (depending on page)**:
- Any page: may see pagemd, pageinfoexport, userscriptlogs, vxdark (if video), pageunlock (when integrated)
- Google search: googlemobile
- ChatGPT: chatgptmd  
- File/image hosts: dlcountdown
- Pages with ads/overlays: adinteract, antiadblock

**Expected Result**: ✅ Tabs appear without duplicates, show correct state

### Test 3: Tab Selection and Panel Switching
**Goal**: Verify tab selection changes the active panel

1. Open shared UI modal
2. Click on different script tabs
3. Verify:
   - The active tab gets highlighted border (hotpink)
   - The panel content below changes to show that script's controls
   - If a script is disabled, panel shows "Enable it to view controls"

**Expected Result**: ✅ Clicking tabs switches panels smoothly, disabled state handled correctly

### Test 4: Enable/Disable Toggle
**Goal**: Verify script enable/disable works

1. Open shared UI modal
2. Find a script tab with "Disable" button
3. Click "Disable"
4. Verify:
   - Button text changes to "Enable"
   - State label changes from "ON" to "OFF"
   - Panel shows disabled message
   - Script behavior stops (may require reload on some scripts)
5. Click "Enable" again
6. Verify state returns to enabled

**Expected Result**: ✅ Toggle works, state persists, script behavior responds

### Test 5: Google Extra Search UI
**Goal**: Verify googlemobile script's UI is visible in shared UI

1. Navigate to https://www.google.com/search?q=test
2. Wait for page to load
3. Open shared UI modal
4. Look for "Google Extra Search" tab
5. Click the tab
6. Verify the Google search helper UI appears in the panel (categories, filters, etc.)

**Expected Result**: ✅ Google Extra UI harvested and displayed in shared panel

**Known Issue**: If the panel doesn't appear, the on-page UI elements may not be creating properly due to Google's dynamic markup changes. This needs manual verification.

### Test 6: Page Unlocker UI (When Integrated)
**Goal**: Verify pageunlock script's UI works from shared modal

1. Navigate to a site that blocks text selection (e.g., some news sites, Medium)
2. Open shared UI modal
3. Look for "Page Unlocker" tab
4. Click the tab
5. Verify the panel shows:
   - Warning about reload requirement
   - 5 toggle switches (Aggressive mode, Overlay buster, Copy tail cleaner, Key event stopper, This site)
   - 2 action buttons (Force unlock now, Reset settings)
6. Click "Force unlock now" button
7. Verify text selection is now possible
8. Toggle "This site" off
9. Verify notification appears
10. Reload page
11. Verify page unlocker no longer activates

**Expected Result**: ✅ All controls visible and functional, reload messaging clear

**Status**: ✅ Complete - Full integration with all 5 toggles + 2 action buttons

### Test 7: No Duplicate Registrations
**Goal**: Verify scripts don't register multiple times

1. Open shared UI modal
2. Count tabs for each script
3. Navigate to a new page on the same domain
4. Open shared UI again
5. Recount tabs

**Expected Result**: ✅ Each script appears exactly once, no duplicates after navigation

### Test 8: Persistence Across Page Loads
**Goal**: Verify settings persist across sessions

1. Open shared UI and flip position to left
2. Disable a script
3. Close browser tab
4. Open new tab to the same site
5. Open shared UI

**Expected Result**: ✅ Dock remains on left side, script remains disabled

### Test 9: Fallback GM Menu Commands
**Goal**: Verify GM menu commands still work when shared UI unavailable

1. Disable userscriptui.user.js in Tampermonkey
2. Reload page
3. Open Tampermonkey menu
4. Verify each script still shows its menu commands
5. Test a command (e.g., toggle a script on/off)

**Expected Result**: ✅ GM menu commands work independently of shared UI

### Test 10: SPA Navigation
**Goal**: Verify shared UI works after client-side navigation

1. Navigate to a single-page app (e.g., ChatGPT, Gmail)
2. Open shared UI
3. Note which scripts are registered
4. Navigate within the SPA (new URL, no page reload)
5. Wait 2 seconds
6. Open shared UI again

**Expected Result**: ✅ Shared UI still works, tabs refresh appropriately for new page context

## Common Issues and Solutions

### Issue: Hotpink dock doesn't appear
**Solution**: 
- Check Tampermonkey dashboard to ensure userscriptui.user.js is installed and enabled
- Check browser console for errors
- Verify the script runs at document-idle

### Issue: Tabs appear but panels are empty
**Solution**:
- Check if script is disabled (panel will show "Enable it to view controls")
- Check browser console for errors in renderPanel function
- Verify script's renderPanel function returns a DOM node

### Issue: Google Extra Search UI doesn't appear
**Solution**:
- Check if googlemobile.user.js is enabled
- Verify you're on a Google search results page (not homepage)
- Check if the script's on-page UI elements are being created (look for `#google-expert-panel` in DevTools)
- If elements don't exist, the script may need updates for Google's current markup

### Issue: Settings don't persist
**Solution**:
- Check that GM_getValue/GM_setValue grants are present
- Check Tampermonkey storage quota isn't exceeded
- Verify browser isn't in private/incognito mode with restrictive settings

### Issue: Scripts register multiple times
**Solution**:
- This should be fixed with the `registrationAttempted` flag
- If still occurring, check browser console for duplicate event listeners
- Verify script isn't being injected multiple times by Tampermonkey

## Regression Testing Checklist

After any changes to shared UI or script integrations, verify:

- [ ] Hotpink dock appears on any page
- [ ] Modal opens/closes smoothly
- [ ] Position flip works
- [ ] All matching scripts show tabs (no missing tabs)
- [ ] No duplicate tabs
- [ ] Tab selection changes panel
- [ ] Enable/disable toggles work
- [ ] Settings persist across reloads
- [ ] GM menu commands still work
- [ ] No console errors
- [ ] No memory leaks (check DevTools Memory profiler after opening/closing modal 10+ times)
- [ ] Works in Tampermonkey on Chrome
- [ ] Works in XBrowser on Android (if available)

## Performance Considerations

- Opening/closing modal should be smooth (<100ms)
- Tab switching should be instant
- Panel rendering should be fast (<200ms)
- No observable memory leaks after repeated open/close cycles
- Dock button should not block page scrolling or interaction

## Accessibility Notes

- Dock button has `aria-label` and `aria-expanded` attributes
- Modal has `role="dialog"` and `aria-label`
- Modal has `aria-hidden` that toggles with visibility
- All interactive elements are keyboard accessible (tab navigation)
- Consider testing with screen readers for full accessibility

## Browser Compatibility

**Tested**:
- ✅ Tampermonkey on Chromium-based browsers (Chrome, Edge, Brave)

**Should Work**:
- Violentmonkey on Firefox
- Tampermonkey on Firefox
- XBrowser on Android

**Known Limitations**:
- Some script managers may not support all GM APIs
- XBrowser compatibility prioritized but not fully tested in this implementation
- Safari userscript support is limited

## Next Steps

1. Complete pageunlock.user.js integration (see PAGEUNLOCK-INTEGRATION-TODO.md)
2. Test on XBrowser Android
3. Verify Google Extra Search UI with current Google markup
4. Add UI helper utilities to shared UI (button, toggle, section builders)
5. Consider adding:
   - Keyboard shortcuts (Ctrl+Shift+U to open shared UI)
   - Search/filter for scripts
   - Script groups/categories
   - Export/import settings
   - Theme customization
