// Tracking engine used by /api/track (browser events) and /api/orders (Purchase).
// Sends events from the server to Meta (Conversions API) and Google Analytics 4 (Measurement Protocol).
const crypto = require('crypto');
const { dbGet, dbSet, clean } = require('./_lib');

const GRAPH_VERSION = 'v23.0';
const EVENTS = ['PageView', 'ViewContent', 'ViewCategory', 'Search', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase', 'Contact'];
const GA_NAMES = { PageView: 'page_view', ViewContent: 'view_item', ViewCategory: 'view_item_list', Search: 'search', AddToCart: 'add_to_cart', InitiateCheckout: 'begin_checkout', AddPaymentInfo: 'add_shipping_info', Purchase: 'purchase', Contact: 'contact_whatsapp' };

const DEFAULTS = {
  metaPixelId: '', metaBrowser: true, metaServer: true, testEventCode: '',
  gaId: '', gaEnabled: true, gaServer: true,
  gscCode: '', siteUrl: '',
  metaTokenSet: false, gaSecretSet: false,
};

// ---------- config (cached for a minute so every page view does not hit the database) ----------
let cache = null, cacheAt = 0;
async function getTracking(force) {
  if (!force && cache && Date.now() - cacheAt < 60000) return cache;
  cache = { ...DEFAULTS, ...((await dbGet('tracking', null)) || {}) };
  cacheAt = Date.now();
  return cache;
}
function resetCache() { cache = null; }

// a token set in the Vercel environment wins over the one saved in the admin panel
async function getSecrets() {
  const saved = (await dbGet('tracking_secrets', null)) || {};
  return {
    metaToken: process.env.META_CAPI_TOKEN || saved.metaToken || '',
    gaSecret: process.env.GA4_API_SECRET || saved.gaSecret || '',
    metaFromEnv: !!process.env.META_CAPI_TOKEN,
    gaFromEnv: !!process.env.GA4_API_SECRET,
    saved,
  };
}

// what the public pages may know (never any token)
function publicConfig(t) {
  return {
    metaPixelId: t.metaPixelId || '',
    metaBrowser: !!(t.metaPixelId && t.metaBrowser),
    metaServer: !!(t.metaPixelId && t.metaServer && (t.metaTokenSet || process.env.META_CAPI_TOKEN)),
    gaId: t.gaEnabled && t.gaId ? t.gaId : '',
  };
}

// ---------- helpers ----------
const sha = (v) => (v ? crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex') : undefined);
const phoneDigits = (p) => {
  let n = String(p || '').replace(/\D/g, '');
  if (n.startsWith('0')) n = '88' + n;                      // 01712... -> 8801712...
  return n.length >= 10 ? n : '';
};
const clientIp = (req) => String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)));

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; };

// clean up what the browser sent
function sanitize(b) {
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 20).map((i) => ({
    id: clean(i.id, 60), name: clean(i.name, 120), price: num(i.price), qty: Math.max(1, Math.min(99, Math.floor(Number(i.qty)) || 1)), category: clean(i.category, 80),
  })).filter((i) => i.id);
  return {
    name: clean(b.name, 30), eventId: clean(b.eventId, 80),
    url: clean(b.url, 400), items,
    value: num(b.value), search: clean(b.search, 120), category: clean(b.category, 120),
    fbp: clean(b.fbp, 120), fbc: clean(b.fbc, 200), gaClientId: clean(b.gaClientId, 60),
    user: { phone: clean(b.user && b.user.phone, 30), name: clean(b.user && b.user.name, 80) },
  };
}

// ---------- Meta Conversions API ----------
function metaPayload(e, req) {
  const name = clean(e.user.name, 80).toLowerCase().split(/\s+/);
  const ph = sha(phoneDigits(e.user.phone));
  const user = compact({
    client_ip_address: clientIp(req), client_user_agent: clean(req.headers['user-agent'], 300),
    fbp: e.fbp, fbc: e.fbc,
    ph: ph ? [ph] : undefined,
    fn: name[0] ? [sha(name[0])] : undefined,
    ln: name.length > 1 ? [sha(name.slice(1).join(' '))] : undefined,
    external_id: ph ? [ph] : undefined,
    country: [sha('bd')],
  });
  const custom = compact({
    currency: 'BDT', value: e.value || e.items.reduce((n, i) => n + i.price * i.qty, 0) || undefined,
    content_type: e.items.length ? 'product' : undefined,
    content_ids: e.items.map((i) => i.id),
    contents: e.items.map((i) => ({ id: i.id, quantity: i.qty, item_price: i.price })),
    content_name: e.items.length === 1 ? e.items[0].name : e.category || undefined,
    content_category: e.category || undefined,
    num_items: e.items.length ? e.items.reduce((n, i) => n + i.qty, 0) : undefined,
    search_string: e.search || undefined,
  });
  return compact({
    event_name: e.name, event_time: Math.floor(Date.now() / 1000), event_id: e.eventId || undefined,
    event_source_url: e.url || undefined, action_source: 'website', user_data: user, custom_data: custom,
  });
}

