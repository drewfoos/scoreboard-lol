// Transforms raw Live Client Data (/liveclientdata/allgamedata) into the
// broadcast state consumed by the overlay. Works in spectator mode: never
// relies on activePlayer data.

// Objective timing rules. Adjust per patch if Riot moves spawns.
export const RULES = {
  DRAGON_FIRST_SPAWN: 300,   // 5:00
  DRAGON_RESPAWN: 300,       // 5:00 after a kill
  ELDER_RESPAWN: 360,        // 6:00 after an elder kill
  GRUB_SPAWN: 480,           // 8:00 — void grubs (user-verified, 2026)
  GRUB_PHASE_END: 825,       // grubs despawn ~13:45 if not taken
  HERALD_SPAWN: 900,         // 15:00 — one herald per game
  BARON_SPAWN: 1200,         // 20:00 (post-Atakhan timing)
  BARON_RESPAWN: 360,        // 6:00 after a kill
  BARON_BUFF: 180,           // 3:00 buff
  ELDER_BUFF: 150,           // verify: some 2026 sources say 120s
  SOUL_AT: 4,                // dragons needed for soul -> elder spawns after
  ELDER_ONLY_AFTER: 2100,    // 35:00 — from here every dragon is an elder
};

const DRAGON_TYPES = ['Fire', 'Water', 'Earth', 'Air', 'Hextech', 'Chemtech'];

// Earned-gold estimate for one player. The API only exposes exact gold for
// the active player, so in spectator mode everything is estimated. Two
// signals, take the max: a standard income formula, and the hard floor of
// what the player has demonstrably spent on items (live client item entries
// carry their shop price).
function estimatePlayerGold(p, gameTime) {
  const s = p.scores || {};
  const passive = Math.max(0, gameTime - 110) * 2.04;
  const formula =
    500 + passive +
    (s.creepScore || 0) * 20.5 +
    (s.kills || 0) * 300 +
    (s.assists || 0) * 150;
  const spent = (p.items || []).reduce(
    (sum, it) => sum + (it.price || 0) * (it.count || 1), 0);
  return Math.max(formula, spent + 500 + passive * 0.25);
}

function normName(n) {
  return (n || '').toLowerCase().split('#')[0].trim();
}

// Map terrain name (rift transformation) -> dragon element. Lets us show the
// upcoming element even when the shaping DragonKill events happened before a
// late-joining spectator connected.
const TERRAIN_ELEMENT = {
  Infernal: 'Fire', Ocean: 'Water', Mountain: 'Earth', Cloud: 'Air',
  Hextech: 'Hextech', Chemtech: 'Chemtech',
};

function normalizeAdjust(a) {
  return {
    turrets: Number(a?.turrets) || 0,
    grubs: Number(a?.grubs) || 0,
    heralds: Number(a?.heralds) || 0,
    barons: Number(a?.barons) || 0,
    dragons: Array.isArray(a?.dragons) ? a.dragons.slice() : [],
  };
}

export class GameStateEngine {
  constructor(rules = RULES) {
    this.rules = rules;
    this.buffTracker = null; // { kind, team, startedAt, goldDiffAtStart }
  }

