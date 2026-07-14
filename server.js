// LoL broadcast scoreboard — local server for OBS.
//   node server.js          poll the live client (spectator or player PC)
//   node server.js --mock   simulated game for layout/preview work
//
// Overlay (OBS browser source): http://localhost:3000/overlay
// Control panel:                http://localhost:3000/control

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GameStateEngine } from './lib/state.js';
import { MockGame } from './lib/mock.js';

// Entry dir that works both as ESM source (dev) and inside the CJS bundle
// produced by esbuild for the packaged exe.
const ENTRY_DIR = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));
// When packaged (pkg snapshot), static assets sit one level above the bundled
// entry (dist/server.cjs -> ../public), and config.json must live somewhere
// writable: next to the exe, since the snapshot filesystem is read-only.
const PACKAGED = typeof process.pkg !== 'undefined';
const BASE = fs.existsSync(path.join(ENTRY_DIR, 'public')) ? ENTRY_DIR : path.join(ENTRY_DIR, '..');
const PORT = Number(process.env.PORT || 3000);
const MOCK = process.argv.includes('--mock');
const NO_OPEN = process.argv.includes('--no-open');
const POLL_MS = 500;
const LIVE_URL = 'https://127.0.0.1:2999/liveclientdata/allgamedata';
const CONFIG_PATH = PACKAGED
  ? path.join(path.dirname(process.execPath), 'config.json')
  : path.join(BASE, 'config.json');

