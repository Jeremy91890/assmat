/* Service worker : l'application fonctionne entièrement hors ligne.
   Aucune donnée n'est envoyée sur le réseau — le cache ne sert qu'aux fichiers de l'app. */

const VERSION = 'assmat-v2';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/calc.js',
  './js/store.js',
  './js/app.js',
  './manifest.webmanifest',
  './fonts/quicksand-latin.woff2',
  './fonts/nunito-sans-latin.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  // `cache: 'reload'` force le passage par le réseau : sans cela, une mise à jour
  // pourrait réinstaller les fichiers périmés encore présents dans le cache HTTP.
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Navigations : réseau d'abord (pour récupérer une mise à jour), repli sur le cache.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Ressources : cache d'abord, puis réseau (et mise en cache au passage).
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
