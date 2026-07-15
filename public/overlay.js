/* Overlay renderer — consumes SSE from /api/stream */

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';

// ------------------------------------------------- element glyphs (inline SVG)
const ELEMENT_COLORS = {
  Fire: '#E8593F', Water: '#4FB3E8', Earth: '#C98A4B', Air: '#BFD4DC',
  Hextech: '#5CD8E0', Chemtech: '#8FD442', Elder: '#D8E8F0', Unknown: '#C8AA6E',
  Baron: '#B07BE0', Grub: '#A78BE0', Herald: '#7FB3D4',
};

const GLYPHS = {
  Fire: 'M12 2c1 3.5-2.4 5-2.4 8 0 1.4.9 2.4 2 2.9-.4-1.6.3-2.7 1.4-3.6.1 2.7 3 3.3 3 6.2 0 2.6-1.9 4.5-4 4.5s-4.5-1.7-4.5-4.8C7.5 10.5 12 8.5 12 2z',
  Water: 'M12 2.5c3 4.6 6 7.9 6 11.5a6 6 0 1 1-12 0c0-3.6 3-6.9 6-11.5z',
  Earth: 'M2 20L8.5 7l3 5.5L14 6l8 14H2z',
  Air: 'M4 8h10a3 3 0 1 0-3-3.6l2 .4A1.2 1.2 0 1 1 14 6H4v2zm0 4h14a3.4 3.4 0 1 1-3.4 4l2-.4a1.5 1.5 0 1 0 1.4-1.6H4v-2zm0-2h8v-1H4v1z',
  Hextech: 'M12 2l8 4.7v9.6L12 21l-8-4.7V6.7L12 2zm0 5l-4 2.4v4.8l4 2.4 4-2.4V9.4L12 7z',
  Chemtech: 'M9 2h6v2h-1v5l5 8.5a2 2 0 0 1-1.7 3H6.7A2 2 0 0 1 5 17.5L10 9V4H9V2zm2.4 9l-3 5h7.2l-3-5h-1.2z',
  Elder: 'M12 1l2.4 7.3L22 10l-7.6 1.7L12 19l-2.4-7.3L2 10l7.6-1.7L12 1zm0 16.5l1 3.5-1 2-1-2 1-3.5z',
  Unknown: 'M12 2a7 7 0 0 1 7 7c0 3-2 4-3.4 5.3-.9.8-1.1 1.3-1.1 2.7h-5c0-2.6.9-3.8 2.3-5C13.2 10.8 14 10.3 14 9a2 2 0 1 0-4 0H5a7 7 0 0 1 7-7zm-2.5 17h5V22h-5v-3z',
  Baron: 'M12 2l2 4 4-2-1 5 5 1-4 3 3 4-5-1v5l-4-3-4 3v-5l-5 1 3-4-4-3 5-1-1-5 4 2 2-4z',
  Grub: 'M12 2.5c1.9 0 3.4 1.4 3.4 3.2S13.9 9 12 9 8.6 7.5 8.6 5.7 10.1 2.5 12 2.5zm0 7.5c2.3 0 4.1 1.5 4.1 3.4s-1.8 3.4-4.1 3.4-4.1-1.5-4.1-3.4S9.7 10 12 10zm0 7.8c1.6 0 2.9 1 2.9 2.3V22H9.1v-1.9c0-1.3 1.3-2.3 2.9-2.3z',
  Herald: 'M12 5C6.5 5 2.5 12 2.5 12S6.5 19 12 19s9.5-7 9.5-7S17.5 5 12 5zm0 10.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm0-5.2a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z',
};

function glyphEl(type, size = 18) {
  const color = ELEMENT_COLORS[type] || ELEMENT_COLORS.Unknown;
  const d = GLYPHS[type] || GLYPHS.Unknown;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', color);
  path.style.filter = `drop-shadow(0 0 3px ${color}88)`;
  svg.appendChild(path);
  return svg;
}

function replaceChild(parent, child) {
  parent.replaceChildren(child);
}

// Official client icons (CommunityDragon, game/assets/ux/scoreboard) shipped
// in /icons; SVG glyphs above remain the fallback for anything unmapped.
const ICON_FILES = {
  Fire: 'fire.png', Water: 'water.png', Earth: 'earth.png', Air: 'air.png',
  Hextech: 'hextech.png', Chemtech: 'chemtech.png', Elder: 'elder.png',
  Unknown: 'dragon.png', Baron: 'baron.png', Herald: 'herald.png', Grub: 'grub.png',
};

