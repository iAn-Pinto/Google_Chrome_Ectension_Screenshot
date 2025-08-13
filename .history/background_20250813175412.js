// Background service worker (MV3) – no DOM access. Use OffscreenCanvas & createImageBitmap.

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'captureSelectedArea') {
    captureSelectedArea(request.rect).catch(handleError);
  } else if (request.action === 'captureFullPage') {
    captureFullPage(request.tabId).catch(handleError);
  }
});

async function captureSelectedArea(rect) {
  const dataUrl = await new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (url) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(url);
    });
  });

  const bitmap = await dataUrlToImageBitmap(dataUrl);
  const canvas = new OffscreenCanvas(rect.width, rect.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  const outDataUrl = await offscreenToDataUrl(canvas);
  await chrome.tabs.create({ url: outDataUrl });
}

async function captureFullPage(tabId) {
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
      chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (url) => {
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
  const finalBlob = await canvas.convertToBlob();
  const finalDataUrl = await blobToDataUrl(finalBlob);
  await chrome.tabs.create({ url: finalDataUrl });
}

// Utility: convert data URL to ImageBitmap
async function dataUrlToImageBitmap(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return await createImageBitmap(blob);
}

async function offscreenToDataUrl(offscreenCanvas) {
  const blob = await offscreenCanvas.convertToBlob();
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
