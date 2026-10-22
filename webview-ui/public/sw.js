// Pixel Office service worker: makes the office installable as an app and
// caches the static shell. Registered as sw.js?v=<app version> (src/pwa.ts),
// so every release installs a new worker with its own cache.
//
// - /ws and /api/* are never touched (network only); office data arrives
//   over the WebSocket and is never cached.
// - Pages: network first, cache only as an offline fallback — after an
//   in-app update the new server's shell (and its new sw.js?v=) loads at once.
// - Other same-origin GETs (hashed bundles, icons, fonts, sprites):
//   cache first, filled on use.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `pixel-office-${VERSION}`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('pixel-office-') && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function put(request, response) {
  if (response.ok && response.type === 'basic') {
    const copy = response.clone();
    void caches.open(CACHE).then((c) => c.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  const rel = req.url.slice(self.registration.scope.length).split(/[?#]/)[0];
  if (rel === 'ws' || rel.startsWith('api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => put(self.registration.scope, res))
        .catch(() => caches.match(self.registration.scope).then((r) => r || Response.error())),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res))),
  );
});
