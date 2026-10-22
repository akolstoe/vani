import { h, icon, iconButton, toast, sheet, slider, toggle, select, field, confirmDialog } from '../ui.js';
import { getBook, updateBook } from '../library.js';
import { openEpub } from '../epub.js';
import { Reader, HL_COLORS } from '../reader.js';
import { Narrator, ENGINES } from '../tts/narrator.js';
import { settings, PRESETS, PERFORMANCE_KEYS } from '../settings.js';
import { saveNote, notesForBook, deleteNote, noteLabel } from '../notes.js';

const SAMPLE = 'It was a bright cold day in April, and the clocks were striking thirteen. “Shall we begin?” she asked.';

export async function readerView(root, { id, params }) {
  const book = await getBook(id);
  if (!book) {
    root.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('h3', {}, 'Book not found'), h('a', { class: 'btn', href: '#/' }, 'Back to library'))));
    return;
  }
  document.body.classList.add('reading');
  const epub = await openEpub(book.file);
  let opts = await settings.forBook(id);

  const scroller = h('div', { class: 'reader-scroll', tabIndex: -1 });
  const reader = new Reader(scroller, epub, { lang: book.language });
  const narrator = new Narrator(reader);
  narrator.setOptions(opts);

  // ---- Top bar --------------------------------------------------------------
  const chapterLabel = h('span', { class: 'chapter-label' });
  const topbar = h('header', { class: 'reader-top' },
    h('a', { class: 'icon-btn', href: '#/', 'aria-label': 'Back to library', title: 'Library' }, icon('back')),
    h('div', { class: 'reader-title' }, h('strong', {}, book.title), chapterLabel),
    iconButton('toc', 'Contents', () => openToc()),
    iconButton('note', 'Notes & highlights', () => openBookNotes()),
    iconButton('type', 'Appearance', () => openAppearance()));

  // ---- Player bar -------------------------------------------------------------
  const playBtn = h('button', { class: 'play-btn', 'aria-label': 'Play', onclick: () => { unlockAudio(); narrator.toggle(); } }, icon('play', 26));
  const status = h('span', { class: 'player-status' });
  const loadBar = h('div', { class: 'load-bar' }, h('span'));
  const rateChip = h('button', { class: 'chip', title: 'Speed', onclick: () => cycleRate() });
  const voiceChip = h('button', { class: 'chip voice-chip', onclick: () => openPerformance() }, icon('sliders', 16), h('span'));
  const timerBtn = iconButton('timer', 'Sleep timer', () => openTimer(), { size: 18 });
  const player = h('footer', { class: 'player' }, loadBar,
    h('div', { class: 'player-row' },
      h('div', { class: 'player-left' }, voiceChip, status),
      h('div', { class: 'player-center' },
        iconButton('prev', 'Previous sentence', () => narrator.skip(-1)),
        playBtn,
        iconButton('next', 'Next sentence', () => narrator.skip(1))),
      h('div', { class: 'player-right' }, rateChip, timerBtn)));

  const selBar = h('div', { class: 'sel-bar', role: 'toolbar', 'aria-label': 'Selection' });
  const popover = h('div', { class: 'footnote-pop', role: 'dialog' });

  root.replaceChildren(h('div', { class: 'reader-view' }, topbar, scroller, player, selBar, popover));

  const voiceName = async () => {
    const eng = ENGINES[opts.engine];
    try {
      const v = (await eng.voices()).find((x) => x.id === opts.voice);
      return v ? v.name : (opts.engine === 'kokoro' ? 'Heart' : 'Default voice');
    } catch { return eng.name; }
  };
  const refreshChips = async () => {
    rateChip.textContent = `${+opts.rate.toFixed(2)}×`;
    voiceChip.lastChild.textContent = await voiceName();
  };
  refreshChips();

  const RATES = [0.75, 0.9, 1, 1.15, 1.25, 1.5, 1.75, 2];
  async function cycleRate() {
    const i = RATES.findIndex((r) => r >= opts.rate - 0.001);
    await applyPerf({ rate: RATES[(i + 1) % RATES.length] });
  }

  async function applyPerf(patch, scope = opts._bookOverride ? 'book' : 'all') {
    if (scope === 'book') await settings.setForBook(id, patch);
    else await settings.set(patch);
    opts = await settings.forBook(id);
    narrator.setOptions(opts);
    refreshChips();
  }

  // ---- Narrator events --------------------------------------------------------
  narrator.addEventListener('state', ({ detail }) => {
    const playing = detail.state === 'playing' || detail.state === 'loading';
    playBtn.replaceChildren(icon(playing ? 'pause' : 'play', 26));
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    player.classList.toggle('is-playing', playing);
    loadBar.classList.toggle('show', detail.state === 'loading');
    if (detail.state === 'loading') status.textContent = 'Loading voice…';
    else updateStatus();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    if (detail.state === 'idle') reader.clearMarks();
  });
  narrator.addEventListener('loading', ({ detail }) => {
    loadBar.firstChild.style.width = `${Math.round(detail.progress * 100)}%`;
    status.textContent = `Downloading voice model… ${Math.round(detail.progress * 100)}%`;
  });
  narrator.addEventListener('error', ({ detail }) => {
    const msg = opts.engine === 'server'
      ? `Can't reach the voice server at ${opts.serverUrl}. Is it running?`
      : `Voice error: ${detail.message}`;
    toast(msg, { action: 'Voice settings', onAction: () => openPerformance(), duration: 7000 });
  });
  let waitTimer;
  narrator.addEventListener('waiting', ({ detail }) => {
    player.classList.toggle('is-waiting', detail.waiting);
    clearInterval(waitTimer);
    if (detail.waiting) {
      const tick = () => { status.textContent = `Preparing voice… ${Math.round((Date.now() - detail.since) / 1000)}s`; };
      tick();
      waitTimer = setInterval(tick, 1000);
    } else updateStatus();
  });
    narrator.addEventListener('slept', () => toast('Sleep timer: playback stopped. Good night.'));

  function updateStatus() {
    const n = reader.sentences.length;
    const label = epub.toc.filter((t) => t.chapter === reader.chapterIndex && t.depth === 0)[0]?.label;
    chapterLabel.textContent = label || `Section ${reader.chapterIndex + 1} of ${reader.chapterCount}`;
    if (narrator.state !== 'loading') {
      const pct = Math.round(((reader.chapterIndex + (narrator.index / Math.max(1, n))) / reader.chapterCount) * 100);
      const sleepTxt = narrator.sleepAt === 'chapter' ? ' · sleeps at chapter end'
        : typeof narrator.sleepAt === 'number' ? ` · sleeps in ${Math.max(1, Math.round((narrator.sleepAt - Date.now()) / 60000))} min` : '';
      status.textContent = `${pct}% of book${sleepTxt}`;
    }
  }

  // ---- Reader events -------------------------------------------------------------
  let saveTimer;
  reader.addEventListener('position', ({ detail }) => {
    if (narrator.state === 'idle' || narrator.state === 'paused') {
      if (detail.sentence !== narrator.index && narrator.state === 'idle') narrator.index = detail.sentence;
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => updateBook(id, { progress: detail, lastOpened: Date.now() }), 600);
    updateStatus();
  });
  reader.addEventListener('chapter', async () => {
    reader.applyNotes(await notesForBook(id));
    updateStatus();
    if (narrator.state !== 'playing') narrator.index = 0;
  });
  reader.addEventListener('footnote', ({ detail }) => {
    popover.replaceChildren(
      h('p', {}, detail.text.length > 900 ? detail.text.slice(0, 900) + '…' : detail.text),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost sm', onclick: () => { popover.classList.remove('show'); reader.goChapter(detail.index, 0, { hash: detail.hash }); } }, 'Go to note'),
        h('button', { class: 'btn sm', onclick: () => popover.classList.remove('show') }, 'Close')));
    popover.classList.add('show');
  });
  reader.addEventListener('noteclick', ({ detail }) => openHighlight(detail.note));

  scroller.addEventListener('dblclick', (e) => {
    const i = reader.sentenceAt(e.clientX, e.clientY);
    if (i !== null) { window.getSelection()?.removeAllRanges(); unlockAudio(); narrator.play(i); }
  });

  // ---- Selection toolbar ---------------------------------------------------------
  let selTimer;
  const onSel = () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const sel = reader.selection();
      if (!sel) { selBar.classList.remove('show'); return; }
      selBar.replaceChildren(
        ...HL_COLORS.map((c) => h('button', { class: `swatch hl-${c}`, 'aria-label': `Highlight ${c}`, onclick: () => addHighlight(sel, c) })),
        h('span', { class: 'sep' }),
        h('button', { class: 'sel-btn', onclick: () => addHighlight(sel, 'yellow', true) }, icon('note', 16), 'Note'),
        h('button', { class: 'sel-btn', onclick: () => { selBar.classList.remove('show'); window.getSelection().removeAllRanges(); unlockAudio(); narrator.play(sel.anchor.s1); } }, icon('play', 16), 'Read'),
        h('button', { class: 'sel-btn', onclick: () => { navigator.clipboard?.writeText(sel.quote); toast('Copied.'); } }, 'Copy'));
      const r = sel.rect;
      const top = r.top > 120 ? r.top - 56 : r.bottom + 12;
      selBar.style.top = `${Math.max(8, top)}px`;
      selBar.style.left = `${Math.min(window.innerWidth - 16, Math.max(16, r.left + r.width / 2))}px`;
      selBar.classList.add('show');
    }, 180);
  };
  document.addEventListener('selectionchange', onSel);

  async function addHighlight(sel, color, withNote = false) {
    selBar.classList.remove('show');
    window.getSelection().removeAllRanges();
    const note = await saveNote({ kind: 'highlight', bookId: id, bookTitle: book.title, chapter: sel.chapter, anchor: sel.anchor, quote: sel.quote, color });
    reader.applyNotes(await notesForBook(id));
    if (withNote) openHighlight(note, true);
    else toast('Highlighted.', { action: 'Add note', onAction: () => openHighlight(note, true) });
  }

  function openHighlight(note, focus = false) {
    const title = h('input', { type: 'text', placeholder: 'Title (lets you link to it with [[Title]])', value: note.title || '' });
    const body = h('textarea', { rows: 6, placeholder: 'Your thoughts… Link ideas with [[Another note]] or [[A book title]].' }, note.body || '');
    let color = note.color || 'yellow';
    const swatches = h('div', { class: 'row' }, HL_COLORS.map((c) => h('button', {
      class: `swatch hl-${c} ${c === color ? 'on' : ''}`, 'aria-label': c,
      onclick: (e) => { color = c; swatches.querySelectorAll('.swatch').forEach((s) => s.classList.remove('on')); e.currentTarget.classList.add('on'); },
    })));
    const s = sheet('Highlight', h('div', { class: 'stack' },
      h('blockquote', { class: `quote hl-border-${color}` }, note.quote),
      swatches, field('Title', title), field('Note', body),
      h('div', { class: 'row between' },
        h('button', { class: 'btn ghost danger', onclick: async () => {
          if (!(await confirmDialog('Delete this highlight and its note?'))) return;
          await deleteNote(note.id); s.close(); reader.applyNotes(await notesForBook(id)); toast('Highlight deleted.');
        } }, icon('trash', 16), 'Delete'),
        h('div', { class: 'row' },
          h('a', { class: 'btn ghost', href: `#/notes/${note.id}`, onclick: () => s.close() }, 'Open in Notes'),
          h('button', { class: 'btn', onclick: async () => {
            await saveNote({ ...note, title: title.value.trim(), body: body.value, color });
            s.close(); reader.applyNotes(await notesForBook(id)); toast('Saved.');
          } }, 'Save')))));
    if (focus) setTimeout(() => body.focus(), 250);
    return s;
  }

  // ---- Sheets ---------------------------------------------------------------------
  function openToc() {
    const items = epub.toc.length ? epub.toc : epub.spine.map((s, i) => ({ label: `Section ${i + 1}`, chapter: i, depth: 0, href: s.href }));
    const s = sheet('Contents', h('nav', { class: 'toc' }, items.map((t) => h('button', {
      class: `toc-item ${t.chapter === reader.chapterIndex ? 'current' : ''}`,
      style: { paddingLeft: `${12 + t.depth * 16}px` },
      disabled: t.chapter < 0,
      onclick: async () => {
        s.close();
        const wasPlaying = narrator.state === 'playing';
        narrator.stop(true);
        await reader.goChapter(t.chapter, 0, { hash: t.href?.split('#')[1] });
        if (wasPlaying) narrator.play(0);
      },
    }, t.label || 'Untitled'))));
    s.body.querySelector('.current')?.scrollIntoView({ block: 'center' });
  }

  async function openBookNotes() {
    const notes = (await notesForBook(id)).sort((a, b) => (a.chapter - b.chapter) || (a.anchor?.s1 - b.anchor?.s1));
    const s = sheet('Notes & highlights', h('div', { class: 'stack' },
      h('div', { class: 'row between' },
        h('span', { class: 'muted' }, `${notes.length} in this book`),
        h('a', { class: 'btn ghost sm', href: `#/notes?book=${id}`, onclick: () => s.close() }, 'Open notebook')),
      notes.length ? h('div', { class: 'note-list' }, notes.map((n) => h('button', {
        class: 'note-row', onclick: async () => {
          s.close();
          await reader.goChapter(n.chapter, n.anchor?.s1 || 0);
          reader.scrollToSentence(n.anchor?.s1 || 0, 'smooth', 'center');
        },
      }, h('span', { class: `dot hl-${n.color || 'yellow'}` }),
        h('span', {}, h('strong', {}, noteLabel(n)), n.body ? h('span', { class: 'muted clamp' }, n.body) : null))))
        : h('p', { class: 'muted' }, 'Select any passage to highlight it or attach a note.')));
  }

  function openAppearance() {
    const st = settings.get();
    const set = (p) => settings.set(p);
    sheet('Appearance', h('div', { class: 'stack' },
      h('div', { class: 'theme-row' }, [['auto', 'Auto'], ['paper', 'Paper'], ['sepia', 'Sepia'], ['night', 'Night']].map(([v, l]) =>
        h('button', { class: `theme-swatch t-${v} ${st.theme === v ? 'on' : ''}`, onclick: (e) => {
          set({ theme: v }); e.currentTarget.parentElement.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on');
        } }, l))),
      field('Typeface', select([
        { value: 'literata', label: 'Literata (book)' }, { value: 'serif', label: 'Classic serif' },
        { value: 'sans', label: 'Sans-serif' }, { value: 'dyslexic', label: 'High legibility' }], st.fontFamily, (v) => set({ fontFamily: v }))),
      slider({ label: 'Text size', min: 14, max: 30, step: 1, value: st.fontSize, format: (v) => `${v}px`, onInput: (v) => set({ fontSize: v }) }),
      slider({ label: 'Line spacing', min: 1.2, max: 2.2, step: 0.05, value: st.lineHeight, format: (v) => v.toFixed(2), onInput: (v) => set({ lineHeight: v }) }),
      slider({ label: 'Line width', min: 24, max: 52, step: 1, value: st.measure, format: (v) => `${v}em`, onInput: (v) => set({ measure: v }) }),
      toggle('Justify text', st.justify, (v) => set({ justify: v }))));
  }

  function openTimer() {
    const choose = (v) => {
      narrator.sleepAt = v === 'off' ? null : v === 'chapter' ? 'chapter' : Date.now() + v * 60000;
      s.close();
      updateStatus();
      toast(v === 'off' ? 'Sleep timer off.' : v === 'chapter' ? 'Stopping at the end of this chapter.' : `Stopping in ${v} minutes.`);
    };
    const s = sheet('Sleep timer', h('div', { class: 'menu-list' },
      [5, 10, 15, 30, 45, 60].map((m) => h('button', { class: 'menu-item', onclick: () => choose(m) }, `${m} minutes`)),
      h('button', { class: 'menu-item', onclick: () => choose('chapter') }, 'End of chapter'),
      h('button', { class: 'menu-item', onclick: () => choose('off') }, 'Off')));
  }

  async function openPerformance() {
    let scope = opts._bookOverride ? 'book' : 'all';
    const body = h('div', { class: 'stack perf' });
    const s = sheet('Performance', body, { wide: true });

    const render = async () => {
      const eng = ENGINES[opts.engine];
      let voices = [];
      let voiceError = '';
      try { voices = await eng.voices(); } catch (e) { voiceError = e.message; }
      const groups = {};
      voices.forEach((v) => (groups[v.group || 'Voices'] ||= []).push({ value: v.id, label: `${v.name}${v.lang ? ` (${v.lang})` : ''}` }));
      const voiceOptions = [{ value: '', label: 'Default' }, ...Object.entries(groups).map(([g, o]) => ({ group: g, options: o }))];
      const set = async (p) => { await applyPerf(p, scope); };
      const setAndRender = async (p) => { await set(p); render(); };

      const preview = (voice) => {
        unlockAudio();
        narrator.pause();
        if (eng.id === 'kokoro' && !eng.loaded) toast('Loading the Kokoro voice model — the first time takes a minute…', { duration: 6000 });
        eng.init?.(null, voice || undefined).then(() => eng.speak(SAMPLE, { ...opts, voice }, {})).catch((e) => toast(`Preview failed: ${e.message}`));
      };

      body.replaceChildren(
        h('div', { class: 'segmented', role: 'tablist' },
          h('button', { class: scope === 'book' ? 'on' : '', onclick: async () => { scope = 'book'; await settings.setForBook(id, Object.fromEntries(PERFORMANCE_KEYS.map((k) => [k, opts[k]]))); opts = await settings.forBook(id); render(); } }, 'This book'),
          h('button', { class: scope === 'all' ? 'on' : '', onclick: async () => { scope = 'all'; await settings.clearBook(id); opts = await settings.forBook(id); narrator.setOptions(opts); refreshChips(); render(); } }, 'All books')),

        h('section', {}, h('h3', {}, 'Presets'),
          h('div', { class: 'chips' }, Object.entries(PRESETS).map(([name, p]) => h('button', { class: 'chip', onclick: () => setAndRender(p) }, name)))),

        h('section', {}, h('h3', {}, 'Voice'),
          field('Engine', select(Object.values(ENGINES).filter((e) => e.available()).map((e) => ({ value: e.id, label: e.name })), opts.engine,
            (v) => setAndRender({ engine: v, voice: '', dialogueVoice: '' })), eng.description),
          voiceError ? h('p', { class: 'warn' }, opts.engine === 'server' ? `Voice server not reachable at ${opts.serverUrl}. Set it up under Voices.` : voiceError) : null,
          h('div', { class: 'row grow' },
            field('Narrator', select(voiceOptions, opts.voice, (v) => set({ voice: v }))),
            h('button', { class: 'btn ghost sm', onclick: () => preview(opts.voice) }, icon('play', 14), 'Preview')),
          toggle('Cast a different voice for dialogue', opts.dialogueEnabled, (v) => setAndRender({ dialogueEnabled: v }), 'Text inside quotation marks gets its own voice.'),
          opts.dialogueEnabled ? h('div', { class: 'row grow' },
            field('Dialogue', select(voiceOptions, opts.dialogueVoice, (v) => set({ dialogueVoice: v }))),
            h('button', { class: 'btn ghost sm', onclick: () => preview(opts.dialogueVoice || opts.voice) }, icon('play', 14), 'Preview')) : null,
          h('a', { class: 'link', href: '#/voices', onclick: () => s.close() }, 'Add custom or cloned voices →')),

        h('section', {}, h('h3', {}, 'Delivery'),
          slider({ label: 'Speed', min: 0.5, max: 3, step: 0.05, value: opts.rate, format: (v) => `${v.toFixed(2)}×`, onInput: (v) => set({ rate: v }) }),
          eng.supportsPitch === false ? '' : slider({ label: 'Pitch', min: -6, max: 6, step: 0.5, value: opts.pitch, format: (v) => `${v > 0 ? '+' : ''}${v} st`, onInput: (v) => set({ pitch: v }) }),
          opts.engine === 'server' ? slider({ label: 'Expressiveness', min: 0.25, max: 1.5, step: 0.05, value: opts.expressiveness ?? 0.5, format: (v) => v < 0.4 ? 'Calm' : v < 0.7 ? 'Natural' : v < 1 ? 'Lively' : 'Dramatic', onInput: (v) => set({ expressiveness: v }) }) : null,
          slider({ label: 'Volume', min: 0.1, max: 1, step: 0.05, value: opts.volume, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => set({ volume: v }) })),

        h('section', {}, h('h3', {}, 'Pacing'),
          slider({ label: 'Between sentences', min: 0, max: 1500, step: 25, value: opts.sentencePause, format: (v) => `${v} ms`, onInput: (v) => set({ sentencePause: v }) }),
          slider({ label: 'Between paragraphs', min: 0, max: 3000, step: 50, value: opts.paragraphPause, format: (v) => `${v} ms`, onInput: (v) => set({ paragraphPause: v }) }),
          slider({ label: 'After headings', min: 0, max: 4000, step: 50, value: opts.headingPause, format: (v) => `${v} ms`, onInput: (v) => set({ headingPause: v }) }),
          slider({ label: 'Between chapters', min: 0, max: 8000, step: 100, value: opts.chapterPause, format: (v) => `${(v / 1000).toFixed(1)} s`, onInput: (v) => set({ chapterPause: v }) })),

        h('section', {}, h('h3', {}, 'Following along'),
          field('Highlight', select([{ value: 'word', label: 'Word and sentence' }, { value: 'sentence', label: 'Sentence only' }, { value: 'none', label: 'None' }], opts.highlight, (v) => set({ highlight: v }))),
          toggle('Auto-scroll to the spoken text', opts.autoScroll, (v) => set({ autoScroll: v })),
          toggle('Continue into the next chapter', opts.autoAdvance, (v) => set({ autoAdvance: v })),
          toggle('Skip footnote markers like [12]', opts.skipBrackets, (v) => set({ skipBrackets: v }))),

        h('section', {}, h('h3', {}, 'Pronunciation'),
          h('p', { class: 'hint' }, 'Teach the narrator names and words. Applied before speaking.'),
          pronunciationEditor(opts.pronunciations || [], (list) => set({ pronunciations: list }))),
      );
    };
    render();
  }

  // ---- Media session & keyboard -----------------------------------------------------
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: book.title, artist: book.author, album: 'Vani',
      artwork: book.coverUrl ? [{ src: book.coverUrl, sizes: '512x512', type: book.cover?.type || 'image/jpeg' }] : [],
    });
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => narrator.play(narrator.index));
    ms.setActionHandler('pause', () => narrator.pause());
    ms.setActionHandler('previoustrack', () => narrator.skip(-1));
    ms.setActionHandler('nexttrack', () => narrator.skip(1));
    try { ms.setActionHandler('seekbackward', () => narrator.skip(-3)); ms.setActionHandler('seekforward', () => narrator.skip(3)); } catch {}
  }

  const onKey = (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('.sheet-wrap')) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); unlockAudio(); narrator.toggle(); }
    else if (e.key === 'ArrowRight' && e.shiftKey) narrator.skip(1);
    else if (e.key === 'ArrowLeft' && e.shiftKey) narrator.skip(-1);
    else if (e.key === ']') reader.goChapter(reader.chapterIndex + 1);
    else if (e.key === '[') reader.goChapter(reader.chapterIndex - 1);
  };
  document.addEventListener('keydown', onKey);

  const onSettings = (s, patch) => {
    if (PERFORMANCE_KEYS.some((k) => k in patch) || 'serverUrl' in patch) {
      if ('serverUrl' in patch) ENGINES.server.loaded = false;
      settings.forBook(id).then((o) => { opts = o; narrator.setOptions(opts); refreshChips(); });
    }
  };
  const unsub = settings.subscribe(onSettings);

  // ---- Open at saved position ------------------------------------------------------------
  const startChapter = params.get('c') != null ? +params.get('c') : book.progress.chapter || 0;
  const startSentence = params.get('s') != null ? +params.get('s') : book.progress.sentence || 0;
  await reader.goChapter(Math.min(startChapter, reader.chapterCount - 1), startSentence);
  narrator.index = startSentence;
  if (params.get('s') != null) reader.markSentence(startSentence, { ...opts, autoScroll: true });
  updateBook(id, { lastOpened: Date.now() });
  scroller.focus({ preventScroll: true });

  return () => {
    narrator.stop(true);
    reader.destroy();
    unsub();
    document.removeEventListener('selectionchange', onSel);
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('reading');
    if ('mediaSession' in navigator) {
      ['play', 'pause', 'previoustrack', 'nexttrack'].forEach((a) => navigator.mediaSession.setActionHandler(a, null));
      navigator.mediaSession.metadata = null;
    }
  };
}

