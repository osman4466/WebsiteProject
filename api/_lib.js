// Shared helpers: storage (Upstash Redis REST, with in-memory fallback for local dev), stock,
// admin auth (HMAC signed token), small HTTP utilities.
const crypto = require('crypto');

// Vercel/Upstash may add a custom prefix to the variable names (e.g. STORAGE_KV_REST_API_URL),
// so we accept any name that ends with one of the known names.
function findEnv(re) {
  const k = Object.keys(process.env).find((name) => re.test(name) && process.env[name]);
  return k ? process.env[k] : undefined;
}
const REDIS_URL = findEnv(/(^|_)(KV_REST_API_URL|UPSTASH_REDIS_REST_URL)$/);
const REDIS_TOKEN = findEnv(/(^|_)(KV_REST_API_TOKEN|UPSTASH_REDIS_REST_TOKEN)$/);
const HAS_REDIS = !!(REDIS_URL && REDIS_TOKEN);
const ON_VERCEL = !!process.env.VERCEL;

// Every database call goes through redis(cmd) (and pipe(cmds) for several calls in one trip).
// To move to another database later (for example MySQL on cPanel) only this block has to be re-written.
async function redisRest(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error('Redis: ' + j.error);
  return j.result;
}

async function pipeRest(cmds) {
  const r = await fetch(REDIS_URL + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error('Redis: ' + ((j && j.error) || 'bad reply'));
  return j.map((x) => { if (x.error) throw new Error('Redis: ' + x.error); return x.result; });
}

// Local development without a database: the same commands, kept in memory.
// (On Vercel every request can run in a different instance, so memory would lose data - we refuse to run without a database there.)
const mem = global.__JW_MEM__ || (global.__JW_MEM__ = { s: new Map(), h: new Map(), l: new Map(), exp: new Map() });
const alive = (k) => { const t = mem.exp.get(k); if (t && Date.now() > t) { mem.s.delete(k); mem.h.delete(k); mem.l.delete(k); mem.exp.delete(k); } };
const hash = (k) => mem.h.get(k) || mem.h.set(k, new Map()).get(k);
const list = (k) => mem.l.get(k) || mem.l.set(k, []).get(k);

function reserveMem(args) {
  const rows = [];
  for (let i = 0; i < args.length; i += 3) rows.push([String(args[i]), Number(args[i + 1]), Number(args[i + 2])]);
  const h = hash('stock');
  rows.forEach(([f, , seed]) => { if (!h.has(f)) h.set(f, String(seed)); });
  for (const [f, q] of rows) { const have = Number(h.get(f)); if (have < q) return [0, f, have]; }
  rows.forEach(([f, q]) => h.set(f, String(Number(h.get(f)) - q)));
  return [1];
}

async function memRedis(cmd) {
  const [op, k, ...r] = cmd; const name = String(op).toUpperCase();
  if (name !== 'EVAL') alive(k);
  switch (name) {
    case 'GET': return mem.s.has(k) ? mem.s.get(k) : null;
    case 'SET': {
      const nx = r.slice(1).some((x) => String(x).toUpperCase() === 'NX');
      if (nx && mem.s.has(k)) return null;
      mem.s.set(k, String(r[0]));
      const ex = r.findIndex((x) => String(x).toUpperCase() === 'EX');
      if (ex > 0) mem.exp.set(k, Date.now() + Number(r[ex + 1]) * 1000); else mem.exp.delete(k);
      return 'OK';
    }
    case 'DEL': { let n = 0; [k, ...r].forEach((x) => { n += (mem.s.delete(x) | mem.h.delete(x) | mem.l.delete(x)); }); return n; }
    case 'INCR': { const n = (Number(mem.s.get(k)) || 0) + 1; mem.s.set(k, String(n)); return n; }
    case 'EXPIRE': if (!mem.exp.has(k)) mem.exp.set(k, Date.now() + Number(r[0]) * 1000); return 1;
    case 'MGET': return [k, ...r].map((x) => { alive(x); return mem.s.has(x) ? mem.s.get(x) : null; });
    case 'HGETALL': return [...hash(k)].flat();
    case 'HSET': for (let i = 0; i < r.length; i += 2) hash(k).set(String(r[i]), String(r[i + 1])); return r.length / 2;
    case 'HSETNX': if (hash(k).has(String(r[0]))) return 0; hash(k).set(String(r[0]), String(r[1])); return 1;
    case 'HDEL': r.forEach((f) => hash(k).delete(String(f))); return r.length;
    case 'HINCRBY': { const n = (Number(hash(k).get(String(r[0]))) || 0) + Number(r[1]); hash(k).set(String(r[0]), String(n)); return n; }
    case 'LPUSH': r.forEach((v) => list(k).unshift(String(v))); return list(k).length;
    case 'RPUSH': r.forEach((v) => list(k).push(String(v))); return list(k).length;
    case 'LRANGE': { const l = list(k); const a = Number(r[0]), z = Number(r[1]); return l.slice(a, z < 0 ? l.length + z + 1 : z + 1); }
    case 'LREM': { const l = list(k); const v = String(r[1]); mem.l.set(k, l.filter((x) => x !== v)); return 1; }
    case 'EVAL': return reserveMem(cmd.slice(4));
    default: throw new Error('memRedis: command not supported: ' + op);
  }
}

function needDb() {
  if (!HAS_REDIS && ON_VERCEL) {
    throw new Error('Database is not connected. In Vercel open Storage, connect Upstash Redis to this project, then Redeploy.');
  }
}
async function redis(cmd) { needDb(); return HAS_REDIS ? redisRest(cmd) : memRedis(cmd); }
async function pipe(cmds) {
  needDb();
  if (HAS_REDIS) return pipeRest(cmds);
  const out = []; for (const c of cmds) out.push(await memRedis(c)); return out;
}

async function dbGet(key, fallback = null) {
  const raw = await redis(['GET', key]);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
async function dbSet(key, value) { await redis(['SET', key, JSON.stringify(value)]); }
async function dbDel(key) { await redis(['DEL', key]); }

// at most "max" calls per device in "windowS" seconds; true = too many (an unreachable database never blocks customers)
const clientIp = (req) => String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
async function rateLimit(req, name, max, windowS) {
  const key = 'rl:' + name + ':' + crypto.createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 24);
  try {
    const [n] = await pipe([['INCR', key], ['EXPIRE', key, windowS, 'NX']]);
    return n > max;
  } catch { return false; }
}

// ---------- stock ----------
// Stock lives in one table of its own (field = product id | size | color), changed with single atomic commands,
// so many orders at the same moment can never overwrite each other or sell the last piece twice.
// getProducts() lays these numbers over the product list, so the rest of the site reads p.stock and v.stock as before.
const hasVariants = (p) => Array.isArray(p.variants) && p.variants.length > 0;
const stockField = (id, size, color) => id + '|' + (size || '') + '|' + (color || '');
const stockEntries = (p) => (hasVariants(p) ? p.variants.map((v) => [stockField(p.id, v.size, v.color), v.stock]) : [[stockField(p.id, '', ''), p.stock]]);

// all-or-nothing: rows = [{ field, qty, seed }] (seed = the stock the product list shows, used only the first time a field is seen)
const RESERVE = `local h=KEYS[1]
local n=#ARGV/3
for i=0,n-1 do redis.call('HSETNX',h,ARGV[i*3+1],ARGV[i*3+3]) end
for i=0,n-1 do
  local have=tonumber(redis.call('HGET',h,ARGV[i*3+1]))
  if have<tonumber(ARGV[i*3+2]) then return {0,ARGV[i*3+1],have} end
end
for i=0,n-1 do redis.call('HINCRBY',h,ARGV[i*3+1],-tonumber(ARGV[i*3+2])) end
return {1}`;
async function stockReserve(rows) {
  const r = await redis(['EVAL', RESERVE, 1, 'stock', ...rows.flatMap((x) => [x.field, x.qty, x.seed])]);
  return r[0] === 1 ? { ok: true } : { ok: false, field: r[1], have: Number(r[2]) };
}
async function stockAdjust(field, delta, seed) {
  await pipe([['HSETNX', 'stock', field, Math.max(0, seed)], ['HINCRBY', 'stock', field, delta]]);
}
// the owner saved a product: write its stock (and forget sizes/colors it no longer has)
async function stockSet(p, old) {
  const next = stockEntries(p), keep = new Set(next.map(([f]) => f));
  const gone = old ? stockEntries(old).map(([f]) => f).filter((f) => !keep.has(f)) : [];
  const cmds = [];
  if (gone.length) cmds.push(['HDEL', 'stock', ...gone]);
  cmds.push(['HSET', 'stock', ...next.flatMap(([f, n]) => [f, Math.max(0, Math.floor(Number(n) || 0))])]);
  await pipe(cmds);
}
async function stockDrop(p) { await redis(['HDEL', 'stock', ...stockEntries(p).map(([f]) => f)]); }

// ---------- defaults ----------
const DEFAULT_SETTINGS = {
  storeName: 'Janissary Wear',
  tagline: 'Wear the legacy. Walk with honour.',
  phone: '',
  whatsapp: '',
  email: '',
  address: 'Dhaka, Bangladesh',
  announcement: 'Cash on delivery available all over Bangladesh',
  shippingInside: 70,
  shippingOutside: 130,
  freeShippingOver: 0,
  facebook: '',
  instagram: '',
};

// Two levels: main categories (parent = '') and sub-categories (parent = slug of a main category).
const DEFAULT_CATEGORIES = [
  { id: 'c_men', name: 'Men', slug: 'men', parent: '', image: '', description: 'Streetwear for men.' },
  { id: 'c_women', name: 'Women', slug: 'women', parent: '', image: '', description: 'Streetwear for women.' },
  { id: 'c_men_tshirt', name: 'T-Shirt', slug: 'men-t-shirt', parent: 'men', image: '', description: '' },
  { id: 'c_men_polo', name: 'Polo Shirt', slug: 'men-polo-shirt', parent: 'men', image: '', description: '' },
  { id: 'c_men_drop', name: 'Drop Shoulder', slug: 'men-drop-shoulder', parent: 'men', image: '', description: '' },
  { id: 'c_women_tshirt', name: 'T-Shirt', slug: 'women-t-shirt', parent: 'women', image: '', description: '' },
  { id: 'c_women_drop', name: 'Drop Shoulder', slug: 'women-drop-shoulder', parent: 'women', image: '', description: '' },
];
const LEGACY_DEFAULT_IDS = ['c_hoodies', 'c_tshirts', 'c_jackets', 'c_accessories'];

async function getSettings() {
  const s = await dbGet('settings', null);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

// Loads categories. Creates the defaults on first run, and upgrades the old flat list
// (version 1, no "parent" field) without losing anything the owner already added.
async function getCategories() {
  let c = await dbGet('categories', null);
  if (!c) {
    c = DEFAULT_CATEGORIES.map((x) => ({ ...x }));
    await dbSet('categories', c);
    return c;
  }
  if (c.some((x) => x.parent === undefined)) {
    const products = await getProducts();
    const used = new Set(products.map((p) => p.category));
    // old untouched default categories with no products are dropped, everything else is kept
    c = c.filter((x) => x.parent !== undefined || !(LEGACY_DEFAULT_IDS.includes(x.id) && !used.has(x.slug)));
    c = c.map((x) => (x.parent === undefined ? { ...x, parent: '' } : x));
    for (const d of DEFAULT_CATEGORIES) {
      if (!c.some((x) => x.slug === d.slug)) c.push({ ...d });
    }
    await dbSet('categories', c);
  }
  return c;
}

// slug of a category plus the slugs of all categories under it
function withDescendants(cats, slug) {
  return [slug, ...cats.filter((c) => c.parent === slug).map((c) => c.slug)];
}

async function getProducts() {
  const [raw, flat] = await pipe([['GET', 'products'], ['HGETALL', 'stock']]);
  let items = [];
  try { items = JSON.parse(raw) || []; } catch {}
  const stock = {};
  for (let i = 0; i < (flat || []).length; i += 2) stock[flat[i]] = Math.max(0, Number(flat[i + 1]) || 0);
  return items.map((p) => {
    if (hasVariants(p)) {
      const variants = p.variants.map((v) => { const n = stock[stockField(p.id, v.size, v.color)]; return n === undefined ? v : { ...v, stock: n }; });
      return { ...p, variants, stock: variants.reduce((n, v) => n + v.stock, 0) };
    }
    const n = stock[stockField(p.id, '', '')];
    return n === undefined ? p : { ...p, stock: n };
  });
}

// ---------- http helpers ----------
// cache = seconds the shared (CDN) cache may keep a public answer; leave it out for anything private or changing
function send(res, code, obj, cache) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache && code === 200 ? `public, s-maxage=${cache}, stale-while-revalidate=${cache * 5}` : 'no-store');
  res.end(JSON.stringify(obj));
}

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  return Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
}

