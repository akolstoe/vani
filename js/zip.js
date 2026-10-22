// Minimal ZIP reader (stored + deflate) using the browser's DecompressionStream.
// Enough for EPUB files; no external dependencies.

export async function openZip(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is not a valid EPUB (zip) archive.');

  const count = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder('utf-8');
  const entries = new Map();
  const lower = new Map();

  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = utf8.decode(buf.subarray(p + 46, p + 46 + nlen));
    entries.set(name, { method, csize, usize, lho });
    lower.set(name.toLowerCase(), name);
    p += 46 + nlen + xlen + clen;
  }

  const find = (name) => {
    if (entries.has(name)) return name;
    let dec = name;
    try { dec = decodeURIComponent(name); } catch {}
    if (entries.has(dec)) return dec;
    return lower.get(dec.toLowerCase()) || null;
  };

  async function bytes(name) {
    const key = find(name);
    if (!key) return null;
    const e = entries.get(key);
    const l = e.lho;
    const nlen = dv.getUint16(l + 26, true);
    const xlen = dv.getUint16(l + 28, true);
    const start = l + 30 + nlen + xlen;
    const data = buf.subarray(start, start + e.csize);
    if (e.method === 0) return data.slice();
    if (e.method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error(`Unsupported compression method ${e.method} for ${key}`);
  }

  return {
    names: () => [...entries.keys()],
    has: (n) => !!find(n),
    bytes,
    async text(n) {
      const b = await bytes(n);
      return b ? utf8.decode(b) : null;
    },
    async blob(n, type = '') {
      const b = await bytes(n);
      return b ? new Blob([b], { type }) : null;
    },
  };
}
