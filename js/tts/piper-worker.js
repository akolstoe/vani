// Runs Piper (fast, lightweight VITS voices) off the main thread. One job at a time;
// "now" jobs (the sentence being read) jump ahead of "later" ones.
let LIB = 'https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1/+esm';
let ttsPromise = null;
const queue = [];
let busy = false;

const load = () => {
  if (!ttsPromise) ttsPromise = import(LIB).catch((e) => { ttsPromise = null; throw e; });
  return ttsPromise;
};

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      const tts = await load();
      const t0 = performance.now();
      const wav = await tts.predict({ text: job.text, voiceId: job.voice });
      const buf = await wav.arrayBuffer();
      self.postMessage({ id: job.id, type: 'audio', wav: buf, ms: performance.now() - t0 }, [buf]);
    } catch (e) {
      self.postMessage({ id: job.id, type: 'error', message: e?.message || String(e) });
    }
  }
  busy = false;
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  if (type === 'init') {
    if (data.lib) LIB = data.lib; // test hook
    try {
      const tts = await load();
      const stored = (await tts.stored?.()) || [];
      if (!stored.includes(data.voice)) {
        await tts.download(data.voice, (p) => {
          if (p?.total) self.postMessage({ type: 'progress', progress: p.loaded / p.total, file: p.url });
        });
      }
      self.postMessage({ id, type: 'ready' });
    } catch (e) {
      self.postMessage({ id, type: 'error', message: e?.message || String(e) });
    }
  } else if (type === 'generate') {
    const job = { id, text: data.text, voice: data.voice, priority: data.priority };
    if (data.priority === 'now') {
      const i = queue.findIndex((j) => j.priority !== 'now');
      queue.splice(i < 0 ? queue.length : i, 0, job);
    } else queue.push(job);
    pump();
  } else if (type === 'drop-later') {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].priority !== 'now') {
        self.postMessage({ id: queue[i].id, type: 'error', message: 'dropped' });
        queue.splice(i, 1);
      }
    }
  }
};
