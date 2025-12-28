# Page Unlocker - Shared UI Integration COMPLETE

## ✅ Status: COMPLETE (v2025.12.28.1322)

All integration tasks have been completed:
- ✅ Constants added (SCRIPT_ID, SCRIPT_TITLE, ENABLE_KEY)
- ✅ gmStore helper added
- ✅ Robust shared UI discovery implemented
- ✅ renderPanel function with all 5 toggles + 2 action buttons
- ✅ toggleEnabled and toggleSetting functions implemented
- ✅ Document-start timing handled correctly

The sections below are kept for reference but the integration is now complete.

---

## Status (Historical)
Version is now 2025.12.28.1322, and full shared UI integration is complete due to technical complexity with document-start timing and file encoding issues.

## What's Needed

### 1. Add Constants (after line 27, after PATCH_FLAG)
```javascript
  const SCRIPT_ID = 'pageunlock';
  const SCRIPT_TITLE = 'Page Unlocker';
  const ENABLE_KEY = `${SCRIPT_ID}.enabled`;
```

### 2. Add gmStore Helper (after gmNotify function, around line 62)
```javascript
  const gmStore = {
    get(key, fallback) { return gmGet(key, fallback); },
    set(key, value) { gmSet(key, value); }
  };
```

### 3. Change const to let (around lines 71-73)
```javascript
  // BEFORE:
  const cfg = normaliseCfg(gmGet(STORAGE_KEY, DEFAULT_CFG));
  const host = location.hostname || '';
  const isHostDisabled = cfg.disabledHosts.includes(host);

  // AFTER:
  let cfg = normaliseCfg(gmGet(STORAGE_KEY, DEFAULT_CFG));
  const host = location.hostname || '';
  let isHostDisabled = cfg.disabledHosts.includes(host);
```

### 4. Add Shared UI Detection (after isHostDisabled line)
```javascript
  // Robust shared UI detection across sandbox boundaries
  let sharedUi = null;
  let sharedUiReady = false;
  let registrationAttempted = false;

  const initSharedUi = (providedFactory) => {
    // Priority 1: Use factory provided in event detail
    let factory = providedFactory;
    
    // Priority 2: Check window (sandboxed context)
    if (!factory && typeof window !== 'undefined' && window.__userscriptSharedUi) {
      factory = window.__userscriptSharedUi;
    }
    
    // Priority 3: Check unsafeWindow (page context)
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

  // Try immediate detection (likely fails at document-start)
  if (typeof document !== 'undefined' && document.readyState !== 'loading') {
    initSharedUi();
  }

  // Listen for shared UI ready event with proper detail consumption
  if (typeof document !== 'undefined') {
    document.addEventListener('userscriptSharedUiReady', (event) => {
      setTimeout(() => {
        const providedFactory = event?.detail?.sharedUi;
        if (!sharedUiReady) {
          initSharedUi(providedFactory);
        }
        if (sharedUi && !registrationAttempted && typeof renderPanel === 'function') {
          registrationAttempted = true;
          sharedUi.registerScript({
            id: SCRIPT_ID,
            title: SCRIPT_TITLE,
            enabled: cfg.enabled,
            render: renderPanel,
            onToggle: (next) => toggleEnabled(next)
          });
        }
      }, 0);
    });

    // Also try after DOMContentLoaded
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        if (!sharedUiReady) {
          initSharedUi();
          if (sharedUi && !registrationAttempted && typeof renderPanel === 'function') {
            registrationAttempted = true;
            sharedUi.registerScript({
              id: SCRIPT_ID,
              title: SCRIPT_TITLE,
              enabled: cfg.enabled,
              render: renderPanel,
              onToggle: (next) => toggleEnabled(next)
            });
          }
        }
      }, 100);
    }, { once: true });
  }
```

