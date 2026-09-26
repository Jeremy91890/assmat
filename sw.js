/* Service worker : l'application fonctionne entièrement hors ligne.
   Les données saisies ne sont jamais envoyées sur le réseau — le cache ne sert qu'aux
   fichiers de l'app. La mesure d'audience (GoatCounter, autre origine) n'est pas interceptée. */

const VERSION = 'pay-assmat-v22';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/analytics.js',
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

/**
 * Réseau d'abord, cache en secours : une nouvelle version déployée est servie dès
 * qu'elle est en ligne, sans dépendre d'un changement de VERSION. `cache: 'no-cache'`
 * revalide auprès du serveur (ETag) au lieu de reprendre une copie du cache HTTP.
 * Au-delà de 4 s sans réponse (réseau très lent), on sert la copie locale.
 */
function reseauDabord(req, repli = null) {
  const reseau = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(req, copy));
    }
    return res;
  });
  const secours = () => caches.match(req, { ignoreSearch: true })
    .then(hit => hit || (repli && caches.match(repli)))
    .then(hit => hit || reseau);
  const delai = new Promise(r => setTimeout(r, 4000)).then(secours);
  return Promise.race([reseau.catch(secours), delai]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Chaque page est mise en cache sous sa propre adresse ; hors ligne, une page jamais
  // visitée retombe sur l'application.
  e.respondWith(reseauDabord(req, req.mode === 'navigate' ? './index.html' : null));
});
