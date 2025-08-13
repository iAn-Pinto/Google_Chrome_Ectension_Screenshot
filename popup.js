document.addEventListener('DOMContentLoaded', function() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    const currentUrl = tabs[0].url;
    const isRestricted = currentUrl.startsWith('chrome://') || currentUrl.startsWith('https://chrome.google.com');

    const captureVisible = document.getElementById('captureVisible');
    const captureSelected = document.getElementById('captureSelected');
    const captureFull = document.getElementById('captureFull');

    if (isRestricted) {
      captureVisible.disabled = true;
      captureSelected.disabled = true;
      captureFull.disabled = true;

      const message = document.createElement('p');
      message.textContent = 'This page cannot be captured.';
      document.body.appendChild(message);
    } else {
      captureVisible.addEventListener('click', function() {
        chrome.tabs.captureVisibleTab(null, { format: 'png' }, function(dataUrl) {
          chrome.tabs.create({ url: dataUrl });
        });
      });

      captureSelected.addEventListener('click', function() {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['content.js']
        });
        window.close();
      });

      captureFull.addEventListener('click', function() {
        chrome.runtime.sendMessage({ action: 'captureFullPage', tabId: tabs[0].id });
        window.close();
      });
    }
  });
});