### 5. Add Integration Functions (BEFORE the "// --- Menu" comment around line 75)
```javascript
  //////////////////////////////////////////////////////////////
  // SHARED UI INTEGRATION
  //////////////////////////////////////////////////////////////

  function toggleEnabled(next) {
    cfg.enabled = !!next;
    gmSet(STORAGE_KEY, cfg);
    if (sharedUi) {
      sharedUi.setScriptEnabled(SCRIPT_ID, cfg.enabled);
    }
    gmNotify(`Page Unlocker: ${cfg.enabled ? 'Enabled' : 'Disabled'}. Reload to apply.`);
  }

  function toggleSetting(key, value) {
    cfg[key] = value;
    gmSet(STORAGE_KEY, cfg);
    if (key === 'disabledHosts') {
      isHostDisabled = cfg.disabledHosts.includes(host);
    }
    gmNotify(`Page Unlocker: setting updated. Reload to apply.`);
  }

  function renderPanel() {
    const panel = document.createElement('div');
    panel.style.cssText = 'padding: 12px; color: #e5e7eb; font-family: system-ui, sans-serif; font-size: 13px;';

    const title = document.createElement('h3');
    title.textContent = 'Page Unlocker Settings';
    title.style.cssText = 'margin: 0 0 12px 0; font-size: 15px; font-weight: 700; color: #f8fafc;';
    panel.appendChild(title);

    const note = document.createElement('p');
    note.textContent = '⚠️ Changes require page reload to take effect.';
    note.style.cssText = 'margin: 0 0 14px 0; padding: 8px; background: rgba(251,191,36,0.15); border-left: 3px solid #fbbf24; font-size: 12px; color: #fcd34d; border-radius: 4px;';
    panel.appendChild(note);

    // Helper to create toggle button
    const createToggle = (label, checked, onChange) => {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; padding: 8px; background: rgba(255,255,255,0.03); border-radius: 6px;';

      const labelEl = document.createElement('span');
      labelEl.textContent = label;
      labelEl.style.cssText = 'flex: 1; color: #cbd5e1;';

      const btn = document.createElement('button');
      btn.textContent = checked ? 'ON' : 'OFF';
      btn.style.cssText = `padding: 4px 12px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.2); cursor: pointer; font-size: 11px; font-weight: 700; ${checked ? 'background: #10b981; color: #111;' : 'background: #374151; color: #9ca3af;'}`;
      btn.addEventListener('click', () => {
        const newVal = !checked;
        onChange(newVal);
        btn.textContent = newVal ? 'ON' : 'OFF';
        btn.style.background = newVal ? '#10b981' : '#374151';
        btn.style.color = newVal ? '#111' : '#9ca3af';
      });

      row.appendChild(labelEl);
      row.appendChild(btn);
      return row;
    };

    // Helper to create action button
    const createButton = (label, onClick) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = 'padding: 8px 14px; margin: 6px 0; background: #3b82f6; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; width: 100%;';
      btn.addEventListener('click', onClick);
      btn.addEventListener('mouseenter', () => { btn.style.background = '#2563eb'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = '#3b82f6'; });
      return btn;
    };

    // Add toggles for each setting
    panel.appendChild(createToggle(
      'Aggressive mode (blocks more events)',
      cfg.aggressive,
      (val) => toggleSetting('aggressive', val)
    ));

    panel.appendChild(createToggle(
      'Overlay buster (removes blocking overlays)',
      cfg.overlayBuster,
      (val) => toggleSetting('overlayBuster', val)
    ));

    panel.appendChild(createToggle(
      'Copy tail cleaner (removes attribution)',
      cfg.cleanCopyTail,
      (val) => toggleSetting('cleanCopyTail', val)
    ));

    panel.appendChild(createToggle(
      'Key event stopper (intercepts keyboard)',
      cfg.interceptKeys,
      (val) => toggleSetting('interceptKeys', val)
    ));

    // This site toggle
    const thisSiteRow = createToggle(
      `This site (${host || 'unknown'})`,
      !isHostDisabled,
      (val) => {
        const set = new Set(cfg.disabledHosts);
        if (val) {
          set.delete(host);
        } else {
          set.add(host);
        }
        cfg.disabledHosts = [...set].sort();
        isHostDisabled = !val;
        toggleSetting('disabledHosts', cfg.disabledHosts);
      }
    );
    panel.appendChild(thisSiteRow);

    const sep = document.createElement('hr');
    sep.style.cssText = 'border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 14px 0;';
    panel.appendChild(sep);

    // Action buttons
    panel.appendChild(createButton('⚡ Force unlock now', () => {
      if (typeof forceUnlockNow === 'function') {
        forceUnlockNow();
        gmNotify('Page Unlocker: forced unlock executed');
      }
    }));

    panel.appendChild(createButton('🔄 Reset all settings', () => {
      if (confirm('Reset all Page Unlocker settings to defaults?')) {
        gmDel(STORAGE_KEY);
        gmNotify('Page Unlocker: settings reset. Reload to apply.');
      }
    }));

    return panel;
  }
```

## Testing After Integration

1. Install all userscripts including the updated pageunlock.user.js
2. Visit any page where content selection is blocked
3. Open the shared UI dock (hotpink button)
4. Verify "Page Unlocker" tab appears
5. Click the tab to see the settings panel
6. Test all toggles (note reload warning)
7. Test "Force unlock now" button
8. Test "Reset settings" button
9. Verify GM menu commands still work as fallback

## Notes

- The script runs at `document-start` but shared UI loads at `document-idle`
- Registration is delayed until DOMContentLoaded + 100ms
- All changes require page reload due to document-start initialization
- GM menu commands remain as fallback for quick access
