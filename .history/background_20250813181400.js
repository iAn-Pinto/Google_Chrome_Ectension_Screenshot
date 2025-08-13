// Background service worker (MV3) – no DOM access. Use OffscreenCanvas & createImageBitmap.

let lastOptions = {
  format: 'png',
  quality: 0.9,
  filename: 'screenshot',
  autoDownload: true
};

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

  while (currentY < pageHeight) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (y) => window.scrollTo(0, y),
      args: [currentY]
    });
    // Allow paint – small delay (tunable)
    await delay(180);

    const shotDataUrl = await new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (url) => { // PNG for stitching
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        resolve(url);
      });
    });

    const bitmap = await dataUrlToImageBitmap(shotDataUrl);

    // Draw at device-pixel coordinates
    ctx.drawImage(bitmap, 0, stitchedHeight);
    stitchedHeight += bitmap.height;
    currentY += step;
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
  return out;
}

async function outputDataUrl(dataUrl, options) {
  if (options.autoDownload) {
    const extension = options.format === 'jpeg' ? 'jpg' : 'png';
    const filename = `${options.filename}.${extension}`;
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

function getVisibleTabDataUrl(tabId, format, quality) {
  return new Promise((resolve, reject) => {
    const targetFormat = format === 'jpeg' ? 'jpeg' : 'png';
    chrome.tabs.captureVisibleTab(undefined, { format: targetFormat, quality: targetFormat === 'jpeg' ? Math.round((quality || 0.9) * 100) : undefined }, (url) => {
      if (chrome.runtime.lastError || !url) return reject(chrome.runtime.lastError || new Error('No data URL'));
      resolve(url);
    });
  });
}
