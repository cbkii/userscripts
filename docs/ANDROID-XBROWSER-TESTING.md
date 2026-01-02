# Android XBrowser Testing Guide

This document provides manual test procedures for verifying Android XBrowser compatibility fixes for download and UI functionality.

## Related Issues

- **Download failures**: Page exporter fails to download files on Android XBrowser
- **UI conflicts**: Shared UI fails to load correctly with higher load order plugins

## Fixes Applied (v2026.01.02.0107)

### Download Improvements
1. **Data URL conversion for mobile**: GM_download now converts blob URLs to data URLs for files < 2MB
2. **saveAs parameter**: Changed from `true` to `false` for better XBrowser download manager compatibility
3. **Better error handling**: Improved fallback chain for download failures

### UI Bootstrap Improvements
1. **Removed `{ once: true }` limitation**: Event listeners now handle multiple events
2. **Polling fallback**: Added 100ms polling (20 attempts, 2 seconds total) for shared UI discovery
3. **Idempotent registration**: Scripts can safely attempt registration multiple times
4. **Race condition handling**: Scripts no longer miss events due to load order

## Scripts Affected

- `pagemd.user.js` (Easy Web Page to Markdown)
- `pageinfoexport.user.js` (Export Full Page Info)

## Manual Test Steps

### Prerequisites

1. Android device with XBrowser installed
2. XBrowser's built-in script manager enabled
3. All test scripts installed via raw GitHub URLs:
   - https://raw.githubusercontent.com/cbkii/userscripts/main/pagemd.user.js
   - https://raw.githubusercontent.com/cbkii/userscripts/main/pageinfoexport.user.js
   - https://raw.githubusercontent.com/cbkii/userscripts/main/userscriptui.user.js

### Test 1: Download Functionality on XBrowser

**Objective**: Verify that markdown exports download successfully on Android XBrowser

**Steps**:
1. Install all three scripts listed above
2. Open any article/blog page (e.g., https://example.com, Wikipedia article, Medium post)
3. Tap the hotpink userscript dock button (bottom right)
4. Tap the "Page → Markdown" tab
5. Tap "Convert (clean)" button
6. **Expected**: File downloads successfully to device
7. Check Downloads folder for `.md` file
8. **Expected**: File exists and contains markdown content

**Variations**:
- Test with different page sizes (small < 100KB, medium < 1MB, large > 1MB)
- Test with "Convert (raw)" button
- Test from menu: Long-press on XBrowser menu → "Page→MD" → "⬇ Convert (with cleanup)"

**Known Limitations**:
- Files > 2MB will use blob URLs (may still fail on some Android browsers)
- Data URL conversion adds slight delay for larger files

### Test 2: UI Load Order Resilience

**Objective**: Verify shared UI loads correctly regardless of script execution order

**Steps**:
1. Uninstall all userscripts
2. Install scripts in REVERSE alphabetical order (this tests higher load order):
   a. First: `vxdark.user.js` or another script alphabetically after pagemd
   b. Second: `pagemd.user.js`
   c. Third: `pageinfoexport.user.js`
   d. Last: `userscriptui.user.js`
3. Navigate to any webpage
4. Wait 3 seconds for polling to complete
5. Tap the hotpink dock button
6. **Expected**: Modal opens showing all installed scripts
7. Verify "Page → Markdown" tab is visible and clickable
8. Verify "Page Info Export" tab is visible and clickable
9. **Expected**: No console errors about "sharedUi not found"

**Repeat with different install orders**:
- Normal order: userscriptui.user.js first, others after
- Random order: shuffle script installation
- Each time, verify the dock button appears and modal contains all scripts

### Test 3: UI Persistence After Page Navigation (SPA test)

**Objective**: Verify UI remains functional on single-page applications

**Steps**:
1. Install scripts as normal
2. Navigate to a single-page application (e.g., GitHub repo, Twitter/X, Reddit)
3. Open shared UI modal and verify it works
4. Navigate to a different page within the same site (click a link)
5. Wait for navigation to complete
6. Tap the hotpink dock button again
7. **Expected**: Modal opens normally
8. **Expected**: All tabs still visible and functional
9. Try exporting markdown from the new page
10. **Expected**: Download succeeds

### Test 4: Multiple Plugin Conflict Test

**Objective**: Verify scripts work correctly when many userscripts are installed

**Steps**:
1. Install 5+ userscripts from the repository
2. Navigate to a webpage that matches multiple script patterns
3. Tap the hotpink dock button
4. **Expected**: Modal shows all enabled scripts
5. Switch between tabs in the modal
6. **Expected**: Each tab's content renders correctly
7. Try markdown export
8. **Expected**: Download succeeds
9. Check browser console
10. **Expected**: No errors about duplicate registrations or conflicts

### Test 5: Polling Fallback Verification

**Objective**: Verify polling fallback works when event listener misses initial event

**Steps**:
1. Install scripts with a 2-second delay between each installation
2. Open browser developer tools / remote debugging
3. Navigate to a test page
4. Check console logs
5. **Expected**: See polling attempts in console (if DEBUG enabled)
6. Verify shared UI loads within 2 seconds
7. **Expected**: All scripts register successfully

## Troubleshooting

### Downloads still fail on XBrowser

**Symptoms**: No download prompt, or download fails silently

**Possible causes**:
1. XBrowser download permissions not granted
2. File size > 2MB (still uses blob URLs)
3. Page CSP blocking data URLs

**Resolution**:
1. Check XBrowser → Settings → Downloads → Enable downloads
2. For large files, try anchor fallback (automatic)
3. Check browser console for errors

### Shared UI doesn't appear

**Symptoms**: No hotpink dock button visible

**Possible causes**:
1. userscriptui.user.js not installed
2. Script execution blocked by CSP
3. Page CSS hiding the button

**Resolution**:
1. Verify userscriptui.user.js is installed and enabled
2. Check browser console for CSP errors
3. Try adding `!important` to button styles (already present)
4. Force refresh the page

### Scripts missing from modal

**Symptoms**: Some scripts don't appear in the tabs list

**Possible causes**:
1. Script disabled
2. Registration timing issue (rare with polling)
3. Script crashed during init

**Resolution**:
1. Check script is enabled in XBrowser script manager
2. Wait 3 seconds and reopen modal (polling may be in progress)
3. Check console for script errors
4. Restart browser and reload page

## Expected Behavior Summary

### Before Fix
- Downloads failed silently on XBrowser (blob URL incompatibility)
- UI failed to load if scripts loaded in wrong order
- Scripts missed `userscriptSharedUiReady` event with `{ once: true }`
- No recovery mechanism for race conditions

### After Fix
- Downloads work via data URLs (< 2MB files)
- UI loads correctly regardless of script order
- Polling fallback ensures discovery within 2 seconds
- Multiple event listeners handle race conditions
- Idempotent registration prevents duplicate entries

## Success Criteria

All tests pass when:
1. ✅ Markdown files download successfully on Android XBrowser
2. ✅ Shared UI modal appears with all scripts listed
3. ✅ Scripts work regardless of installation/execution order
4. ✅ UI remains functional after SPA navigation
5. ✅ No console errors related to UI conflicts or registration
6. ✅ Download fallbacks work when GM_download fails

## Reporting Issues

If tests fail after applying these fixes:

1. Note exact XBrowser version: Settings → About
2. Capture console errors (use remote debugging)
3. Document reproduction steps with specific URLs
4. Note which test case failed
5. Report to: https://github.com/cbkii/userscripts/issues

Include:
- Device model and Android version
- XBrowser version
- Installed script versions
- Console error messages
- Network tab showing download attempts
