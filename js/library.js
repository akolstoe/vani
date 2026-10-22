// Library data: importing EPUBs and keeping per-book state.
import { db, uid } from './db.js';
import { openEpub } from './epub.js';

const coverUrls = new Map();

function withCover(b) {
  if (b.cover && !coverUrls.has(b.id)) coverUrls.set(b.id, URL.createObjectURL(b.cover));
  return { ...b, coverUrl: coverUrls.get(b.id) || null };
}

export async function listBooks() {
  return (await db.all('books')).map(withCover);
}

export async function getBook(id) {
  const b = await db.get('books', id);
  return b ? withCover(b) : null;
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
  const b = await db.get('books', id);
  if (!b) return;
  await db.put('books', { ...b, ...patch });
}

export async function deleteBook(id) {
  await db.del('books', id);
  if (coverUrls.has(id)) { URL.revokeObjectURL(coverUrls.get(id)); coverUrls.delete(id); }
  for (const n of await db.byIndex('notes', 'bookId', id)) {
    // Keep notes, but detach them from the deleted book's location.
    await db.put('notes', { ...n, orphanedFrom: n.bookTitle || '', bookId: undefined });
  }
}
