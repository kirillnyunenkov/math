/* Тренажёр ЕГЭ — service worker.
   При выкладке новой версии сайта поднимай VERSION (любое изменение этого файла
   заставит браузер установить новый SW и удалить старый кеш). HTML грузится
   network-first, поэтому онлайн-пользователи всегда получают свежую версию. */
const VERSION = 'v99';
const CACHE = 'ege-' + VERSION;
const SHELL = ['./', './index.html', './sync-core.js', './config.js', './stats-core.js', './exam-core.js', './exam-panel-core.js', './exam-validate.js', './exam-client-core.js', './exam-history-core.js', './exam-my-view.js', './exam.js', './teacher.html', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png',
  './logo.svg', './favicon.ico', './favicon-32.png',
  './katex/katex.min.css', './katex/katex.min.js', './katex/auto-render.min.js',
  // шрифты теперь свои: без них офлайн-приложение подменяло типографику системной
  './fonts/golos-text-cyrillic.woff2', './fonts/golos-text-latin.woff2',
  './fonts/literata-cyrillic.woff2', './fonts/literata-latin.woff2'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // сторонние (шрифты и т.п.) — как есть

  // HTML/навигация — свежая версия когда онлайн, кеш когда офлайн.
  // У каждой страницы своя запись: иначе открытая однажды панель учителя
  // (teacher.html) подменила бы собой тренажёр в офлайне.
  if (req.mode === 'navigate') {
    const page = url.pathname.endsWith('/teacher.html') ? './teacher.html' : './index.html';
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(CACHE);
        if (net.ok) c.put(page, net.clone());
        return net;
      } catch (err) {
        const c = await caches.open(CACHE);
        return (await c.match(page)) || (page === './index.html' && await c.match('./')) || Response.error();
      }
    })());
    return;
  }

  // остальное (data.js, иконки) — отдаём из кеша сразу, обновляем в фоне
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const cached = await c.match(req);
    const net = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
    return cached || (await net) || Response.error();
  })());
});
