(() => {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(error => {
        console.warn('[Cortex PWA] No se pudo registrar el service worker:', error);
      });
    }, { once: true });
  }
})();
