const { ipcRenderer } = require('electron');

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (!link) return;
  let url;
  try {
    url = new URL(link.href, location.href);
  } catch {
    return;
  }
  if (['javascript:', 'data:', 'vbscript:'].includes(url.protocol)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (url.origin === location.origin || !['http:', 'https:'].includes(url.protocol)) return;
  event.preventDefault();
  event.stopPropagation();
  ipcRenderer.send('open-external', url.href);
}, true);
