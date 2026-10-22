import { h, icon, iconButton, toast, coverEl, timeAgo, confirmDialog, sheet } from '../ui.js';
import { listBooks, importBook, deleteBook } from '../library.js';
import { settings } from '../settings.js';

let sortBy = 'recent';
let query = '';

export async function importFiles(files) {
  let added = 0;
  for (const f of files) {
    try {
      const { duplicate } = await importBook(f);
      if (duplicate) toast(`“${f.name}” is already in your library.`);
      else added++;
    } catch (e) {
      toast(`Couldn't import ${f.name}: ${e.message}`, { duration: 6000 });
    }
  }
  if (added) toast(added === 1 ? 'Book added to your library.' : `${added} books added.`);
  return added;
}

export function pickFiles() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: '.epub,application/epub+zip', multiple: true, style: { display: 'none' } });
    input.onchange = () => { resolve([...input.files]); input.remove(); };
    document.body.append(input);
    input.click();
  });
}

export async function libraryView(root) {
  const grid = h('div', { class: 'book-grid' });
  const continueEl = h('section', { class: 'continue' });

  const render = async () => {
    let books = await listBooks();
    const recent = books.filter((b) => b.lastOpened).sort((a, b) => b.lastOpened - a.lastOpened)[0];
    continueEl.replaceChildren();
    if (recent && !query) {
      continueEl.append(h('a', { class: 'continue-card', href: `#/read/${recent.id}` },
        coverEl(recent, 'sm'),
        h('div', { class: 'continue-text' },
          h('span', { class: 'eyebrow' }, 'Continue'),
          h('strong', {}, recent.title),
          h('span', { class: 'muted' }, recent.author),
          h('div', { class: 'progress' }, h('span', { style: { width: `${Math.round(recent.progress.percent * 100)}%` } }))),
        h('span', { class: 'play-pill' }, icon('headphones', 18), 'Listen')));
    }
    if (query) {
      const q = query.toLowerCase();
      books = books.filter((b) => (b.title + ' ' + b.author).toLowerCase().includes(q));
    }
    const sorters = {
      recent: (a, b) => (b.lastOpened || b.added) - (a.lastOpened || a.added),
      title: (a, b) => a.title.localeCompare(b.title),
      author: (a, b) => a.author.localeCompare(b.author),
      progress: (a, b) => b.progress.percent - a.progress.percent,
    };
    books.sort(sorters[sortBy]);
    grid.replaceChildren(...books.map((b) => h('article', { class: 'book-card' },
      h('a', { href: `#/read/${b.id}`, class: 'book-link', 'aria-label': `Open ${b.title}` },
        coverEl(b),
        b.progress.percent > 0 ? h('div', { class: 'progress' }, h('span', { style: { width: `${Math.max(2, Math.round(b.progress.percent * 100))}%` } })) : null,
        h('strong', { class: 'book-title' }, b.title),
        h('span', { class: 'book-author' }, b.author)),
      iconButton('more', `Options for ${b.title}`, () => bookMenu(b, render), { class: 'card-menu' }))));
    if (!books.length) {
      grid.replaceChildren(h('div', { class: 'empty' },
        h('div', { class: 'empty-art' }, icon('book', 40)),
        h('h3', {}, query ? 'No matches' : 'Your shelf is empty'),
        h('p', {}, query ? 'Try another title or author.' : 'Import EPUB files you own, or find thousands of free classics in Discover.'),
        query ? null : h('div', { class: 'row center' },
          h('button', { class: 'btn', onclick: async () => { if (await importFiles(await pickFiles())) render(); } }, icon('upload', 18), 'Import EPUB'),
          h('a', { class: 'btn ghost', href: '#/discover' }, icon('compass', 18), 'Discover books'))));
    }
  };

  const drop = h('div', { class: 'drop-hint' }, icon('upload', 32), h('span', {}, 'Drop EPUB files to add them'));
  root.replaceChildren(h('div', { class: 'page' },
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Library'), h('p', { class: 'muted' }, 'Your books, read aloud in any voice.')),
      h('button', { class: 'btn', onclick: async () => { if (await importFiles(await pickFiles())) render(); } }, icon('upload', 18), h('span', {}, 'Import'))),
    continueEl,
    h('div', { class: 'toolbar' },
      h('label', { class: 'search' }, icon('search', 18),
        h('input', { type: 'search', placeholder: 'Search your library', value: query, oninput: (e) => { query = e.target.value; render(); } })),
      h('select', { 'aria-label': 'Sort', onchange: (e) => { sortBy = e.target.value; render(); } },
        [['recent', 'Recent'], ['title', 'Title'], ['author', 'Author'], ['progress', 'Progress']]
          .map(([v, l]) => h('option', { value: v, selected: v === sortBy }, l)))),
    grid, drop));

  const page = root.firstChild;
  page.addEventListener('dragover', (e) => { e.preventDefault(); page.classList.add('dragging'); });
  page.addEventListener('dragleave', (e) => { if (!page.contains(e.relatedTarget)) page.classList.remove('dragging'); });
  page.addEventListener('drop', async (e) => {
    e.preventDefault();
    page.classList.remove('dragging');
    if (await importFiles([...e.dataTransfer.files])) render();
  });
  await render();
}

function bookMenu(b, refresh) {
  const s = sheet(b.title, h('div', { class: 'stack' },
    h('p', { class: 'muted' }, `${b.author} · ${b.chapters} sections · ${(b.size / 1048576).toFixed(1)} MB · last read ${timeAgo(b.lastOpened)}`),
    b.description ? h('p', { class: 'desc' }, b.description.slice(0, 600)) : null,
    h('div', { class: 'menu-list' },
      h('a', { class: 'menu-item', href: `#/read/${b.id}`, onclick: () => s.close() }, icon('book'), 'Open'),
      h('a', { class: 'menu-item', href: `#/notes?book=${b.id}`, onclick: () => s.close() }, icon('note'), 'Notes & highlights'),
      h('button', { class: 'menu-item', onclick: () => {
        const url = URL.createObjectURL(b.file);
        h('a', { href: url, download: `${b.title}.epub` }).click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } }, icon('download'), 'Export EPUB'),
      h('button', { class: 'menu-item danger', onclick: async () => {
        s.close();
        if (await confirmDialog(`Remove “${b.title}” from your library? Your notes are kept.`, 'Remove')) {
          await deleteBook(b.id);
          await settings.clearBook(b.id);
          toast('Book removed.');
          refresh();
        }
      } }, icon('trash'), 'Remove from library'))));
}
