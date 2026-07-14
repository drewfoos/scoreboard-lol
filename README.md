# scoreboard-lol

Esports-broadcast-style League of Legends scoreboard overlay for OBS, driven by
Riot's **Live Client Data API** (`https://127.0.0.1:2999`). No Riot API key, no
rate limits — the data comes from the game client on this machine.

Designed for the **caster/spectator PC**: spectate the match, run this server,
capture the overlay in OBS on top of the game feed.

## Easiest: the installer

```
npm install          # dev tools only (esbuild + pkg), one time
npm run installer    # -> dist/LoL-Scoreboard-Setup.exe (~16 MB)
```

Requires [Inno Setup 6](https://jrsoftware.org/isinfo.php)
(`winget install -e --id JRSoftware.InnoSetup`) on the build machine only.

The app runs windowless (GUI subsystem, logs to `scoreboard.log`); its face is
a native WebView2 panel window (`LoL-Scoreboard-Panel.exe`, compiled from
`scripts/Panel.cs` by `npm run panel` using the csc bundled with Windows).
Launching the app while it's already running just reopens the panel; the Quit
button in the panel stops the server. WebView2 runtime is preinstalled on
Windows 11 / modern Windows 10; if missing, the panel falls back to the
default browser.

Send `dist/LoL-Scoreboard-Setup.exe` to whoever is casting. It installs
per-user (no admin prompt) with Start Menu shortcuts — **LoL Scoreboard**
(live) and **LoL Scoreboard (Test Mode)** (simulated game for OBS setup) —
plus an optional desktop icon. On launch, a console window shows status and
the control panel opens in the browser automatically; OBS points at the
overlay URL below. Node is NOT required on their machine. Team settings
persist in a `config.json` next to the installed exe, and the uninstaller
(Settings → Apps) removes everything.

`npm run build` alone produces the raw portable `dist/LoL-Scoreboard.exe`
(~55 MB) if you prefer sending a single file. Flags work on both
(`--mock` to preview, `--no-open` to skip the browser popup).

Windows SmartScreen may warn on first run (unsigned installer) — "More info →
Run anyway".

## Running from source

```
node server.js          # live mode — polls the running LoL client
node server.js --mock   # simulated late-game for layout/OBS setup
```

- **Overlay:** `http://localhost:3000/overlay` — add as an OBS **Browser Source**
  at 1920x1080 (OBS defaults new sources to 800x600, which crops the bar;
  Ctrl+F / Fit to Screen fixes placement). Layer it above your game capture.
- **Overlay modes** (Match Settings): **Hybrid** (default) covers Riot's HUD
  numbers with an opaque plate while the game's own drake element icons show
  through below — keep the in-game scoreboard HUD ON. **Cover** hides the
  whole HUD region. **Transparent** is a floating bar — toggle the in-game
  HUD off for that one.
- **Only tested at 1920x1080** (game client and OBS canvas). Other resolutions
  are unsupported.
- **Control panel:** `http://localhost:3000/control` — team names, tags, colors,
  logos (PNG upload), series score, best-of, side swap. Saves to `config.json`
  and pushes to the overlay instantly.

No npm install needed — zero dependencies, Node 18+.

## What the overlay shows

- Center bar: team logos/tags, series score, turrets taken, team gold, kills
- Game clock and per-team elemental dragon icons under the bar
- Top-left: next dragon countdown (element shown once the rift has settled;
  ELDER once a team has soul point)
- Top-right: baron spawn countdown, and during Baron/Elder buff a draining
  timer bar plus the gold swing since the buff started

## Honest limitations

- **Team gold is an estimate.** The API only exposes exact gold for the machine's
  own player, so gold is derived from CS, kills, assists, passive income, and
  item values (each player's max of formula vs. items owned). Tracks within a
  few percent of the broadcast number.
- **Upcoming dragon element** isn't exposed until dragons die; a generic icon is
  shown until the 3rd dragon fixes the element.
- CS for non-active players updates in increments of 10 (API quirk).

## Patch constants

Objective timings live at the top of `lib/state.js` (`RULES`): dragon first
spawn/respawn, baron spawn (currently 25:00), buff durations. Adjust there if a
patch moves them.

## How it works

`server.js` polls `/liveclientdata/allgamedata` every 500 ms (self-signed cert
accepted), `lib/state.js` reduces players + events into broadcast state
(turret attribution via turret IDs `_T1_`/`_T2_`, dragons/baron via kill events,
spawn timers via respawn rules), and pushes it to the overlay over
Server-Sent Events. `lib/mock.js` fabricates a realistic 27-minute game through
the same engine for preview.
