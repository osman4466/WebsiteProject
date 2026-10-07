// Shared helpers: storage (Upstash Redis REST, with in-memory fallback for local dev),
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

// In-memory fallback: local dev only. On Vercel every request can run in a different
// instance, so memory would silently lose data - we refuse to run without a database there.
const mem = global.__JW_MEM__ || (global.__JW_MEM__ = new Map());

function needDb() {
  if (!HAS_REDIS && ON_VERCEL) {
    throw new Error('Database is not connected. In Vercel open Storage, connect Upstash Redis to this project, then Redeploy.');
  }
}

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error('Redis: ' + j.error);
  return j.result;
}

async function dbGet(key, fallback = null) {
  needDb();
  let raw;
  if (HAS_REDIS) raw = await redis(['GET', key]);
  else raw = mem.has(key) ? mem.get(key) : null;
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

async function dbSet(key, value) {
  needDb();
  const s = JSON.stringify(value);
  if (HAS_REDIS) await redis(['SET', key, s]);
  else mem.set(key, s);
}

async function dbDel(key) {
  needDb();
  if (HAS_REDIS) await redis(['DEL', key]);
  else mem.delete(key);
}

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
  return (await dbGet('products', [])) || [];
}

// ---------- http helpers ----------
function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
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

module.exports = {
  HAS_REDIS, ON_VERCEL, redis, dbGet, dbSet, dbDel,
  getSettings, getCategories, getProducts, withDescendants, DEFAULT_SETTINGS,
  send, getQuery, getBody,
  sign, verify, isAdmin, requireAdmin, safeEqual,
  uid, slugify, clean,
};
