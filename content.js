let startX, startY, endX, endY;
let isSelecting = false;
let selectionBox = null;

document.body.style.cursor = 'crosshair';

function handleMouseDown(e) {
  isSelecting = true;
  startX = e.clientX;
  startY = e.clientY;

  selectionBox = document.createElement('div');
  selectionBox.style.position = 'fixed';
  selectionBox.style.border = '2px dashed #000';
  selectionBox.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
  selectionBox.style.zIndex = '999999';
  selectionBox.style.left = startX + 'px';
  selectionBox.style.top = startY + 'px';

  document.body.appendChild(selectionBox);

  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}

function handleMouseMove(e) {
  if (!isSelecting) return;

  endX = e.clientX;
  endY = e.clientY;

  selectionBox.style.width = Math.abs(endX - startX) + 'px';
  selectionBox.style.height = Math.abs(endY - startY) + 'px';
  selectionBox.style.left = (endX > startX ? startX : endX) + 'px';
  selectionBox.style.top = (endY > startY ? startY : endY) + 'px';
}

function handleMouseUp(e) {
  isSelecting = false;
  document.body.style.cursor = 'default';

  const rect = {
    x: parseInt(selectionBox.style.left),
    y: parseInt(selectionBox.style.top),
    width: parseInt(selectionBox.style.width),
    height: parseInt(selectionBox.style.height)
  };

  chrome.runtime.sendMessage({ action: 'captureSelectedArea', rect: rect });

  document.body.removeChild(selectionBox);

  document.removeEventListener('mousedown', handleMouseDown);
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);
}

document.addEventListener('mousedown', handleMouseDown);
