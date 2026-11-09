// Cortex requires a live backend. Pass requests through without caching API
// responses or dashboards so the installed app always reflects current state.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});
