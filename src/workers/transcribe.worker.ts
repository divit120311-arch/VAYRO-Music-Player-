/// <reference lib="webworker" />
/**
 * On-device lyric transcription (Whisper via transformers.js), word-level timestamps.
 *
 * Speed:
 *  - Runs on the CPU (WebAssembly, 8-bit). WebGPU can be forced for testing, but measured slower
 *    or broken on integrated GPUs, so it is not used automatically.
 *  - The song is processed in ~20 s sections, starting with the section being listened to, and
 *    each finished section is posted straight back, so lyrics appear while the rest is processed.
 *
 * Accuracy:
 *  - `language` can be forced (e.g. Hindi): auto-detection often mislabels Hindi as Urdu or
 *    transliterates it badly.
 *  - Each section gets 5 s of lead-in context. If the word aligner still collapses (every word
 *    on one timestamp — happens when a section starts in silence), the section is re-run with
 *    more context.
 *
 * Protocol
 *   in : { type: 'run', id, audio: Float32Array (16 kHz), pieces: [keepFrom, to][] (in processing
 *          order), language?: string, model: 'base' | 'small' }
 *        { type: 'cancel', id }
 *   out: { type: 'progress', id, phase: 'model' | 'listen', progress }
 *        { type: 'device', id, device: 'webgpu' | 'wasm' }
 *        { type: 'partial', id, words, done, total }
 *        { type: 'done', id } | { type: 'cancelled', id } | { type: 'error', id, message }
 */
