// Simulated game for testing the overlay without a running LoL client.
// Produces the same raw shape as /liveclientdata/allgamedata and is fed
// through the same GameStateEngine as live data.
//
// The simulation starts mid/late game (default 27:00) so every overlay
// widget has something to show, then advances in real time.

const BLUE = [
  { riotId: 'C9 Fudge#NA1', champion: 'Gnar' },
  { riotId: 'C9 Blaber#NA1', champion: 'Olaf' },
  { riotId: 'C9 Perkz#NA1', champion: 'Orianna' },
  { riotId: 'C9 Zven#NA1', champion: 'Kaisa' },
  { riotId: 'C9 Vulcan#NA1', champion: 'Alistar' },
];
const RED = [
  { riotId: 'TSM Huni#NA1', champion: 'Gragas' },
  { riotId: 'TSM Spica#NA1', champion: 'Udyr' },
  { riotId: 'TSM PowerOfEvil#NA1', champion: 'Syndra' },
  { riotId: 'TSM Lost#NA1', champion: 'Tristana' },
  { riotId: 'TSM SwordArt#NA1', champion: 'Rell' },
];

export class MockGame {
  constructor({ startAt = 27 * 60 } = {}) {
    this.t = startAt;
    this.startedWall = Date.now();
    this.startAt = startAt;
    this.events = [];
    this.players = [];
    let id = 0;
    for (const [team, roster] of [['ORDER', BLUE], ['CHAOS', RED]]) {
      for (const p of roster) {
        this.players.push({
          riotId: p.riotId,
          summonerName: p.riotId.split('#')[0],
          championName: p.champion,
          team,
          level: 1,
          isDead: false,
          respawnTimer: 0,
          scores: { kills: 0, deaths: 0, assists: 0, creepScore: 0, wardScore: 0 },
          items: [],
          _id: id++,
          _csRate: team === 'ORDER' ? 8.2 + Math.random() * 1.6 : 7.0 + Math.random() * 1.4,
        });
      }
    }
    this._buildHistory();
  }

  _addEvent(ev) {
    this.events.push({ EventID: this.events.length, ...ev });
  }

  _kill(killerIdx, victimIdx, time) {
    const killer = this.players[killerIdx];
    const victim = this.players[victimIdx];
    killer.scores.kills++;
    victim.scores.deaths++;
    // hand out 0-2 assists among killer's teammates
    const mates = this.players.filter(p => p.team === killer.team && p !== killer);
    for (const m of mates.slice(0, Math.floor(Math.random() * 3))) m.scores.assists++;
    this._addEvent({ EventName: 'ChampionKill', EventTime: time, KillerName: killer.riotId, VictimName: victim.riotId, Assisters: [] });
  }

