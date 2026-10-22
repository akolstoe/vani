// Tiny IndexedDB wrapper. Stores: books, notes, kv (settings and misc).
const DB_NAME = 'vani';
const VERSION = 1;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('notes')) {
        const s = db.createObjectStore('notes', { keyPath: 'id' });
        s.createIndex('bookId', 'bookId');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export const db = {
  async get(s, key) { return wrap((await store(s)).get(key)); },
  async all(s) { return wrap((await store(s)).getAll()); },
  async put(s, value) { return wrap((await store(s, 'readwrite')).put(value)); },
  async del(s, key) { return wrap((await store(s, 'readwrite')).delete(key)); },
  async byIndex(s, index, value) { return wrap((await store(s)).index(index).getAll(value)); },
  async clear(s) { return wrap((await store(s, 'readwrite')).clear()); },
};

export async function getKV(key, fallback) {
  const row = await db.get('kv', key);
  return row ? row.value : fallback;
}
export async function setKV(key, value) {
  return db.put('kv', { key, value });
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
