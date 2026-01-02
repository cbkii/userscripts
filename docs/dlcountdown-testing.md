# Download Timer Accelerator Pro - Testing Guide

## Changes Summary (Version 2026.01.02.0158)

This version adds compatibility with FreeDlink and similar sites that require captcha/ad-verification for downloads, plus XBrowser support for Android.

### Key Improvements

1. **FreeDlink Compatibility**
   - Added domain exclusion for `fredl.ru` and `freedl.ink`
   - Automatic detection of captcha elements (hCaptcha, reCAPTCHA)
   - Detection of ad-verification fields (`adsOnlinehash`, `adblock_detected`, `level`)
   - Script automatically disables acceleration on these sites

2. **Safer DOM Manipulation**
   - `handleCommonPatterns()` now more selective:
     - Only hides elements with actual countdown text (not all "wait" elements)
     - Only enables download-specific disabled buttons
     - Won't interfere with ad verification flows

3. **XBrowser (Android) Support**
   - localStorage fallback when GM APIs unavailable
   - Fallback UI button when menu commands not supported
   - Better error handling for missing APIs

4. **Anti-adblock Script Coordination**
   - Added `@exclude` for FreeDlink domains in `antiadblock.user.js`
   - Prevents conflicts that could trigger ad-blocker detection

## Test Scenarios

### 1. FreeDlink Download Test (Primary Goal)

**URL:** `https://fredl.ru/6blvteuy9wqq` (or similar FreeDlink URL)

**Expected Behavior:**
- Script detects FreeDlink domain and logs: `"Skipping acceleration on fredl.ru - site requires captcha/ad verification"`
- Timer runs at normal speed (60 seconds)
- Script does NOT interfere with:
  - Countdown display
  - hCaptcha widget
  - Ad verification (adsOnlinehash, level fields)
  - "Normal download" button flow
- User can solve captcha normally
- Download completes successfully after captcha solved

**How to Test:**
1. Install updated `dlcountdown.user.js`
2. Navigate to a FreeDlink download page
3. Open browser console to see script logs
4. Verify timer runs at normal speed
5. Solve captcha when prompted
6. Verify download completes successfully

### 2. Regular Download Sites (Regression Test)

**Test Sites:** Any download site matching the `@include` patterns (NOT FreeDlink)

**Expected Behavior:**
- Script accelerates timers by 100x (default)
- Countdown completes quickly
- Download buttons become enabled
- Downloads work normally

**How to Test:**
1. Navigate to a regular file hosting site with countdown timer
2. Enable script via menu/UI
3. Verify timer accelerates
4. Verify download completes successfully

### 3. XBrowser Android Test

**Platform:** Android device with XBrowser

**Expected Behavior:**
- Script loads without errors
- If GM APIs unavailable, uses localStorage
- Fallback UI button appears in bottom-right corner
- Button shows "⏱️ Timer: ON/OFF" state
- Clicking button toggles acceleration on/off

**How to Test:**
1. Install script in XBrowser on Android
2. Navigate to any download site
3. Look for fallback button (bottom-right, fixed position)
4. Toggle button and verify state changes
5. Verify acceleration works when enabled

### 4. Captcha Detection Test

**Test Pages:** Any page with hCaptcha or reCAPTCHA widget

**Expected Behavior:**
- Script detects captcha elements
- Logs: `"Captcha or ad verification detected - timers left intact"`
- Acceleration automatically disabled
- Page functions normally

**How to Test:**
1. Navigate to page with visible captcha widget
2. Check console for detection log message
3. Verify script doesn't interfere with page behavior

### 5. Shared UI Integration Test

**Platform:** Desktop browser with Tampermonkey

**Expected Behavior:**
- Script registers with userscriptui.user.js
- Panel appears in shared UI modal
- Toggle button works
- "Rescan timers" button works when enabled
- Status text shows current state

**How to Test:**
1. Ensure userscriptui.user.js is installed
2. Navigate to any matching page
3. Open shared UI modal (look for pink button)
4. Verify Download Timer Accelerator panel appears
5. Test toggle and rescan buttons

### 6. Menu Commands Test

**Platform:** Desktop browser with Tampermonkey

**Expected Behavior:**
- Menu shows "[Download Countdown] ✓/✗ Enable" command
- When enabled, shows "⟳ Rescan timers" command
- Commands work correctly

**How to Test:**
1. Open Tampermonkey menu
2. Verify script commands appear
3. Toggle enable/disable
4. Verify state changes correctly

## Validation Checklist

Before deploying to production:

- [ ] Syntax check passes: `node --check dlcountdown.user.js`
- [ ] Lint passes: `cd dev && npm run lint`
- [ ] Tests pass: `cd dev && npm run test`
- [ ] FreeDlink downloads work with captcha
- [ ] Regular download sites still accelerate correctly
- [ ] No conflicts with antiadblock.user.js on FreeDlink
- [ ] XBrowser fallback UI appears when needed
- [ ] Shared UI integration works
- [ ] Menu commands work
- [ ] Console logs show correct detection messages

## Known Limitations

1. **Captcha must be solved manually** - Script does not automate captcha solving (by design)
2. **Ad verification requires user action** - Premium download flows requiring ad clicks must be done manually
3. **Detection timing** - If captcha/ad elements load after script initialization, detection may occur on DOMContentLoaded
4. **Domain whitelist** - Only FreeDlink explicitly excluded; similar sites may need to be added to `excludedDomains` array

## Troubleshooting

### Script still accelerating on FreeDlink
- Check console for detection log messages
- Verify domain is in `excludedDomains` array
- Check if captcha elements are present in DOM when script runs

### Download fails after timer completes
- Disable Download Timer Accelerator for that site
- Check if site has ad verification requirements
- Add domain to `excludedDomains` if needed

### Fallback UI button doesn't appear
- Check if GM_registerMenuCommand exists (desktop browsers)
- Check if shared UI is loaded (look for pink button)
- Button only appears when both are unavailable

### localStorage errors on XBrowser
- Check browser console for specific error messages
- Verify XBrowser allows userscript localStorage access
- Try clearing browser data and reinstalling script

## Future Enhancements

Potential improvements for future versions:

1. **Configurable exclusion list** - UI to add/remove excluded domains
2. **Ad verification automation** (opt-in) - Automatic createAds API calls for power users
3. **Site-specific profiles** - Different acceleration factors per domain
4. **Smart detection refinement** - Better heuristics for captcha/ad detection
5. **Temporary disable** - Per-page toggle without changing global state
