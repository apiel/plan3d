// Service worker: lets the installed app open without a network. Pages come
// from the network when it is there (so a new deploy shows at once), else from
// the cache; built assets have a hash in their name and never change, so the
// cache serves them first. Other sites (Google sign-in, Drive) are left alone.
const CACHE = 'plan3d-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './manifest.webmanifest', './icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// the page sends what it loaded before this worker was in charge, to be kept too
self.addEventListener('message', (e) => {
  if (Array.isArray(e.data?.cache)) e.waitUntil(caches.open(CACHE).then((c) => Promise.all(e.data.cache.map((u) => c.add(u).catch(() => {})))));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const keep = (res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  };
  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then(keep)));
    return;
  }
  e.respondWith(
    fetch(req)
      .then(keep)
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit ?? caches.match('./')))
  );
});