  _buildHistory() {
    const t = (m, s) => m * 60 + s;
    // Blue side snowballs, mirroring the reference shot (26-10 at 28:00).
    this._addEvent({ EventName: 'GameStart', EventTime: 0 });
    this._addEvent({ EventName: 'MinionsSpawning', EventTime: 65 });
    this._kill(1, 6, t(3, 12)); // first blood
    this._addEvent({ EventName: 'FirstBlood', EventTime: t(3, 12), Recipient: BLUE[1].riotId });

    // Dragons: blue takes 1,3,4 (soul point pending), red steals #2.
    this._addEvent({ EventName: 'DragonKill', EventTime: t(5, 40), DragonType: 'Fire', Stolen: 'False', KillerName: BLUE[1].riotId });
    this._addEvent({ EventName: 'DragonKill', EventTime: t(11, 5), DragonType: 'Water', Stolen: 'True', KillerName: RED[1].riotId });
    this._addEvent({ EventName: 'DragonKill', EventTime: t(16, 30), DragonType: 'Fire', Stolen: 'False', KillerName: BLUE[1].riotId });
    this._addEvent({ EventName: 'DragonKill', EventTime: t(22, 10), DragonType: 'Fire', Stolen: 'False', KillerName: BLUE[1].riotId });

    // Grubs + herald
    for (let i = 0; i < 3; i++) this._addEvent({ EventName: 'HordeKill', EventTime: t(6, 30) + i * 20, KillerName: BLUE[1].riotId, Stolen: 'False' });
    this._addEvent({ EventName: 'HeraldKill', EventTime: t(15, 0), Stolen: 'False', KillerName: BLUE[1].riotId });

    // Turrets: 8 for blue, 2 for red
    const blueTakes = ['Turret_T2_L_03_A', 'Turret_T2_C_05_A', 'Turret_T2_R_03_A', 'Turret_T2_L_02_A', 'Turret_T2_C_04_A', 'Turret_T2_R_02_A', 'Turret_T2_C_03_A', 'Turret_T2_C_01_A'];
    const redTakes = ['Turret_T1_C_05_A', 'Turret_T1_L_03_A'];
    blueTakes.forEach((id, i) => this._addEvent({ EventName: 'TurretKilled', EventTime: t(9, 0) + i * 130, TurretKilled: id, KillerName: BLUE[i % 5].riotId, Assisters: [] }));
    redTakes.forEach((id, i) => this._addEvent({ EventName: 'TurretKilled', EventTime: t(12, 0) + i * 300, TurretKilled: id, KillerName: RED[i % 5].riotId, Assisters: [] }));
    this._addEvent({ EventName: 'FirstBrick', EventTime: t(9, 0), KillerName: BLUE[0].riotId });

    // Kill history to 25-9 before the baron fight
    let bk = 1, rk = 0;
    let time = t(4, 0);
    while (bk < 25 || rk < 9) {
      time += 40 + Math.random() * 60;
      if (time > t(26, 0)) time = t(26, 0);
      if (bk < 25 && (Math.random() < 0.72 || rk >= 9)) {
        this._kill(Math.floor(Math.random() * 5), 5 + Math.floor(Math.random() * 5), time);
        bk++;
      } else {
        this._kill(5 + Math.floor(Math.random() * 5), Math.floor(Math.random() * 5), time);
        rk++;
      }
    }

    // Baron at 26:20 for blue, one more kill for each side in the fight
    this._kill(2, 7, t(26, 10));
    this._kill(8, 4, t(26, 5));
    this._addEvent({ EventName: 'BaronKill', EventTime: t(26, 20), Stolen: 'False', KillerName: BLUE[1].riotId });

    // Items roughly matching a 27' game (prices only matter in aggregate)
    for (const p of this.players) {
      const rich = p.team === 'ORDER';
      const n = rich ? 5 : 4;
      for (let i = 0; i < n; i++) {
        p.items.push({ itemID: 3000 + i, displayName: 'Item', count: 1, slot: i, price: rich ? 2600 : 2300 });
      }
      p.level = rich ? 14 + Math.floor(Math.random() * 3) : 12 + Math.floor(Math.random() * 3);
    }
  }

  snapshot() {
    this.t = this.startAt + (Date.now() - this.startedWall) / 1000;

    // CS grows with time
    for (const p of this.players) {
      p.scores.creepScore = Math.floor((this.t / 60) * p._csRate);
      p.scores.wardScore = Math.floor(this.t / 45);
    }

    // occasional live kill so numbers move during preview
    if (!this._nextLiveKill) this._nextLiveKill = this.t + 25 + Math.random() * 50;
    if (this.t >= this._nextLiveKill) {
      const blueSide = Math.random() < 0.7;
      this._kill(
        blueSide ? Math.floor(Math.random() * 5) : 5 + Math.floor(Math.random() * 5),
        blueSide ? 5 + Math.floor(Math.random() * 5) : Math.floor(Math.random() * 5),
        this.t,
      );
      this._nextLiveKill = null;
    }

    return {
      activePlayer: {},
      allPlayers: this.players.map(({ _id, _csRate, ...p }) => ({ ...p, scores: { ...p.scores }, items: p.items.slice() })),
      events: { Events: this.events.slice() },
      gameData: { gameMode: 'CLASSIC', gameTime: this.t, mapName: 'Map11', mapNumber: 11, mapTerrain: 'Infernal' },
    };
  }
}
