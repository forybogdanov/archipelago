// Duel rules + geometry, shared by server.js (authoritative) and the page (prediction, drawing, /test-duel bot match).
// Tactical first-person shootout: hitscan weapons, head/body/leg damage, rounds with freeze time, first to RULES.wins.
(function (api) {
  // Arena: floor 44 x 68 m inside perimeter walls. Solid blocks [x, z, half-x, half-z, height]; anything up to
  // STEP higher than your feet is walked up (stairs), anything up to ~1.2 m can be jumped onto.
  // One map per board terrain, drawn at random per duel. One half is listed, the other is its half-turn copy, so both spawns
  // get the same map. Every map keeps the spawn wall and leaves the lanes at x = +-5.5 open (test.js checks both).
  // sky / floor / wall / crate = colours; blocks that are tall, thin or long are drawn as wall, the rest as crates.
  api.STEP = .36;
  const A = api.ARENA = { hx: 22, hz: 34 };
  const map = (name, sky, floor, wall, crate, half) => {
    half = [[0, -26, 5, .4, 3.5], ...half];                                    // spawn wall: no spawn-to-spawn shots
    return { name, sky, floor, wall, crate, boxes: [...half, ...half.filter(b => b[0] || b[1]).map(([x, z, ...r]) => [-x, -z, ...r])] };
  };
  const at = (pts, ...size) => pts.map(p => [...p, ...size]);
  api.MAPS = {
    desert: map('Desert', 0x9fc4e0, '#c9b48a', '#aeb0ad', '#9a6b35', [           // three lanes
      [0, 0, 2.5, 2.5, 1.2], [0, 0, .8, .8, 3.2],
      [7, -17, .4, 5, 3.5], [7, -4.5, .4, 4.5, 3.5], [7, 10, .4, 7, 3.5], [7, 21, .4, 1, 3.5], // lane wall with three doors
      [-3, -12, 2, .4, 1.1],                                                   // crouch cover in the long mid lane
      [18, -8, 4, 3, 2], [18, -4.8, 4, .2, 3.1],                               // sniper nest over the side lane, parapet facing the enemy
      ...[1, 2, 3, 4, 5].map(k => [16, -15.4 + .8 * k, 2, .4, k / 3]),         // stairs up to it
      [14, 6, 1, 1, 1.2], [11, 14, 1.2, 1.2, 2.4], [19, 18, 1, 1, 1.2], [12, -18, 1, 1, 1.2], [16, 2, .8, .8, 1.6], [10.5, -1, 1, 1, 1.2],
    ]),
    forest: map('Forest', 0x8fb8a0, '#4c7a3a', '#5b4028', '#2f6b2a', [           // tree trunks everywhere, bushes and logs for low cover
      [0, 0, .8, .8, 4.5], [0, 0, 2.5, .5, .9],
      ...at([[9, -22], [15, -27], [19, -14], [11, -9], [16, -2], [8, 3], [19, 7], [12, 13], [17, 20], [9, 24], [2, -17], [3, -6], [1.5, 8]], .6, .6, 4.5),
      ...at([[13, -17], [8, -3], [15, 5], [10, 18], [2.5, 14]], 1, 1, 1.2),
      [12, -4, 2, .4, .8], [16, 12, .4, 2, .8],
    ]),
    hills: map('Hills', 0xd9c2a4, '#b5704a', '#a39a8e', '#c2613a', [           // stepped terraces on the flanks, cut stone slabs, brick stacks
      [0, 0, 2, 2, 1.2],
      [17, -4, 5, 9, .35], [18.5, -4, 3.5, 6.5, .7], [20, -4, 2, 4, 1.05],
      [9, -20, 1.5, 1.5, 3.5], [8.5, 8, 1.2, 3, 3.5], [14, 16, 3, 1, 3.5], [2, -12, 1.5, .8, 3.5], [1, 18, 1, 2, 2.4],
      ...at([[10, -8], [8, -14], [12, 6], [18, 12], [9, 22], [15, -22], [3, 3]], 1, 1, 1.2),
    ]),
    pasture: map('Pasture', 0xa8d4f0, '#86b858', '#b9b4a6', '#ece8dc', [           // open ground: low drystone walls, one shelter, sheep
      [0, 0, 1.2, 1.2, 1.4],
      [12, -12, 4, .3, 1.1], [14, 4, .3, 5, 1.1], [10, 18, 3, .3, 1.1], [2, -8, 2, .3, 1.1], [18, -22, .3, 3, 1.1],
      [16, -3, 2.5, 2, 3.2],
      ...at([[9, -5], [18, 14], [8, -21], [3, 10], [2, 20]], .9, .6, .9), ...at([[11, 8], [15, 24]], .6, .9, .9),
    ]),
    fields: map('Fields', 0xf0d9a0, '#b89a4a', '#a8402e', '#e6c35a', [               // barn and silo, rows of hay bales, fences
      [0, 0, 2, 2, 2.4],
      [16, -6, 4, 5, 4], [19, 10, 1.5, 1.5, 4.5],
      ...at([[9, -16], [9, -13.8], [13, 8], [13, 10.2], [8, 2], [8, 20], [18, 18], [3, -14], [2.5, 12]], 1, 1, 1.2),
      ...at([[9, -11.6], [13, 12.4], [18, 20.2]], 1, 1, 2.4),
      [12, -24, 3, .2, 1.1], [16, 2.5, 4, .2, 1.1], [2, -4, .2, 3, 1.1],
    ]),
    mountains: map('Mountains', 0x23252e, '#55565e', '#3a3b44', '#7a5a3a', [               // dark tunnels: rock walls and pillars, ore carts
      [0, 0, 1.5, 1.5, 3.5],
      [7.4, -14, .6, 8, 3.5], [7.4, 9, .6, 7, 3.5], [15, -12, 4, .6, 3.5], [13, 4, 3, .6, 3.5], [17, 16, 5, .6, 3.5],
      ...at([[2, -10], [3, 8], [11, -22], [18, -2], [11, 24]], 1, 1, 3.5),
      ...at([[10, -2], [18, -18], [3, -20], [9, 19], [19, 8]], 1, .7, 1.1), [14, 10, .7, 1, 1.1],
    ]),
  };
  api.SPAWN = [{ x: 0, y: 0, z: -31, yaw: Math.PI, pitch: 0 }, { x: 0, y: 0, z: 31, yaw: 0, pitch: 0 }];
  api.RULES = { hp: 100, wins: 3, freeze: 3000, round: 60000, post: 3000 };
  api.ZONE = { head: 4, body: 1, legs: .75 };
  // rate/reload/draw in ms, speed in m/s, spread/move/air = inaccuracy cone (rad) standing still / at full run / airborne,
  // pat(heat) = [pitch, yaw] recoil offset after `heat` rapid shots (deterministic, so sprays can be learned), cool = heat lost per second.
  api.WEAPONS = {
    rifle: { name: 'Rifle', dmg: 36, rate: 100, auto: true, mag: 30, reserve: 90, reload: 2400, draw: 500, speed: 5.5, spread: .003, move: .07, air: .15, cool: 12,
      pat: h => [.013 * Math.min(h, 10) + .001 * Math.max(0, h - 10), h < 4 ? 0 : .035 * Math.sin((h - 4) * .5) * Math.min(1, (h - 4) / 3)] },
    pistol: { name: 'Pistol', dmg: 30, rate: 160, mag: 12, reserve: 36, reload: 2100, draw: 400, speed: 6.1, spread: .005, move: .02, air: .1, cool: 8,
      pat: h => [.012 * Math.min(h, 4), 0] },
    knife: { name: 'Knife', dmg: 40, altDmg: 65, rate: 450, altRate: 1000, draw: 350, speed: 6.35, range: 1.9, spread: 0, move: 0, air: 0, cool: 9, pat: () => [0, 0] },
    // Scout, not AWP: two body shots or one headshot, quick bolt, nearly knife speed; still wild when moving or unscoped.
    sniper: { name: 'Sniper', dmg: 75, rate: 1250, mag: 10, reserve: 20, reload: 3000, draw: 700, speed: 5.9, spread: .0003, move: .12, air: .2, unscoped: .06, cool: 9,
      pat: () => [0, 0] },
  };
  const SLACK = 150; // ms of network jitter tolerated by the fire-rate check

  api.eye = p => ({ x: p.x, y: (p.y || 0) + (p.c ? 1.15 : 1.6), z: p.z });

  // ---- rays (o + d*t, d unit length) ----
  const slab = (o, d, lo, hi) => { // entry distance into an axis-aligned box, Infinity on a miss
    let t0 = 0, t1 = Infinity;
    for (const a of 'xyz') {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) return Infinity; continue; }
      let u = (lo[a] - o[a]) / d[a], v = (hi[a] - o[a]) / d[a];
      if (u > v) [u, v] = [v, u];
      t0 = Math.max(t0, u); t1 = Math.min(t1, v);
      if (t0 > t1) return Infinity;
    }
    return t0;
  };
  // Distance to the first floor / perimeter wall / block of `boxes` (a map's), capped at max.
  api.wall = (o, d, max, boxes) => {
    let best = max;
    if (d.y < 0) best = Math.min(best, -o.y / d.y);
    for (const [a, lim] of [['x', A.hx], ['z', A.hz]]) if (d[a]) best = Math.min(best, ((d[a] > 0 ? lim : -lim) - o[a]) / d[a]);
    for (const [bx, bz, hx, hz, h] of boxes) best = Math.min(best, slab(o, d, { x: bx - hx, y: 0, z: bz - hz }, { x: bx + hx, y: h, z: bz + hz }));
    return best;
  };
  // Where a ray enters player p = { x, y, z, c }: { t, zone } or null. Head sphere over body and leg cylinders; crouching shrinks all three.
  api.hitBody = (o, d, p) => {
    const k = p.c ? .72 : 1, y = p.y || 0, ox = o.x - p.x, oz = o.z - p.z;
    let best = null;
    const take = (t, zone) => { if (t >= 0 && (!best || t < best.t)) best = { t, zone }; };
    const oy = o.y - (y + 1.6 * k), b = ox * d.x + oy * d.y + oz * d.z, disc = b * b - (ox * ox + oy * oy + oz * oz - .21 * .21);
    if (disc >= 0) take(-b - Math.sqrt(disc), 'head');
    const cyl = (r, y0, y1, zone) => {
      const a = d.x * d.x + d.z * d.z, hb = ox * d.x + oz * d.z, q = hb * hb - a * (ox * ox + oz * oz - r * r);
      if (a < 1e-9 || q < 0) return;
      const t = (-hb - Math.sqrt(q)) / a, hy = o.y + d.y * t;
      if (hy >= y0 && hy <= y1) take(t, zone);
    };
    cyl(.36, y + .8 * k, y + 1.42 * k, 'body'); cyl(.3, y, y + .8 * k, 'legs');
    return best;
  };

  // ---- match state ----
  const reset = (D, now) => {
    D.round++;
    D.hp = { [D.a]: api.RULES.hp, [D.b]: api.RULES.hp };
    D.pos = { [D.a]: { ...api.SPAWN[0], c: false, w: 'rifle' }, [D.b]: { ...api.SPAWN[1], c: false, w: 'rifle' } };
    D.live = now + api.RULES.freeze * (D.round === 1 ? 2 : 1); // longer first freeze: time to pick a weapon
    D.ends = D.live + api.RULES.round; D.next = null;
  };
  const pick = () => { const k = Object.keys(api.MAPS); return k[Math.floor(Math.random() * k.length)]; };
  api.create = (a, b, now, map) => { const D = { a, b, map: api.MAPS[map] ? map : pick(), score: { [a]: 0, [b]: 0 }, round: 0, last: {}, winner: null, roundWinner: null }; reset(D, now); return D; };

  // ponytail: positions are trusted (clamped to the arena; pinned to spawn in freeze time), no speed checks or lag compensation; add if cheating/latency bites.
  api.move = (D, i, p, now) => {
    const c = (v, lim) => Math.max(-lim, Math.min(lim, +v || 0)), old = D.pos[i], pin = now < D.live;
    D.pos[i] = { x: pin ? old.x : c(p.x, A.hx), y: pin ? 0 : Math.max(0, Math.min(5, +p.y || 0)), z: pin ? old.z : c(p.z, A.hz),
      yaw: +p.yaw || 0, pitch: c(p.pitch, 1.5), c: !!p.c, w: api.WEAPONS[p.w] ? p.w : 'rifle' };
  };

  const endRound = (D, w, now) => {
    D.score[w]++; D.roundWinner = w;
    if (D.score[w] >= api.RULES.wins) D.winner = w; else D.next = now + api.RULES.post;
  };

  // i fires weapon w along dir from where they stand. Returns the shot { from, w, o, end, zone, dmg, hp, killed } for both screens.
  // ponytail: the client rolls its own spread/recoil into dir and counts its own ammo; the server only enforces rate of fire and geometry.
  api.shoot = (D, i, { dir, w, alt }, now) => {
    const W = api.WEAPONS[w], n = dir && Math.hypot(dir.x, dir.y, dir.z), key = i + w;
    if (!W) throw new Error('Bad weapon');
    if (!Number.isFinite(n) || !n) throw new Error('Bad aim');
    if (now < D.live || D.next || D.winner !== null || D.hp[i] <= 0) throw new Error('Round not live');
    const rate = alt && W.altRate || W.rate;
    if (now < (D.last[key] || 0) + rate - SLACK) throw new Error('Too fast');
    D.last[key] = Math.max((D.last[key] || 0) + rate, now - SLACK);
    const d = { x: dir.x / n, y: dir.y / n, z: dir.z / n }, o = api.eye(D.pos[i]), j = i === D.a ? D.b : D.a;
    const max = api.wall(o, d, W.range || 200, api.MAPS[D.map].boxes), h = api.hitBody(o, d, D.pos[j]), t = h && h.t < max ? h.t : max;
    const ev = { from: i, w, o, end: { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t }, zone: null, dmg: 0, killed: false };
    if (t < max) {
      ev.zone = h.zone;
      ev.dmg = Math.min(D.hp[j], Math.round((alt && W.altDmg || W.dmg) * api.ZONE[h.zone]));
      ev.hp = D.hp[j] -= ev.dmg;
      if (ev.hp <= 0) { ev.killed = true; endRound(D, i, now); }
    }
    return ev;
  };

  // Advances the round clock. True when something changed: time ran out (more health wins, a tie goes to the challenged) or the next round began.
  api.tick = (D, now) => {
    if (D.winner !== null) return false;
    if (D.next) { if (now < D.next) return false; reset(D, now); return true; }
    if (now < D.ends) return false;
    endRound(D, D.hp[D.a] > D.hp[D.b] ? D.a : D.b, now);
    return true;
  };

  // What the screens need. pos is only read at round start; live positions travel through 'move'.
  api.view = (D, now) => ({ a: D.a, b: D.b, map: D.map, hp: D.hp, score: D.score, round: D.round, wins: api.RULES.wins, liveIn: D.live - now, left: D.ends - now,
    post: !!D.next, roundWinner: D.roundWinner, pos: D.pos });
})(typeof module !== 'undefined' ? module.exports : (window.DuelPhys = {}));
