// Offline + speed: serve the app from cache instantly, refresh the cache in the background.
// Books and notes live in IndexedDB, not here.
const VERSION = 'vani-v9';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/ui.js', 'js/db.js', 'js/zip.js', 'js/epub.js', 'js/reader.js', 'js/notes.js',
  'js/library.js', 'js/catalog.js', 'js/settings.js',
  'js/tts/narrator.js', 'js/tts/webspeech.js', 'js/tts/kokoro.js', 'js/tts/kokoro-worker.js', 'js/tts/piper.js', 'js/tts/piper-worker.js', 'js/tts/server.js', 'js/tts/audio.js',
  'js/views/library.js', 'js/views/reader.js', 'js/views/notes.js', 'js/views/discover.js',
  'js/views/voices.js', 'js/views/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === location.origin;
  const cacheable = sameOrigin || /fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.host);
  if (!cacheable) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const hit = await cache.match(e.request, { ignoreSearch: sameOrigin });
    const refresh = fetch(e.request).then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(refresh); return hit; }
    return (await refresh) || (sameOrigin ? cache.match('index.html') : Response.error());
  }));
});
