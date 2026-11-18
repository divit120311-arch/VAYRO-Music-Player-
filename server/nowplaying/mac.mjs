// macOS "Now Playing": reads the Spotify app (or Apple Music) through its official scripting
// interface (Apple Events, via the built-in `osascript`, JavaScript flavour). Same report format
// as the Windows helper, so the browser side doesn't care which one answered.
//
// First use: macOS asks "“Terminal” (or node) wants to control “Spotify”" — click OK. If it was
// denied, allow it in System Settings → Privacy & Security → Automation.
import { execFile } from 'node:child_process';

const READ = `
function run() {
  var now = Date.now();
  function read(name, durationInMs) {
    var a = Application(name);
    if (!a.running()) return null;          // never launches the app
    var st = a.playerState();               // 'playing' | 'paused' | 'stopped'
    if (st === 'stopped') return null;
    var t = a.currentTrack;
    var d = Number(t.duration()) || 0;
    return {
      app: name, title: t.name(), artist: t.artist(), album: t.album(),
      status: st === 'playing' ? 'Playing' : 'Paused',
      position: Number(a.playerPosition()) || 0,
      start: 0, end: durationInMs ? d / 1000 : d, updated: now
    };
  }
  var s = null, m = null, err = null;
  try { s = read('Spotify', true); } catch (e) { err = String(e); }
  if (!s || s.status !== 'Playing') { try { m = read('Music', false); } catch (e) {} }
  var out = (m && m.status === 'Playing') ? m : (s || m);
  if (!out && err) return JSON.stringify({ error: err });
  return JSON.stringify(out || { none: true });
}`;

const osa = (script, args = []) =>
  new Promise((resolve) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', script, ...args], { timeout: 4000 }, (e, stdout, stderr) => {
      resolve(e ? { error: (stderr || e.message || '').trim() } : { out: String(stdout).trim() });
    });
  });

/** a readable reason for the usual failures */
function explain(msg) {
  if (/-1743|not authori[sz]ed/i.test(msg)) {
    return 'macOS blocked Vayro from reading Spotify. Allow it in System Settings → Privacy & Security → Automation (turn on Spotify under Terminal / node), then try again.';
  }
  return msg.slice(0, 300);
}

export function createMacHelper(onState) {
  let running = false;
  let timer = null;
  let lastApp = 'Spotify';

  const tick = async () => {
    if (!running) return;
    const r = await osa(READ);
    if (!running) return;
    if (r.error) onState({ error: explain(r.error) });
    else {
      try {
        const s = JSON.parse(r.out);
        if (s.error) onState({ error: explain(s.error) });
        else {
          if (s.app) lastApp = s.app;
          // `updated` = when the app was read; `now` = when we got the answer → the browser adds the gap
          onState({ ...s, now: Date.now() });
        }
      } catch {
        /* not JSON: ignore this round */
      }
    }
    timer = setTimeout(tick, 350);
  };

  return {
    start() {
      if (running) return;
      running = true;
      void tick();
    },
    stop() {
      running = false;
      clearTimeout(timer);
    },
    /** toggle | play | pause | next | prev | seek <seconds> → the app that's being followed */
    async command(cmd, t) {
      const app = lastApp === 'Music' ? 'Music' : 'Spotify';
      const body = {
        toggle: 'a.playpause()',
        play: 'a.play()',
        pause: 'a.pause()',
        next: 'a.nextTrack()',
        prev: 'a.previousTrack()',
        seek: 'a.playerPosition = Number(argv[1])',
      }[cmd];
      if (!body) return;
      await osa(`function run(argv) { var a = Application(argv[0]); if (!a.running()) return; ${body}; }`, [app, String(t ?? 0)]);
    },
  };
}
