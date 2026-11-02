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
  assert(!ok(1, 'build', { kind: 'outpost', id: 0 }) || R.turn === 1, 'out-of-turn build must fail');

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
    if (R.step === 'bandit') { assert(ok(i, 'bandit', { hex: pick(B.hexes.map((_, k) => k).filter(k => k !== B.bandit)) })); continue; }
    if (R.step === 'steal') { assert(ok(i, 'steal', { target: pick(R.victims) })); continue; }
    if (R.step === 'roll') { if (!(p.cards.includes('captain') && Math.random() < .5 && ok(i, 'play', { card: 'captain' }))) assert(ok(i, 'roll')); continue; }

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
    if (L.towns.length && ok(i, 'build', { kind: 'town', id: pick(L.towns) })) continue;
    if (L.outposts.length && ok(i, 'build', { kind: 'outpost', id: pick(L.outposts) })) continue;
    if (ok(i, 'buy')) continue;
    if (L.routes.length && Math.random() < .7 && ok(i, 'build', { kind: 'route', id: pick(L.routes) })) continue;
    if (p.cards.includes('boon') && ok(i, 'play', { card: 'boon', res: ['grain', 'metal'] })) continue;
    const rich = RES.find(k => p.res[k] > g.ratio(R, i, k)), poor = RES.find(k => p.res[k] === 0);
    if (rich && poor && ok(i, 'bank', { give: rich, get: poor })) continue;
    assert(ok(i, 'end'));
  }

  assert.equal(R.phase, 'over', 'game should finish');
  assert(g.points(R, R.winner) >= 12);
  R.players.forEach((_, i) => {
    assert(B.edges.filter(e => e.owner === i).length <= 15);
    assert(B.vertices.filter(v => v.owner === i && !v.town).length <= 5);
    assert(B.vertices.filter(v => v.owner === i && v.town).length <= 4);
    assert(RES.every(k => R.players[i].res[k] >= 0));
  });
  // distance rule holds everywhere
  assert(B.vertices.every(v => v.owner === null || v.adj.every(a => B.vertices[a].owner === null)));
}
console.log('ok: 20 bot games finished cleanly');
