// Transcription jobs for the user's own audio files (local helper — loopback clients only).
//
//  - One job per (file hash, model, language): repeated / concurrent requests join it.
//  - Results are cached on disk (server/.cache/transcripts); finished songs are never transcribed
//    again, and an interrupted job resumes from the sections it already finished.
//  - The audio is split into 20–25 s sections cut at quiet moments, processed starting where the
//    listener is; each finished section is available to the client immediately.
//  - Priority 0 (the track being played) always goes before priority 1 (prefetching the next
//    track); a single native worker thread does the recognition.
//  - Near-silent sections are skipped (no speech to find; Whisper invents text for silence).
import { Worker } from 'node:worker_threads';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const SR = 16000;
const LEAD = 5 * SR; // lead-in context per section
const RETRY_LEAD = 15 * SR;
const MAX_SECONDS = 20 * 60;
const MODELS = new Set(['base', 'small']);
const LANGS = /^(auto|[a-z]{2,3})$/;
const here = path.dirname(fileURLToPath(import.meta.url));
// the desktop app passes a writable folder (its own install folder is read-only)
const CACHE_DIR = process.env.VAYRO_DATA ? path.join(process.env.VAYRO_DATA, 'transcripts') : path.resolve(here, '..', '.cache', 'transcripts');

const jobs = new Map(); // key → job
const modelInit = new Map(); // model → ms (first load in this server process)
let worker = null;
let busy = null; // { job, idx, reqId }
let reqSeq = 0;

const keyOf = (hash, model, lang) => `${hash}.${model}.${lang}`;
const fileOf = (key) => path.join(CACHE_DIR, `${key}.json`);

function getWorker() {
  if (worker) return worker;
  worker = new Worker(path.join(here, 'worker.mjs'));
  worker.on('message', onWorkerMessage);
  worker.on('error', (err) => {
    console.error('[asr] worker crashed:', err?.message);
    const b = busy;
    busy = null;
    worker = null;
    if (b) {
      b.job.failures = (b.job.failures ?? 0) + 1;
      if (b.job.failures > 2) fail(b.job, `Speech recognition crashed: ${err?.message ?? err}`);
    }
    setImmediate(pump);
  });
  return worker;
}

/** cut points at the quietest 50 ms frame 20–25 s into each section (≤ 30 s with lead-in) */
function planSections(audio) {
  const F = SR / 20;
  const frames = Math.floor(audio.length / F);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * F; i < (f + 1) * F; i++) s += audio[i] * audio[i];
    rms[f] = Math.sqrt(s / F);
  }
  const bounds = [0];
  let start = 0;
  while (frames - start > 27 * 20) {
    let best = start + 25 * 20;
    let bestV = Infinity;
    for (let f = start + 20 * 20; f < start + 25 * 20; f++) if (rms[f] < bestV) { bestV = rms[f]; best = f; }
    bounds.push(best * F);
    start = best;
  }
  bounds.push(audio.length);
  const sections = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const [a, b] = [bounds[i], bounds[i + 1]];
    let sum = 0;
    for (let k = a; k < b; k += 8) sum += audio[k] * audio[k];
    sections.push({ a, b, silent: Math.sqrt(sum / Math.max(1, (b - a) / 8)) < 0.004 });
  }
  return sections;
}

/** which writing system the words use (Whisper doesn't report its detected language here) */
function scriptOf(words) {
  let latin = 0;
  let deva = 0;
  let arabic = 0;
  let other = 0;
  for (const w of words) for (const ch of w.text) {
    if (/[A-Za-z]/.test(ch)) latin++;
    else if (/[ऀ-ॿ]/.test(ch)) deva++;
    else if (/[؀-ۿ]/.test(ch)) arabic++;
    else if (/\p{L}/u.test(ch)) other++;
  }
  const max = Math.max(latin, deva, arabic, other);
  if (!max) return null;
  return max === deva ? 'devanagari' : max === arabic ? 'arabic' : max === latin ? 'latin' : 'other';
}

