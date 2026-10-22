// Notes & highlights: storage helpers, [[wikilink]] resolution, backlinks and a small,
// safe Markdown renderer.
import { db, uid } from './db.js';

export async function allNotes() {
  return (await db.all('notes')).sort((a, b) => b.updated - a.updated);
}

export async function saveNote(note) {
  const now = Date.now();
  const n = { id: uid(), created: now, kind: 'note', title: '', body: '', ...note, updated: now };
  await db.put('notes', n);
  return n;
}

export const deleteNote = (id) => db.del('notes', id);
export const notesForBook = (bookId) => db.byIndex('notes', 'bookId', bookId);

export function noteLabel(n) {
  if (n.title?.trim()) return n.title.trim();
  if (n.quote) return `“${n.quote.length > 70 ? n.quote.slice(0, 70) + '…' : n.quote}”`;
  const first = (n.body || '').split('\n').find((l) => l.trim());
  return first ? first.replace(/^#+\s*/, '').slice(0, 70) : 'Untitled note';
}

const LINK_RE = /\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g;

export function outgoingLinks(body = '') {
  return [...body.matchAll(LINK_RE)].map((m) => m[1].trim().toLowerCase());
}

export function backlinks(note, notes) {
  const keys = new Set([note.title?.trim().toLowerCase(), `id:${note.id}`].filter(Boolean));
  return notes.filter((n) => n.id !== note.id && outgoingLinks(n.body).some((k) => keys.has(k)));
}

export function resolveLink(target, notes, books) {
  const t = target.trim().toLowerCase();
  if (t.startsWith('id:')) {
    const n = notes.find((x) => x.id === t.slice(3));
    if (n) return { type: 'note', id: n.id };
  }
  const n = notes.find((x) => x.title?.trim().toLowerCase() === t);
  if (n) return { type: 'note', id: n.id };
  const b = books.find((x) => x.title.trim().toLowerCase() === t);
  if (b) return { type: 'book', id: b.id };
  return { type: 'missing', title: target.trim() };
}

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(text, resolve) {
  // Pull out wikilinks first so escaping can't break titles with quotes or apostrophes.
  const links = [];
  let s = text.replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
    const r = resolve(target);
    const t = esc(label || target);
    let html;
    if (r.type === 'note') html = `<a class="wikilink" href="#/notes/${r.id}">${t}</a>`;
    else if (r.type === 'book') html = `<a class="wikilink book" href="#/read/${r.id}">${t}</a>`;
    else html = `<a class="wikilink missing" href="#/notes/new?title=${encodeURIComponent(r.title)}" title="Create this note">${t}</a>`;
    links.push(html);
    return `\u0000${links.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => links[+i]);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

export function renderMarkdown(md = '', resolve) {
  const lines = md.split('\n');
  const out = [];
  let list = null;
  let para = [];
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '), resolve)}</p>`); para = []; }
    if (list) { out.push(`</${list}>`); list = null; }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { flush(); out.push(`<h${m[1].length + 1}>${inline(m[2], resolve)}</h${m[1].length + 1}>`); continue; }
    if ((m = line.match(/^>\s?(.*)/))) { flush(); out.push(`<blockquote>${inline(m[1], resolve)}</blockquote>`); continue; }
    if ((m = line.match(/^\s*[-*]\s+\[( |x)\]\s+(.*)/i))) {
      if (para.length) flush();
      if (list !== 'ul') { flush(); out.push('<ul class="tasks">'); list = 'ul'; }
      out.push(`<li><input type="checkbox" disabled ${m[1].toLowerCase() === 'x' ? 'checked' : ''}> ${inline(m[2], resolve)}</li>`);
      continue;
    }
    if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
      if (para.length) flush();
      if (list !== 'ul') { flush(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1], resolve)}</li>`);
      continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (para.length) flush();
      if (list !== 'ol') { flush(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1], resolve)}</li>`);
      continue;
    }
    if (list) flush();
    para.push(line.trim());
  }
  flush();
  return out.join('\n');
}

export function notesToMarkdown(notes, books) {
  const bookTitle = (id) => books.find((b) => b.id === id)?.title || 'Unknown book';
  return notes.map((n) => {
    const parts = [`## ${noteLabel(n)}`];
    if (n.bookId) parts.push(`*${bookTitle(n.bookId)}${n.chapter != null ? `, chapter ${n.chapter + 1}` : ''}*`);
    if (n.quote) parts.push(`> ${n.quote}`);
    if (n.body) parts.push(n.body);
    return parts.join('\n\n');
  }).join('\n\n---\n\n');
}
