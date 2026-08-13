/**
 * Offline support.
 *
 * Recognition is already local - the whole point of the 1.9 MB on-device index -
 * so the only thing standing between this app and working with no connection is
 * the cache. That matters where it gets used: card shows and shop back rooms
 * have famously bad wifi, and a scanner that stops working there is no scanner.
 *
 * The data files are versioned with the cache name, so a new build fetches a
 * fresh index rather than serving a stale one against new card metadata - a
 * mismatch the Scanner refuses to start with.
 */

// Registered as /sw.js?v=<build id>, so a new build is a new service worker
// with a new cache; the activate handler then deletes every older one.
const CACHE = `bulksift-${new URL(self.location.href).searchParams.get('v') || 'dev'}`;
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];
const DATA = ['/data/index.bin', '/data/cards.json', '/data/prices.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Core first so the shell is usable quickly; data is large and can lag.
      await cache.addAll(CORE);
      await Promise.allSettled(DATA.map((u) => cache.add(u)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // All of /data is network-first, not just prices.
  //
  // index.bin and cards.json are only immutable *relative to each other*, and
  // they can be rebuilt without the app version changing. Serving a cached
  // index against freshly fetched card metadata is exactly the mismatch the
  // Scanner refuses to start with - which is the right failure, but the user
  // sees a dead app. Going to the network first and keeping the cache purely as
  // the offline fallback means online users always get a consistent set, and
  // offline users still get a working scanner.
  const networkFirst = url.pathname.startsWith('/data/');

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (networkFirst) {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) {
            await cache.put(request, fresh.clone());
            return fresh;
          }
        } catch {
          // fall through to the cached copy
        }
      }
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(request);
        if (res.ok && (url.pathname.startsWith('/data/') || url.pathname.startsWith('/assets/'))) {
          await cache.put(request, res.clone());
        }
        return res;
      } catch (err) {
        const shell = await cache.match('/index.html');
        if (request.mode === 'navigate' && shell) return shell;
        throw err;
      }
    })(),
  );
});
