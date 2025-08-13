(() => {
  let startX, startY, endX, endY;
  let isSelecting = false;
  let selectionBox = null;
  let overlay = null;

  function initOverlay() {
    overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.cursor = 'crosshair';
    overlay.style.zIndex = '2147483647';
    overlay.style.background = 'rgba(0,0,0,0.05)';
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown, true);
  }

  function cleanup() {
    if (selectionBox && selectionBox.parentNode) selectionBox.parentNode.removeChild(selectionBox);
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('mouseup', handleMouseUp, true);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      cleanup();
      chrome.runtime.sendMessage({ action: 'selectionCanceled' });
    }
  }

  function handleMouseDown(e) {
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;
    selectionBox = document.createElement('div');
    Object.assign(selectionBox.style, {
      position: 'fixed',
      border: '2px solid #4A90E2',
      background: 'rgba(74,144,226,0.25)',
      boxShadow: '0 0 0 9999px rgba(0,0,0,0.15)',
      zIndex: '2147483647',
      left: startX + 'px',
      top: startY + 'px'
    });
    document.body.appendChild(selectionBox);
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('mouseup', handleMouseUp, true);
    e.preventDefault();
  }

  function handleMouseMove(e) {
    if (!isSelecting) return;
    endX = e.clientX;
    endY = e.clientY;
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    Object.assign(selectionBox.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' });
  }

  function handleMouseUp() {
    isSelecting = false;
    const rect = {
      x: parseInt(selectionBox.style.left),
      y: parseInt(selectionBox.style.top),
      width: parseInt(selectionBox.style.width),
      height: parseInt(selectionBox.style.height)
    };
    cleanup();
    chrome.runtime.sendMessage({ action: 'captureSelectedArea', rect });
  }

  initOverlay();
})();
