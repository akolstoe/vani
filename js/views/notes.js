import { h, icon, iconButton, toast, confirmDialog, timeAgo } from '../ui.js';
import { allNotes, saveNote, deleteNote, noteLabel, backlinks, outgoingLinks, resolveLink, renderMarkdown, notesToMarkdown } from '../notes.js';
import { listBooks } from '../library.js';

let filter = 'all';
let search = '';

export async function notesView(root, { id, params }) {
  let notes = await allNotes();
  const books = await listBooks();
  let bookFilter = params.get('book') || '';

  if (id === 'new') {
    const n = await saveNote({ title: params.get('title') || '', body: '' });
    location.replace(`#/notes/${n.id}`);
    return;
  }

  const listEl = h('div', { class: 'notes-list' });
  const editorEl = h('div', { class: 'note-editor' });
  const page = h('div', { class: `notes-page ${id ? 'has-selection' : ''}` },
    h('aside', { class: 'notes-side' },
      h('header', { class: 'page-head compact' },
        h('h1', {}, 'Notes'),
        h('div', { class: 'row' },
          iconButton('download', 'Export all notes as Markdown', exportAll),
          h('button', { class: 'btn sm', onclick: async () => { const n = await saveNote({}); location.hash = `#/notes/${n.id}`; } }, icon('plus', 16), 'New'))),
      h('label', { class: 'search' }, icon('search', 18),
        h('input', { type: 'search', placeholder: 'Search notes and quotes', value: search, oninput: (e) => { search = e.target.value; drawList(); } })),
      h('div', { class: 'row wrap' },
        h('div', { class: 'segmented small' }, [['all', 'All'], ['note', 'Notes'], ['highlight', 'Highlights']].map(([v, l]) =>
          h('button', { class: filter === v ? 'on' : '', onclick: (e) => { filter = v; e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); drawList(); } }, l))),
        h('select', { 'aria-label': 'Filter by book', onchange: (e) => { bookFilter = e.target.value; drawList(); } },
          h('option', { value: '' }, 'All books'),
          books.map((b) => h('option', { value: b.id, selected: b.id === bookFilter }, b.title)))),
      listEl),
    editorEl);
  root.replaceChildren(page);

  function drawList() {
    const q = search.toLowerCase();
    const shown = notes.filter((n) =>
      (filter === 'all' || n.kind === filter) &&
      (!bookFilter || n.bookId === bookFilter) &&
      (!q || `${n.title} ${n.body} ${n.quote || ''} ${n.bookTitle || ''}`.toLowerCase().includes(q)));
    listEl.replaceChildren(...shown.map((n) => h('a', { class: `note-item ${n.id === id ? 'active' : ''}`, href: `#/notes/${n.id}` },
      n.kind === 'highlight' ? h('span', { class: `dot hl-${n.color || 'yellow'}` }) : h('span', { class: 'dot plain' }),
      h('span', { class: 'note-item-text' },
        h('strong', {}, noteLabel(n)),
        h('span', { class: 'muted small' }, [n.bookTitle, timeAgo(n.updated)].filter(Boolean).join(' · '))))));
    if (!shown.length) listEl.replaceChildren(h('p', { class: 'muted pad' }, notes.length ? 'Nothing matches.' : 'No notes yet. Highlight a passage while reading, or start a new note.'));
  }
  drawList();

  async function exportAll() {
    const md = `# Vani notes\n\n${notesToMarkdown(notes, books)}\n`;
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    h('a', { href: url, download: 'vani-notes.md' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  if (!id) {
    editorEl.replaceChildren(h('div', { class: 'empty' },
      h('div', { class: 'empty-art' }, icon('link', 36)),
      h('h3', {}, 'A web of ideas'),
      h('p', {}, 'Link any note to another with [[Note title]], or to a book with [[Book title]]. Every link shows up as a backlink on the other side.')));
    return;
  }

  let note = notes.find((n) => n.id === id);
  if (!note) { editorEl.replaceChildren(h('div', { class: 'empty' }, h('h3', {}, 'Note not found'))); return; }

  const resolve = (t) => resolveLink(t, notes, books);
  let mode = note.body || note.quote ? 'preview' : 'edit';
  const title = h('input', { class: 'note-title', type: 'text', placeholder: note.kind === 'highlight' ? 'Title this highlight' : 'Untitled', value: note.title || '' });
  const body = h('textarea', { class: 'note-body', placeholder: 'Write freely. Type [[ to link another note or a book.' }, note.body || '');
  const preview = h('div', { class: 'note-preview prose' });
  const suggest = h('div', { class: 'suggest', role: 'listbox' });
  const meta = h('div', { class: 'note-meta' });
  const modeBtn = h('button', { class: 'btn ghost sm', onclick: () => { mode = mode === 'edit' ? 'preview' : 'edit'; drawMode(); } });

  let saveTimer;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      note = await saveNote({ ...note, title: title.value.trim(), body: body.value });
      notes = await allNotes();
      drawList();
      drawMeta();
    }, 400);
  };
  title.addEventListener('input', save);
  body.addEventListener('input', () => { save(); autosize(); suggestLinks(); });
  body.addEventListener('keydown', (e) => {
    const items = [...suggest.querySelectorAll('button')];
    if (!items.length || !suggest.classList.contains('show')) return;
    const cur = items.findIndex((b) => b.classList.contains('on'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = (cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((b, i) => b.classList.toggle('on', i === n));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      (items[cur] || items[0]).click();
    } else if (e.key === 'Escape') suggest.classList.remove('show');
  });
  const autosize = () => { body.style.height = 'auto'; body.style.height = `${Math.max(240, body.scrollHeight)}px`; };

  function suggestLinks() {
    const upto = body.value.slice(0, body.selectionStart);
    const m = upto.match(/\[\[([^\]\n]*)$/);
    if (!m) { suggest.classList.remove('show'); return; }
    const q = m[1].toLowerCase();
    const options = [
      ...notes.filter((n) => n.id !== note.id && n.title?.trim()).map((n) => ({ label: n.title.trim(), kind: 'Note' })),
      ...books.map((b) => ({ label: b.title, kind: 'Book' })),
    ].filter((o) => o.label.toLowerCase().includes(q)).slice(0, 8);
    if (q && !options.some((o) => o.label.toLowerCase() === q)) options.push({ label: m[1], kind: 'New note' });
    suggest.replaceChildren(...options.map((o, i) => h('button', {
      class: i === 0 ? 'on' : '', type: 'button',
      onmousedown: (e) => e.preventDefault(),
      onclick: () => {
        const start = body.selectionStart - m[1].length;
        const after = body.value.slice(body.selectionStart).replace(/^[^\]\n]*\]\]/, '');
        body.value = body.value.slice(0, start) + o.label + ']]' + after;
        body.selectionStart = body.selectionEnd = start + o.label.length + 2;
        suggest.classList.remove('show');
        save();
      },
    }, h('span', {}, o.label), h('span', { class: 'muted small' }, o.kind))));
    suggest.classList.toggle('show', options.length > 0);
  }

  function drawMode() {
    modeBtn.textContent = mode === 'edit' ? 'Done' : 'Edit';
    body.hidden = mode !== 'edit';
    preview.hidden = mode === 'edit';
    if (mode === 'edit') { requestAnimationFrame(() => { autosize(); body.focus(); }); }
    else {
      preview.innerHTML = body.value.trim() ? renderMarkdown(body.value, resolve) : '<p class="muted">Nothing written yet. Tap Edit to start.</p>';
    }
  }

  function drawMeta() {
    const back = backlinks(note, notes);
    const out = [...new Set(outgoingLinks(note.body))].map((t) => ({ t, r: resolve(t) }));
    meta.replaceChildren(
      out.length ? h('section', {}, h('h3', {}, icon('link', 16), 'Links to'),
        h('div', { class: 'chips' }, out.map(({ t, r }) => h('a', {
          class: `chip ${r.type}`,
          href: r.type === 'note' ? `#/notes/${r.id}` : r.type === 'book' ? `#/read/${r.id}` : `#/notes/new?title=${encodeURIComponent(r.title)}`,
        }, r.type === 'book' ? icon('book', 14) : null, r.type === 'missing' ? `+ ${t}` : notes.find((n) => n.id === r.id)?.title || books.find((b) => b.id === r.id)?.title || t)))) : '',
      h('section', {}, h('h3', {}, icon('link', 16), `Linked from (${back.length})`),
        back.length ? h('div', { class: 'note-list' }, back.map((n) => h('a', { class: 'note-row', href: `#/notes/${n.id}` },
          h('span', { class: `dot ${n.kind === 'highlight' ? `hl-${n.color}` : 'plain'}` }),
          h('span', {}, h('strong', {}, noteLabel(n)), h('span', { class: 'muted clamp' }, contextOf(n.body, note.title)))))) :
          h('p', { class: 'muted small' }, note.title?.trim() ? `Link here from any note with [[${note.title.trim()}]].` : 'Give this note a title so others can link to it.')),
      h('p', { class: 'muted small' }, `Created ${new Date(note.created).toLocaleString()} · edited ${timeAgo(note.updated)}`));
  }

  const source = note.kind === 'highlight' || note.bookId || note.orphanedFrom ? h('div', { class: `source-card hl-border-${note.color || 'yellow'}` },
    note.quote ? h('blockquote', {}, note.quote) : null,
    note.bookId ? h('a', { class: 'link', href: `#/read/${note.bookId}?c=${note.chapter ?? 0}&s=${note.anchor?.s1 ?? 0}` }, icon('book', 14),
      `${note.bookTitle || 'Open book'}${note.chapter != null ? ` · section ${note.chapter + 1}` : ''} — read in context`)
      : h('span', { class: 'muted small' }, `From “${note.orphanedFrom || note.bookTitle}” (removed from library)`)) : null;

  editorEl.replaceChildren(
    h('div', { class: 'editor-top' },
      h('a', { class: 'icon-btn mobile-only', href: '#/notes', 'aria-label': 'All notes' }, icon('back')),
      h('span', { class: 'grow' }),
      modeBtn,
      iconButton('trash', 'Delete note', async () => {
        if (!(await confirmDialog('Delete this note? Links to it will show as missing.'))) return;
        await deleteNote(note.id);
        toast('Note deleted.');
        location.hash = '#/notes';
      })),
    h('div', { class: 'editor-inner' }, title, source, h('div', { class: 'body-wrap' }, body, suggest), preview, meta));
  preview.addEventListener('click', (e) => { if (!e.target.closest('a')) { mode = 'edit'; drawMode(); } });
  drawMode();
  drawMeta();
  if (!note.title && !note.body && note.kind !== 'highlight') title.focus();

  return () => {
    clearTimeout(saveTimer);
    if (title.value.trim() !== (note.title || '') || body.value !== (note.body || '')) {
      saveNote({ ...note, title: title.value.trim(), body: body.value });
    }
  };
}

function contextOf(body = '', title = '') {
  const i = body.toLowerCase().indexOf(`[[${(title || '').toLowerCase()}`);
  if (i < 0) return body.slice(0, 120);
  return (i > 50 ? '…' : '') + body.slice(Math.max(0, i - 50), i + 80).replace(/\n/g, ' ') + '…';
}
