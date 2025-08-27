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
      // no-op
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

// Helpers to stabilize the page and align scroll during full-page capture (minimal additions)
async function preparePageForCapture(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const STYLE_ID = '__screenshot_helper_style__';
      let style = document.getElementById(STYLE_ID);
      if (style) style.remove();
      style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        html, body { scroll-behavior: auto !important; overscroll-behavior: none !important; }
        html, body { scroll-snap-type: none !important; }
        * { animation: none !important; transition: none !important; }
        ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
      `;
      document.documentElement.appendChild(style);

      const candidates = Array.from(document.body.querySelectorAll('*'));
      let maxTopFixed = 0;
      for (const el of candidates) {
        const cs = getComputedStyle(el);
        const fixedOrSticky = (cs.position === 'fixed' || cs.position === 'sticky');
        if (!fixedOrSticky) continue;
        const r = el.getBoundingClientRect();
        const visible = r.width > 0 && r.height > 0;
        const touchesTop = r.top <= 0 && r.bottom > 0;
        if (visible && (cs.position === 'fixed' || touchesTop)) {
          maxTopFixed = Math.max(maxTopFixed, Math.ceil(Math.max(0, r.bottom)));
        }
      }
      for (const el of candidates) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.position === 'sticky') {
          el.setAttribute('data-__screenshot_hidden__', '1');
          el.style.setProperty('visibility', 'hidden', 'important');
        }
      }

      const prevBg = document.documentElement.style.backgroundColor;
      document.documentElement.setAttribute('data-__screenshot_prev_bg__', prevBg || '');
      const bodyBg = getComputedStyle(document.body).backgroundColor || '#fff';
      document.documentElement.style.backgroundColor = bodyBg;

      return { styleId: STYLE_ID, maxTopFixed };
    }
  });
  return result; // { styleId, maxTopFixed }
}

async function cleanupPageAfterCapture(tabId, styleId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (STYLE_ID) => {
      document.querySelectorAll('[data-__screenshot_hidden__]').forEach(el => {
        el.style.removeProperty('visibility');
        el.removeAttribute('data-__screenshot_hidden__');
      });
      const style = document.getElementById(STYLE_ID);
      if (style) style.remove();

      const prevBg = document.documentElement.getAttribute('data-__screenshot_prev_bg__');
      if (prevBg !== null) {
        if (prevBg) {
          document.documentElement.style.backgroundColor = prevBg;
        } else {
          document.documentElement.style.removeProperty('background-color');
        }
        document.documentElement.removeAttribute('data-__screenshot_prev_bg__');
      }
    },
    args: [styleId]
  });
}

// Align scroll to device pixels, wait for paint to settle (double rAF)
async function scrollAndWait(tabId, y, scale) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (targetY, scale) => {
      return new Promise(resolve => {
        const yRounded = Math.round(targetY * scale) / scale;
        window.scrollTo(0, yRounded);
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    },
    args: [y, scale]
  });
}

async function getPageMetrics(tabId) {
  const [{ result: metrics }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => ({
      pageWidth: document.documentElement.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      dpr: window.devicePixelRatio
    })
  });
  return metrics;
}

// Updated: seam-free full page capture with overlap cropping and cleanup
async function captureFullPage(tabId, options) {
  const { pageWidth, pageHeight, viewportHeight, dpr } = await getPageMetrics(tabId);

  const zoom = (await chrome.tabs.getZoom(tabId).catch(() => 1)) || 1;
  const scale = dpr * zoom;

  const tab = await chrome.tabs.get(tabId);
  const windowId = tab.windowId;

  const { styleId, maxTopFixed } = await preparePageForCapture(tabId);
  const overlapCss = Math.max(80, (maxTopFixed || 0) + 10);
  const overlapPx = Math.round(overlapCss * scale);
  const stepCss = Math.max(1, viewportHeight - overlapCss);

  const totalWidthPx = Math.ceil(pageWidth * scale);
  const totalHeightPx = Math.ceil(pageHeight * scale);
  const canvas = new OffscreenCanvas(totalWidthPx, totalHeightPx);
  const ctx = canvas.getContext('2d');

  let currentY = 0;        // CSS px
  let stitchedHeight = 0;  // device px

  let index = 0;
  const totalSteps = Math.ceil(pageHeight / stepCss);
  let progressNotificationId = await createOrUpdateProgress(0, totalSteps);

  try {
    while (true) {
      const maxScrollTop = Math.max(0, pageHeight - viewportHeight);
      const targetY = Math.min(currentY, maxScrollTop);

      await scrollAndWait(tabId, targetY, scale);
      await delay(options.settleDelay ?? options.retryDelay ?? 160);

      const shotDataUrl = await retry(async () => {
        return await new Promise((resolve, reject) => {
          chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (url) => {
            if (chrome.runtime.lastError || !url) return reject(chrome.runtime.lastError || new Error('Empty capture'));
            resolve(url);
          });
        });
      }, options.retryAttempts || 3, options.retryDelay || 180);

      const bitmap = await dataUrlToImageBitmap(shotDataUrl);

      const remaining = totalHeightPx - stitchedHeight;
      const srcY = (index === 0) ? 0 : Math.min(overlapPx, Math.max(0, bitmap.height - 1));
      let srcH = bitmap.height - srcY;
      if (srcH > remaining) srcH = remaining;
      if (srcH <= 0) break;

      ctx.drawImage(
        bitmap,
        0, srcY, bitmap.width, srcH,
        0, stitchedHeight, bitmap.width, srcH
      );

      stitchedHeight += srcH;
      index++;

      progressNotificationId = await createOrUpdateProgress(index, totalSteps, progressNotificationId);
      chrome.runtime.sendMessage({ action: 'fullPageProgress', current: index, total: totalSteps });

      if (stitchedHeight >= totalHeightPx) break;

      currentY += stepCss;
      if (currentY > pageHeight && stitchedHeight >= totalHeightPx - 1) break;
    }

    const finalDataUrl = await offscreenToDataUrl(canvas, options.format, options.quality);
    await outputDataUrl(finalDataUrl, options);
  } finally {
    await cleanupPageAfterCapture(tabId, styleId);
    if (progressNotificationId) {
      chrome.notifications.clear(progressNotificationId);
    }
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
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sanitizeOptions,
    retry,
    _test: {
      sampleSanitize: (opts) => sanitizeOptions(opts)
    }
  };
}