// Background service worker (MV3) – no DOM access. Use OffscreenCanvas & createImageBitmap.

let lastOptions = {
  format: 'png',
  quality: 0.9,
  filename: 'screenshot',
  autoDownload: true,
  addTimestamp: false
};

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'prepareOptions' && request.options) {
      lastOptions = { ...lastOptions, ...sanitizeOptions(request.options) };
    } else if (request.action === 'captureVisible') {
      lastOptions = { ...lastOptions, ...sanitizeOptions(request.options || {}) };
      captureVisible(request.tabId, lastOptions).catch(handleError);
    } else if (request.action === 'captureSelectedArea') {
      captureSelectedArea(request.rect, lastOptions).catch(handleError);
    } else if (request.action === 'captureFullPage') {
      lastOptions = { ...lastOptions, ...sanitizeOptions(request.options || {}) };
      captureFullPage(request.tabId, lastOptions).catch(handleError);
    } else if (request.action === 'selectionCanceled') {
      // no-op, could show a notification
    }
  });
}

// Keyboard shortcut commands
if (typeof chrome !== 'undefined' && chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab) return;
      if (command === 'capture-visible') {
        captureVisible(activeTab.id, lastOptions).catch(handleError);
      } else if (command === 'capture-full') {
        captureFullPage(activeTab.id, lastOptions).catch(handleError);
      } else if (command === 'capture-selected') {
        // Inject selection script
        await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content.js'] });
      }
    } catch (e) {
      handleError(e);
    }
  });
}

async function captureVisible(tabId, options) {
  const dataUrl = await getVisibleTabDataUrl(tabId, options.format, options.quality);
  await outputDataUrl(dataUrl, options);
}

async function captureSelectedArea(rect, options) {
  const dataUrl = await new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (url) => { // always capture PNG first for lossless crop
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(url);
    });
  });

  const bitmap = await dataUrlToImageBitmap(dataUrl);
  const canvas = new OffscreenCanvas(rect.width, rect.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  const outDataUrl = await offscreenToDataUrl(canvas, options.format, options.quality);
  await outputDataUrl(outDataUrl, options);
}

async function captureFullPage(tabId, options) {
  // Get page + viewport metrics from the page context
  const [{ result: metrics }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      pageWidth: document.documentElement.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      dpr: window.devicePixelRatio
    })
  });

  const { pageWidth, pageHeight, viewportHeight, dpr } = metrics;

  // Need windowId for captureVisibleTab
  const tab = await chrome.tabs.get(tabId);
  const windowId = tab.windowId;

  const totalHeightPx = Math.ceil(pageHeight * dpr);
  const totalWidthPx = Math.ceil(pageWidth * dpr);
  const canvas = new OffscreenCanvas(totalWidthPx, totalHeightPx);
  const ctx = canvas.getContext('2d');

  const step = viewportHeight; // logical CSS px step
  let currentY = 0;
  let stitchedHeight = 0;

  let index = 0;
  const totalSteps = Math.ceil(pageHeight / step);
  let progressNotificationId = await createOrUpdateProgress(0, totalSteps);

  while (currentY < pageHeight) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (y) => window.scrollTo(0, y),
      args: [currentY]
    });
    // Allow paint – small delay (tunable)
  await delay(options.retryDelay || 180);

  const shotDataUrl = await retry(async () => {
      return await new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (url) => { // PNG for stitching
          if (chrome.runtime.lastError || !url) return reject(chrome.runtime.lastError || new Error('Empty capture'));
          resolve(url);
        });
      });
  }, options.retryAttempts || 3, options.retryDelay || 180);

    const bitmap = await dataUrlToImageBitmap(shotDataUrl);

    // Draw at device-pixel coordinates
    ctx.drawImage(bitmap, 0, stitchedHeight);
  stitchedHeight += bitmap.height;
  currentY += step;
  index++;
  progressNotificationId = await createOrUpdateProgress(index, totalSteps, progressNotificationId);
  // Broadcast progress to any open popup
  chrome.runtime.sendMessage({ action: 'fullPageProgress', current: index, total: totalSteps });
  }

  // If we overshot (due to rounding) we can optionally crop. For simplicity keep as-is.
  // Crop overshoot if stitchedHeight > required device px height
  if (stitchedHeight > totalHeightPx) {
    const cropped = new OffscreenCanvas(totalWidthPx, totalHeightPx);
    const cctx = cropped.getContext('2d');
    cctx.drawImage(canvas, 0, 0);
    const finalDataUrl = await offscreenToDataUrl(cropped, options.format, options.quality);
    await outputDataUrl(finalDataUrl, options);
  } else {
    const finalDataUrl = await offscreenToDataUrl(canvas, options.format, options.quality);
    await outputDataUrl(finalDataUrl, options);
  }
  if (progressNotificationId) {
    chrome.notifications.clear(progressNotificationId);
  }
}

