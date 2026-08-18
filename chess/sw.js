/* Service worker Шахмат Dark Side.
   Держит оболочку игры в кэше, чтобы приложение открывалось без интернета.
   Запросы к /api/ (комнаты для онлайн-игры) всегда идут в сеть. */

// Версию поднимать при любом изменении списка оболочки, иначе установленное
// приложение продолжит открываться из старого кэша
const CACHE = 'dark-side-chess-v4';

// Оболочка приложения: без этих файлов игра не запустится
const SHELL = [
  './',
  './index.html',
  './style.css',
  './engine.js',
  './ai.js',
  './net.js',
  './sound.js',
  './app.js',
  './credits.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Поодиночке: один недоступный файл не должен рушить всю установку
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => (name === CACHE ? null : caches.delete(name))));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return;   // комнаты — только живая сеть

  // Переходы по страницам: свежая версия, если сеть есть; иначе — из кэша
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (err) {
        const cached = await caches.match('./index.html', { ignoreSearch: true });
        return cached || Response.error();
      }
    })());
    return;
  }

  // Остальное: отдаём из кэша сразу, параллельно обновляя его
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    const network = fetch(request).then((response) => {
      if (response && response.ok && response.type === 'basic') {
        caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
      }
      return response;
    }).catch(() => null);

    return cached || (await network) || Response.error();
  })());
});
