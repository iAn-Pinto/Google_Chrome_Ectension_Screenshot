document.addEventListener('DOMContentLoaded', async () => {
  const captureVisible = document.getElementById('captureVisible');
  const captureSelected = document.getElementById('captureSelected');
  const captureFull = document.getElementById('captureFull');
  const formatSel = document.getElementById('format');
  const qualityInput = document.getElementById('quality');
  const qualityVal = document.getElementById('qualityVal');
  const filenameInput = document.getElementById('filename');
  const autoDownload = document.getElementById('autoDownload');

  // Load persisted settings
  chrome.storage.sync.get(['format','quality','filename','autoDownload'], (data) => {
    if (data.format) formatSel.value = data.format;
    if (data.quality) { qualityInput.value = data.quality; qualityVal.textContent = data.quality; }
    if (data.filename) filenameInput.value = data.filename;
    if (typeof data.autoDownload === 'boolean') autoDownload.checked = data.autoDownload;
  });

  qualityInput.addEventListener('input', () => {
    qualityVal.textContent = qualityInput.value;
  });

  function persistSettings() {
    chrome.storage.sync.set({
      format: formatSel.value,
      quality: qualityInput.value,
      filename: filenameInput.value,
      autoDownload: autoDownload.checked
    });
  }

  [formatSel, qualityInput, filenameInput, autoDownload].forEach(el => el.addEventListener('change', persistSettings));

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const currentUrl = tab.url;
    const isRestricted = currentUrl.startsWith('chrome://') || currentUrl.startsWith('https://chrome.google.com');

    if (isRestricted) {
      [captureVisible, captureSelected, captureFull].forEach(b => b.disabled = true);
      const message = document.createElement('p');
      message.textContent = 'This page cannot be captured.';
      document.body.appendChild(message);
      return;
    }

    const getOpts = () => ({
      format: formatSel.value,
      quality: parseFloat(qualityInput.value),
      filename: filenameInput.value || 'screenshot',
      autoDownload: autoDownload.checked
    });

    captureVisible.addEventListener('click', () => {
      const opts = getOpts();
      chrome.runtime.sendMessage({ action: 'captureVisible', tabId: tab.id, options: opts });
      window.close();
    });

    captureSelected.addEventListener('click', () => {
      const opts = getOpts();
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      chrome.runtime.sendMessage({ action: 'prepareOptions', options: opts }); // store for selected area
      window.close();
    });

    captureFull.addEventListener('click', () => {
      const opts = getOpts();
      chrome.runtime.sendMessage({ action: 'captureFullPage', tabId: tab.id, options: opts });
      window.close();
    });
  });
});
