// EPUB 2/3 parser: metadata, spine, table of contents, cover, and sanitized chapters.
import { openZip } from './zip.js';

const XHTML = 'http://www.w3.org/1999/xhtml';

function parseXML(text, type = 'application/xml') {
  const doc = new DOMParser().parseFromString(text, type);
  if (doc.getElementsByTagName('parsererror').length) return null;
  return doc;
}

function dirname(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i + 1);
}

export function resolvePath(base, href) {
  if (!href) return '';
  if (/^[a-z]+:/i.test(href)) return href;
  const [pathPart, hash] = href.split('#');
  let p = pathPart.startsWith('/') ? pathPart.slice(1) : dirname(base) + pathPart;
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  let joined = out.join('/');
  try { joined = decodeURIComponent(joined); } catch {}
  return hash !== undefined ? `${joined}#${hash}` : joined;
}

const byLocal = (root, name) => [...root.getElementsByTagNameNS('*', name)];
const firstText = (root, name) => byLocal(root, name)[0]?.textContent.trim() || '';

export async function openEpub(file) {
  const zip = await openZip(file);
  const container = parseXML(await zip.text('META-INF/container.xml') || '');
  const opfPath = container && byLocal(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('EPUB is missing its package file (container.xml).');
  const opf = parseXML(await zip.text(opfPath) || '');
  if (!opf) throw new Error('EPUB package file could not be read.');

  const meta = {
    title: firstText(opf, 'title') || file.name?.replace(/\.epub$/i, '') || 'Untitled',
    author: byLocal(opf, 'creator').map((e) => e.textContent.trim()).filter(Boolean).join(', ') || 'Unknown author',
    language: firstText(opf, 'language') || 'en',
    description: firstText(opf, 'description').replace(/<[^>]+>/g, ''),
  };

  const manifest = new Map();
  for (const item of byLocal(opf, 'item')) {
    manifest.set(item.getAttribute('id'), {
      id: item.getAttribute('id'),
      href: resolvePath(opfPath, item.getAttribute('href')),
      type: item.getAttribute('media-type') || '',
      props: (item.getAttribute('properties') || '').split(/\s+/),
    });
  }

  const spineEl = byLocal(opf, 'spine')[0];
  const spine = byLocal(opf, 'itemref')
    .map((r) => manifest.get(r.getAttribute('idref')))
    .filter((it) => it && /html|xml/.test(it.type));

  // Cover image
  let coverItem = [...manifest.values()].find((m) => m.props.includes('cover-image'));
  if (!coverItem) {
    const metaCover = byLocal(opf, 'meta').find((m) => m.getAttribute('name') === 'cover');
    if (metaCover) coverItem = manifest.get(metaCover.getAttribute('content'));
  }
  if (!coverItem) coverItem = [...manifest.values()].find((m) => /image/.test(m.type) && /cover/i.test(m.id + m.href));
  const cover = coverItem && /image/.test(coverItem.type) ? await zip.blob(coverItem.href, coverItem.type) : null;

  // Table of contents (EPUB3 nav, then NCX)
  let toc = [];
  const navItem = [...manifest.values()].find((m) => m.props.includes('nav'));
  if (navItem) {
    const nav = parseXML(await zip.text(navItem.href) || '', 'application/xhtml+xml')
      || new DOMParser().parseFromString(await zip.text(navItem.href) || '', 'text/html');
    const tocNav = [...nav.getElementsByTagName('nav')].find((n) =>
      (n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '').includes('toc'))
      || nav.getElementsByTagName('nav')[0];
    if (tocNav) {
      const walk = (ol, depth) => {
        for (const li of ol.children) {
          if (li.localName !== 'li') continue;
          const a = [...li.children].find((c) => c.localName === 'a' || c.localName === 'span');
          if (a) {
            const href = a.getAttribute('href');
            toc.push({ label: a.textContent.replace(/\s+/g, ' ').trim(), href: href ? resolvePath(navItem.href, href) : null, depth });
          }
          const sub = [...li.children].find((c) => c.localName === 'ol');
          if (sub) walk(sub, depth + 1);
        }
      };
      const ol = [...tocNav.children].find((c) => c.localName === 'ol');
      if (ol) walk(ol, 0);
    }
  }
  if (!toc.length) {
    const ncxItem = manifest.get(spineEl?.getAttribute('toc')) || [...manifest.values()].find((m) => m.type === 'application/x-dtbncx+xml');
    if (ncxItem) {
      const ncx = parseXML(await zip.text(ncxItem.href) || '');
      if (ncx) {
        const walk = (parent, depth) => {
          for (const np of parent.children) {
            if (np.localName !== 'navPoint') continue;
            const label = byLocal(np, 'text')[0]?.textContent.trim() || '';
            const src = byLocal(np, 'content')[0]?.getAttribute('src');
            toc.push({ label, href: src ? resolvePath(ncxItem.href, src) : null, depth });
            walk(np, depth + 1);
          }
        };
        const navMap = byLocal(ncx, 'navMap')[0];
        if (navMap) walk(navMap, 0);
      }
    }
  }
  toc = toc.map((t) => ({ ...t, chapter: t.href ? spine.findIndex((s) => s.href === t.href.split('#')[0]) : -1 }));

  const imageCache = new Map();
  async function assetUrl(path) {
    if (imageCache.has(path)) return imageCache.get(path);
    const item = [...manifest.values()].find((m) => m.href === path);
    const blob = await zip.blob(path, item?.type || '');
    const url = blob ? URL.createObjectURL(blob) : '';
    imageCache.set(path, url);
    return url;
  }

  async function chapter(index) {
    const item = spine[index];
    if (!item) return null;
    const raw = await zip.text(item.href) || '';
    let doc = parseXML(raw, 'application/xhtml+xml');
    if (!doc || !doc.body) doc = new DOMParser().parseFromString(raw, 'text/html');
    const body = doc.body || doc.getElementsByTagNameNS(XHTML, 'body')[0] || doc.documentElement;
    const frag = document.createElement('div');
    frag.append(...[...body.childNodes].map((n) => document.importNode(n, true)));
    await sanitize(frag, item.href);
    return { html: frag, href: item.href, index };
  }

  async function sanitize(root, baseHref) {
    root.querySelectorAll('script,style,link,meta,iframe,object,embed,form,input,button,textarea,select,audio,video,noscript')
      .forEach((n) => n.remove());
    for (const el of root.querySelectorAll('*')) {
      for (const attr of [...el.attributes]) {
        const n = attr.name.toLowerCase();
        if (n.startsWith('on') || n === 'style' || n === 'srcset') el.removeAttribute(attr.name);
      }
      if (el.localName === 'a' && el.hasAttribute('href')) {
        const href = el.getAttribute('href');
        el.removeAttribute('href');
        if (/^https?:/i.test(href)) {
          el.setAttribute('href', href);
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        } else if (!/^[a-z]+:/i.test(href)) {
          el.dataset.link = resolvePath(baseHref, href);
          el.setAttribute('role', 'link');
          el.tabIndex = 0;
        }
      }
    }
    for (const img of root.querySelectorAll('img')) {
      const src = img.getAttribute('src');
      img.removeAttribute('src');
      if (src && !/^[a-z]+:/i.test(src)) img.src = await assetUrl(resolvePath(baseHref, src));
      img.loading = 'lazy';
    }
    for (const im of root.querySelectorAll('image')) {
      const href = im.getAttribute('href') || im.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (href && !/^[a-z]+:/i.test(href)) {
        const url = await assetUrl(resolvePath(baseHref, href));
        im.setAttribute('href', url);
        im.setAttributeNS('http://www.w3.org/1999/xlink', 'href', url);
      }
    }
  }

  return { meta, spine, toc, cover, chapter, close: () => imageCache.forEach((u) => u && URL.revokeObjectURL(u)) };
}
