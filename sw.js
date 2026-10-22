// Offline support: cache the app shell; network-first for the shell so updates arrive,
// cache-first for fonts. Books and notes live in IndexedDB, not here.
const VERSION = 'vani-v4';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/ui.js', 'js/db.js', 'js/zip.js', 'js/epub.js', 'js/reader.js', 'js/notes.js',
  'js/library.js', 'js/catalog.js', 'js/settings.js',
  'js/tts/narrator.js', 'js/tts/webspeech.js', 'js/tts/kokoro.js', 'js/tts/server.js', 'js/tts/audio.js',
  'js/views/library.js', 'js/views/reader.js', 'js/views/notes.js', 'js/views/discover.js',
  'js/views/voices.js', 'js/views/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
  } else if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.host)) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    })));
  }
});