  // adjust: manual late-join corrections ({ blue, red }) — counts only.
  // manualEvents: timestamped synthetic objective events entered from the
  // control panel; needed because the current-patch spectator feed emits NO
  // neutral-monster events (verified live 2026-07: dragon + grub kills
  // produced nothing). These flow through the same event logic, so respawn
  // timers and buff bars work off manual clicks.
  update(raw, adjust, manualEvents = [], hud = null) {
    const players = raw?.allPlayers || [];
    const realEvents = raw?.events?.Events || [];
    const gameTime = raw?.gameData?.gameTime || 0;

    // The spectator feed emits neutral-objective events unreliably (some
    // dragons, apparently never grubs). When a real event and a manual entry
    // describe the same kill (same kind, close in time), keep the real one.
    const OBJ_EVENTS = new Set(['DragonKill', 'HordeKill', 'HeraldKill', 'BaronKill']);
    const dedupedManual = manualEvents.filter((m) =>
      !OBJ_EVENTS.has(m.EventName) ||
      !realEvents.some((e) => e.EventName === m.EventName && Math.abs(e.EventTime - m.EventTime) < 120));
    const events = [...realEvents, ...dedupedManual];

    // Killer attribution: events name killers inconsistently — player riotId
    // or summoner name (turrets) but champion name for some dragon kills.
    // Map all three; on champion-name collisions (mirror picks) fall through
    // to the assister vote.
    const teamOf = new Map();
    const setName = (key, team) => {
      const k = normName(key);
      if (!k) return;
      if (teamOf.has(k) && teamOf.get(k) !== team) teamOf.set(k, null); // ambiguous
      else teamOf.set(k, team);
    };
    for (const p of players) {
      setName(p.riotId, p.team);
      setName(p.summonerName, p.team);
      setName(p.championName, p.team);
    }
    const killerTeam = (ev) => {
      const direct = teamOf.get(normName(ev.KillerName));
      if (direct) return direct;
      // majority vote among assisters
      const votes = { ORDER: 0, CHAOS: 0 };
      for (const a of ev.Assisters || []) {
        const t = teamOf.get(normName(a));
        if (t) votes[t]++;
      }
      if (votes.ORDER !== votes.CHAOS) return votes.ORDER > votes.CHAOS ? 'ORDER' : 'CHAOS';
      return ev.TeamHint || null;
    };

    const teams = {
      ORDER: { kills: 0, deaths: 0, turrets: 0, dragons: [], grubs: 0, heralds: 0, barons: 0, gold: 0 },
      CHAOS: { kills: 0, deaths: 0, turrets: 0, dragons: [], grubs: 0, heralds: 0, barons: 0, gold: 0 },
    };

    for (const p of players) {
      const t = teams[p.team];
      if (!t) continue;
      t.kills += p.scores?.kills || 0;
      t.deaths += p.scores?.deaths || 0;
      t.gold += estimatePlayerGold(p, gameTime);
    }

    let lastDragonKill = null;
    let lastElderKill = null;
    let lastBaronKill = null;
    let thirdDragonType = null;
    let dragonKillCount = 0;

    for (const ev of events) {
      switch (ev.EventName) {
        case 'TurretKilled': {
          // Turret id encodes the owner. Current format: Turret_TOrder_* /
          // Turret_TChaos_*; older format: _T1_ (ORDER) / _T2_ (CHAOS).
          const id = ev.TurretKilled || '';
          let credit = null;
          if (/_TOrder|_T1_/i.test(id)) credit = 'CHAOS';
          else if (/_TChaos|_T2_/i.test(id)) credit = 'ORDER';
          else credit = killerTeam(ev);
          if (credit) teams[credit].turrets++;
          break;
        }
        case 'DragonKill': {
          const team = killerTeam(ev);
          const type = ev.DragonType || 'Unknown';
          if (type === 'Elder') {
            lastElderKill = { time: ev.EventTime, team };
          } else {
            dragonKillCount++;
            if (dragonKillCount === 3) thirdDragonType = type;
            if (team) teams[team].dragons.push(type);
            lastDragonKill = { time: ev.EventTime, team };
          }
          break;
        }
        case 'HordeKill': { // void grubs
          const team = killerTeam(ev);
          if (team) teams[team].grubs++;
          break;
        }
        case 'HeraldKill': {
          const team = killerTeam(ev);
          if (team) teams[team].heralds++;
          break;
        }
        case 'BaronKill': {
          const team = killerTeam(ev);
          if (team) teams[team].barons++;
          lastBaronKill = { time: ev.EventTime, team };
          break;
        }
      }
    }

    teams.ORDER.gold = Math.round(teams.ORDER.gold);
    teams.CHAOS.gold = Math.round(teams.CHAOS.gold);

    // merge manual late-join corrections
    const adj = { ORDER: normalizeAdjust(adjust?.blue), CHAOS: normalizeAdjust(adjust?.red) };
    for (const side of ['ORDER', 'CHAOS']) {
      const a = adj[side], t = teams[side];
      t.turrets += a.turrets;
      t.grubs += a.grubs;
      t.heralds += a.heralds;
      t.barons += a.barons;
      t.dragons = [...a.dragons, ...t.dragons];
    }
    dragonKillCount += adj.ORDER.dragons.length + adj.CHAOS.dragons.length;

    // HUD reader (cover mode): exact gold + authoritative objective counts
    // read from the concealed in-game spectator HUD. Element identity of
    // HUD-counted dragons stays whatever events/manual entries provided;
    // extras render as generic 'Unknown' drakes.
    let hudLive = false;
    if (hud && hud.ok) {
      hudLive = true;
      const map = { ORDER: hud.blue, CHAOS: hud.red };
      for (const side of ['ORDER', 'CHAOS']) {
        const h = map[side];
        const t = teams[side];
        if (!h) continue;
        if (Number.isInteger(h.gold)) t.gold = h.gold;
        if (Number.isInteger(h.turrets)) t.turrets = h.turrets;
        if (Number.isInteger(h.grubs)) t.grubs = h.grubs;
        if (Number.isInteger(h.barons)) t.barons = h.barons;
        if (Number.isInteger(h.dragons)) {
          const d = t.dragons.slice(0, h.dragons);
          while (d.length < h.dragons) d.push('Unknown');
          t.dragons = d;
        }
      }
    }

    // --- Dragon spawn timer ---
    const r = this.rules;
    const soulTaker =
      teams.ORDER.dragons.length >= r.SOUL_AT ? 'ORDER' :
      teams.CHAOS.dragons.length >= r.SOUL_AT ? 'CHAOS' : null;
    const nextIsElder = !!soulTaker || gameTime >= r.ELDER_ONLY_AFTER;
    let dragonSpawnAt;
    if (nextIsElder) {
      // anchor on the most recent elder or soul-point dragon we actually saw;
      // with a pure late-join correction there is no event to anchor on, so
      // the timer stays hidden (0) until the next observed kill.
      const last = lastElderKill || lastDragonKill;
      dragonSpawnAt = last ? last.time + r.ELDER_RESPAWN : 0;
    } else {
      dragonSpawnAt = lastDragonKill
        ? lastDragonKill.time + r.DRAGON_RESPAWN
        : r.DRAGON_FIRST_SPAWN;
    }
    // Upcoming element: the transformed map terrain is authoritative (and
    // survives late joins); fall back to the 3rd observed dragon's type.
    const terrainElement = TERRAIN_ELEMENT[raw?.gameData?.mapTerrain] || null;
    const upcomingElement = nextIsElder ? 'Elder'
      : terrainElement || ((dragonKillCount >= 2 && thirdDragonType) ? thirdDragonType : null);

    // --- Baron timer / active buffs ---
    let baronSpawnAt = r.BARON_SPAWN;
    if (lastBaronKill) baronSpawnAt = lastBaronKill.time + r.BARON_RESPAWN;

    // Pit progression for the countdown widget: grubs -> herald -> baron.
    // countdown 0 = objective currently up (widget hides).
    const grubsTotal = teams.ORDER.grubs + teams.CHAOS.grubs;
    const heraldTaken = teams.ORDER.heralds + teams.CHAOS.heralds > 0;
    let pit;
    if (gameTime < r.GRUB_SPAWN) {
      pit = { kind: 'GRUBS', countdown: r.GRUB_SPAWN - gameTime };
    } else if (grubsTotal < 3 && gameTime < r.GRUB_PHASE_END) {
      pit = { kind: 'GRUBS', countdown: 0 };
    } else if (!heraldTaken && gameTime < r.HERALD_SPAWN) {
      pit = { kind: 'HERALD', countdown: r.HERALD_SPAWN - gameTime };
    } else {
      // from herald spawn onward the deterministic next milestone is baron's
      // first spawn — show it even with no herald-kill information
      pit = { kind: 'BARON', countdown: Math.max(0, baronSpawnAt - gameTime) };
    }

    let buff = null;
    const goldDiff = teams.ORDER.gold - teams.CHAOS.gold;
    const candidates = [];
    if (lastBaronKill && gameTime < lastBaronKill.time + r.BARON_BUFF && lastBaronKill.team) {
      candidates.push({ kind: 'BARON', team: lastBaronKill.team, startedAt: lastBaronKill.time, endsAt: lastBaronKill.time + r.BARON_BUFF });
    }
    if (lastElderKill && gameTime < lastElderKill.time + r.ELDER_BUFF && lastElderKill.team) {
      candidates.push({ kind: 'ELDER', team: lastElderKill.team, startedAt: lastElderKill.time, endsAt: lastElderKill.time + r.ELDER_BUFF });
    }
    // Most recent buff wins the widget.
    candidates.sort((a, b) => b.startedAt - a.startedAt);
    if (candidates.length) {
      const c = candidates[0];
      if (!this.buffTracker || this.buffTracker.kind !== c.kind || this.buffTracker.startedAt !== c.startedAt) {
        this.buffTracker = { ...c, goldDiffAtStart: goldDiff };
      }
      const swingRaw = goldDiff - this.buffTracker.goldDiffAtStart;
      // Present the swing from the buff-holder's perspective.
      const swing = c.team === 'ORDER' ? swingRaw : -swingRaw;
      buff = {
        kind: c.kind,
        team: c.team,
        remaining: Math.max(0, c.endsAt - gameTime),
        duration: c.endsAt - c.startedAt,
        goldSwing: Math.round(swing),
      };
    } else {
      this.buffTracker = null;
    }

    return {
      live: true,
      gameTime,
      hudLive,
      teams,
      objectives: {
        dragon: {
          spawnAt: dragonSpawnAt,
          countdown: Math.max(0, dragonSpawnAt - gameTime),
          isElder: nextIsElder,
          upcomingElement,
          soulTaker,
        },
        baron: {
          spawnAt: baronSpawnAt,
          countdown: Math.max(0, baronSpawnAt - gameTime),
          buff,
        },
        pit,
      },
    };
  }

  idle() {
    this.buffTracker = null;
    return { live: false };
  }
}

export const DRAGON_ELEMENTS = DRAGON_TYPES;
