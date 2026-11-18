// "Now Playing" mode: what this computer is playing (Spotify app, Apple Music, a browser tab…).
//   Windows: read from the system media session by a small PowerShell helper (smtc.ps1).
//   macOS:   read from the Spotify app (or Apple Music) through its scripting interface (mac.mjs). Vayro shows the
// song's synced lyrics against that position. The audio is never touched: the other app plays it.
//
//   GET  /api/nowplaying                      → { supported, state }
//   POST /api/nowplaying/command?cmd=toggle|play|pause|next|prev|seek&t=<seconds>
//
// The helper starts on the first request and stops after a minute without requests.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMacHelper } from './mac.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'smtc.ps1');
const WINDOWS = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const SUPPORTED = WINDOWS || MAC;
const mac = MAC ? createMacHelper((s) => (state = { ...s, receivedAt: Date.now() })) : null;
const IDLE_MS = 60_000;

let child = null;
let state = null;
let lastAsked = 0;
let idleTimer = null;
let buf = '';

function start() {
  if (mac) {
    mac.start();
    if (!idleTimer) idleTimer = setInterval(() => Date.now() - lastAsked > IDLE_MS && stop(), 10_000);
    return;
  }
  if (child || !WINDOWS) return;
  child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], { windowsHide: true });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        state = { ...JSON.parse(line), receivedAt: Date.now() };
      } catch { /* partial / non-JSON line */ }
    }
  });
  child.stderr.on('data', (d) => console.warn('[nowplaying]', String(d).trim().slice(0, 300)));
  child.on('exit', () => {
    child = null;
    buf = '';
    // still wanted: restart (e.g. after a crash)
    if (Date.now() - lastAsked < IDLE_MS) setTimeout(start, 1000);
  });
  idleTimer = setInterval(() => {
    if (Date.now() - lastAsked > IDLE_MS) stop();
  }, 10_000);
}

function stop() {
  clearInterval(idleTimer);
  idleTimer = null;
  mac?.stop();
  if (child) {
    const c = child;
    child = null;
    c.stdin.end();
    setTimeout(() => c.kill(), 500);
  }
  state = null;
}

const COMMANDS = new Set(['toggle', 'play', 'pause', 'next', 'prev', 'seek']);

export async function handleNowPlaying(req, res, pathname, params, sendJson) {
  if (pathname !== '/api/nowplaying' && pathname !== '/api/nowplaying/command') return false;
  if (!SUPPORTED) {
    sendJson(res, 200, { supported: false, error: 'Syncing with the Spotify app works when Vayro’s server runs on Windows or macOS.' });
    return true;
  }
  lastAsked = Date.now();
  start();
  if (pathname === '/api/nowplaying') {
    sendJson(res, 200, { supported: true, state }, { 'Cache-Control': 'no-store' });
    return true;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Use POST.' });
    return true;
  }
  const cmd = params.get('cmd') || '';
  if (!COMMANDS.has(cmd)) {
    sendJson(res, 400, { error: 'Unknown command.' });
    return true;
  }
  let line = cmd;
  if (cmd === 'seek') {
    const t = Number(params.get('t'));
    if (!Number.isFinite(t) || t < 0 || t > 36_000) {
      sendJson(res, 400, { error: 'Bad position.' });
      return true;
    }
    line = `seek ${t.toFixed(2)}`;
  }
  if (mac) void mac.command(cmd, Number(params.get('t')));
  else child?.stdin.write(`${line}\n`);
  sendJson(res, 200, { ok: true });
  return true;
}
