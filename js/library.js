// Library data: importing EPUBs and keeping per-book state.
import { db, uid, getKV, setKV } from './db.js';
import { openEpub } from './epub.js';

const coverUrls = new Map();

function withCover(b) {
  if (b.cover && !coverUrls.has(b.id)) coverUrls.set(b.id, URL.createObjectURL(b.cover));
  return { ...b, coverUrl: coverUrls.get(b.id) || null };
}

// Reading state (progress, last opened) changes every few seconds while listening, so it
// lives in its own small record. Rewriting the book record would re-copy the whole EPUB.
const STATE_KEYS = ['progress', 'lastOpened'];
const withState = async (b) => ({ ...b, ...((await getKV(`state:${b.id}`, null)) || {}) });

export async function listBooks() {
  return Promise.all((await db.all('books')).map(async (b) => withCover(await withState(b))));
}

export async function getBook(id) {
  const b = await db.get('books', id);
  return b ? withCover(await withState(b)) : null;
}

export async function importBook(file, source = 'import') {
  if (!/\.epub$/i.test(file.name || '') && file.type && file.type !== 'application/epub+zip') {
    throw new Error(`${file.name} isn't an EPUB file.`);
  }
  const epub = await openEpub(file);
  const existing = (await db.all('books')).find((b) => b.title === epub.meta.title && b.author === epub.meta.author);
  if (existing) { epub.close(); return { book: withCover(existing), duplicate: true }; }
  const book = {
    id: uid(),
    title: epub.meta.title,
    author: epub.meta.author,
    language: epub.meta.language,
    description: epub.meta.description,
    cover: epub.cover,
    file,
    size: file.size,
    chapters: epub.spine.length,
    source,
    added: Date.now(),
    lastOpened: 0,
    progress: { chapter: 0, sentence: 0, percent: 0 },
  };
  epub.close();
  await db.put('books', book);
  return { book: withCover(book), duplicate: false };
}

export async function updateBook(id, patch) {
  const state = Object.fromEntries(Object.entries(patch).filter(([k]) => STATE_KEYS.includes(k)));
  const rest = Object.fromEntries(Object.entries(patch).filter(([k]) => !STATE_KEYS.includes(k)));
  if (Object.keys(state).length) {
    const cur = (await getKV(`state:${id}`, null)) || {};
    await setKV(`state:${id}`, { ...cur, ...state });
  }
  if (!Object.keys(rest).length) return;
  const b = await db.get('books', id);
  if (!b) return;
  await db.put('books', { ...b, ...patch });
}

export async function deleteBook(id) {
  await db.del('books', id);
  await db.del('kv', `state:${id}`);
  if (coverUrls.has(id)) { URL.revokeObjectURL(coverUrls.get(id)); coverUrls.delete(id); }
  for (const n of await db.byIndex('notes', 'bookId', id)) {
    // Keep notes, but detach them from the deleted book's location.
    await db.put('notes', { ...n, orphanedFrom: n.bookTitle || '', bookId: undefined });
  }
}
