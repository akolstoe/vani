// Renders chapters, splits them into speakable sentences, and handles highlighting,
// selection, internal links/footnotes and reading position.

const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'div', 'td', 'th', 'dd', 'dt',
  'figcaption', 'pre', 'section', 'article', 'aside', 'header', 'footer', 'caption', 'address', 'body', 'tr']);
const HEADING = /^h[1-6]$/;
const WORDCH = /[\p{L}\p{N}'’\-]/u;
const ABBREV = /(?:^|[\s(“"])(?:Mr|Mrs|Ms|Mx|Dr|St|Mt|Prof|Rev|Gen|Gov|Capt|Lt|Col|Sgt|Sr|Jr|Hon|vs|etc|viz|cf|al|No|Vol|Ch|pp?|ca|approx|[A-Z])\.$/;
const hasHighlights = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
export const HL_COLORS = ['yellow', 'green', 'blue', 'pink'];

function segmentSentences(text, lang) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      return [...new Intl.Segmenter(lang || 'en', { granularity: 'sentence' }).segment(text)]
        .map((s) => [s.index, s.index + s.segment.length]);
    } catch {}
  }
  const out = [];
  const re = /[^.!?…]+(?:[.!?…]+["'”’)\]]*\s*|$)/g;
  let m;
  while ((m = re.exec(text)) && m[0]) out.push([m.index, m.index + m[0].length]);
  return out;
}

export class Reader extends EventTarget {
  constructor(el, book, { lang } = {}) {
    super();
    this.el = el;
    this.book = book;
    this.lang = lang || book.meta.language;
    this.chapterIndex = -1;
    this.sentences = [];
    this.noteRanges = [];
    this._onScroll = this._onScroll.bind(this);
    el.addEventListener('scroll', this._onScroll, { passive: true });
    el.addEventListener('click', (e) => this._onClick(e));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.dataset?.link) this._followLink(e.target);
    });
  }

  destroy() {
    this.el.removeEventListener('scroll', this._onScroll);
    if (hasHighlights) ['vani-sentence', 'vani-word', ...HL_COLORS.map((c) => `vani-hl-${c}`)].forEach((n) => CSS.highlights.delete(n));
    this.book.close();
  }

  get chapterCount() { return this.book.spine.length; }

  async goChapter(index, sentence = 0, { hash, smooth = false } = {}) {
    if (index < 0 || index >= this.chapterCount) return false;
    if (index !== this.chapterIndex) {
      const ch = await this.book.chapter(index);
      if (!ch) return false;
      this.chapterIndex = index;
      this.el.replaceChildren();
      const article = document.createElement('article');
      article.className = 'chapter';
      article.lang = this.lang;
      article.append(...ch.html.childNodes);
      this.el.append(article, this._chapterNav());
      this._buildSentences(article);
      this.el.scrollTop = 0;
      this.dispatchEvent(new CustomEvent('chapter', { detail: { index } }));
    }
    if (hash) {
      const target = this.el.querySelector(`[id="${CSS.escape(hash)}"]`);
      if (target) target.scrollIntoView({ block: 'start' });
    } else if (sentence > 0) {
      this.scrollToSentence(sentence, smooth ? 'smooth' : 'auto', 'start');
    }
    this._emitPosition();
    return true;
  }

  _chapterNav() {
    const nav = document.createElement('nav');
    nav.className = 'chapter-nav';
    const prev = document.createElement('button');
    prev.className = 'btn ghost';
    prev.textContent = '← Previous chapter';
    prev.disabled = this.chapterIndex === 0;
    prev.onclick = () => this.goChapter(this.chapterIndex - 1);
    const next = document.createElement('button');
    next.className = 'btn';
    const last = this.chapterIndex >= this.chapterCount - 1;
    next.textContent = last ? 'The end' : 'Next chapter →';
    next.disabled = last;
    next.onclick = () => this.goChapter(this.chapterIndex + 1);
    nav.append(prev, next);
    return nav;
  }

  _buildSentences(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest('rt, rp, svg, nav.chapter-nav') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const groups = [];
    let cur = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      let b = n.parentElement;
      while (b && b !== root && !BLOCK.has(b.localName)) b = b.parentElement;
      if (!cur || cur.block !== b) { cur = { block: b, nodes: [] }; groups.push(cur); }
      cur.nodes.push(n);
    }

    const sentences = [];
    for (const g of groups) {
      const full = g.nodes.map((n) => n.data).join('');
      if (!/[\p{L}\p{N}]/u.test(full)) continue;
      const norm = full.replace(/\s/g, ' ');
      const kind = g.block && HEADING.test(g.block.localName) ? 'heading' : 'text';
      const ranges = [];
      for (const [a, b] of segmentSentences(norm, this.lang)) {
        let s = a, e = b;
        while (s < e && norm[s] === ' ') s++;
        while (e > s && norm[e - 1] === ' ') e--;
        if (s >= e) continue;
        const seg = norm.slice(s, e);
        const prev = ranges[ranges.length - 1];
        const prevText = prev ? norm.slice(prev[0], prev[1]) : '';
        const shouldMerge = prev && (
          !/\p{L}/u.test(seg) || // "[1]", "12." etc.
          /^[\p{Ll}]/u.test(seg) || // “Is anyone there?” he called.
          ABBREV.test(prevText) || // Dr. Hale
          /[\[(]$/.test(prevText) // split inside brackets
        );
        if (shouldMerge) prev[1] = e;
        else if (/[\p{L}\p{N}]/u.test(seg)) ranges.push([s, e]);
      }
      if (!ranges.length) continue;
      const base = sentences.length;
      ranges.forEach(([s, e], k) => sentences.push({
        i: base + k, start: s, end: e, text: norm.slice(s, e).replace(/ {2,}/g, (m) => ' '.repeat(m.length)),
        kind, paraEnd: k === ranges.length - 1, parts: [], block: g.block,
      }));

      // Wrap each sentence's pieces of each text node in spans.
      let offset = 0;
      for (const node of g.nodes) {
        const nStart = offset, nEnd = offset + node.data.length;
        offset = nEnd;
        const frag = document.createDocumentFragment();
        let pos = nStart;
        for (let k = 0; k < ranges.length; k++) {
          const [s, e] = ranges[k];
          const a = Math.max(s, nStart), b = Math.min(e, nEnd);
          if (a >= b) continue;
          if (a > pos) frag.append(full.slice(pos, a));
          const span = document.createElement('span');
          span.className = 's';
          span.dataset.s = base + k;
          const t = document.createTextNode(full.slice(a, b));
          span.append(t);
          frag.append(span);
          sentences[base + k].parts.push({ node: t, offset: a - s, span });
          pos = b;
        }
        if (pos === nStart) continue; // untouched node
        if (pos < nEnd) frag.append(full.slice(pos, nEnd));
        node.replaceWith(frag);
      }
    }
    this.sentences = sentences;
  }

  // ---- Highlighting ---------------------------------------------------------

  _rangeFor(i, from = 0, to = Infinity) {
    const s = this.sentences[i];
    if (!s || !s.parts.length) return null;
    const r = document.createRange();
    let started = false;
    for (const p of s.parts) {
      const len = p.node.data.length;
      if (!started && from < p.offset + len) {
        r.setStart(p.node, Math.max(0, from - p.offset));
        started = true;
      }
      if (started && to <= p.offset + len) {
        r.setEnd(p.node, Math.max(0, Math.min(len, to - p.offset)));
        return r;
      }
    }
    const last = s.parts[s.parts.length - 1];
    if (!started) return null;
    r.setEnd(last.node, last.node.data.length);
    return r;
  }

  markSentence(i, opts = {}) {
    this.current = i;
    this.el.querySelectorAll('.s.active').forEach((n) => n.classList.remove('active'));
    if (hasHighlights) CSS.highlights.delete('vani-word');
    const s = this.sentences[i];
    if (!s) return;
    if (opts.highlight !== 'none') {
      if (hasHighlights) {
        const r = this._rangeFor(i);
        if (r) CSS.highlights.set('vani-sentence', new Highlight(r));
      } else {
        s.parts.forEach((p) => p.span.classList.add('active'));
      }
    } else if (hasHighlights) CSS.highlights.delete('vani-sentence');
    if (opts.autoScroll !== false) this.scrollToSentence(i, 'smooth', 'center', true);
    this._emitPosition(i);
  }

  markWord(i, charOffset) {
    if (!hasHighlights) return;
    const s = this.sentences[i];
    if (!s) return;
    const t = s.text;
    let a = Math.max(0, Math.min(charOffset, t.length - 1));
    while (a < t.length && !WORDCH.test(t[a])) a++;
    while (a > 0 && WORDCH.test(t[a - 1])) a--;
    let b = a;
    while (b < t.length && WORDCH.test(t[b])) b++;
    if (b <= a) return;
    const r = this._rangeFor(i, a, b);
    if (r) CSS.highlights.set('vani-word', new Highlight(r));
  }

  clearMarks() {
    if (hasHighlights) { CSS.highlights.delete('vani-sentence'); CSS.highlights.delete('vani-word'); }
    this.el.querySelectorAll('.s.active').forEach((n) => n.classList.remove('active'));
  }

  scrollToSentence(i, behavior = 'smooth', block = 'center', onlyIfNeeded = false) {
    const span = this.sentences[i]?.parts[0]?.span;
    if (!span) return;
    if (onlyIfNeeded) {
      const r = span.getBoundingClientRect(), c = this.el.getBoundingClientRect();
      if (r.top > c.top + c.height * 0.15 && r.bottom < c.bottom - c.height * 0.3) return;
    }
    span.scrollIntoView({ behavior, block });
  }

  // ---- Notes / highlights -----------------------------------------------------

  applyNotes(notes) {
    this.noteRanges = [];
    if (!hasHighlights) return;
    const byColor = Object.fromEntries(HL_COLORS.map((c) => [c, []]));
    for (const n of notes) {
      if (n.chapter !== this.chapterIndex || !n.anchor) continue;
      const r = this._rangeBetween(n.anchor);
      if (!r) continue;
      (byColor[n.color] || byColor.yellow).push(r);
      this.noteRanges.push({ note: n, range: r });
    }
    for (const c of HL_COLORS) {
      if (byColor[c].length) CSS.highlights.set(`vani-hl-${c}`, new Highlight(...byColor[c]));
      else CSS.highlights.delete(`vani-hl-${c}`);
    }
  }

  _rangeBetween({ s1, o1, s2, o2 }) {
    const a = this._rangeFor(s1, o1, o1 + 1);
    const b = this._rangeFor(s2, Math.max(0, o2 - 1), o2);
    if (!a || !b) return null;
    const r = document.createRange();
    r.setStart(a.startContainer, a.startOffset);
    r.setEnd(b.endContainer, b.endOffset);
    return r;
  }

  _locate(node, offset) {
    if (node.nodeType !== Node.TEXT_NODE) {
      const child = node.childNodes[Math.min(offset, node.childNodes.length - 1)] || node;
      const span = child.nodeType === 1 ? (child.closest?.('.s') || child.querySelector?.('.s')) : child.parentElement?.closest('.s');
      if (!span) return null;
      const i = +span.dataset.s;
      const part = this.sentences[i]?.parts.find((p) => p.span === span);
      return part ? { s: i, o: part.offset } : null;
    }
    const span = node.parentElement?.closest('.s');
    if (!span) return null;
    const i = +span.dataset.s;
    const part = this.sentences[i]?.parts.find((p) => p.node === node);
    return part ? { s: i, o: part.offset + offset } : null;
  }

  selection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!this.el.contains(r.commonAncestorContainer)) return null;
    const a = this._locate(r.startContainer, r.startOffset);
    const b = this._locate(r.endContainer, r.endOffset);
    const quote = sel.toString().replace(/\s+/g, ' ').trim();
    if (!a || !b || !quote) return null;
    return { chapter: this.chapterIndex, anchor: { s1: a.s, o1: a.o, s2: b.s, o2: b.o }, quote, rect: r.getBoundingClientRect() };
  }

  sentenceAt(x, y) {
    const el = document.elementFromPoint(x, y)?.closest?.('.s');
    return el ? +el.dataset.s : null;
  }

  noteAtPoint(x, y) {
    let node, offset;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (!p) return null;
      node = p.offsetNode; offset = p.offset;
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (!r) return null;
      node = r.startContainer; offset = r.startOffset;
    } else return null;
    return this.noteRanges.find(({ range }) => {
      try { return range.isPointInRange(node, offset); } catch { return false; }
    })?.note || null;
  }

  // ---- Links & footnotes ------------------------------------------------------

  _onClick(e) {
    const link = e.target.closest?.('[data-link]');
    if (link) { e.preventDefault(); this._followLink(link); return; }
    const note = this.noteAtPoint(e.clientX, e.clientY);
    if (note && window.getSelection()?.isCollapsed) {
      this.dispatchEvent(new CustomEvent('noteclick', { detail: { note } }));
    }
  }

  async _followLink(a) {
    const [path, hash] = a.dataset.link.split('#');
    const index = path ? this.book.spine.findIndex((s) => s.href === path) : this.chapterIndex;
    if (index < 0) return;
    const looksLikeNote = /^\s*[\[(]?[\d*†‡a-z]{1,3}[\])]?\s*$/i.test(a.textContent) ||
      (a.getAttribute('epub:type') || '').includes('noteref');
    if (looksLikeNote && hash) {
      let target = index === this.chapterIndex ? this.el.querySelector(`[id="${CSS.escape(hash)}"]`) : null;
      if (!target) {
        const ch = await this.book.chapter(index);
        target = ch?.html.querySelector(`[id="${CSS.escape(hash)}"]`);
      }
      if (target) {
        const block = target.closest('aside, li, p, div') || target;
        const text = (block.textContent || target.textContent).replace(/\s+/g, ' ').trim();
        this.dispatchEvent(new CustomEvent('footnote', { detail: { text, rect: a.getBoundingClientRect(), index, hash } }));
        return;
      }
    }
    this.goChapter(index, 0, { hash });
  }

  // ---- Position -----------------------------------------------------------------

  visibleSentence() {
    const c = this.el.getBoundingClientRect();
    for (let y = c.top + 24; y < c.top + c.height / 2; y += 18) {
      for (const x of [c.left + c.width * 0.5, c.left + c.width * 0.3, c.left + c.width * 0.7]) {
        const i = this.sentenceAt(x, y);
        if (i !== null) return i;
      }
    }
    return null;
  }

  _onScroll() {
    clearTimeout(this._st);
    this._st = setTimeout(() => this._emitPosition(), 250);
  }

  _emitPosition(sentence) {
    const s = sentence ?? this.visibleSentence() ?? 0;
    const n = Math.max(1, this.sentences.length);
    const percent = (this.chapterIndex + s / n) / this.chapterCount;
    this.dispatchEvent(new CustomEvent('position', { detail: { chapter: this.chapterIndex, sentence: s, percent } }));
  }
}
