// Free public-domain catalog: Project Gutenberg (70,000+ books) via the open Gutendex API.
import { settings } from './settings.js';

const API = 'https://gutendex.com/books/';

export async function searchCatalog({ search = '', topic = '', language = '', page = 1 } = {}) {
  const u = new URL(API);
  if (search) u.searchParams.set('search', search);
  if (topic) u.searchParams.set('topic', topic);
  if (language) u.searchParams.set('languages', language);
  if (page > 1) u.searchParams.set('page', page);
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Catalog unavailable (${r.status})`);
  const data = await r.json();
  return {
    count: data.count,
    next: !!data.next,
    books: data.results.map((b) => ({
      gid: b.id,
      title: b.title,
      author: b.authors.map((a) => a.name.split(', ').reverse().join(' ')).join(', ') || 'Unknown',
      cover: b.formats['image/jpeg'] || null,
      epub: b.formats['application/epub+zip'] || null,
      downloads: b.download_count,
      languages: b.languages,
      subjects: b.subjects || [],
    })),
  };
}

// Gutenberg doesn't always send CORS headers, so try direct first, then the
// optional proxy (the bundled voice server provides one at /fetch?url=).
export async function downloadEpub(book) {
  const urls = [
    `https://www.gutenberg.org/ebooks/${book.gid}.epub3.images`,
    book.epub,
  ].filter(Boolean);
  const proxy = settings.get().corsProxy;
  const attempts = [...urls, ...(proxy ? urls.map((u) => proxy.replace('{url}', encodeURIComponent(u))) : [])];
  let lastErr;
  for (const url of attempts) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      if (blob.size < 1000) throw new Error('Empty download');
      return new File([blob], `${book.title}.epub`, { type: 'application/epub+zip' });
    } catch (e) { lastErr = e; }
  }
  const err = new Error('The browser blocked the download from Project Gutenberg.');
  err.cause = lastErr;
  err.blocked = true;
  throw err;
}

export const TOPICS = ['Fiction', 'Adventure', 'Science fiction', 'Mystery', 'Romance', 'Fantasy', 'Horror', 'Poetry',
  'Drama', 'Philosophy', 'History', 'Biography', 'Children', 'Humor', 'Religion', 'Science'];

export const LANGUAGES = [['', 'Any language'], ['en', 'English'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['fi', 'Finnish'], ['zh', 'Chinese'], ['la', 'Latin'], ['sa', 'Sanskrit']];