async function getBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    try { return JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString() : req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// ---------- auth ----------
function secret() {
  return process.env.SESSION_SECRET || 'jw-secret::' + (process.env.ADMIN_PASSWORD || '') + '::' + (process.env.ADMIN_EMAIL || '');
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}

function isAdmin(req) {
  const h = req.headers['authorization'] || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  return !!verify(t);
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  send(res, 401, { error: 'Unauthorized. Please login again.' });
  return false;
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- misc ----------
function uid(prefix = 'id') {
  return prefix + '_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

function clean(v, max = 200) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

// ---------- product links (/product/<name>-<last 5 characters of the id>) ----------
function productSlug(p) {
  const base = String(p.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return (base || 'product') + '-' + String(p.id).slice(-5);
}
const withSlug = (p) => ({ ...p, slug: productSlug(p) });
// finds a product from its link part; the old name still works after a rename because only the id part counts
function findBySlug(list, slug) {
  const s = String(slug || '');
  const tail = s.slice(s.lastIndexOf('-') + 1);
  return list.find((p) => p.id === s) || list.find((p) => productSlug(p) === s) || list.find((p) => String(p.id).slice(-5) === tail) || null;
}

// the public address of the site: the Site URL set in Admin > Tracking, otherwise the address the visitor used
function siteBase(req, override) {
  if (override) return String(override).replace(/\/+$/, '');
  const h = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || (/^(localhost|127\.)/.test(h) ? 'http' : 'https')).split(',')[0].trim();
  return proto + '://' + h;
}

module.exports = {
  HAS_REDIS, ON_VERCEL, redis, pipe, dbGet, dbSet, dbDel, rateLimit,
  stockField, stockReserve, stockAdjust, stockSet, stockDrop,
  getSettings, getCategories, getProducts, withDescendants, DEFAULT_SETTINGS,
  send, getQuery, getBody,
  sign, verify, isAdmin, requireAdmin, safeEqual,
  uid, slugify, clean, productSlug, withSlug, findBySlug, siteBase,
};
