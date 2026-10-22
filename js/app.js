import { h, icon, toast } from './ui.js';
import { settings } from './settings.js';
import { libraryView } from './views/library.js';
import { readerView } from './views/reader.js';
import { notesView } from './views/notes.js';
import { discoverView } from './views/discover.js';
import { voicesView } from './views/voices.js';
import { settingsView } from './views/settings.js';

const ROUTES = [
  { re: /^\/?$/, view: libraryView, nav: 'library' },
  { re: /^\/read\/([^/]+)$/, view: readerView, nav: 'library' },
  { re: /^\/discover$/, view: discoverView, nav: 'discover' },
  { re: /^\/notes(?:\/([^/]+))?$/, view: notesView, nav: 'notes' },
  { re: /^\/voices$/, view: voicesView, nav: 'voices' },
  { re: /^\/settings$/, view: settingsView, nav: 'settings' },
];

const NAV = [
  ['library', '#/', 'book', 'Library'],
  ['discover', '#/discover', 'compass', 'Discover'],
  ['notes', '#/notes', 'note', 'Notes'],
  ['voices', '#/voices', 'mic', 'Voices'],
  ['settings', '#/settings', 'gear', 'Settings'],
];

const main = h('main', { id: 'view' });
const nav = h('nav', { class: 'rail', 'aria-label': 'Main' },
  h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark' }, 'वा'), h('span', { class: 'brand-name' }, 'Vani')),
  NAV.map(([key, href, ic, label]) => h('a', { class: 'nav-item', href, 'data-nav': key }, icon(ic, 22), h('span', {}, label))));

let cleanup = null;
let navToken = 0;

async function route() {
  const token = ++navToken;
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const match = ROUTES.map((r) => ({ r, m: path.match(r.re) })).find((x) => x.m) || { r: ROUTES[0], m: [] };
  try { await cleanup?.(); } catch {}
  cleanup = null;
  nav.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.nav === match.r.nav));
  try {
    const c = await match.r.view(main, { id: match.m[1] ? decodeURIComponent(match.m[1]) : null, params });
    if (token !== navToken) { c?.(); return; }
    cleanup = c || null;
  } catch (e) {
    console.error(e);
    main.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'empty' },
      h('h3', {}, 'Something went wrong'), h('p', { class: 'muted' }, e.message), h('a', { class: 'btn', href: '#/' }, 'Back to library'))));
  }
  if (!path.startsWith('/read')) main.scrollTop = 0;
}

const FONTS = {
  literata: '"Literata", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif',
  sans: '"Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  dyslexic: '"Atkinson Hyperlegible", Verdana, Tahoma, sans-serif',
};

function applyAppearance(s) {
  const r = document.documentElement;
  r.dataset.theme = s.theme;
  r.style.setProperty('--read-font', FONTS[s.fontFamily] || FONTS.literata);
  r.style.setProperty('--read-size', `${s.fontSize}px`);
  r.style.setProperty('--read-leading', s.lineHeight);
  r.style.setProperty('--read-measure', `${s.measure}em`);
  r.style.setProperty('--read-align', s.justify ? 'justify' : 'start');
  r.style.setProperty('--read-letter', s.fontFamily === 'dyslexic' ? '0.02em' : '0');
  const dark = s.theme === 'night' || (s.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#16140f' : s.theme === 'sepia' ? '#f1e6d0' : '#f7f3ea');
}

async function start() {
  await settings.load();
  applyAppearance(settings.get());
  settings.subscribe(applyAppearance);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyAppearance(settings.get()));
  document.getElementById('app').replaceChildren(nav, main);
  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version of Vani is ready.', { action: 'Reload', onAction: () => location.reload(), duration: 10000 });
          }
        });
      });
    }).catch(() => {});
  }

  // Files shared/opened via the installed app (File Handling API)
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files?.length) return;
      const { importFiles } = await import('./views/library.js');
      const files = await Promise.all(params.files.map((f) => f.getFile()));
      if (await importFiles(files)) { location.hash = '#/'; route(); }
    });
  }
}

start();
