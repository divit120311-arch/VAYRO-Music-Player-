// Speech-recognition worker thread (Whisper via transformers.js on onnxruntime-node).
//
// Runs the model natively (multi-threaded, AVX2) instead of in the browser's single-threaded
// WebAssembly: on a 2-core Ryzen 3 this measured ~10x faster (30 s clip: 54.5 s → 5.0 s).
// One section at a time; the job scheduler in ./index.mjs decides which section comes next.
//
// in : { type: 'section', reqId, model, language?, audio: Float32Array (16 kHz, lead-in + section),
//        keepFromSec, offsetSec }
// out: { type: 'loaded', model, ms } | { type: 'result', reqId, words, ms } | { type: 'error', reqId, message }
import { parentPort } from 'node:worker_threads';
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
// the desktop app keeps downloaded models in its writable data folder
if (process.env.VAYRO_DATA) env.cacheDir = process.env.VAYRO_DATA + '/models';
const SR = 16000;
const models = new Map();

function load(model) {
  let p = models.get(model);
  if (!p) {
    const t0 = performance.now();
    p = pipeline('automatic-speech-recognition', `onnx-community/whisper-${model}_timestamped`, { dtype: 'q8' }).then((asr) => {
      parentPort.postMessage({ type: 'loaded', model, ms: Math.round(performance.now() - t0) });
      return asr;
    });
    p.catch(() => models.delete(model));
    models.set(model, p);
  }
  return p;
}

async function recognise(asr, audio, language, offsetSec, keepFromSec) {
  const out = await asr(audio, {
    return_timestamps: 'word',
    task: 'transcribe', // never translate
    chunk_length_s: 30,
    stride_length_s: 5,
    // On sung vocals Whisper's decoder sometimes loops on a repeated token until its 448-token
    // limit (measured: 47 s for 16 s of audio). ~9 tokens a second is above even fast rap, so this
    // only cuts runaway loops short.
    max_new_tokens: Math.min(440, Math.ceil(Math.min(30, audio.length / 16000) * 9) + 24),
    ...(language ? { language } : {}),
  });
  const words = [];
  for (const c of out.chunks ?? []) {
    const s = c.timestamp?.[0];
    if (typeof s !== 'number' || !Number.isFinite(s)) continue;
    const start = offsetSec + s;
    const end = offsetSec + Math.max(s, c.timestamp[1] ?? s + 0.3);
    // A word belongs to the previous section if it ENDS in the lead-in. (Not the midpoint: the
    // first word after a pause gets its start stretched back into the pause, which would push a
    // word sung just after the cut into the lead-in — and lose it from both sections.)
    if (end <= keepFromSec + 0.05) continue;
    words.push({ text: c.text, start: +start.toFixed(3), end: +end.toFixed(3) });
  }
  return words;
}

/** every word on (nearly) one instant = the word aligner failed for this section */
function collapsed(words) {
  if (words.length < 3) return false;
  return new Set(words.map((w) => w.start.toFixed(1))).size <= Math.max(1, words.length * 0.2);
}

parentPort.on('message', async (m) => {
  if (m.type !== 'section') return;
  const t0 = performance.now();
  try {
    const asr = await load(m.model);
    const audio = new Float32Array(m.audio.buffer, m.audio.byteOffset, m.audio.length);
    let words = await recognise(asr, audio, m.language, m.offsetSec, m.keepFromSec);
    // retry a collapsed section with more lead-in context (the caller supplies it as `retry`)
    if (collapsed(words) && m.retry) {
      const r = new Float32Array(m.retry.audio.buffer, m.retry.audio.byteOffset, m.retry.audio.length);
      words = await recognise(asr, r, m.language, m.retry.offsetSec, m.keepFromSec);
    }
    parentPort.postMessage({ type: 'result', reqId: m.reqId, words, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    parentPort.postMessage({ type: 'error', reqId: m.reqId, message: err?.message ?? String(err) });
  }
});

export const SAMPLE_RATE = SR;
