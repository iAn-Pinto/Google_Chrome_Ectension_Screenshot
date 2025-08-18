# Testing Guide

This document describes how to test the Screenshot Extension both automatically (unit tests) and manually (functional tests inside Chrome).

## 1. Automated Unit Tests

Implemented using Jest to cover pure helper logic in `background.js`.

### Run
```
npm install
npm test
```
### Covered Helpers
- sanitizeOptions: Ensures option normalization & filename sanitization.
- retry: Verifies retry success/failure pathways.

### Improving Coverage
Additional refactors could extract logic like `createOrUpdateProgress`, `outputDataUrl` decision branch, and `offscreenToDataUrl` (with dependency injection for chrome APIs / OffscreenCanvas) into testable modules. For now coverage is intentionally focused on pure, side-effect-light logic.

## 2. Manual Functional Test Plan

Follow these steps each release to verify end-to-end functionality in Chrome.

### Environment Prep
1. Open Chrome (latest stable) on desktop.
2. Navigate to chrome://extensions and enable Developer Mode.
3. Click "Load unpacked" and select the repository root folder containing `manifest.json`.
4. Pin the extension (optional) for quick access.

### A. Popup UI & Settings
1. Click the extension icon to open popup.
2. Verify default values:
   - Format: PNG
   - Quality: 0.9 slider & label
   - Filename: screenshot
   - Auto download: checked
   - Add timestamp: unchecked
   - Retry Attempts: 3
   - Retry Delay: 180
3. Change each field to a non-default value (e.g., JPEG, quality 0.7, filename `my test file`, uncheck auto download, check add timestamp, attempts=2, delay=250) and close popup.
4. Re-open popup; confirm values persisted (via chrome.storage.sync).

### B. Visible Viewport Capture
1. Open a normal HTTPS site (e.g., https://example.com).
2. Set settings: PNG, auto download ON, timestamp OFF.
3. Click "Capture Visible Part".
4. Expect: A file downloads automatically named `screenshot.png`.
5. Open the image; verify it matches current viewport only (no scroll beyond visible area).
6. Repeat with add timestamp ON; filename should include ISO-like suffix.

### C. Selected Area Capture
1. On a content-rich page, open popup, choose JPEG @ quality 0.8, set filename `area`, ensure auto download ON.
2. Click "Capture Selected Area".
3. Overlay appears with crosshair cursor.
4. Drag a rectangle; upon mouseup overlay disappears.
5. Expect: Download of `area.jpg` (or with timestamp if enabled) containing only the selected region.
6. Repeat but press ESC after overlay appears; ensure no capture occurs.

### D. Full Page Capture (Stitching)
1. Navigate to a long scrolling page (e.g., documentation page > 3 viewports tall).
2. Popup: set PNG, attempts=3, delay=180.
3. Click "Capture Full Page".
4. Popup closes; observe Chrome notification updating progress counts.
5. (If popup left open, progress bar increments.)
6. After completion, resulting image should include the entire page height (verify top & bottom present). No large blank stripes. Minor overlap acceptable.
7. Repeat with JPEG, quality 0.6, timestamp ON.

### E. Keyboard Shortcuts
1. Go to chrome://extensions/shortcuts.
2. Confirm defaults:
   - Alt+Shift+V visible
   - Alt+Shift+S selected area
   - Alt+Shift+F full page
3. Trigger Alt+Shift+V on a page; ensure download identical to button test.
4. Trigger Alt+Shift+S; ensure overlay appears.
5. Trigger Alt+Shift+F; ensure full page capture executes.

### F. Restricted Pages Handling
1. Open chrome://extensions.
2. Open extension popup.
3. Buttons should be disabled and message "This page cannot be captured." displayed.
4. No attempt to capture should occur if buttons clicked (they are disabled).

### G. Retry Logic Smoke Test
(Hard to deterministically force failures; optionally throttle CPU/network via DevTools.)
1. In DevTools performance throttling, set CPU slowdown or create artificial heavy layout page.
2. Perform full page capture; ensure it eventually succeeds (depends on conditions). If failure occurs, notification should report error.

### H. Error Handling
1. Temporarily (for testing only) modify code to throw inside `captureVisible` then reload extension; confirm notification "Screenshot Failed" appears when action triggered.
2. Revert change.

### I. Storage Sync Behavior (Optional)
1. Sign into Chrome with sync enabled across two profiles (or use two devices).
2. Change settings on one device; after sync, open on second and verify settings replicated (may require wait or manual sync trigger).

### J. Download vs Open In Tab
1. Uncheck "Auto download".
2. Perform Visible capture.
3. Expect new tab opens with data URL image instead of download.

### K. Filename Sanitization
1. Enter filename: `my bad:name*file`.
2. Perform capture.
3. Downloaded file should have name with illegal characters replaced by underscores (e.g., `my_bad_name_file.png`).

### L. Large Page Memory Boundary (Exploratory)
1. Load an extremely tall page (infinite scroll or long article).
2. Attempt full page capture; note if extension errors (possible canvas memory). Record page dimensions & outcome.

## 3. Recording Results
Use a checklist per test run. Capture representative output images for regression reference.

## 4. Automation Roadmap
Potential future automated additions:
- Puppeteer-based headless Chrome tests launching extension (custom loader) to simulate captures (limited by Chrome headless screenshot restrictions).
- Refactor OffscreenCanvas processing into separate module for injectable mocks.
- Integration test harness using Chrome's extension debugging protocol (via puppeteer-core + chrome-launcher).

## 5. Known Limitations of Tests
- No automated coverage of Chrome APIs (requires integration/e2e environment).
- Canvas/image operations not unit tested (browser dependent).
- Notification progress and scrolling timing not simulated.

---
Happy testing!