import { pipeline, env, Tensor, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

const SR = 16000;
const CONTEXT = 5 * SR;
env.allowLocalModels = false;

type Device = 'webgpu' | 'wasm';
type Model = 'base' | 'small';
interface Word { text: string; start: number; end: number }
interface Chunk { text: string; timestamp: [number, number | null] }

const cancelled = new Set<number>();
const post = (m: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
const cache = new Map<string, Promise<AutomaticSpeechRecognitionPipeline>>();


function load(model: Model, device: Device, id: number, dtypeOverride?: string) {
  const key = `${model}:${device}:${dtypeOverride ?? ''}`;
  let p = cache.get(key);
  if (!p) {
    const files = new Map<string, { loaded: number; total: number }>();
    let lastPct = -1;
    // (cast: the overloaded pipeline() typing is too complex for tsc to resolve here)
    const make = pipeline as unknown as (task: string, model: string, opts: object) => Promise<AutomaticSpeechRecognitionPipeline>;
    p = make('automatic-speech-recognition', `onnx-community/whisper-${model}_timestamped`, {
      device,
      dtype: dtypeOverride ? JSON.parse(dtypeOverride) : device === 'webgpu' ? { encoder_model: 'fp16', decoder_model_merged: 'q4f16' } : 'q8',
      progress_callback: (e: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (e.status !== 'progress' || !e.file) return;
        files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 });
        let a = 0;
        let b = 0;
        for (const f of files.values()) {
          a += f.loaded;
          b += f.total;
        }
        // whole-percent steps only: per-chunk events would flood the UI thread
        const pct = b > 0 ? Math.floor((a / b) * 100) : 0;
        if (b > 0 && pct !== lastPct) {
          lastPct = pct;
          post({ type: 'progress', id, phase: 'model', progress: pct / 100 });
        }
      },
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/**
 * The song's language (see server/asr/worker.mjs): transformers.js has no language detection and
 * silently uses English, which makes Whisper TRANSLATE Hindi / Punjabi singing into English. One
 * decoder step after <|startoftranscript|> scores the language tokens; the best wins (Urdu → Hindi).
 */
async function detectLanguage(asr: AutomaticSpeechRecognitionPipeline, audio: Float32Array): Promise<string | undefined> {
  type Fn = (x: object) => Promise<{ logits: Tensor }>;
  const p = asr as unknown as { processor: (a: Float32Array) => Promise<{ input_features: Tensor }>; model: Fn & { generation_config: { decoder_start_token_id: number; lang_to_id?: Record<string, number> } } };
  const { input_features } = await p.processor(audio);
  const cfg = p.model.generation_config;
  const out = await p.model({ input_features, decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(cfg.decoder_start_token_id)]), [1, 1]) });
  const data = out.logits.data as Float32Array;
  const vocab = out.logits.dims[out.logits.dims.length - 1];
  const base = data.length - vocab;
  let best: string | undefined;
  let top = -Infinity;
  for (const [token, tid] of Object.entries(cfg.lang_to_id ?? {})) {
    if (data[base + tid] > top) {
      top = data[base + tid];
      best = token.slice(2, -2);
    }
  }
  return best === 'ur' ? 'hi' : best;
}

/** every word on (nearly) the same instant = the aligner failed for this section */
function collapsed(words: Word[]) {
  if (words.length < 3) return false;
  const starts = new Set(words.map((w) => w.start.toFixed(1)));
  return starts.size <= Math.max(1, words.length * 0.2);
}

async function runPiece(model: AutomaticSpeechRecognitionPipeline, audio: Float32Array, keepFrom: number, to: number, language: string | undefined, lead: number) {
  const from = Math.max(0, keepFrom - lead);
  const out = (await model(audio.subarray(from, to), {
    return_timestamps: 'word',
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
    ...(language ? { language } : {}),
  } as never)) as { chunks?: Chunk[] };
  const offset = from / SR;
  const words: Word[] = [];
  for (const c of out.chunks ?? []) {
    const s = c.timestamp[0];
    if (typeof s !== 'number' || !Number.isFinite(s)) continue;
    const start = offset + s;
    const end = offset + Math.max(s, c.timestamp[1] ?? s + 0.3);
    // words in the lead-in belong to the previous section
    if ((start + end) / 2 < keepFrom / SR || start >= to / SR) continue;
    words.push({ text: c.text, start, end });
  }
  return words;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.id);
    return;
  }
  if (msg.type !== 'run') return;
  const { id, audio, pieces, model: size, device: forced, dtype } = msg as { id: number; audio: Float32Array; pieces: [number, number][]; language?: string; model: Model; device?: Device; dtype?: string };
  // CPU by default. Measured on an AMD integrated GPU (30 s clip, model cached): CPU 54 s;
  // WebGPU fp32+q4 71 s (slower); WebGPU fp16+q4f16 produced no words at all. The GPU path stays
  // available for testing via `device`, but isn't used automatically until it proves faster.
  let device: Device = forced ?? 'wasm';
  try {
    post({ type: 'progress', id, phase: 'model', progress: 0 });
    let model: AutomaticSpeechRecognitionPipeline;
    try {
      model = await load(size, device, id, dtype);
    } catch (err) {
      if (device !== 'webgpu') throw err;
      device = 'wasm'; // GPU initialisation failed → CPU
      model = await load(size, device, id);
    }
    post({ type: 'device', id, device });
    let language = msg.language as string | undefined;
    if (!language) {
      // 30 s from about a quarter of the way in, where there's usually singing
      const a = Math.max(0, Math.min(Math.floor(audio.length * 0.25), audio.length - 30 * SR));
      language = await detectLanguage(model, audio.subarray(a, Math.min(audio.length, a + 30 * SR))).catch(() => undefined);
      post({ type: 'language', id, language });
    }
    for (let k = 0; k < pieces.length; k++) {
      if (cancelled.has(id)) {
        cancelled.delete(id);
        return post({ type: 'cancelled', id });
      }
      post({ type: 'progress', id, phase: 'listen', progress: k / pieces.length });
      const [keepFrom, to] = pieces[k];
      let words: Word[];
      try {
        words = await runPiece(model, audio, keepFrom, to, language, CONTEXT);
      } catch (err) {
        if (device !== 'webgpu') throw err;
        // a GPU failure mid-way (driver reset, out of memory) → continue on the CPU
        device = 'wasm';
        model = await load(size, device, id);
        post({ type: 'device', id, device });
        words = await runPiece(model, audio, keepFrom, to, language, CONTEXT);
      }
      if (collapsed(words)) words = await runPiece(model, audio, keepFrom, to, language, 15 * SR);
      post({ type: 'partial', id, words, done: k + 1, total: pieces.length });
    }
    post({ type: 'progress', id, phase: 'listen', progress: 1 });
    post({ type: 'done', id });
  } catch (err) {
    post({ type: 'error', id, message: (err as Error)?.message ?? String(err) });
  }
};
