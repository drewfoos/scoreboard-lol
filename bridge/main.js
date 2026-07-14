// Validation bridge: subscribes to Overwolf GEP for League of Legends and
// records everything it emits — the goal is to learn what jungle_camps and
// friends actually deliver (and whether they flow in spectator mode).
// Output: bridge-log.jsonl next to this file + forwarded to the scoreboard
// server (POST /api/bridge) if it's running.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');

const LOL_GAME_ID = 5426;
const LOG_PATH = path.join(__dirname, 'bridge-log.jsonl');
const SERVER = { host: '127.0.0.1', port: 3000, path: '/api/bridge' };

const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });

function record(kind, payload) {
  const line = JSON.stringify({ ts: new Date().toISOString(), kind, payload });
  logStream.write(line + '\n');
  console.log(line);
  // best-effort forward to the scoreboard server
  try {
    const req = http.request({ ...SERVER, method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 1500 });
    req.on('error', () => {});
    req.end(JSON.stringify({ kind, payload }));
  } catch { /* server not running — fine */ }
}

app.whenReady().then(() => {
  record('bridge', 'started, waiting for GEP package');
});

app.overwolf.packages.on('ready', (e, packageName, isReady) => {
  if (packageName !== 'gep' || !isReady) return;
  record('bridge', 'GEP package ready');
  const gep = app.overwolf.packages.gep;

  gep.removeAllListeners();

  gep.on('game-detected', (event, gameId, name, gameInfo) => {
    record('game-detected', { gameId, name, gameInfo });
    if (gameId !== LOL_GAME_ID) return;
    event.enable();
    gep.setRequiredFeatures(gameId, null) // null = all available features
      .then((f) => record('features-set', f))
      .catch((err) => record('features-error', String(err)));
  });

  gep.on('new-info-update', (event, gameId, data) => {
    record('info', data);
  });

  gep.on('new-game-event', (event, gameId, data) => {
    record('event', data);
  });

  gep.on('error', (event, gameId, error, ...args) => {
    record('gep-error', { error: String(error), args });
  });

  gep.on('game-exit', (event, gameId, name) => {
    record('game-exit', { gameId, name });
  });
});
