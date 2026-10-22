# Vani

**Vāṇī** (वाणी) — Sanskrit for voice, speech, the spoken word.

Vani is a free, open-source EPUB library and reader that reads any book aloud in the voice you choose, with a performance panel for how it's read and a linked note-taking system for what you think about it.

It runs entirely in your browser — no account, no server, no tracking. Install it on your phone or computer like an app.

## Features

**Library**
- Import any DRM-free EPUB (button, drag-and-drop, or "Open with" once installed)
- Covers, search, sort, reading progress, "continue listening"
- Discover and add 70,000+ free public-domain books from Project Gutenberg

**Reader**
- Paper, sepia and night themes; book, classic, sans and high-legibility typefaces
- Adjustable size, spacing and line width; table of contents; footnote pop-ups

**Read-aloud performance**
- Three voice engines:
  - **Device voices** — built into your browser/OS, instant and offline
  - **Kokoro** — open-weight neural voices that run privately in your browser
  - **Your voices** — custom and cloned voices from a voice server you run yourself
- Separate voice for dialogue (text in quotes)
- Speed, pitch, volume
- Pauses between sentences, paragraphs, headings and chapters
- Word-by-word and sentence highlighting, auto-scroll, auto-advance
- Pronunciation dictionary ("Hermione → Her-my-oh-nee")
- Presets: Audiobook, Quick listen, Bedtime, Dramatic, Study
- Per-book or global settings
- Sleep timer, lock-screen / headphone controls, keyboard shortcuts

**Linked notes**
- Highlight in four colors, attach notes
- Link notes to each other or to books with `[[Title]]` (with autocomplete)
- Backlinks on every note; jump from any highlight back to its place in the book
- Export notes as Markdown; back up and restore

## Run it

It's static files — no build step.

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

Or host it free on GitHub Pages: repo **Settings → Pages → Deploy from a branch → `main` / root**.

## Voices you have permission to use

The voice server lets you clone a voice from a short recording. Use your own voice, or a voice whose owner has agreed. Vani asks you to confirm this before creating a voice.

## Project layout

```
index.html, styles.css, sw.js, manifest.webmanifest
js/
  app.js            router, appearance
  epub.js, zip.js   EPUB parsing (no dependencies)
  reader.js         rendering, sentence splitting, highlighting
  notes.js          notes, wikilinks, backlinks, Markdown
  catalog.js        Project Gutenberg via Gutendex
  tts/              narrator + engines (webspeech, kokoro, server)
  views/            library, reader, notes, discover, voices, settings
server/             self-hosted voice server (custom & cloned voices)
```

## License

MIT