async function sendMeta(e, req, cfg, secrets) {
  if (!cfg.metaPixelId || !cfg.metaServer) return { state: 'off' };
  if (!secrets.metaToken) return { state: 'off', message: 'No access token' };
  try {
    const body = { data: [metaPayload(e, req)] };
    if (cfg.testEventCode) body.test_event_code = cfg.testEventCode;
    const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${cfg.metaPixelId}/events?access_token=${encodeURIComponent(secrets.metaToken)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3500),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) return { state: 'error', message: (j.error && (j.error.error_user_msg || j.error.message)) || 'HTTP ' + r.status };
    return { state: 'ok', message: 'received ' + (j.events_received ?? 1) };
  } catch (ex) {
    return { state: 'error', message: ex.message };
  }
}

// ---------- Google Analytics 4 (server side: purchases only; the browser sends the rest) ----------
async function sendGA(e, cfg, secrets, debug) {
  if (!cfg.gaId || !cfg.gaEnabled || !cfg.gaServer) return { state: 'off' };
  if (!secrets.gaSecret) return { state: 'off', message: 'No API secret' };
  try {
    const params = {
      transaction_id: e.eventId || undefined, currency: 'BDT', value: e.value,
      items: e.items.map((i) => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.qty, item_category: i.category || undefined })),
    };
    const body = { client_id: e.gaClientId || crypto.randomBytes(5).toString('hex') + '.' + Math.floor(Date.now() / 1000), events: [{ name: GA_NAMES[e.name] || e.name.toLowerCase(), params: compact(params) }] };
    const base = debug ? 'https://www.google-analytics.com/debug/mp/collect' : 'https://www.google-analytics.com/mp/collect';
    const r = await fetch(`${base}?measurement_id=${encodeURIComponent(cfg.gaId)}&api_secret=${encodeURIComponent(secrets.gaSecret)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(3500),
    });
    if (debug) {
      const j = await r.json().catch(() => ({}));
      const msgs = (j.validationMessages || []).map((m) => m.description).filter(Boolean);
      return msgs.length ? { state: 'error', message: msgs.join(' | ') } : { state: 'ok', message: 'valid' };
    }
    return r.status >= 200 && r.status < 300 ? { state: 'ok' } : { state: 'error', message: 'HTTP ' + r.status };
  } catch (ex) {
    return { state: 'error', message: ex.message };
  }
}

// ---------- short log shown in Admin > Tracking (orders, tests and errors only, to save database writes) ----------
async function addLog(entry) {
  try {
    const log = (await dbGet('tracking_log', [])) || [];
    log.unshift({ t: Date.now(), ...entry });
    await dbSet('tracking_log', log.slice(0, 40));
  } catch { /* the log must never break anything */ }
}

// ---------- main entry ----------
// Sends one event to every server destination that is switched on. Never throws.
async function forward(req, raw, opts = {}) {
  try {
    const e = sanitize(raw);
    if (!EVENTS.includes(e.name)) return { ok: false, error: 'Unknown event' };
    const cfg = await getTracking();
    const secrets = await getSecrets();
    const meta = await sendMeta(e, req, cfg, secrets);
    const ga = e.name === 'Purchase' ? await sendGA(e, cfg, secrets, false) : { state: 'off' };
    const bad = meta.state === 'error' || ga.state === 'error';
    if (e.name === 'Purchase' || bad) {
      await addLog({ event: e.name, id: e.eventId, value: e.value, meta: meta.state + (meta.message ? ': ' + meta.message : ''), ga: ga.state + (ga.message ? ': ' + ga.message : '') });
    }
    return { ok: !bad, meta, ga };
  } catch (ex) {
    return { ok: false, error: ex.message };
  }
}

module.exports = { getTracking, getSecrets, resetCache, publicConfig, sanitize, forward, sendMeta, sendGA, addLog };
