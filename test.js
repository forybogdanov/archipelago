// Smoke test: 3 random bots play full games through the same act() the sockets use.
const assert = require('assert');
const g = require('./server');
const { RES } = g;
const pick = a => a[Math.floor(Math.random() * a.length)];

for (let game = 0; game < 20; game++) {
  const R = g.makeRoom('T');
  ['Ann', 'Bo', 'Cy'].forEach((name, k) => R.players.push({ pid: 'p' + k, name, color: '#fff', connected: true }));
  g.startGame(R);
  const B = R.board;
  assert.equal(B.hexes.length, 19);
  assert(B.hexes.every(h => Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r)) <= 2), 'board is one hexagon');
  assert.equal(B.hexes.filter(h => h.terrain === 'desert').length, 1);
  assert.equal(B.edges.filter(e => e.port).length, 7);
  assert(B.vertices.every(v => v.hexes.length <= 3 && v.adj.length >= 2 && v.adj.length <= 3));

  const ok = (i, type, a) => { try { g.act(R, i, type, a); return true; } catch { return false; } };
  assert(!ok(1, 'build', { kind: 'settlement', id: 0 }) || R.turn === 1, 'out-of-turn build must fail');

  let steps = 0;
  while (R.phase !== 'over' && steps++ < 100000) {
    const i = R.turn, p = R.players[i];
    if (R.phase === 'setup') { assert(ok(i, 'build', { kind: R.step, id: pick(g.legal(R, i)[R.step + 's']) })); continue; }
    if (R.step === 'discard') {
      for (const j of Object.keys(R.discard)) {
        const pool = RES.flatMap(k => Array(R.players[j].res[k]).fill(k)).sort(() => Math.random() - .5).slice(0, R.discard[j]);
        const res = Object.fromEntries(RES.map(k => [k, pool.filter(x => x === k).length]));
        assert(ok(+j, 'discard', { res }));
      }
      continue;
    }
    if (R.step === 'robber') { assert(ok(i, 'robber', { hex: pick(B.hexes.map((_, k) => k).filter(k => k !== B.robber)) })); continue; }
    if (R.step === 'steal') { assert(ok(i, 'steal', { target: pick(R.victims) })); continue; }
    if (R.step === 'roll') { assert(!ok(i, 'play', { card: 'knight' }), 'no cards before rolling'); assert(ok(i, 'roll')); continue; }
    if (p.cards.includes('knight') && Math.random() < .5 && ok(i, 'play', { card: 'knight' })) continue;
    if (p.cards.includes('challenge') && !R.cardPlayed) {
      const j = (i + 1) % R.players.length, mine = { ...p.res }, theirs = { ...R.players[j].res };
      assert(!ok(i, 'play', { card: 'challenge', target: i }), 'cannot challenge yourself');
      assert(ok(i, 'play', { card: 'challenge', target: j }));
      assert.equal(R.step, 'duel');
      assert(!ok(i, 'end'), 'no ending the turn mid-duel');
      const D = R.duel, win = Math.random() < .5, [s, t] = win ? [i, j] : [j, i];
      // The server clock is passed in, so freeze time, fire rate and the round timer are tested without waiting.
      let now = Date.now();
      const AHEAD = { x: 0, y: 0, z: 1 }, lane = (c = false) => { // both in the long mid lane, s looking at t
        g.duelMove(R, s, { x: 5.5, z: -18 }, now); g.duelMove(R, t, { x: 5.5, z: 18, c }, now);
      };
      const fire = (dir, w) => { now += 2000; return g.duelShoot(R, s, { dir, w }, now); };
      assert.throws(() => g.duelShoot(R, s, { dir: AHEAD, w: 'rifle' }, now), /not live/, 'no shooting in freeze time');
      now = D.live;
      g.duelMove(R, s, { x: 0, z: -31 }, now); g.duelMove(R, t, { x: 0, z: 31 }, now);
      assert.equal(fire(AHEAD, 'sniper').zone, null, 'the spawn walls block the shot');
      lane(true);
      assert.equal(fire(AHEAD, 'sniper').zone, null, 'crouching ducks under a head-height shot');
      assert.throws(() => g.duelShoot(R, s, { dir: AHEAD, w: 'sniper' }, now + 10), /Too fast/, 'fire rate is enforced');
      lane();
      const body = fire({ x: 0, y: -.5, z: 36 }, 'pistol');
      assert.deepEqual([body.zone, body.dmg, D.hp[t]], ['body', 30, 70]);
      assert.equal(fire({ x: 0, y: -1.3, z: 36 }, 'pistol').dmg, 23, 'legs take less');
      now = D.ends; assert(g.duelTick(R, now), 'round times out');
      assert.equal(D.score[s], 1, 'more health wins a timed-out round');
      while (R.duel) { // win the remaining rounds with headshots
        now = D.next; assert(g.duelTick(R, now), 'next round starts');
        assert.deepEqual(D.hp, { [i]: 100, [j]: 100 });
        now = D.live; lane();
        const hs = fire(AHEAD, 'pistol');
        assert.deepEqual([hs.zone, hs.killed], ['head', true]);
      }
      assert.equal(R.step, 'act');
      const tot = r => RES.reduce((n, k) => n + r[k], 0);
      if (win) { assert.equal(tot(R.players[j].res), 0); assert.equal(tot(p.res), tot(mine) + tot(theirs)); }
      else { assert.deepEqual(p.res, mine); assert.deepEqual(R.players[j].res, theirs); }
      continue;
    }

    if (Math.random() < .1) {
      const give = RES.find(k => p.res[k] > 1), want = RES.find(k => p.res[k] === 0);
      if (give && want && ok(i, 'offer', { give: { [give]: 1 }, want: { [want]: 1 } })) {
        R.players.forEach((_, j) => j !== i && ok(j, 'accept'));
        const before = R.players.map(q => RES.reduce((s, k) => s + q.res[k], 0));
        if (R.trade.accepts.length) { assert(ok(i, 'confirm', { with: R.trade.accepts[0] })); assert.deepEqual(R.players.map(q => RES.reduce((s, k) => s + q.res[k], 0)), before); }
        else assert(ok(i, 'cancel'));
      }
    }
    const L = g.legal(R, i);
    if (L.cities.length && ok(i, 'build', { kind: 'city', id: pick(L.cities) })) continue;
    if (L.settlements.length && ok(i, 'build', { kind: 'settlement', id: pick(L.settlements) })) continue;
    if (ok(i, 'buy')) continue;
    if (L.roads.length && Math.random() < .7 && ok(i, 'build', { kind: 'road', id: pick(L.roads) })) continue;
    if (p.cards.includes('plenty') && ok(i, 'play', { card: 'plenty', res: ['wheat', 'ore'] })) continue;
    const rich = RES.find(k => p.res[k] > g.ratio(R, i, k)), poor = RES.find(k => p.res[k] === 0);
    if (rich && poor && ok(i, 'bank', { give: rich, get: poor })) continue;
    assert(ok(i, 'end'));
  }

  assert.equal(R.phase, 'over', 'game should finish');
  assert(g.points(R, R.winner) >= 12);
  R.players.forEach((_, i) => {
    assert(B.edges.filter(e => e.owner === i).length <= 15);
    assert(B.vertices.filter(v => v.owner === i && !v.city).length <= 5);
    assert(B.vertices.filter(v => v.owner === i && v.city).length <= 4);
    assert(RES.every(k => R.players[i].res[k] >= 0));
  });
  // distance rule holds everywhere
  assert(B.vertices.every(v => v.owner === null || v.adj.every(a => B.vertices[a].owner === null)));
}

