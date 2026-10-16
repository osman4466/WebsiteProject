// Customer order tracking: POST /api/orders?track=1  { phone, number }
// Shows only orders that are still running, plus delivered or cancelled orders for 2 days after that.
// Never returns the name, phone or address, and a device can only look up 10 times in 10 minutes.
const { send, rateLimit, clean } = require('./_lib');
const { phoneKey, numberKey, ensureMigrated, ordersByPhone, orderByNumber } = require('./_orders');

const KEEP_MS = 2 * 24 * 3600 * 1000;       // delivered and cancelled orders disappear 2 days after the change
const RUNNING = ['pending', 'confirmed', 'shipped'];
const MAX_TRIES = 10, WINDOW_S = 600, MAX_ORDERS = 5;

// when the order got its current status (orders from before this feature have no time for delivered or cancelled)
const changedAt = (o) => { const h = (o.history || []).filter((x) => x.status === o.status).pop(); return h ? h.at : o.status === 'pending' ? o.createdAt : 0; };
const visible = (o, now) => RUNNING.includes(o.status) || (['delivered', 'cancelled'].includes(o.status) && changedAt(o) && now - changedAt(o) < KEEP_MS);

const publicOrder = (o) => ({
  number: o.number, createdAt: o.createdAt, status: o.status, history: (o.history || []).map((h) => ({ status: h.status, at: h.at })),
  items: o.items.map((i) => ({ name: i.name, image: i.image, size: i.size, color: i.color, qty: i.qty, price: i.price })),
  subtotal: o.subtotal, shipping: o.shipping, total: o.total,
});

async function trackOrders(req, res, b) {
  const phone = phoneKey(clean(b.phone, 30)), number = numberKey(clean(b.number, 30));
  if (!phone && !number) return send(res, 400, { error: 'Please enter your mobile number or your order number.' });
  if (phone && phone.length < 10) return send(res, 400, { error: 'Please enter the full mobile number.' });
  if (await rateLimit(req, 'track', MAX_TRIES, WINDOW_S)) return send(res, 429, { error: 'Too many tries. Please wait a few minutes and try again.' });

  const now = Date.now();
  await ensureMigrated();
  const mine = phone ? await ordersByPhone(phone) : [await orderByNumber(number)].filter(Boolean);
  const found = mine
    .filter((o) => (!phone || phoneKey(o.customer && o.customer.phone) === phone) && (!number || numberKey(o.number) === number) && visible(o, now))
    .slice(0, MAX_ORDERS).map(publicOrder);
  return send(res, 200, { orders: found });
}

module.exports = { trackOrders };
