// Runs the Kokoro model off the main thread so the app never freezes while it thinks.
// Jobs run strictly one at a time; "now" jobs (the sentence being read) jump ahead of
// "later" jobs (sentences prepared in advance).
let LIB = 'https://cdn.jsdelivr.net/npm/kokoro-js@1/+esm';
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let ttsPromise = null;
const queue = [];
let busy = false;

function init(allowGpu) {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const { KokoroTTS } = await import(LIB);
      const webgpu = allowGpu && !!self.navigator.gpu && !!(await self.navigator.gpu.requestAdapter().catch(() => null));
      const tts = await KokoroTTS.from_pretrained(MODEL, {
        dtype: webgpu ? 'fp32' : 'q8',
        device: webgpu ? 'webgpu' : 'wasm',
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) self.postMessage({ type: 'progress', progress: p.loaded / p.total, file: p.file });
        },
      });
      return { tts, device: webgpu ? 'WebGPU' : 'WebAssembly' };
    })().catch((e) => { ttsPromise = null; throw e; });
  }
  return ttsPromise;
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      const { tts } = await ttsPromise;
      const t0 = performance.now();
      const out = await tts.generate(job.text, { voice: job.voice, speed: job.speed });
      const audio = out.audio instanceof Float32Array ? out.audio : new Float32Array(out.audio);
      const ms = performance.now() - t0;
      self.postMessage({ id: job.id, type: 'audio', audio, sampleRate: out.sampling_rate, ms }, [audio.buffer]);
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
      const { device } = await init(data.allowGpu);
      self.postMessage({ id, type: 'ready', device });
    } catch (e) {
      self.postMessage({ id, type: 'error', message: e?.message || String(e) });
    }
  } else if (type === 'generate') {
    const job = { id, text: data.text, voice: data.voice, speed: data.speed, priority: data.priority };
    if (data.priority === 'now') {
      const i = queue.findIndex((j) => j.priority !== 'now');
      queue.splice(i < 0 ? queue.length : i, 0, job);
    } else queue.push(job);
    pump();
  } else if (type === 'bump') {
    const i = queue.findIndex((j) => j.id === data.job);
    if (i > 0) {
      const [job] = queue.splice(i, 1);
      job.priority = 'now';
      const k = queue.findIndex((j) => j.priority !== 'now');
      queue.splice(k < 0 ? queue.length : k, 0, job);
    }
  } else if (type === 'drop-later') {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].priority !== 'now') {
        self.postMessage({ id: queue[i].id, type: 'error', message: 'dropped' });
        queue.splice(i, 1);
      }
    }
  }
};
