// Runs the Kokoro model off the main thread so the app never freezes while it thinks.
const LIB = 'https://cdn.jsdelivr.net/npm/kokoro-js@1/+esm';
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let ttsPromise = null;

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    if (type === 'init') {
      if (!ttsPromise) {
        ttsPromise = (async () => {
          const { KokoroTTS } = await import(LIB);
          const webgpu = data.allowGpu && !!self.navigator.gpu && !!(await self.navigator.gpu.requestAdapter().catch(() => null));
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
      const { device } = await ttsPromise;
      self.postMessage({ id, type: 'ready', device });
    } else if (type === 'generate') {
      const { tts } = await ttsPromise;
      const out = await tts.generate(data.text, { voice: data.voice, speed: data.speed });
      const audio = out.audio instanceof Float32Array ? out.audio : new Float32Array(out.audio);
      self.postMessage({ id, type: 'audio', audio, sampleRate: out.sampling_rate }, [audio.buffer]);
    }
  } catch (e) {
    self.postMessage({ id, type: 'error', message: e?.message || String(e) });
  }
};
