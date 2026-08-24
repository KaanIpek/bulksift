/* Keeps the game playable with no signal. The bundle is small and entirely
   self-contained - no fonts, no audio files, no sprite sheets - so caching
   what has been fetched is enough to run the whole thing offline.

   Assets are content-hashed by the build, so they are cached forever and a
   new build simply asks for new names. The page itself is fetched fresh when
   the network allows, and falls back to the copy on disk when it does not,
   which is what stops a stale shell pinning an old build. */

const CACHE = 'frontline-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  const isDocument = request.mode === 'navigate';
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (isDocument) {
        try {
          const fresh = await fetch(request);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          return (await cache.match(request)) ?? (await cache.match('./index.html')) ?? Response.error();
        }
      }
      const hit = await cache.match(request);
      if (hit) return hit;
      const fresh = await fetch(request);
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })(),
  );
});
