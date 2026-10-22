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

// Public CORS relays for public-domain files. Gutenberg doesn't send CORS headers,
// so a browser page can't download from it directly. These relays only ever see
// the public book URL — never anything personal.
const PUBLIC_RELAYS = [
  'https://api.codetabs.com/v1/proxy/?quest={url}',
  'https://api.allorigins.win/raw?url={url}',
  'https://corsproxy.io/?url={url}',
];

async function fetchZip(url, ms = 30000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    if (blob.size < 1000 || head[0] !== 0x50 || head[1] !== 0x4b) throw new Error('Not an EPUB');
    return blob;
  } finally { clearTimeout(t); }
}

// Try direct first, then your own helper (Settings), then public relays.
export async function downloadEpub(book, onStatus) {
  const urls = [
    `https://www.gutenberg.org/cache/epub/${book.gid}/pg${book.gid}-images-3.epub`,
    `https://www.gutenberg.org/ebooks/${book.gid}.epub3.images`,
    book.epub,
  ].filter((u, i, a) => u && a.indexOf(u) === i);
  const own = settings.get().corsProxy;
  const relays = [...(own ? [own] : []), ...PUBLIC_RELAYS];
  const attempts = [
    ...urls.slice(0, 1),
    ...relays.flatMap((p) => urls.slice(0, 2).map((u) => p.replace('{url}', encodeURIComponent(u)))),
  ];
  let lastErr;
  for (const [i, url] of attempts.entries()) {
    try {
      if (i > 0) onStatus?.(`Trying route ${i + 1}…`);
      const blob = await fetchZip(url);
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
