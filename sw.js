// Minimal offline cache so the app still opens (and keeps working) once
// it's been installed to a phone's home screen without a network connection.
// Network-first: always try to get the latest deploy when online, and only
// fall back to whatever's cached if the network fails. A cache-first
// strategy here would mean every fix shipped keeps getting masked by a
// stale cached copy on devices that already installed the app.
const CACHE = 'shape-trees-v6';
const ASSETS = [
  './', './index.html', './style.css',
  './data.js', './shapes.js', './editor.js', './app.js',
  './manifest.json', './icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        caches.open(CACHE).then((cache) => cache.put(event.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
