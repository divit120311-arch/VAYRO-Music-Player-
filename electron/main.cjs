// Vayro desktop app.
//
// Runs Vayro's own server (server/index.mjs) on this computer — the same one `npm start` runs —
// and shows the site in a window. Because the server runs here, "Sync lyrics" can see the Spotify
// app on this Mac / PC, with nothing for the listener to install or type.
//
//  - The server runs as a child process (Electron's own Node), listening on 127.0.0.1 only: nothing
//    outside this computer can reach it, and there's no firewall prompt.
//  - A fixed port keeps the site's saved settings (localStorage is per address) between launches.
//  - Writable data (lyric timings, the speech model) goes to the app's data folder, because the app's
//    own folder is read-only once installed.
const { app, BrowserWindow, shell, dialog, Menu, session, screen } = require('electron');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');

const PORTS = [47821, 47822, 47823, 47824, 47825];
const MAC = process.platform === 'darwin';
const ROOT = path.join(__dirname, '..');
let server = null;
let win = null;
let quitting = false;

/** first port in the list that nothing else is using on 127.0.0.1 */
function freePort() {
  return new Promise((resolve, reject) => {
    const tryAt = (i) => {
      if (i >= PORTS.length) return reject(new Error('No free port for Vayro’s server.'));
      const s = net.createServer();
      s.once('error', () => tryAt(i + 1));
      s.once('listening', () => s.close(() => resolve(PORTS[i])));
      s.listen(PORTS[i], '127.0.0.1');
    };
    tryAt(0);
  });
}

/** resolves once the server answers */
function waitForServer(port, ms = 20000) {
  const until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', retry);
      req.on('timeout', () => req.destroy());
    };
    const retry = () => (Date.now() > until ? reject(new Error('Vayro’s server didn’t start.')) : setTimeout(ping, 200));
    ping();
  });
}

function startServer(port) {
  const log = [];
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1', // run Electron's binary as plain Node for the server
      PORT: String(port),
      HOST: '127.0.0.1',
      VAYRO_DATA: app.getPath('userData'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const keep = (d) => {
    log.push(String(d));
    if (log.length > 60) log.shift();
  };
  server.stdout.on('data', keep);
  server.stderr.on('data', keep);
  server.on('exit', (code) => {
    server = null;
    if (quitting) return;
    dialog.showErrorBox('Vayro stopped', `Vayro’s server stopped (code ${code}).\n\n${log.join('').slice(-1500)}`);
    app.quit();
  });
}

// ---- window size / position, restored on the next launch ----------------------------------------
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    // only if that spot is still on a connected screen (an external monitor may be gone)
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 10 && b.y < a.y + a.height - 80;
    });
    return onScreen ? b : null;
  } catch {
    return null; // first launch, or an unreadable file: default size
  }
}
function saveBounds() {
  if (!win || win.isDestroyed()) return;
  const b = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(b));
  } catch (e) {
    console.warn('[vayro] could not save the window position:', e.message);
  }
}

/** run an app command in the page (search, settings, play/pause…) — see App.tsx runCommand */
function command(cmd) {
  if (!win) return;
  win.show();
  void win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('vayro:command', { detail: ${JSON.stringify(cmd)} }))`);
}

/** macOS: a proper app menu (the standard roles give copy/paste, hide, full screen, window list) */
function buildMenu() {
  if (!MAC) return Menu.setApplicationMenu(null); // Windows: no menu bar; shortcuts live in the page
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => command('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Search', accelerator: 'Cmd+F', click: () => command('search') },
        { label: 'Library', accelerator: 'Cmd+L', click: () => command('library') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Playback',
      submenu: [
        // Space stays with the page (it must not fire while typing in a search box)
        { label: 'Play / Pause', click: () => command('toggle') },
        { label: 'Next', accelerator: 'Cmd+Right', click: () => command('next') },
        { label: 'Previous', accelerator: 'Cmd+Left', click: () => command('prev') },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(port) {
  const saved = loadBounds();
  win = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 360,
    minHeight: 560,
    // macOS: the traffic lights sit inside Vayro's own header (the page leaves room for them)
    ...(MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 24 } } : {}),
    backgroundColor: '#050508',
    title: 'Vayro',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
      // hidden / minimised windows draw nothing (music keeps playing; lyrics are recomputed from
      // the playback clock on the next frame, so they're in time the moment the window is back)
      backgroundThrottling: true,
      spellcheck: false,
    },
  });
  const origin = `http://127.0.0.1:${port}`;
  win.once('ready-to-show', () => {
    if (saved?.maximized) win.maximize();
    win.show();
  });
  // in macOS full screen the traffic lights hide, so the header can use that space again
  const markFullscreen = (on) => void win.webContents.executeJavaScript(`document.documentElement.toggleAttribute('data-fullscreen', ${on})`);
  win.on('enter-full-screen', () => markFullscreen(true));
  win.on('leave-full-screen', () => markFullscreen(false));
  win.on('close', saveBounds);
  // links to Apple Music, Spotify, etc. open in the normal browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
  void win.loadURL(origin + (MAC ? '/?shell=mac' : '/'));
  win.on('closed', () => (win = null));
}

function stopServer() {
  quitting = true;
  if (server) {
    server.kill();
    server = null;
  }
}

// one Vayro at a time: a second launch focuses the first window
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    // least privilege: the page may go full screen; every other permission request is refused
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'fullscreen'));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
    app.on('web-contents-created', (_e, contents) => contents.on('will-attach-webview', (ev) => ev.preventDefault()));
    try {
      const port = await freePort();
      startServer(port);
      await waitForServer(port);
      createWindow(port);
      app.on('activate', () => {
        if (!win) createWindow(port);
      });
    } catch (e) {
      dialog.showErrorBox('Vayro couldn’t start', String(e && e.message ? e.message : e));
      stopServer();
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    // macOS apps stay open without windows; the server keeps running until Quit
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', stopServer);
  app.on('will-quit', stopServer);
}