// Duel maps: one per terrain, drawn at random; each blocks spawn-to-spawn shots and keeps the lane used above open.
const DUEL = require('./duel'), ray = (boxes, x, z0, z1, y) => DUEL.wall({ x, y, z: z0 }, { x: 0, y: 0, z: 1 }, z1 - z0, boxes);
assert.deepEqual(Object.keys(DUEL.MAPS).sort(), ['desert', 'fields', 'forest', 'hills', 'mountains', 'pasture']);
for (const [name, { boxes }] of Object.entries(DUEL.MAPS)) {
  assert(ray(boxes, 0, -31, 31, 1.6) < 62, name + ': spawns cannot see each other');
  for (const x of [5.5, -5.5]) for (const y of [.2, 1, 1.6]) assert.equal(ray(boxes, x, -18, 18, y), 36, name + ': lane is open');
  for (const z of [-31, 31]) assert(boxes.every(([bx, bz, hx, hz]) => Math.abs(bx) >= hx + .4 || Math.abs(z - bz) >= hz + .4), name + ': spawn is free');
}
assert(new Set(Array.from({ length: 300 }, () => DUEL.create(0, 1, 0).map)).size === 6, 'maps are drawn at random');
// The sniper is a scout: two body shots or one headshot.
const sn = DUEL.WEAPONS.sniper.dmg, { hp } = DUEL.RULES;
assert(sn < hp && sn * 2 >= hp && sn * DUEL.ZONE.head >= hp);
console.log('ok: 20 bot games finished cleanly');
