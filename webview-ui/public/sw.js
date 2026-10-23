// Pixel Office service worker: makes the office installable as an app and
// caches the static shell. Registered as sw.js?v=<app version> (src/pwa.ts),
// so every release installs a new worker with its own cache.
//
// - /ws and /api/* are never touched (network only); office data arrives
//   over the WebSocket and is never cached.
// - Install: precaches the page and the files it links (precacheShell).
// - Pages: network first, cache only as an offline fallback — after an
//   in-app update the new server's shell (and its new sw.js?v=) loads at once.
// - Other same-origin GETs (hashed bundles, icons, fonts, sprites):
//   cache first, filled on use.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `pixel-office-${VERSION}`;

// Precache the shell (the page + every same-origin file it links: bundles, CSS, manifest,
// icons), so the "server is off" panel (src/lan/ServerPanel.tsx) renders offline even when
// the server stops right after the first visit — the page that registered this worker
// loaded its files before the worker could see them.
async function precacheShell() {
  const scope = self.registration.scope;
  const res = await fetch(scope, { cache: 'no-store' });
  if (!res.ok) return;
  const html = await res.clone().text();
  const cache = await caches.open(CACHE);
  await cache.put(scope, res);
  const urls = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
    .map((m) => new URL(m[1], scope).href)
    .filter((u) => u.startsWith(scope));
  await Promise.all([...new Set(urls)].map((u) => cache.add(u).catch(() => {})));
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precacheShell().catch(() => {}));
});

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