// Utility: convert data URL to ImageBitmap
async function dataUrlToImageBitmap(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return await createImageBitmap(blob);
}

async function offscreenToDataUrl(offscreenCanvas, format = 'png', quality = 0.92) {
  const type = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const blob = await offscreenCanvas.convertToBlob({ type, quality });
  return blobToDataUrl(blob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function handleError(error) {
  console.error('Screenshot error:', error);
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'hello_extensions.png',
    title: 'Screenshot Failed',
    message: 'An error occurred while capturing the page.'
  });
}

function sanitizeOptions(o) {
  const out = { ...o };
  if (!['png','jpeg'].includes(out.format)) out.format = 'png';
  if (typeof out.quality !== 'number' || out.quality <= 0 || out.quality > 1) out.quality = 0.9;
  if (typeof out.filename !== 'string' || !out.filename.trim()) out.filename = 'screenshot';
  out.filename = out.filename.replace(/[^a-zA-Z0-9._-]+/g, '_');
  out.autoDownload = !!out.autoDownload;
  out.addTimestamp = !!out.addTimestamp;
  return out;
}

async function outputDataUrl(dataUrl, options) {
  if (options.autoDownload) {
    const extension = options.format === 'jpeg' ? 'jpg' : 'png';
    const ts = options.addTimestamp ? '_' + new Date().toISOString().replace(/[:.]/g,'-') : '';
    const filename = `${options.filename}${ts}.${extension}`;
    return new Promise((resolve, reject) => {
      chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, (id) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(id);
      });
    });
  } else {
    await chrome.tabs.create({ url: dataUrl });
  }
}

async function createOrUpdateProgress(current, total, existingId) {
  const percent = Math.min(100, Math.round((current / total) * 100));
  const opts = {
    type: 'basic',
    iconUrl: 'hello_extensions.png',
    title: 'Full Page Capture',
    message: `Capturing... ${current}/${total} (${percent}%)`
  };
  return new Promise((resolve) => {
    if (existingId) {
      chrome.notifications.update(existingId, opts, (ok) => resolve(existingId));
    } else {
      chrome.notifications.create(undefined, opts, (id) => resolve(id));
    }
  });
}

async function retry(fn, attempts, delayMs) {
  let lastErr;
  for (let i=0; i<attempts; i++) {
    try { return await fn(); } catch (e) { lastErr = e; if (i < attempts - 1) await delay(delayMs); }
  }
  throw lastErr;
}

function getVisibleTabDataUrl(tabId, format, quality) {
  return new Promise((resolve, reject) => {
    const targetFormat = format === 'jpeg' ? 'jpeg' : 'png';
    chrome.tabs.captureVisibleTab(undefined, { format: targetFormat, quality: targetFormat === 'jpeg' ? Math.round((quality || 0.9) * 100) : undefined }, (url) => {
      if (chrome.runtime.lastError || !url) return reject(chrome.runtime.lastError || new Error('No data URL'));
      resolve(url);
    });
  });
}

// Export pure helpers for unit testing when running in Node (no chrome API).
// Detection: Node test environment won't have global chrome.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sanitizeOptions,
    retry,
    // expose for tests of filename logic
    _test: {
      sampleSanitize: (opts) => sanitizeOptions(opts)
    }
  };
}
