## Screenshot Extension (MV3)

Enhanced Chrome extension template for capturing screenshots:

### Features
* Capture visible viewport
* Capture user-selected area (ESC to cancel)
* Capture full page with stitching, overshoot crop, retry logic
* PNG / JPEG (quality slider)
* Auto-download or open in new tab
* Optional timestamp in filename
* Progress notification & in-popup progress bar for full-page capture
* Keyboard shortcuts (configurable in chrome://extensions/shortcuts)
  * Alt+Shift+V – Visible
  * Alt+Shift+S – Selected area
  * Alt+Shift+F – Full page
* Configurable retry attempts & delay for unreliable pages

### Installation
1. Clone repo
2. Open Chrome > Extensions > Enable Developer Mode
3. Load Unpacked > select repository folder

### Popup Controls
| Control | Description |
|---------|-------------|
| Format | PNG (lossless) or JPEG |
| Quality | JPEG encoding quality (ignored for PNG) |
| Filename | Base filename (sanitized) |
| Auto download | Save directly via Downloads API |
| Add timestamp | Append ISO-like timestamp to name |
| Retry Attempts | Number of capture retries per scroll segment |
| Retry Delay (ms) | Delay between retries & after scroll before capture |

### Full Page Capture Strategy
1. Gather scroll + viewport metrics via `chrome.scripting.executeScript`
2. Iteratively scroll, wait (retry delay), capture via `captureVisibleTab`
3. Retry failed segment captures (network / paint glitches)
4. Stitch in OffscreenCanvas at device pixel scale
5. Crop overshoot if present
6. Encode as PNG / JPEG and download or open

### In-Popup Progress Bar
Leaving the popup open when clicking "Capture Full Page" displays an inline progress bar updated via runtime messages from the service worker. (The notification progress remains for when popup is closed.)

### Storage
Settings saved with `chrome.storage.sync` (roams if user sync is enabled).

### Permissions Justification
| Permission | Purpose |
|------------|---------|
| activeTab | Access current page for scripting & capture |
| scripting | Inject selection overlay & page metric scripts |
| notifications | User feedback + progress |
| tabs | Retrieve tab/window info |
| downloads | Save captures directly |
| storage | Persist user preferences |
| host_permissions (<all_urls>) | Allow metric scripts on arbitrary pages |

### Keyboard Shortcuts
Change or remove shortcuts at: chrome://extensions/shortcuts

### Development Notes
* Background runs as MV3 service worker (no DOM). Uses OffscreenCanvas + createImageBitmap.
* All stitching/cropping happens off-page; only minimal scripting injection performs scrolling & metrics.
* Area selection overlay is ephemeral and cleans up on completion or ESC.

### Possible Future Enhancements
* Abort button / command to cancel full-page capture mid-way
* Multi-monitor / window selection awareness
* Scroll element (not whole window) selection for specific scroll containers
* PDF export

### Troubleshooting
* Some sites block screenshots (DRM, protected video, chrome:// URLs). The extension disables controls for restricted schemes.
* Very long pages can exceed canvas memory limits; consider segment export in future.
* If captures are blank, increase Retry Delay or Attempts in the popup.

---
MIT License.
