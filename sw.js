// Офлайн-робота читалки: усі файли програми зберігаються в телефоні.
const VERSION = 'chytalka-app-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'connectors.js', 'connectors-uk.js', 'offline-tr.js',
  'lib/pdf.min.js', 'lib/pdf.worker.min.js',
  'bergamot/translator.js', 'bergamot/worker/translator-worker.js',
  'bergamot/worker/bergamot-translator-worker.js', 'bergamot/worker/bergamot-translator-worker.wasm',
  'models/models.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('chytalka-app-') && k !== VERSION).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // переклад через Інтернет — завжди напряму
  if (/translate\.googleapis\.com|mymemory/.test(url.host)) return;
  const isFont = /fonts\.(googleapis|gstatic)\.com/.test(url.host);
  if (url.origin !== location.origin && !isFont) return;

  const heavy = /\/models\/|\.wasm$|pdf\.worker|bergamot-translator-worker\.js|fonts\.gstatic/.test(url.href);
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await caches.match(req, { ignoreSearch: true });
    // Великі файли (моделі, рушій, шрифти) — з телефону
    if (heavy && hit) return hit;
    // Решта: з Інтернету (щоб отримувати оновлення), а без нього — з телефону
    const net = fetch(req).then(r => {
      if (r && (r.ok || r.type === 'opaque') && !url.pathname.includes('/models/')) cache.put(req, r.clone());
      return r;
    }).catch(() => null);
    const r = hit ? await Promise.race([net, new Promise(ok => setTimeout(() => ok(null), 3000))]) : await net;
    if (r) return r;
    if (hit) return hit;
    if (req.mode === 'navigate') return (await caches.match('index.html')) || Response.error();
    return Response.error();
  })());
});
