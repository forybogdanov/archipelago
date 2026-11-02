// Archipelago server. Run: npm i && npm start, then expose with: ngrok http 3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const RES = ['timber', 'clay', 'wool', 'grain', 'metal'];
const YIELD = { forest: 'timber', quarry: 'clay', meadow: 'wool', farm: 'grain', mine: 'metal', desert: null };
const COST = {
  route: { timber: 1, clay: 1 },
  outpost: { timber: 1, clay: 1, wool: 1, grain: 1 },
  town: { grain: 2, metal: 3 },
  card: { wool: 1, grain: 1, metal: 1 },
};
const LIMIT = { route: 15, outpost: 5, town: 4 };
const WIN = 12, MAX_PLAYERS = 4;
const COLORS = ['#e4572e', '#29b6f6', '#f5f5f5', '#ab47bc'];

const rnd = n => Math.floor(Math.random() * n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const total = r => RES.reduce((s, k) => s + r[k], 0);
const has = (r, c) => RES.every(k => r[k] >= (c[k] || 0));
const pay = (r, c, sign = -1) => RES.forEach(k => { r[k] += sign * (c[k] || 0); });
const need = (ok, msg = 'Not allowed') => { if (!ok) throw new Error(msg); };
const bag = o => Object.fromEntries(RES.map(k => [k, Math.max(0, Math.min(99, parseInt(o?.[k]) || 0))]));
// logSeq counts every entry ever logged, so clients can tell which entries are new (for sounds).
const log = (R, m) => { R.log.push(m); R.logSeq = (R.logSeq || 0) + 1; if (R.log.length > 100) R.log.shift(); };

// ---------- board ----------
function genBoard() {
  // 19 hexes: every axial cell within 2 steps of the centre forms one big hexagon.
  const cells = [];
  for (let q = -2; q <= 2; q++) for (let r = Math.max(-2, -q - 2); r <= Math.min(2, -q + 2); r++) cells.push([q, r]);
  const terrain = shuffle(['desert', ...['forest', 'meadow', 'farm'].flatMap(t => [t, t, t, t]), ...['quarry', 'mine'].flatMap(t => [t, t, t])]);
  const nums = shuffle([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
  const hexes = cells.map(([q, r], i) => ({
    q, r, x: Math.sqrt(3) * (q + r / 2), y: 1.5 * r, terrain: terrain[i],
    num: terrain[i] === 'desert' ? null : nums.pop(), corners: [],
  }));

  // Vertices/edges are deduplicated by rounded pixel position of hex corners.
  const vertices = [], edges = [], vmap = new Map(), emap = new Map();
  const vid = (x, y) => {
    const k = Math.round(x * 100) + ',' + Math.round(y * 100);
    if (!vmap.has(k)) { vmap.set(k, vertices.length); vertices.push({ id: vertices.length, x, y, hexes: [], adj: [], edges: [], owner: null, town: false, port: null }); }
    return vmap.get(k);
  };
  hexes.forEach((h, hi) => {
    for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 30); h.corners.push(vid(h.x + Math.cos(a), h.y + Math.sin(a))); }
    h.corners.forEach((v, i) => {
      vertices[v].hexes.push(hi);
      const w = h.corners[(i + 1) % 6], k = Math.min(v, w) + '-' + Math.max(v, w);
      if (!emap.has(k)) {
        const id = edges.length;
        emap.set(k, id);
        edges.push({ id, a: v, b: w, hexes: [], owner: null, port: null });
        vertices[v].adj.push(w); vertices[w].adj.push(v);
        vertices[v].edges.push(id); vertices[w].edges.push(id);
      }
      edges[emap.get(k)].hexes.push(hi);
    });
  });

  // 7 ports spread evenly around the coastline: one 2:1 per good + two 3:1.
  const cx = hexes.reduce((s, h) => s + h.x, 0) / hexes.length, cy = hexes.reduce((s, h) => s + h.y, 0) / hexes.length;
  const ang = e => Math.atan2((vertices[e.a].y + vertices[e.b].y) / 2 - cy, (vertices[e.a].x + vertices[e.b].x) / 2 - cx);
  const coast = edges.filter(e => e.hexes.length === 1).sort((e, f) => ang(e) - ang(f));
  const types = shuffle([...RES, 'any', 'any']), off = rnd(coast.length);
  types.forEach((t, i) => {
    const e = coast[(off + Math.floor(i * coast.length / types.length)) % coast.length];
    e.port = vertices[e.a].port = vertices[e.b].port = t;
  });
  return { hexes, vertices, edges, bandit: hexes.findIndex(h => h.terrain === 'desert') };
}

// ---------- rules ----------
function legal(R, i) {
  const b = R.board, setup = R.phase === 'setup';
  const free = v => v.owner === null && v.adj.every(a => b.vertices[a].owner === null);
  const reach = id => { const v = b.vertices[id]; return v.owner === i || (v.owner === null && v.edges.some(e => b.edges[e].owner === i)); };
  return {
    outposts: b.vertices.filter(v => free(v) && (setup || v.edges.some(e => b.edges[e].owner === i))).map(v => v.id),
    routes: b.edges.filter(e => e.owner === null && (setup ? (e.a === R.lastOutpost || e.b === R.lastOutpost) : (reach(e.a) || reach(e.b)))).map(e => e.id),
    towns: setup ? [] : b.vertices.filter(v => v.owner === i && !v.town).map(v => v.id),
  };
}

function piecesLeft(R, i) {
  const b = R.board, mine = b.vertices.filter(v => v.owner === i);
  return {
    route: LIMIT.route - b.edges.filter(e => e.owner === i).length,
    outpost: LIMIT.outpost - mine.filter(v => !v.town).length,
    town: LIMIT.town - mine.filter(v => v.town).length,
  };
}

function ratio(R, i, r) {
  let n = 4;
  for (const v of R.board.vertices) if (v.owner === i && v.port) n = Math.min(n, v.port === r ? 2 : v.port === 'any' ? 3 : 4);
  return n;
}

function points(R, i, withSecret = true) {
  let s = 0;
  for (const v of R.board.vertices) if (v.owner === i) s += v.town ? 2 : 1;
  if (R.longest === i) s += 2;
  if (R.fleet === i) s += 2;
  if (withSecret) { const p = R.players[i]; s += [...p.cards, ...p.fresh].filter(c => c === 'renown').length; }
  return s;
}

// Longest chain of own routes; opponent buildings break it. ponytail: brute-force DFS, fine at 15 routes.
function longest(b, pi) {
  let best = 0;
  const used = new Set();
  const dfs = (v, len) => {
    best = Math.max(best, len);
    const o = b.vertices[v].owner;
    if (len > 0 && o !== null && o !== pi) return;
    for (const e of b.vertices[v].edges) {
      if (used.has(e) || b.edges[e].owner !== pi) continue;
      used.add(e);
      dfs(b.edges[e].a === v ? b.edges[e].b : b.edges[e].a, len + 1);
      used.delete(e);
    }
  };
  b.vertices.forEach(v => dfs(v.id, 0));
  return best;
}

function awards(R) {
  const lens = R.lens = R.players.map((_, i) => longest(R.board, i));
  let h = R.longest;
  if (h !== null && lens[h] < 5) h = null;
  const max = Math.max(...lens);
  if (max >= 5 && (h === null || lens[h] < max)) {
    const top = lens.flatMap((l, i) => (l === max ? [i] : []));
    h = top.length === 1 ? top[0] : null;
  }
  R.longest = h;
  R.players.forEach((p, i) => {
    if (p.captains >= 3 && (R.fleet === null || p.captains > R.players[R.fleet].captains)) R.fleet = i;
  });
}

function steal(R, i, j) {
  const pool = RES.flatMap(k => Array(R.players[j].res[k]).fill(k)), k = pool[rnd(pool.length)];
  R.players[j].res[k]--; R.players[i].res[k]++;
  log(R, `${R.players[i].name} robbed ${R.players[j].name} of a good`);
  R.step = R.resume;
}

const ACT = {
  build(R, i, { kind, id }) {
    const p = R.players[i], b = R.board, L = legal(R, i);
    if (R.phase === 'setup') {
      need(kind === R.step && L[kind + 's'].includes(id), 'Illegal placement');
      const n = R.players.length;
      log(R, `${p.name} placed a${kind === 'outpost' ? 'n' : ''} ${kind}`);
      if (kind === 'outpost') {
        b.vertices[id].owner = i; R.lastOutpost = id; R.step = 'route';
        if (R.setupIdx >= n) for (const h of b.vertices[id].hexes) { const r = YIELD[b.hexes[h].terrain]; if (r) p.res[r]++; }
      } else {
        b.edges[id].owner = i;
        R.setupIdx++;
        if (R.setupIdx === 2 * n) { R.phase = 'main'; R.turn = 0; R.step = 'roll'; log(R, 'Setup done — set sail!'); }
        else { R.turn = R.setupIdx < n ? R.setupIdx : 2 * n - 1 - R.setupIdx; R.step = 'outpost'; }
      }
      return;
    }
    need(R.step === 'act', 'Roll first');
    need(Object.hasOwn(LIMIT, kind) && L[kind + 's'].includes(id), 'Illegal placement');
    need(has(p.res, COST[kind]), 'Not enough goods');
    need(piecesLeft(R, i)[kind] > 0, `No ${kind}s left`);
    pay(p.res, COST[kind]);
    if (kind === 'route') b.edges[id].owner = i;
    else if (kind === 'outpost') b.vertices[id].owner = i;
    else b.vertices[id].town = true;
    log(R, `${p.name} built a ${kind}`);
  },

  roll(R, i) {
    need(R.step === 'roll', 'Not time to roll');
    const d = R.dice = [rnd(6) + 1, rnd(6) + 1], s = d[0] + d[1], b = R.board;
    log(R, `${R.players[i].name} rolled ${s}`);
    if (s === 7) {
      R.discard = {};
      R.players.forEach((p, j) => { const t = total(p.res); if (t > 7) R.discard[j] = Math.floor(t / 2); });
      R.resume = 'act';
      R.step = Object.keys(R.discard).length ? 'discard' : 'bandit';
      log(R, '🗡️ Bandits raid the island!');
      return;
    }
    b.hexes.forEach((h, hi) => {
      if (h.num !== s || hi === b.bandit) return;
      for (const v of h.corners) { const V = b.vertices[v]; if (V.owner !== null) R.players[V.owner].res[YIELD[h.terrain]] += V.town ? 2 : 1; }
    });
    R.step = 'act';
  },

  discard(R, i, { res }) {
    const n = R.discard[i], p = R.players[i], b = bag(res);
    need(R.step === 'discard' && n, 'Nothing to discard');
    need(total(b) === n, `Discard exactly ${n}`);
    need(has(p.res, b), "You don't have those goods");
    pay(p.res, b);
    delete R.discard[i];
    if (!Object.keys(R.discard).length) R.step = 'bandit';
  },

  bandit(R, i, { hex }) {
    const b = R.board;
    need(R.step === 'bandit', 'Not now');
    need(Number.isInteger(hex) && hex >= 0 && hex < b.hexes.length && hex !== b.bandit, 'Pick another hex');
    b.bandit = hex;
    R.victims = [...new Set(b.hexes[hex].corners.map(v => b.vertices[v].owner))].filter(o => o !== null && o !== i && total(R.players[o].res) > 0);
    if (R.victims.length === 1) steal(R, i, R.victims[0]);
    else if (R.victims.length) R.step = 'steal';
    else R.step = R.resume;
  },

  steal(R, i, { target }) {
    need(R.step === 'steal' && R.victims.includes(target), 'Pick a valid player');
    steal(R, i, target);
  },

  buy(R, i) {
    const p = R.players[i];
    need(R.step === 'act', 'Not now');
    need(R.deck.length, 'Expedition deck is empty');
    need(has(p.res, COST.card), 'Not enough goods');
    pay(p.res, COST.card);
    p.fresh.push(R.deck.pop());
    log(R, `${p.name} bought an expedition card`);
  },

  play(R, i, { card, res }) {
    const p = R.players[i], k = p.cards.indexOf(card);
    need(R.step === 'roll' || R.step === 'act', 'Not now');
    need(!R.cardPlayed, 'One card per turn');
    need(k >= 0 && card !== 'renown', "You can't play that");
    if (card === 'boon') {
      need(Array.isArray(res) && res.length === 2 && res.every(r => RES.includes(r)), 'Pick two goods');
      res.forEach(r => p.res[r]++);
    }
    p.cards.splice(k, 1);
    R.cardPlayed = true;
    if (card === 'captain') { p.captains++; R.resume = R.step; R.step = 'bandit'; }
    log(R, `${p.name} played ${card === 'captain' ? 'a Captain' : 'a Resource Boon'}`);
  },

  bank(R, i, { give, get }) {
    const p = R.players[i];
    need(R.step === 'act', 'Not now');
    need(RES.includes(give) && RES.includes(get) && give !== get, 'Bad trade');
    const n = ratio(R, i, give);
    need(p.res[give] >= n, `Need ${n} ${give}`);
    p.res[give] -= n; p.res[get]++;
    log(R, `${p.name} traded ${n} ${give} for 1 ${get}`);
  },

  offer(R, i, { give, want }) {
    const g = bag(give), w = bag(want);
    need(R.step === 'act', 'Not now');
    need(total(g) && total(w), 'Offer something for something');
    need(has(R.players[i].res, g), "You don't have those goods");
    R.trade = { from: i, give: g, want: w, accepts: [] };
  },

  accept(R, i) {
    const t = R.trade;
    need(t && t.from !== i, 'No offer to accept');
    need(has(R.players[i].res, t.want), "You don't have the goods");
    if (!t.accepts.includes(i)) t.accepts.push(i);
  },

  confirm(R, i, { with: j }) {
    const t = R.trade, p = R.players[i], q = R.players[j];
    need(R.step === 'act' && t && t.from === i && t.accepts.includes(j), 'Not now');
    need(has(p.res, t.give) && has(q.res, t.want), 'Someone no longer has the goods');
    pay(p.res, t.give); pay(q.res, t.give, 1);
    pay(q.res, t.want); pay(p.res, t.want, 1);
    R.trade = null;
    log(R, `${p.name} traded with ${q.name}`);
  },

  cancel(R, i) {
    need(R.trade && R.trade.from === i, 'No offer');
    R.trade = null;
  },

  end(R, i) {
    const p = R.players[i];
    need(R.step === 'act', 'Not now');
    p.cards.push(...p.fresh); p.fresh = [];
    R.cardPlayed = false; R.trade = null;
    R.turn = (R.turn + 1) % R.players.length;
    R.step = 'roll';
  },

  chat(R, i, { text }) {
    const t = String(text || '').trim().slice(0, 200);
    if (t.startsWith('/')) return cheat(R, i, t);
    if (t) log(R, `💬 ${R.players[i].name}: ${t}`);
  },
};

// Test cheats, typed in chat. Only with `node server.js --cheats` (npm run cheat); always announced in the log.
//   /give [n]            n of every good (default 5)
//   /give <good> [n]     n of one good, e.g. /give metal 3
//   /card <type>         playable card now: captain | boon | renown
const CHEATS = process.argv.includes('--cheats');
function cheat(R, i, cmd) {
  need(CHEATS, 'Cheats are off (start the server with npm run cheat)');
  need(R.phase === 'main' || R.phase === 'setup', 'Start a game first');
  const p = R.players[i], [name, a, b] = cmd.slice(1).toLowerCase().split(/\s+/);
  if (name === 'give') {
    const good = RES.includes(a) ? a : null, n = Math.max(1, Math.min(99, parseInt(good ? b : a) || 5));
    need(good || !a || /^\d+$/.test(a), `Unknown good: ${a} (${RES.join(', ')})`);
    for (const k of good ? [good] : RES) p.res[k] += n;
    log(R, `🧪 ${p.name} cheated in ${n} ${good || 'of every good'}`);
  } else if (name === 'card') {
    need(['captain', 'boon', 'renown'].includes(a), 'Usage: /card captain|boon|renown');
    p.cards.push(a);
    log(R, `🧪 ${p.name} cheated in a ${a} card`);
  } else need(false, 'Cheats: /give [n], /give <good> [n], /card captain|boon|renown');
}

// Single entry point for every game action (sockets and tests both go through here).
function act(R, i, type, a = {}) {
  need(i >= 0, 'Not in this room');
  need(Object.hasOwn(ACT, type), 'Unknown action');
  if (type !== 'chat') {
    need(R.phase === 'setup' ? type === 'build' : R.phase === 'main', 'Not now');
    if (type !== 'discard' && type !== 'accept') need(R.turn === i, 'Not your turn');
  }
  ACT[type](R, i, a);
  if (R.phase === 'main') {
    awards(R);
    if (points(R, R.turn) >= WIN) {
      R.phase = 'over'; R.winner = R.turn;
      log(R, `🏆 ${R.players[R.turn].name} wins with ${points(R, R.turn)} Renown!`);
    }
  }
}

function makeRoom(code) { return { code, host: null, players: [], phase: 'lobby', log: [] }; }

function startGame(R) {
  shuffle(R.players);
  Object.assign(R, {
    phase: 'setup', board: genBoard(),
    deck: shuffle([...Array(14).fill('captain'), ...Array(4).fill('boon'), ...Array(5).fill('renown')]),
    turn: 0, step: 'outpost', setupIdx: 0, lastOutpost: null, dice: null, discard: {}, victims: [], resume: 'act',
    trade: null, cardPlayed: false, longest: null, fleet: null, winner: null, lens: R.players.map(() => 0),
  });
  for (const p of R.players) Object.assign(p, { res: bag({}), cards: [], fresh: [], captains: 0 });
  log(R, 'The voyage begins! Each captain places an outpost and a route (snake order).');
}

// Per-player view: hides other hands and cards.
function view(R, me) {
  const over = R.phase === 'over', inGame = R.phase !== 'lobby';
  const base = {
    code: R.code, phase: R.phase, me, isHost: R.players[me].pid === R.host, win: WIN, cost: COST, log: R.log.slice(-60), logSeq: R.logSeq || 0,
    players: R.players.map((p, i) => ({
      name: p.name, color: p.color, connected: p.connected,
      ...(inGame && { hand: total(p.res), cards: p.cards.length + p.fresh.length, captains: p.captains, route: R.lens[i], points: points(R, i, i === me || over) }),
    })),
  };
  if (!inGame) return base;
  const p = R.players[me], mine = R.turn === me;
  return {
    ...base, board: R.board, turn: R.turn, step: R.step, dice: R.dice, longest: R.longest, fleet: R.fleet,
    trade: R.trade, winner: R.winner, deckLeft: R.deck.length,
    discard: R.step === 'discard' ? R.discard[me] || 0 : 0,
    victims: R.step === 'steal' && mine ? R.victims : null,
    legal: mine && (R.phase === 'setup' || R.step === 'act') ? legal(R, me) : null,
    my: {
      res: p.res, cards: p.cards, fresh: p.fresh, cardPlayed: R.cardPlayed, left: piecesLeft(R, me),
      ratios: Object.fromEntries(RES.map(r => [r, ratio(R, me, r)])),
    },
  };
}

// ---------- network ----------
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  } else if (/^\/img\/[a-z]+\.(jpg|png)$/.test(req.url) && fs.existsSync(path.join(__dirname, req.url))) {
    res.writeHead(200, { 'Content-Type': req.url.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-cache' });
    fs.createReadStream(path.join(__dirname, req.url)).pipe(res);
  } else if (/^\/sfx\/[a-z_]+\.(mp3|ogg)$/.test(req.url) && fs.existsSync(path.join(__dirname, req.url))) {
    res.writeHead(200, { 'Content-Type': req.url.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg', 'Cache-Control': 'no-cache' });
    fs.createReadStream(path.join(__dirname, req.url)).pipe(res);
  } else if (req.url === '/board') { // random board for the ?preview page
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(genBoard()));
  } else { res.writeHead(404); res.end(); }
});
const io = new Server(server); // same-origin; client connects to whatever host/protocol served the page
// ponytail: one game per server process; add rooms keyed by code if you ever host several tables.
const R = makeRoom('LOCAL');
const send = () => R.players.forEach((p, i) => p.connected && io.to(p.sid).emit('state', view(R, i)));
const clean = s => String(s || '').trim().slice(0, 16) || 'Sailor';

io.on('connection', socket => {
  const guard = fn => (a = {}) => { try { fn(a || {}); send(); } catch (e) { socket.emit('err', e.message); } };
  const me = () => R.players.findIndex(p => p.pid === socket.data.pid);

  // Join, or rebind after a refresh/reconnect (same pid).
  socket.on('join', guard(({ name, pid }) => {
    pid = String(pid || '').slice(0, 64);
    need(pid, 'Missing player id');
    let p = R.players.find(p => p.pid === pid);
    if (!p) {
      need(name !== undefined, 'Session expired — join again'); // auto-rejoin from a tab the server no longer knows
      need(R.phase === 'lobby', 'Game already in progress');
      need(R.players.length < MAX_PLAYERS, 'Game is full');
      p = { pid, name: clean(name), color: COLORS.find(c => !R.players.some(q => q.color === c)) };
      R.players.push(p);
      if (!R.host) R.host = pid;
    }
    p.sid = socket.id; p.connected = true;
    socket.data.pid = pid;
  }));

  socket.on('start', guard(() => {
    need(R.host === socket.data.pid && (R.phase === 'lobby' || R.phase === 'over'), 'Only the host can start');
    need(R.players.length >= 2, 'Need at least 2 players');
    startGame(R);
  }));

  socket.on('act', guard(({ type, ...a }) => act(R, me(), type, a)));

  socket.on('disconnect', () => {
    const p = R.players[me()];
    if (!p || p.sid !== socket.id) return;
    if (R.phase === 'lobby') {
      R.players.splice(me(), 1);
      if (R.host === p.pid) R.host = R.players[0]?.pid ?? null;
    } else p.connected = false;
    send();
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Archipelago on http://localhost:${PORT} — share it with: ngrok http ${PORT}`));
}
module.exports = { RES, makeRoom, startGame, act, legal, ratio, points };