async function persist(job) {
  const words = [...job.done.values()].flat().sort((x, y) => x.start - y.start);
  const body = {
    key: job.key, hash: job.hash, model: job.model, language: job.lang, duration: job.duration,
    complete: job.status === 'done',
    sections: [...job.done.keys()].map((i) => [job.sections[i].a, job.sections[i].b]),
    words, script: scriptOf(words), timings: job.timings, savedAt: new Date().toISOString(),
  };
  await mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${fileOf(job.key)}.tmp`;
  await writeFile(tmp, JSON.stringify(body));
  await rename(tmp, fileOf(job.key));
}

function readCache(key) {
  try {
    return JSON.parse(readFileSync(fileOf(key), 'utf8'));
  } catch {
    return null;
  }
}

function fail(job, message) {
  job.status = 'error';
  job.error = message;
  job.audio = null;
}

function finish(job) {
  job.status = 'done';
  job.timings.total_ms = Math.round(performance.now() - job.t0);
  job.timings.recognise_ms = job.recogniseMs;
  job.timings.rtf = +(job.timings.total_ms / 1000 / job.duration).toFixed(3);
  job.audio = null;
  persist(job).catch((e) => console.error('[asr] cache write failed:', e.message));
}

function nextSection(job) {
  for (const i of job.order) if (!job.done.has(i) && !job.sections[i].silent) return i;
  return -1;
}

function pump() {
  if (busy) return;
  const ready = [...jobs.values()]
    .filter((j) => (j.status === 'queued' || j.status === 'running') && j.audio)
    .sort((x, y) => x.priority - y.priority || x.created - y.created);
  for (const job of ready) {
    const idx = nextSection(job);
    if (idx < 0) {
      finish(job);
      continue;
    }
    if (job.status === 'queued') {
      job.status = 'running';
      job.timings.queue_ms = Math.round(performance.now() - job.t0);
    }
    const s = job.sections[idx];
    const from = Math.max(0, s.a - LEAD);
    const rFrom = Math.max(0, s.a - RETRY_LEAD);
    busy = { job, idx, reqId: ++reqSeq };
    // copies (slice) so the job's buffer stays intact if the worker restarts
    getWorker().postMessage({
      type: 'section', reqId: busy.reqId, model: job.model, language: job.lang === 'auto' ? undefined : job.lang,
      audio: job.audio.slice(from, s.b), offsetSec: from / SR, keepFromSec: s.a / SR,
      retry: rFrom < from ? { audio: job.audio.slice(rFrom, s.b), offsetSec: rFrom / SR } : undefined,
    });
    return;
  }
}

function onWorkerMessage(m) {
  if (m.type === 'loaded') {
    if (!modelInit.has(m.model)) modelInit.set(m.model, m.ms);
    for (const j of jobs.values()) if (j.model === m.model && j.timings.model_init_ms == null) j.timings.model_init_ms = m.ms;
    return;
  }
  const b = busy;
  if (!b || m.reqId !== b.reqId) return;
  busy = null;
  const job = b.job;
  if (m.type === 'result') {
    job.done.set(b.idx, m.words);
    job.recogniseMs += m.ms;
    if (job.timings.first_section_ms == null) job.timings.first_section_ms = Math.round(performance.now() - job.t0);
    job.version++;
    if (job.status === 'running') persist(job).catch(() => {}); // resumable
  } else {
    job.failures = (job.failures ?? 0) + 1;
    if (job.failures > 2) fail(job, m.message);
  }
  if (job.status === 'cancelled') job.audio = null;
  setImmediate(pump);
}

// ------------------------------------------------------------------------------------------------
const isLoopback = (req) => {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' || process.env.ALLOW_REMOTE_TRANSCRIBE === '1';
};

function parseParams(sp) {
  const hash = (sp.get('hash') || '').toLowerCase();
  const model = sp.get('model') || 'base';
  const lang = sp.get('lang') || 'auto';
  if (!/^[a-f0-9]{16,64}$/.test(hash) || !MODELS.has(model) || !LANGS.test(lang)) return null;
  return { hash, model, lang, key: keyOf(hash, model, lang) };
}

function view(job) {
  const total = job.sections.filter((s) => !s.silent).length;
  const done = [...job.done.keys()].filter((i) => !job.sections[i].silent).length;
  const words = [...job.done.values()].flat().sort((x, y) => x.start - y.start);
  return {
    id: job.key, status: job.status, error: job.error ?? null, progress: total ? done / total : 1,
    sectionsDone: done, sectionsTotal: total, version: job.version, words, script: scriptOf(words),
    timings: { ...job.timings, model_init_ms: job.timings.model_init_ms ?? (modelInit.has(job.model) ? 0 : null) },
    model: job.model, language: job.lang, duration: job.duration,
    engine: `onnxruntime-node (native, ${os.cpus().length} threads), Whisper ${job.model} q8`,
  };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) {
        reject(Object.assign(new Error('Audio too large.'), { status: 413 }));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

/** Route /api/transcribe/*. Returns false when the path isn't ours. */
export async function handleTranscribe(req, res, pathname, sp, sendJson) {
  if (!pathname.startsWith('/api/transcribe')) return false;
  if (!isLoopback(req)) return sendJson(res, 403, { error: 'Transcription is only available on this computer.' }), true;

  // cached result (complete or partial) without uploading anything
  if (pathname === '/api/transcribe/cache' && req.method === 'GET') {
    const p = parseParams(sp);
    if (!p) return sendJson(res, 400, { error: 'Bad parameters.' }), true;
    const live = jobs.get(p.key);
    if (live && live.status !== 'cancelled' && live.status !== 'error') return sendJson(res, 200, { found: true, ...view(live) }), true;
    const c = readCache(p.key);
    if (c?.complete) return sendJson(res, 200, { found: true, id: p.key, status: 'done', progress: 1, words: c.words, script: c.script, timings: { ...c.timings, cache_hit: true }, model: c.model, language: c.language, duration: c.duration }), true;
    return sendJson(res, 200, { found: false, partialSections: c?.sections?.length ?? 0 }), true;
  }

  // start (or join) a job: body = 16 kHz mono PCM, int16 little-endian
  if (pathname === '/api/transcribe' && req.method === 'POST') {
    const p = parseParams(sp);
    if (!p) return sendJson(res, 400, { error: 'Bad parameters.' }), true;
    const priority = sp.get('priority') === '1' ? 1 : 0;
    const start = Math.max(0, Number(sp.get('start')) || 0);
    const existing = jobs.get(p.key);
    if (existing && (existing.status === 'queued' || existing.status === 'running' || existing.status === 'done')) {
      req.resume(); // de-duplicated: the audio is already here
      existing.priority = Math.min(existing.priority, priority);
      setImmediate(pump);
      return sendJson(res, 200, view(existing)), true;
    }
    const t0 = performance.now();
    const body = await readBody(req, MAX_SECONDS * SR * 2 + 1024);
    if (body.length < SR * 2) return sendJson(res, 400, { error: 'Audio too short.' }), true;
    const pcm = new Int16Array(body.buffer, body.byteOffset, Math.floor(body.length / 2));
    const audio = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) audio[i] = pcm[i] / 32768;
    const sections = planSections(audio);
    const at = start * SR;
    let first = sections.findIndex((s) => at >= s.a && at < s.b);
    if (first < 0) first = 0;
    const order = [...sections.keys()].slice(first).concat([...sections.keys()].slice(0, first));
    const job = {
      ...p, audio, duration: audio.length / SR, sections, order, done: new Map(), status: 'queued', priority,
      created: Date.now(), t0, version: 0, recogniseMs: 0,
      timings: { upload_ms: Math.round(performance.now() - t0), client_decode_ms: Number(sp.get('decode_ms')) || null },
    };
    // resume: reuse sections finished by an earlier, interrupted run
    const prev = readCache(p.key);
    if (prev?.sections?.length) {
      for (let i = 0; i < sections.length; i++) {
        if (prev.sections.some(([a, b]) => a === sections[i].a && b === sections[i].b)) {
          job.done.set(i, prev.words.filter((w) => w.start >= sections[i].a / SR - 0.01 && w.start < sections[i].b / SR));
        }
      }
      job.timings.resumed_sections = job.done.size;
    }
    // forget finished jobs after 30 min (their results live on in the disk cache)
    for (const [k, j] of jobs) if (j.status !== 'queued' && j.status !== 'running' && Date.now() - j.created > 30 * 60_000) jobs.delete(k);
    jobs.set(p.key, job);
    setImmediate(pump);
    return sendJson(res, 200, view(job)), true;
  }

  const m = pathname.match(/^\/api\/transcribe\/([a-z0-9.]+)(\/cancel)?$/);
  if (m) {
    const job = jobs.get(m[1]);
    if (!job) return sendJson(res, 404, { error: 'No such job.' }), true;
    if (m[2] && req.method === 'POST') {
      // keep finished sections (on disk) so the job can resume later
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'cancelled';
        if (!busy || busy.job !== job) job.audio = null;
      }
      return sendJson(res, 200, view(job)), true;
    }
    return sendJson(res, 200, view(job)), true;
  }
  return sendJson(res, 404, { error: 'Unknown transcription endpoint.' }), true;
}

export const transcribeInfo = () => ({ available: true, models: [...MODELS], cacheDir: CACHE_DIR, cached: existsSync(CACHE_DIR) });
