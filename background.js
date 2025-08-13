chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureSelectedArea') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = request.rect.width;
        canvas.height = request.rect.height;
        ctx.drawImage(img, request.rect.x, request.rect.y, request.rect.width, request.rect.height, 0, 0, request.rect.width, request.rect.height);
        chrome.tabs.create({ url: canvas.toDataURL() });
      };
      img.src = dataUrl;
    });
  } else if (request.action === 'captureFullPage') {
    captureFullPage(request.tabId);
  }
});

async function captureFullPage(tabId) {
  try {
    // Get the dimensions of the page
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        width: document.body.scrollWidth,
        height: document.body.scrollHeight,
        devicePixelRatio: window.devicePixelRatio
      })
    });

    const { width, height, devicePixelRatio } = result;

    // Get the viewport dimensions
    const tab = await chrome.tabs.get(tabId);
    const viewportHeight = tab.height;

    const screenshots = [];

    // Scroll and capture the page
    for (let y = 0; y < height; y += viewportHeight) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (y) => window.scrollTo(0, y),
        args: [y]
      });

      // A small delay to allow the page to render
      await new Promise(resolve => setTimeout(resolve, 500));

      const screenshot = await chrome.tabs.captureVisibleTab(tabId, { format: 'png' });
      screenshots.push(screenshot);
    }

    // Stitch the screenshots together
    const canvas = new OffscreenCanvas(width * devicePixelRatio, height * devicePixelRatio);
    const ctx = canvas.getContext('2d');

    let currentY = 0;
    for (const screenshot of screenshots) {
      const img = new Image();
      await new Promise(resolve => {
        img.onload = resolve;
        img.src = screenshot;
      });
      ctx.drawImage(img, 0, currentY);
      currentY += img.height;
    }

    // Create a blob from the canvas and open it in a new tab
    const blob = await canvas.convertToBlob();
    const url = URL.createObjectURL(blob);

    chrome.tabs.create({ url });
  } catch (error) {
    console.error('Error capturing full page:', error);
    // Notify the user that something went wrong
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'hello_extensions.png',
      title: 'Screenshot Failed',
      message: 'Could not capture the full page. Please try again on a different page.'
    });
  }
}