function pronunciationEditor(list, onChange) {
  const rows = h('div', { class: 'pron-list' });
  const items = list.map((x) => ({ ...x }));
  const commit = () => onChange(items.filter((x) => x.from));
  const addBtn = h('button', { class: 'btn ghost sm', onclick: () => {
    items.push({ from: '', to: '', whole: true });
    draw();
    rows.querySelectorAll('.pron-row input')[(items.length - 1) * 2]?.focus();
  } }, icon('plus', 14), 'Add word');
  function draw() {
    const rowEls = items.map((it, i) => h('div', { class: 'pron-row' },
      h('input', { type: 'text', placeholder: 'Written', value: it.from, onchange: (e) => { it.from = e.target.value; commit(); } }),
      h('span', { class: 'muted' }, '→'),
      h('input', { type: 'text', placeholder: 'Say it like', value: it.to, onchange: (e) => { it.to = e.target.value; commit(); } }),
      iconButton('x', 'Remove', () => { items.splice(i, 1); commit(); draw(); }, { size: 16 })));
    rows.replaceChildren(...rowEls, addBtn);
  }
  draw();
  return rows;
}

// iOS/Safari only allow audio that starts from a user gesture.
let unlocked = false;
export function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch {}
  import('../tts/audio.js').then(({ audioContext }) => audioContext().resume?.()).catch(() => {});
}