function iconEl(type, size = 18) {
  const file = ICON_FILES[type];
  if (!file) return glyphEl(type, size);
  const img = document.createElement('img');
  img.src = '/icons/' + file;
  img.width = size;
  img.height = size;
  img.style.objectFit = 'contain';
  img.draggable = false;
  return img;
}

// ----------------------------------------------------------- theme plumbing
// Derived shades are computed here (not CSS color functions) because OBS's
// embedded Chromium is older than desktop browsers.
function hexToRgb(hex) {
  const h = (hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n) || full.length !== 6) return { r: 200, g: 170, b: 110 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const rgba = (hex, a) => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};
const blend = (hexA, hexB, t) => {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  const m = (x, y) => Math.round(x + (y - x) * t);
  return `rgb(${m(a.r, b.r)}, ${m(a.g, b.g)}, ${m(a.b, b.b)})`;
};

let lastThemeKey = '';
function applyTheme(t) {
  if (!t) return;
  const key = JSON.stringify(t);
  if (key === lastThemeKey) return;
  lastThemeKey = key;

  const s = document.documentElement.style;
  s.setProperty('--gold', t.accent);
  s.setProperty('--gold-bright', t.text);
  s.setProperty('--gold-dim', rgba(t.accent, 0.45));
  s.setProperty('--accent-a30', rgba(t.accent, 0.3));
  s.setProperty('--accent-a22', rgba(t.accent, 0.22));
  s.setProperty('--text-a08', rgba(t.text, 0.08));
  s.setProperty('--text-a10', rgba(t.text, 0.1));
  s.setProperty('--text-a14', rgba(t.text, 0.14));
  s.setProperty('--text-a28', rgba(t.text, 0.28));
  s.setProperty('--bar-top', rgba(t.panel, 0.93));
  s.setProperty('--bar-bot', rgba(t.bg, 0.96));
  s.setProperty('--bg-a82', rgba(t.bg, 0.82));
  s.setProperty('--bg-a94', rgba(t.bg, 0.94));
  s.setProperty('--chip-top', rgba(t.bg, 0.96));
  s.setProperty('--chip-bot', rgba(t.panel, 0.92));
  s.setProperty('--panel-lit', blend(t.panel, '#ffffff', 0.12));
  s.setProperty('--ink', rgba(t.bg, 0.94));
  s.setProperty('--plate-top', blend(t.panel, '#ffffff', 0.04));
  s.setProperty('--plate-bot', t.bg);

  // fonts: load from Google Fonts, keep stock stack as fallback
  const families = [...new Set([t.headerFont, t.bodyFont].filter(Boolean))];
  const href = 'https://fonts.googleapis.com/css2?' +
    families.map((f) => 'family=' + encodeURIComponent(f).replace(/%20/g, '+')).join('&') +
    '&display=swap';
  let link = document.getElementById('themeFonts');
  if (!link) {
    link = document.createElement('link');
    link.id = 'themeFonts';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  s.setProperty('--font-head', `"${t.headerFont}", "Barlow Condensed", "Arial Narrow", sans-serif`);
  s.setProperty('--font-body', `"${t.bodyFont}", "Barlow Condensed", "Arial Narrow", sans-serif`);
}

// ---------------------------------------------------------------- formatting
const fmtClock = (s) => {
  s = Math.max(0, Math.floor(s));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const fmtGold = (g) => `${(g / 1000).toFixed(1)}k`;

// ------------------------------------------------------------------- render
const prevKills = { L: null, R: null };
const lastTrayKeys = { L: null, R: null };
const lastGlyphKeys = { dragon: '', baron: '' };

function setKills(el, side, value) {
  if (prevKills[side] !== null && value !== prevKills[side]) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
  prevKills[side] = value;
  el.textContent = value;
}

function renderSeries(el, wins, bestOf) {
  const need = Math.ceil(bestOf / 2);
  if (el.childElementCount !== need || Number(el.dataset.wins) !== wins) {
    el.replaceChildren();
    for (let i = 0; i < need; i++) {
      const d = document.createElement('span');
      d.className = 'dot' + (i < wins ? ' won' : '');
      el.appendChild(d);
    }
    el.dataset.wins = wins;
  }
}

function renderTeamChrome(cfg) {
  const L = cfg.blue, R = cfg.red;
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--team-l-glow', rgba(L.color || '#0AC8B9', 0.65));
  rootStyle.setProperty('--team-r-glow', rgba(R.color || '#E84057', 0.65));

  for (const [side, team] of [['L', L], ['R', R]]) {
    const tag = $('tag' + side);
    tag.textContent = (team.tag || '???').toUpperCase().slice(0, 5);
    tag.style.setProperty('--team-glow', rgba(team.color || '#888888', 0.55));
    const block = $('logo' + side);
    block.style.setProperty('--team-color', team.color);
    block.style.setProperty('--team-blend', blend(team.color || '#888888', '#10141a', 0.6));
    const img = $('logoImg' + side);
    if (team.logo) {
      if (img.getAttribute('src') !== team.logo) img.src = team.logo;
      block.classList.remove('no-logo');
    } else {
      img.removeAttribute('src');
      block.classList.add('no-logo');
      const fb = $('logoFb' + side);
      fb.textContent = (team.tag || '?').toUpperCase().slice(0, 1);
      fb.style.setProperty('--team-color', team.color);
    }
    renderSeries($('series' + side), team.wins || 0, cfg.bestOf || 3);
  }
}

function trayChip(type, count) {
  const chip = document.createElement('div');
  chip.className = 'obj-chip';
  chip.appendChild(iconEl(type, 16));
  const n = document.createElement('span');
  n.textContent = count;
  chip.appendChild(n);
  return chip;
}

// Objective tray per team: epic-monster counts (grubs / herald / baron) plus
// one icon per dragon element taken; dragons sit nearest the center clock.
function renderTray(el, team, side, includeDrakes = true) {
  const t = team || { dragons: [], grubs: 0, heralds: 0, barons: 0 };
  const key = [includeDrakes, t.dragons.join(','), t.grubs, t.heralds, t.barons].join('|');
  if (lastTrayKeys[side] === key) return;
  lastTrayKeys[side] = key;
  el.replaceChildren();
  const drakes = (includeDrakes ? t.dragons : []).map((type, i) => {
    const d = document.createElement('div');
    d.className = 'drake';
    d.style.animationDelay = `${i * 0.05}s`;
    d.appendChild(iconEl(type, 19));
    return d;
  });
  // grubs live in the main bar now; trays only carry herald/baron chips
  const chips = [];
  if (t.heralds) chips.push(trayChip('Herald', t.heralds));
  if (t.barons) chips.push(trayChip('Baron', t.barons));
  const ordered = side === 'L' ? [...chips, ...drakes] : [...drakes, ...chips];
  for (const node of ordered) el.appendChild(node);
}

function renderSwing(el, amount, teamTag) {
  el.replaceChildren();
  const num = document.createElement('span');
  num.className = amount >= 0 ? 'pos' : 'neg';
  num.textContent = `${amount >= 0 ? '+' : '−'}${Math.abs(amount).toLocaleString()}`;
  el.appendChild(num);
  el.appendChild(document.createTextNode(' ' + (teamTag || '').toUpperCase()));
}

function render(state, cfg) {
  applyTheme(cfg.theme);
  const stage = $('stage');
  if (!state.live && cfg.showIdle === false) { stage.classList.add('hidden'); return; }
  stage.classList.remove('hidden');
  stage.classList.toggle('pregame', !state.live);
  stage.classList.toggle('no-logos', cfg.showLogos === false);

  // cover/hybrid: opaque plate conceals the in-game spectator HUD while live;
  // hybrid additionally opens framed windows over Riot's drake element icons
  const plateMode = cfg.overlayMode === 'cover' || cfg.overlayMode === 'hybrid';
  stage.classList.toggle('cover', plateMode && !!state.live);
  stage.classList.toggle('hybrid', cfg.overlayMode === 'hybrid' && !!state.live);
  if (plateMode) {
    const plate = $('coverPlate');
    plate.style.width = `${cfg.cover?.width || 1300}px`;
    // hybrid: plate stops at Riot's bar bottom so the drake icons below it
    // stay visible; cover: full user-tuned height
    plate.style.height = cfg.overlayMode === 'hybrid'
      ? `${cfg.cover?.hybridHeight || 56}px`
      : `${cfg.cover?.height || 110}px`;
  }

  renderTeamChrome(cfg);

  if (!state.live) {
    // between games: keep team identity + series score, blank the stats
    prevKills.L = prevKills.R = null;
    $('killsL').textContent = '–';
    $('killsR').textContent = '–';
    $('goldL').textContent = '—';
    $('goldR').textContent = '—';
    $('turretsL').textContent = '–';
    $('turretsR').textContent = '–';
    $('grubsL').textContent = '–';
    $('grubsR').textContent = '–';
    $('clock').textContent = 'STARTING SOON';
    renderTray($('drakesL'), null, 'L');
    renderTray($('drakesR'), null, 'R');
    return;
  }

  const L = state.teams.ORDER, R = state.teams.CHAOS;
  setKills($('killsL'), 'L', L.kills);
  setKills($('killsR'), 'R', R.kills);
  $('goldL').textContent = fmtGold(L.gold);
  $('goldR').textContent = fmtGold(R.gold);
  $('turretsL').textContent = L.turrets;
  $('turretsR').textContent = R.turrets;
  $('grubsL').textContent = L.grubs;
  $('grubsR').textContent = R.grubs;
  $('clock').textContent = fmtClock(state.gameTime);

  renderTray($('drakesL'), L, 'L', cfg.overlayMode !== 'hybrid');
  renderTray($('drakesR'), R, 'R', cfg.overlayMode !== 'hybrid');

  // ---- dragon widget (top-left): countdown only, hidden once spawned
  const dr = state.objectives.dragon;
  const showDragon = dr.countdown > 0;
  $('dragonWidget').classList.toggle('off', !showDragon);
  if (showDragon) {
    const el = dr.isElder ? 'Elder' : (dr.upcomingElement || 'Unknown');
    if (lastGlyphKeys.dragon !== el) {
      lastGlyphKeys.dragon = el;
      replaceChild($('dragonWidgetIcon'), iconEl(el, 30));
    }
    $('dragonWidget').style.setProperty('--obj-color', ELEMENT_COLORS[el] || ELEMENT_COLORS.Unknown);
    $('dragonLabel').textContent = dr.isElder ? 'ELDER DRAGON' : 'DRAGON';
    const dt = $('dragonTimer');
    dt.textContent = fmtClock(dr.countdown);
    dt.className = 'corner-time' + (dr.countdown <= 30 ? ' soon' : '');
  }

  // ---- baron widget (top-right)
  const ba = state.objectives.baron;
  const buff = ba.buff;
  const bt = $('baronTimer');
  const bar = $('buffBar');
  const swing = $('goldSwing');

  const pit = state.objectives.pit || { kind: 'BARON', countdown: ba.countdown };
  const PIT_STYLE = {
    GRUBS: { icon: 'Grub', color: '#A78BE0' },
    HERALD: { icon: 'Herald', color: '#7FB3D4' },
    BARON: { icon: 'Baron', color: '#B07BE0' },
  };
  const showPit = !!buff || pit.countdown > 0;
  $('baronWidget').classList.toggle('off', !showPit);
  if (buff) {
    if (lastGlyphKeys.baron !== 'Baron') {
      lastGlyphKeys.baron = 'Baron';
      replaceChild($('baronIcon'), iconEl('Baron', 30));
    }
    $('baronWidget').style.setProperty('--obj-color', PIT_STYLE.BARON.color);
    const teamTag = buff.team === 'ORDER' ? cfg.blue.tag : cfg.red.tag;
    $('baronLabel').textContent = buff.kind + ' BUFF';
    $('buffTeam').textContent = (teamTag || '').toUpperCase();
    bt.textContent = fmtClock(buff.remaining);
    bt.className = 'corner-time';
    bar.classList.add('on');
    $('buffFill').style.width = `${(buff.remaining / buff.duration) * 100}%`;
    swing.classList.add('on');
    renderSwing(swing, buff.goldSwing, teamTag);
  } else if (showPit) {
    const style = PIT_STYLE[pit.kind] || PIT_STYLE.BARON;
    if (lastGlyphKeys.baron !== style.icon) {
      lastGlyphKeys.baron = style.icon;
      replaceChild($('baronIcon'), iconEl(style.icon, 30));
    }
    $('baronWidget').style.setProperty('--obj-color', style.color);
    $('baronLabel').textContent = pit.kind;
    $('buffTeam').textContent = '';
    bar.classList.remove('on');
    swing.classList.remove('on');
    bt.textContent = fmtClock(pit.countdown);
    bt.className = 'corner-time' + (pit.countdown <= 30 ? ' soon' : '');
  }
}

// Scale the fixed 1920x1080 stage to fit whatever size the OBS browser
// source actually is, so a mis-sized source shows a smaller overlay instead
// of cropping it.
function fitStage() {
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  const stage = $('stage');
  stage.style.transformOrigin = 'top left';
  stage.style.transform = s === 1 ? '' : `scale(${s})`;
}
window.addEventListener('resize', fitStage);
fitStage();

// ------------------------------------------------------------------ stream
let knownBootId = null;
function connect() {
  const es = new EventSource('/api/stream');
  es.onmessage = (msg) => {
    try {
      const { state, config, bootId } = JSON.parse(msg.data);
      // server restarted (usually an app update): reload to get fresh files
      if (bootId) {
        if (knownBootId && knownBootId !== bootId) { location.reload(); return; }
        knownBootId = bootId;
      }
      render(state, config);
    } catch { /* ignore malformed frame */ }
  };
  es.onerror = () => {
    es.close();
    setTimeout(connect, 2000);
  };
}
connect();
