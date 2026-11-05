/* PalmBudget Enterprise — Service Worker (offline-first) v1.0.0 */
const VERSION = '1.0.8-2026.11.05';
const SHELL_CACHE = 'pbe-shell-' + VERSION;
const LIB_CACHE = 'pbe-lib-v1';
const TILE_CACHE = 'pbe-tiles-v1';
const TILE_MAX = 6000;
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const U = 'https://unpkg.com/';
const LIBS = [
  U + 'leaflet@1.9.4/dist/leaflet.css', U + 'leaflet@1.9.4/dist/leaflet.js',
  U + 'chart.js@4.4.1/dist/chart.umd.js', U + 'pmtiles@3.2.1/dist/pmtiles.js',
  U + 'shpjs@4.0.4/dist/shp.min.js', U + '@tmcw/togeojson@5.8.1/dist/togeojson.umd.js',
  U + 'georaster@1.6.0/dist/georaster.browser.bundle.min.js', U + 'georaster-layer-for-leaflet@3.10.0/dist/georaster-layer-for-leaflet.min.js',
  U + 'pdfjs-dist@3.11.174/build/pdf.min.js', U + 'pdfjs-dist@3.11.174/build/pdf.worker.min.js',
  U + 'jspdf@2.5.1/dist/jspdf.umd.min.js',
  U + 'leaflet@1.9.4/dist/images/marker-icon.png', U + 'leaflet@1.9.4/dist/images/marker-shadow.png'
];
const TILE_HOSTS = ['server.arcgisonline.com', 'tile.openstreetmap.org', 'services.arcgisonline.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const sc = await caches.open(SHELL_CACHE);
    await sc.addAll(SHELL);
    // pustaka di-cache satu per satu agar instalasi tidak gagal bila satu CDN lambat
    const lc = await caches.open(LIB_CACHE);
    await Promise.all(LIBS.map(async u => { try { if (!(await lc.match(u))) { const r = await fetch(u, { mode: 'cors' }); if (r.ok) await lc.put(u, r); } } catch (err) {} }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = [SHELL_CACHE, LIB_CACHE, TILE_CACHE];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

let trimming = false;
async function trimTiles() {
  if (trimming) return; trimming = true;
  try { const c = await caches.open(TILE_CACHE); const keys = await c.keys(); if (keys.length > TILE_MAX) for (const k of keys.slice(0, keys.length - TILE_MAX)) await c.delete(k); } finally { trimming = false; }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                              // API POST → selalu jaringan
  const url = new URL(req.url);
  if (/script\.google(usercontent)?\.com$/.test(url.hostname)) return;  // API Apps Script tidak di-cache
  if (req.headers.has('range')) return;                          // PMTiles online (HTTP Range) langsung ke jaringan

  // Navigasi: network-first, fallback ke shell
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try { const r = await fetch(req); const c = await caches.open(SHELL_CACHE); c.put('./index.html', r.clone()); return r; }
      catch (err) { return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error(); }
    })());
    return;
  }
  // Pustaka CDN: cache-first
  if (url.hostname === 'unpkg.com' || url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith((async () => {
      const c = await caches.open(LIB_CACHE); const hit = await c.match(req.url);
      if (hit) return hit;
      const r = await fetch(req); if (r.ok) c.put(req.url, r.clone()); return r;
    })());
    return;
  }
  // Ubin basemap: cache-first (area yang pernah dilihat tersedia offline)
  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(TILE_CACHE); const hit = await c.match(req.url);
      if (hit) return hit;
      try { const r = await fetch(req); if (r.ok) { c.put(req.url, r.clone()); trimTiles(); } return r; }
      catch (err) { return new Response('', { status: 504 }); }
    })());
    return;
  }
  // Aset lain se-origin: stale-while-revalidate
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(SHELL_CACHE); const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
  }
});
