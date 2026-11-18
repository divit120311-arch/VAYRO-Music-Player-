// Builds public/preview-offsets.json: where each library song's 30-second preview starts within
// the full song, so the website shows synced lyrics at once (its visitors' browsers would otherwise
// have to listen to every preview themselves, which takes minutes on slower computers).
//
// It runs the site's own code (lyrics lookup + preview alignment, src/services/previewAlign.ts)
// against Vayro's local server, which has the fast native speech engine.
//
//   1. npm run dev                       (keep it running)
//   2. node scripts/preview-offsets.mjs "<path to chrome or edge>"  [http://localhost:5173]
//
// Resumable: songs already in the file are skipped. Re-run after adding artists.
// Entries: { o: offset seconds, m: words matched, g: 1 if a best guess } · 0 = couldn't be placed.
// Songs whose lyrics have no timestamps aren't listed (nothing to line up).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [chrome, base = 'http://localhost:5173'] = process.argv.slice(2);
if (!chrome || !existsSync(chrome)) {
  console.error('Usage: node scripts/preview-offsets.mjs "<path to chrome.exe / Google Chrome>" [site url]');
  process.exit(1);
}
const OUT = path.resolve('public/preview-offsets.json');
const table = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const skipped = new Set();
const save = () => {
  const sorted = Object.fromEntries(Object.keys(table).sort().map((k) => [k, table[k]]));
  const json = JSON.stringify(sorted);
  writeFileSync(OUT + '.tmp', json);
  try {
    renameSync(OUT + '.tmp', OUT);
  } catch (e) {
    // Windows: the dev server (or antivirus) can hold the file open for a moment: write it directly
    if (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES') throw e;
    writeFileSync(OUT, json);
    try { unlinkSync(OUT + '.tmp'); } catch { /* left over: harmless, replaced next save */ }
  }
};

const port = 9650;
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'vayro-offsets-'))}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 160 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {}
  if (!ws) await sleep(250);
}
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result ?? msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalv = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

await send('Page.enable');
await send('Page.navigate', { url: base });
await sleep(6000);
// installs window.__align in the page; re-run whenever the page reloads (the dev server reloads it
// after optimising dependencies, which wipes page globals)
const SETUP = `(async () => {
  const cat = await import('/src/services/libraryCatalog.ts');
  const lp = await import('/src/services/lyricsProvider.ts');
  const pa = await import('/src/services/previewAlign.ts');
  const health = await (await fetch('/api/health')).json();
  if (!health.transcribe) throw new Error('This server has no speech engine — run it with npm run dev on your computer.');
  const c = await cat.fetchCatalog();
  const tracks = new Map(c.tracks.map((t) => [t.id, t]));
  window.__align = async (tid) => {
    const track = cat.toTrack(tracks.get(tid));
    if (!track.preview || !track.streamUrl) return 'skip';
    const r = await lp.lookupLyrics(track, track.duration ?? 0, 'latin');
    if (r.kind !== 'doc' || r.doc.kind !== 'synced') return 'skip';
    const a = await pa.alignPreview(track, r.doc, { cancelled: false });
    return a ? { o: Math.round(a.offset * 100) / 100, m: a.matched, ...(a.guess ? { g: 1 } : {}) } : 0;
  };
  return c.tracks.filter((t) => cat.toTrack(t).preview).map((t) => t.id);
})()`;
const ready = () => evalv(`typeof window.__align === 'function'`);
await sleep(4000); // let a first-load reload happen before setting up
let ids = await evalv(SETUP);
const todo = ids.filter((t) => !(t in table));
console.log(`${ids.length} previews in the library · ${ids.length - todo.length} already done · ${todo.length} to go`);
const t0 = Date.now();
let n = 0;
for (const tid of todo) {
  let v;
  try {
    if (!(await ready())) ids = await evalv(SETUP);
    v = await Promise.race([evalv(`window.__align(${JSON.stringify(tid)})`), sleep(180_000).then(() => 'timeout')]);
  } catch (e) {
    v = 'error';
    console.warn(`  ${tid}: ${String(e.message).split('\n')[0].slice(0, 120)}`);
  }
  n++;
  if (v === 'skip' || v === 'error' || v === 'timeout') skipped.add(tid);
  else table[tid] = v;
  if (n % 5 === 0 || n === todo.length) save();
  if (n % 10 === 0 || n === todo.length) {
    const per = (Date.now() - t0) / 1000 / n;
    const placed = Object.values(table).filter((x) => x && typeof x === 'object').length;
    console.log(`${n}/${todo.length} · ${placed} placed · ${skipped.size} without synced lyrics/failed · ~${Math.round(((todo.length - n) * per) / 60)} min left`);
  }
}
save();
ws.close();
proc.kill();
console.log('done →', OUT);