// The packaged exe runs as a GUI app (no console), so mirror logs to a file
// next to the exe for troubleshooting.
if (PACKAGED) {
  const logPath = path.join(path.dirname(process.execPath), 'scoreboard.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });
  for (const m of ['log', 'error']) {
    const orig = console[m].bind(console);
    console[m] = (...args) => {
      try { logStream.write(`[${new Date().toISOString()}] ${args.join(' ')}\n`); } catch {}
      orig(...args);
    };
  }
}

const DEFAULT_CONFIG = {
  bestOf: 3,
  showIdle: true,  // keep the bar (teams + series) visible between games
  showLogos: true, // false = hide logo blocks entirely (tags only, no images)
  // 'hybrid' (default): plate hides Riot's HUD numbers, Riot's own drake
  // icons show through below — in-game HUD must stay ON.
  // 'cover': full plate. 'transparent': floating bar, HUD off in game.
  overlayMode: 'hybrid',
  cover: { width: 1210, height: 110, hybridHeight: 60 }, // user-calibrated at 1080p
  // experimental HUD OCR (exact gold/counts in cover mode) — off by default,
  // enable only by setting this true in config.json
  hudReader: false,
  // manual corrections for objectives taken before the spectate connected
  adjust: {
    blue: { turrets: 0, grubs: 0, heralds: 0, barons: 0, dragons: [] },
    red: { turrets: 0, grubs: 0, heralds: 0, barons: 0, dragons: [] },
  },
  blue: { name: 'Blue Team', tag: 'BLU', wins: 0, logo: '', color: '#0AC8B9' },
  red: { name: 'Red Team', tag: 'RED', wins: 0, logo: '', color: '#E84057' },
  swap: false, // swap which side of the bar each in-game team renders on
  theme: {
    accent: '#C8AA6E',            // gold: icons, borders, labels
    text: '#F0E6D2',              // values / bright text
    bg: '#090B0F',                // bar background base
    panel: '#141922',             // raised surfaces (gradient tops, badges)
    headerFont: 'Barlow Condensed', // numbers, tags, timers (Google Font name)
    bodyFont: 'Barlow Condensed',   // small labels (Google Font name)
  },
};

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
let config = loadConfig();

// ---------------------------------------------------------------- data feed
const engine = new GameStateEngine();
const mock = MOCK ? new MockGame() : null;
let latestState = { live: false };
const sseClients = new Set();

// Synthetic objective events entered from the control panel — the current
// patch's spectator feed emits no neutral-monster events, so this is the
// primary source for dragons/grubs/herald/baron. Timestamped at entry so
// respawn timers and buff bars work. Cleared when a new game starts.
let manualEvents = [];
let lastSeenGameTime = 0;

// ------------------------------------------------- HUD reader (cover mode)
// Reads exact gold + objective counts from the concealed in-game HUD.
// Requires: cover mode on, HUD enabled in game, borderless/windowed client.
const HUD_EXE = PACKAGED
  ? path.join(path.dirname(process.execPath), 'HudReader.exe')
  : path.join(BASE, 'dist', 'HudReader.exe');
let hudData = null;       // latest good read { ...json, ts }
let lastHudCounts = null; // previous counts, for kill-timer synthesis
let hudBusy = false;

function pollHud() {
  if (MOCK || config.hudReader !== true || config.overlayMode !== 'cover' || hudBusy) return;
  if (!fs.existsSync(HUD_EXE)) return;
  hudBusy = true;
  execFile(HUD_EXE, [], { timeout: 5000, windowsHide: true }, (err, stdout) => {
    hudBusy = false;
    if (err) { hudData = null; return; }
    try {
      const d = JSON.parse(String(stdout).trim());
      if (d.ok) {
        hudData = { ...d, ts: Date.now() };
        synthesizeHudTimers(d);
      } else {
        hudData = null;
      }
    } catch { hudData = null; }
  });
}
setInterval(pollHud, 2000);

// A dragon-count increase seen on the HUD anchors the respawn timer, exactly
// like a manual click would (element unknown -> generic drake icon until a
// manual entry or event names it).
function synthesizeHudTimers(d) {
  if (lastHudCounts) {
    for (const side of ['blue', 'red']) {
      const cur = d[side]?.dragons, prev = lastHudCounts[side]?.dragons;
      if (Number.isInteger(cur) && Number.isInteger(prev) && cur > prev) {
        manualEvents.push({
          EventName: 'DragonKill', DragonType: 'Unknown',
          EventTime: latestState.gameTime || 0, KillerName: '',
          TeamHint: side === 'blue' ? 'ORDER' : 'CHAOS',
          EventID: 100000 + manualEvents.length, Manual: true, FromHud: true,
        });
        console.log(`HUD: ${side} dragon count ${prev} -> ${cur}, respawn timer anchored`);
      }
    }
  }
  lastHudCounts = { blue: { ...d.blue }, red: { ...d.red } };
}

function freshHud() {
  return hudData && Date.now() - hudData.ts < 8000 ? hudData : null;
}

const MANUAL_KINDS = {
  dragon: (el) => ({ EventName: 'DragonKill', DragonType: el || 'Unknown' }),
  elder: () => ({ EventName: 'DragonKill', DragonType: 'Elder' }),
  grub: () => ({ EventName: 'HordeKill' }),
  herald: () => ({ EventName: 'HeraldKill' }),
  baron: () => ({ EventName: 'BaronKill' }),
  turret: () => ({ EventName: 'TurretKilled', TurretKilled: '' }),
};

// Changes every server start; the overlay reloads itself when it sees a new
// bootId, so OBS always runs the current app files after an update.
const BOOT_ID = String(Date.now());

function broadcast() {
  const payload = `data: ${JSON.stringify({ state: latestState, config, bootId: BOOT_ID })}\n\n`;
  for (const res of sseClients) res.write(payload);
}

function fetchLive() {
  return new Promise((resolve, reject) => {
    const req = https.get(LIVE_URL, { rejectUnauthorized: false, timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

// Audit log: record every objective event the API sends so misattributions
// can be diagnosed after the game (packaged builds write scoreboard.log).
const AUDIT_EVENTS = /Dragon|Horde|Herald|Baron|Turret/;
let auditCount = 0;
function auditEvents(raw) {
  const evs = raw?.events?.Events || [];
  if (evs.length < auditCount) auditCount = 0; // new game
  for (const ev of evs.slice(auditCount)) {
    if (AUDIT_EVENTS.test(ev.EventName || '')) console.log('EVENT ' + JSON.stringify(ev));
  }
  auditCount = evs.length;
}

async function tick() {
  try {
    const raw = MOCK ? mock.snapshot() : await fetchLive();
    if (!MOCK) auditEvents(raw);
    // new game detection: clock jumped backwards -> clear manual events
    const t = raw?.gameData?.gameTime || 0;
    if (t < lastSeenGameTime - 30) {
      manualEvents = [];
      hudData = null;
      lastHudCounts = null;
      console.log('new game detected — manual objective events cleared');
    }
    lastSeenGameTime = t;
    // during the loading screen the API answers but has no players yet —
    // stay in the pre-game state until real data exists
    latestState = raw?.allPlayers?.length
      ? engine.update(raw, config.adjust, manualEvents, freshHud())
      : engine.idle();
  } catch {
    latestState = engine.idle();
  }
  broadcast();
}
setInterval(tick, POLL_MS);
tick();

// ------------------------------------------------------------------- server
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function serveStatic(res, file) {
  const full = path.join(BASE, 'public', file);
  if (!full.startsWith(path.join(BASE, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      // OBS and WebView2 aggressively cache; always serve current app files
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 8e6) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Open the control panel: prefer the native WebView2 panel window (own
// taskbar icon/identity), then Edge/Chrome --app mode, then default browser.
function openPanel(url) {
  const panelCandidates = [
    PACKAGED ? path.join(path.dirname(process.execPath), 'LoL-Scoreboard-Panel.exe') : null,
    path.join(BASE, 'dist', 'LoL-Scoreboard-Panel.exe'),
  ].filter(Boolean);
  for (const p of panelCandidates) {
    try {
      if (fs.existsSync(p)) {
        spawn(p, [url], { detached: true, stdio: 'ignore' }).unref();
        return;
      }
    } catch { /* try next */ }
  }
  const pf86 = process.env['ProgramFiles(x86)'] || '';
  const pf = process.env.ProgramFiles || '';
  const local = process.env.LOCALAPPDATA || '';
  const browsers = [
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (browsers.length) {
    spawn(browsers[0], [`--app=${url}`, '--window-size=1180,860'], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/' ) { res.writeHead(302, { Location: '/overlay' }); return res.end(); }
  if (p === '/overlay') return serveStatic(res, 'overlay.html');
  if (p === '/control') return serveStatic(res, 'control.html');

  if (p === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ state: latestState, config }));
  }

  if (p === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ state: latestState, config, bootId: BOOT_ID })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (p === '/api/objective') {
    if (req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        if (body.undo) {
          manualEvents.pop();
        } else {
          const make = MANUAL_KINDS[body.kind];
          if (!make) throw new Error('unknown kind: ' + body.kind);
          manualEvents.push({
            ...make(body.element),
            EventTime: latestState.gameTime || 0,
            KillerName: '',
            TeamHint: body.team === 'red' ? 'CHAOS' : 'ORDER',
            EventID: 100000 + manualEvents.length,
            Manual: true,
          });
        }
        await tick(); // recompute + broadcast immediately, don't wait for the poll
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, count: manualEvents.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: String(e) }));
      }
    }
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(manualEvents));
    }
  }

  if (p === '/api/quit' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    console.log('quit requested from control panel');
    setTimeout(() => process.exit(0), 300);
    return;
  }

  if (p === '/api/config') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(config));
    }
    if (req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const prev = config;
        config = { ...DEFAULT_CONFIG, ...config, ...body };
        config.blue = { ...DEFAULT_CONFIG.blue, ...prev.blue, ...body.blue };
        config.red = { ...DEFAULT_CONFIG.red, ...prev.red, ...body.red };
        config.theme = { ...DEFAULT_CONFIG.theme, ...prev.theme, ...body.theme };
        config.adjust = {
          blue: { ...DEFAULT_CONFIG.adjust.blue, ...prev.adjust?.blue, ...body.adjust?.blue },
          red: { ...DEFAULT_CONFIG.adjust.red, ...prev.adjust?.red, ...body.adjust?.red },
        };
        config.cover = { ...DEFAULT_CONFIG.cover, ...prev.cover, ...body.cover };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        broadcast();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(config));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: String(e) }));
      }
    }
  }

  return serveStatic(res, p.replace(/^\/+/, ''));
});

server.listen(PORT, () => {
  console.log(`scoreboard-lol ${MOCK ? '(MOCK GAME)' : '(live client mode)'}`);
  console.log(`  overlay  -> http://localhost:${PORT}/overlay   (add as OBS browser source, 1920x1080)`);
  console.log(`  control  -> http://localhost:${PORT}/control`);
  // ?v= busts WebView2/browser caches of pages fetched before no-store existed
  if (!NO_OPEN && process.platform === 'win32') openPanel(`http://localhost:${PORT}/control?v=${BOOT_ID}`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Already running: just bring up a panel window for the existing
    // instance instead of erroring, then exit quietly.
    console.error(`Port ${PORT} already in use — opening panel for the running instance.`);
    if (!NO_OPEN && process.platform === 'win32') openPanel(`http://localhost:${PORT}/control?v=${Date.now()}`);
    setTimeout(() => process.exit(0), 1500);
  } else {
    throw err;
  }
});
