// Customer order tracking: POST /api/orders?track=1  { phone, number }
// Shows only orders that are still running, plus delivered or cancelled orders for 2 days after that.
// Never returns the name, phone or address, and a device can only look up 10 times in 10 minutes.
const crypto = require('crypto');
const { send, dbGet, redis, HAS_REDIS, clean } = require('./_lib');

const KEEP_MS = 2 * 24 * 3600 * 1000;       // delivered and cancelled orders disappear 2 days after the change
const RUNNING = ['pending', 'confirmed', 'shipped'];
const MAX_TRIES = 10, WINDOW_S = 600, MAX_ORDERS = 5;

// the last 10 digits of a Bangladesh mobile number, so 01712.., +88 01712.. and 8801712.. all match
const phoneKey = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const numberKey = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^JW/, '');

// when the order got its current status (orders from before this feature have no time for delivered or cancelled)
const changedAt = (o) => { const h = (o.history || []).filter((x) => x.status === o.status).pop(); return h ? h.at : o.status === 'pending' ? o.createdAt : 0; };
const visible = (o, now) => RUNNING.includes(o.status) || (['delivered', 'cancelled'].includes(o.status) && changedAt(o) && now - changedAt(o) < KEEP_MS);

// at most MAX_TRIES per device per WINDOW_S seconds (fails open if the database has a hiccup)
const mem = global.__JW_TRACK_RL__ || (global.__JW_TRACK_RL__ = new Map());
async function tooMany(req) {
  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
  const key = 'rl:track:' + crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24);
  try {
    if (HAS_REDIS) {
      const n = await redis(['INCR', key]);
      if (n === 1) await redis(['EXPIRE', key, WINDOW_S]);
      return n > MAX_TRIES;
    }
    const now = Date.now(), hits = (mem.get(key) || []).filter((t) => now - t < WINDOW_S * 1000);
    hits.push(now); mem.set(key, hits);
    return hits.length > MAX_TRIES;
  } catch { return false; }
}

const publicOrder = (o) => ({
  number: o.number, createdAt: o.createdAt, status: o.status, history: (o.history || []).map((h) => ({ status: h.status, at: h.at })),
  items: o.items.map((i) => ({ name: i.name, image: i.image, size: i.size, color: i.color, qty: i.qty, price: i.price })),
  subtotal: o.subtotal, shipping: o.shipping, total: o.total,
});

async function trackOrders(req, res, b) {
  const phone = phoneKey(clean(b.phone, 30)), number = numberKey(clean(b.number, 30));
  if (!phone && !number) return send(res, 400, { error: 'Please enter your mobile number or your order number.' });
  if (phone && phone.length < 10) return send(res, 400, { error: 'Please enter the full mobile number.' });
  if (await tooMany(req)) return send(res, 429, { error: 'Too many tries. Please wait a few minutes and try again.' });

  const now = Date.now();
  const found = (await dbGet('orders', []))
    .filter((o) => (!phone || phoneKey(o.customer && o.customer.phone) === phone) && (!number || numberKey(o.number) === number) && visible(o, now))
    .slice(0, MAX_ORDERS).map(publicOrder);
  return send(res, 200, { orders: found });
}

module.exports = { trackOrders };
