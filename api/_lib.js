// Shared helpers: storage (Upstash Redis REST, with in-memory fallback for local dev),
// admin auth (HMAC signed token), small HTTP utilities.
const crypto = require('crypto');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HAS_REDIS = !!(REDIS_URL && REDIS_TOKEN);

// In-memory fallback (local dev only; NOT persistent on Vercel)
const mem = global.__JW_MEM__ || (global.__JW_MEM__ = new Map());

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
  let raw;
  if (HAS_REDIS) raw = await redis(['GET', key]);
  else raw = mem.has(key) ? mem.get(key) : null;
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

async function dbSet(key, value) {
  const s = JSON.stringify(value);
  if (HAS_REDIS) await redis(['SET', key, s]);
  else mem.set(key, s);
}

async function dbDel(key) {
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

const DEFAULT_CATEGORIES = [
  { id: 'c_hoodies', name: 'Hoodies', slug: 'hoodies', image: '', description: 'Heavy fleece hoodies built for the season.' },
  { id: 'c_tshirts', name: 'T-Shirts', slug: 't-shirts', image: '', description: 'Premium cotton tees with bold prints.' },
  { id: 'c_jackets', name: 'Jackets', slug: 'jackets', image: '', description: 'Outerwear with a commanding silhouette.' },
  { id: 'c_accessories', name: 'Accessories', slug: 'accessories', image: '', description: 'Caps, belts and finishing touches.' },
];

async function getSettings() {
  const s = await dbGet('settings', null);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

async function getCategories() {
  let c = await dbGet('categories', null);
  if (!c) {
    c = DEFAULT_CATEGORIES;
    await dbSet('categories', c);
  }
  return c;
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
  HAS_REDIS, dbGet, dbSet, dbDel,
  getSettings, getCategories, getProducts, DEFAULT_SETTINGS,
  send, getQuery, getBody,
  sign, verify, isAdmin, requireAdmin, safeEqual,
  uid, slugify, clean,
};
