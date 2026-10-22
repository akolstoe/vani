import { h, icon, toast } from '../ui.js';
import { searchCatalog, downloadEpub, TOPICS, LANGUAGES } from '../catalog.js';
import { importBook } from '../library.js';

const state = { search: '', topic: '', language: 'en', page: 1 };

export async function discoverView(root) {
  const results = h('div', { class: 'catalog-grid' });
  const more = h('div', { class: 'row center' });
  const info = h('p', { class: 'muted' });
  let reqId = 0;

  const load = async (append = false) => {
    const my = ++reqId;
    if (!append) { results.replaceChildren(...Array.from({ length: 8 }, () => h('div', { class: 'catalog-card skeleton' }))); info.textContent = ''; }
    more.replaceChildren();
    try {
      const data = await searchCatalog(state);
      if (my !== reqId) return;
      if (!append) results.replaceChildren();
      results.append(...data.books.map(card));
      info.textContent = `${data.count.toLocaleString()} free books${state.search ? ` matching “${state.search}”` : ''}${state.topic ? ` in ${state.topic}` : ''} · from Project Gutenberg`;
      if (!data.books.length && !append) results.replaceChildren(h('div', { class: 'empty' }, h('h3', {}, 'No books found'), h('p', {}, 'Try a different title, author or topic.')));
      if (data.next) more.append(h('button', { class: 'btn ghost', onclick: () => { state.page++; load(true); } }, 'Load more'));
    } catch (e) {
      if (my !== reqId) return;
      results.replaceChildren(h('div', { class: 'empty' }, h('h3', {}, 'Catalog unavailable'),
        h('p', {}, 'Check your connection and try again.'), h('button', { class: 'btn', onclick: () => load() }, 'Retry')));
    }
  };

  let t;
  root.replaceChildren(h('div', { class: 'page' },
    h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Discover'), h('p', { class: 'muted' }, 'Tens of thousands of public-domain books, free to read and listen to.'))),
    h('div', { class: 'toolbar' },
      h('label', { class: 'search' }, icon('search', 18),
        h('input', { type: 'search', placeholder: 'Title or author', value: state.search, oninput: (e) => {
          clearTimeout(t); t = setTimeout(() => { state.search = e.target.value.trim(); state.page = 1; load(); }, 450);
        } })),
      h('select', { 'aria-label': 'Language', onchange: (e) => { state.language = e.target.value; state.page = 1; load(); } },
        LANGUAGES.map(([v, l]) => h('option', { value: v, selected: v === state.language }, l)))),
    h('div', { class: 'chips scroll' },
      [['', 'Popular'], ...TOPICS.map((x) => [x, x])].map(([v, l]) => h('button', {
        class: `chip ${state.topic === v ? 'on' : ''}`,
        onclick: (e) => {
          state.topic = v; state.page = 1;
          e.currentTarget.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === e.currentTarget));
          load();
        },
      }, l))),
    info, results, more));
  load();
}

function card(b) {
  const btn = h('button', { class: 'btn sm', disabled: !b.epub }, icon('plus', 14), b.epub ? 'Add' : 'No EPUB');
  btn.onclick = async () => {
    btn.disabled = true;
    btn.replaceChildren(h('span', { class: 'spinner' }), 'Adding…');
    try {
      const file = await downloadEpub(b, (msg) => btn.replaceChildren(h('span', { class: 'spinner' }), msg));
      const { book, duplicate } = await importBook(file, 'gutenberg');
      btn.replaceChildren(icon('book', 14), 'Open');
      btn.disabled = false;
      btn.onclick = () => { location.hash = `#/read/${book.id}`; };
      toast(duplicate ? 'Already in your library.' : `Added “${b.title}”.`, { action: 'Read now', onAction: () => { location.hash = `#/read/${book.id}`; } });
    } catch (e) {
      btn.disabled = false;
      btn.replaceChildren(icon('plus', 14), 'Add');
      if (e.blocked) {
        toast('Couldn’t reach Gutenberg right now. Try again in a moment.', {
          duration: 9000, action: 'Open on Gutenberg',
          onAction: () => window.open(`https://www.gutenberg.org/ebooks/${b.gid}`, '_blank', 'noopener'),
        });
      } else toast(`Couldn't add this book: ${e.message}`);
    }
  };
  return h('article', { class: 'catalog-card' },
    b.cover ? h('img', { class: 'cover md', src: b.cover, alt: '', loading: 'lazy' }) : h('div', { class: 'cover md generated', style: { '--hue': b.gid % 360 } }, h('span', { class: 'gen-title' }, b.title)),
    h('div', { class: 'catalog-info' },
      h('strong', { class: 'book-title' }, b.title),
      h('span', { class: 'book-author' }, b.author),
      h('span', { class: 'muted small' }, `${b.downloads.toLocaleString()} downloads`),
      btn));
}
