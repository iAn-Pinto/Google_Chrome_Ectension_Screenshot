document.addEventListener('DOMContentLoaded', async () => {
  const captureVisible = document.getElementById('captureVisible');
  const captureSelected = document.getElementById('captureSelected');
  const captureFull = document.getElementById('captureFull');
  const formatSel = document.getElementById('format');
  const qualityInput = document.getElementById('quality');
  const qualityVal = document.getElementById('qualityVal');
  const filenameInput = document.getElementById('filename');
  const autoDownload = document.getElementById('autoDownload');
  const addTimestamp = document.getElementById('addTimestamp');
  const retryAttemptsInput = document.getElementById('retryAttempts');
  const retryDelayInput = document.getElementById('retryDelay');
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  const progressLabel = document.getElementById('progressLabel');

  // Load persisted settings
  chrome.storage.sync.get(['format','quality','filename','autoDownload','addTimestamp','retryAttempts','retryDelay'], (data) => {
    if (data.format) formatSel.value = data.format;
    if (data.quality) { qualityInput.value = data.quality; qualityVal.textContent = data.quality; }
    if (data.filename) filenameInput.value = data.filename;
    if (typeof data.autoDownload === 'boolean') autoDownload.checked = data.autoDownload;
    if (typeof data.addTimestamp === 'boolean') addTimestamp.checked = data.addTimestamp;
    if (typeof data.retryAttempts === 'number') retryAttemptsInput.value = data.retryAttempts;
    if (typeof data.retryDelay === 'number') retryDelayInput.value = data.retryDelay;
  });

  qualityInput.addEventListener('input', () => {
    qualityVal.textContent = qualityInput.value;
  });

  function persistSettings() {
    chrome.storage.sync.set({
      format: formatSel.value,
      quality: qualityInput.value,
      filename: filenameInput.value,
      autoDownload: autoDownload.checked,
      addTimestamp: addTimestamp.checked,
      retryAttempts: parseInt(retryAttemptsInput.value, 10),
      retryDelay: parseInt(retryDelayInput.value, 10)
    });
  }

  [formatSel, qualityInput, filenameInput, autoDownload, addTimestamp, retryAttemptsInput, retryDelayInput].forEach(el => el.addEventListener('change', persistSettings));

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
      autoDownload: autoDownload.checked,
      addTimestamp: addTimestamp.checked,
      retryAttempts: parseInt(retryAttemptsInput.value, 10) || 3,
      retryDelay: parseInt(retryDelayInput.value, 10) || 180
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
      // Show progress UI (will be updated by messages)
      progressContainer.style.display = 'block';
      progressBar.style.width = '0%';
      progressLabel.textContent = 'Starting full page capture...';
      chrome.runtime.sendMessage({ action: 'captureFullPage', tabId: tab.id, options: opts });
      window.close();
    });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'fullPageProgress' && progressContainer) {
      progressContainer.style.display = 'block';
      const percent = Math.min(100, Math.round((msg.current / msg.total) * 100));
      progressBar.style.width = percent + '%';
      progressLabel.textContent = `Capturing ${msg.current}/${msg.total} (${percent}%)`;
      if (msg.current >= msg.total) {
        progressLabel.textContent = 'Finalizing...';
      }
    }
  });
});
