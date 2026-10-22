const CACHE = 'wordverse-shell-v1';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const page = await fetch(self.registration.scope);
    if (!page.ok) return;
    const html = await page.text();
    await cache.put(self.registration.scope, new Response(html, { headers: { 'Content-Type': 'text/html' } }));
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map(match => new URL(match[1], self.registration.scope))
      .filter(url => url.origin === self.location.origin && /\.(?:js|css)$/.test(url.pathname));
    await Promise.all(assets.map(url => cache.add(url.href)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('wordverse-shell-') && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(async response => {
      if (response.ok) (await caches.open(CACHE)).put(self.registration.scope, response.clone());
      return response;
    }).catch(async () => (await caches.open(CACHE)).match(self.registration.scope)));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(async response => {
    if (response.ok && /\.(?:js|css)$/.test(new URL(request.url).pathname)) (await caches.open(CACHE)).put(request, response.clone());
    return response;
  })));
});
