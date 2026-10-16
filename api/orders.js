const crypto = require('crypto');
const {
  send, getQuery, getBody, getProducts, getSettings, redis, rateLimit,
  stockField, stockReserve, stockAdjust,
  requireAdmin, uid, clean,
} = require('./_lib');
const { forward } = require('./_track');
const { notifyOrder } = require('./_mail');
const { trackOrders } = require('./_status');
const { saveOrder, updateOrder, removeOrder, getOrder, listOrders, nextNumber, phoneKey, ensureMigrated } = require('./_orders');

const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

const variantOf = (p, size, color) => (p.variants || []).find((v) => (v.size || '') === (size || '') && (v.color || '') === (color || ''));

// what the customer's browser is told about a placed order
const receipt = (o) => ({
  number: o.number, eventId: o.id, subtotal: o.subtotal, shipping: o.shipping, total: o.total,
  items: o.items.map((i) => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
});

// the same cart sent twice within two minutes (double click, retry after a bad connection) is one order
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fingerprint = (customer, items) => 'idem:' + crypto.createHash('sha256').update(JSON.stringify([
  phoneKey(customer.phone), items.map((i) => [i.id, i.size, i.color, i.qty].join('|')).sort(),
])).digest('hex').slice(0, 32);

// stock rows of an order: one row for each product + size + color (the same item twice in a cart is added up)
function stockRows(items, products) {
  const rows = new Map();
  for (const it of items) {
    const p = products.find((x) => x.id === it.id);
    if (!p) continue;
    const v = Array.isArray(p.variants) && p.variants.length ? variantOf(p, it.size, it.color) : null;
    const field = stockField(p.id, v ? v.size : '', v ? v.color : '');
    const row = rows.get(field) || { field, qty: 0, seed: v ? v.stock : p.stock, name: it.name };
    row.qty += it.qty; rows.set(field, row);
  }
  return [...rows.values()];
}

module.exports = async (req, res) => {
  try {
    const q = getQuery(req);

    // ---- Public: place an order (cash on delivery) ----
    if (req.method === 'POST') {
      const b = await getBody(req);
      if (q.track) return trackOrders(req, res, b);   // a customer looking up an order
      const c = b.customer || {};
      const customer = {
        name: clean(c.name, 80),
        phone: clean(c.phone, 20),
        address: clean(c.address, 300),
        area: c.area === 'outside' ? 'outside' : 'inside',
        note: clean(c.note, 300),
      };
      if (!customer.name || !customer.address) return send(res, 400, { error: 'Name and address are required' });
      if (!/^[0-9+\-\s]{10,16}$/.test(customer.phone)) return send(res, 400, { error: 'Please enter a valid phone number' });

      const reqItems = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
      if (!reqItems.length) return send(res, 400, { error: 'Your cart is empty' });

      if (await rateLimit(req, 'order', 30, 600)) return send(res, 429, { error: 'Too many orders from this device. Please wait a few minutes and try again.' });

      const products = await getProducts();
      const settings = await getSettings();
      const items = [];
      let subtotal = 0;

      for (const it of reqItems) {
        const p = products.find((x) => x.id === it.id && x.active !== false);
        const qty = Math.max(1, Math.min(20, Math.floor(Number(it.qty) || 1)));
        if (!p) return send(res, 400, { error: 'A product in your cart is no longer available' });
        const size = clean(it.size, 40), color = clean(it.color, 40);
        const hasVariants = Array.isArray(p.variants) && p.variants.length > 0;
        const v = hasVariants ? variantOf(p, size, color) : null;
        if (hasVariants && !v) return send(res, 400, { error: `This size or color of "${p.name}" is not available` });
        const have = hasVariants ? v.stock : p.stock;
        if (have < qty) return send(res, 400, { error: `Only ${have} left in stock for "${p.name}"${size || color ? ' (' + [size, color].filter(Boolean).join(', ') + ')' : ''}` });
        const unit = v && v.price > 0 ? v.price : p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price;
        items.push({ id: p.id, name: p.name, image: (p.colorImages || {})[color] || p.images[0] || '', size, color, qty, price: unit });
        subtotal += unit * qty;
      }

      // a repeat of an order that was just placed: answer with that order instead of making another one
      const idem = fingerprint(customer, items);
      if (!(await redis(['SET', idem, 'pending', 'NX', 'EX', '120']))) {
        for (let i = 0; i < 16; i++) {
          const prior = await redis(['GET', idem]);
          if (prior && prior !== 'pending') { const o = await getOrder(prior); if (o) return send(res, 201, receipt(o)); break; }
          await sleep(250);
        }
        return send(res, 409, { error: 'Your order is being placed. Please wait a moment and check again.' });
      }

      try {
        const free = settings.freeShippingOver > 0 && subtotal >= settings.freeShippingOver;
        const shipping = free ? 0 : customer.area === 'outside' ? settings.shippingOutside : settings.shippingInside;

        // take the stock in one step; if any item is short nothing is taken
        const rows = stockRows(items, products);
        const got = await stockReserve(rows);
        if (!got.ok) {
          await redis(['DEL', idem]);
          const r = rows.find((x) => x.field === got.field);
          return send(res, 400, { error: `Only ${got.have} left in stock for "${r ? r.name : 'this item'}"` });
        }

        const now = Date.now();
        const order = {
          id: uid('o'), number: await nextNumber(),
          items, subtotal, shipping, total: subtotal + shipping,
          customer, status: 'pending', createdAt: now, history: [{ status: 'pending', at: now }],
        };
        try { await saveOrder(order); } catch (e) {
          for (const r of rows) await stockAdjust(r.field, r.qty, 0).catch(() => {});   // could not save: give the stock back
          throw e;
        }
        await redis(['SET', idem, order.id, 'EX', '120']);

        // after the order is saved: tell Meta and Google about the purchase (the browser sends the same event with the same id, so it is counted once)
        // and email the owner. Both run together and neither can hold the customer for more than a few seconds.
        const t = b.tracking && typeof b.tracking === 'object' ? b.tracking : {};
        let timer;
        await Promise.race([
          Promise.all([
            forward(req, {
              name: 'Purchase', eventId: order.id, url: t.url, value: order.total,
              items: items.map((i) => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
              fbp: t.fbp, fbc: t.fbc, gaClientId: t.gaClientId, user: { phone: customer.phone, name: customer.name },
            }),
            notifyOrder(req, order, settings.storeName),
          ]),
          new Promise((resolve) => { timer = setTimeout(resolve, 5000); }),
        ]);
        clearTimeout(timer);

        return send(res, 201, receipt(order));
      } catch (e) {
        await redis(['DEL', idem]).catch(() => {});
        throw e;
      }
    }

    // ---- Admin only below ----
    if (!requireAdmin(req, res)) return;

    if (req.method === 'GET') {
      await ensureMigrated();
      return send(res, 200, await listOrders(Math.min(5000, Number(q.limit) || 1000)));
    }

    if (req.method === 'PUT') {
      const b = await getBody(req);
      const o = await getOrder(q.id);
      if (!o) return send(res, 404, { error: 'Order not found' });
      if (!STATUSES.includes(b.status)) return send(res, 400, { error: 'Invalid status' });
      const prev = o.status;

      // put stock back if an order is cancelled (and take it again if re-opened)
      if (b.status !== prev && (b.status === 'cancelled' || prev === 'cancelled')) {
        const products = await getProducts();
        if (b.status === 'cancelled') {
          for (const r of stockRows(o.items, products)) await stockAdjust(r.field, r.qty, r.seed);
        } else {
          const got = await stockReserve(stockRows(o.items, products));
          if (!got.ok) return send(res, 409, { error: `Not enough stock to re-open this order (only ${got.have} left of one item).` });
        }
      }
      if (b.status !== prev) o.history = [...(o.history || []), { status: b.status, at: Date.now() }];
      o.status = b.status;
      await updateOrder(o);
      return send(res, 200, o);
    }

    if (req.method === 'DELETE') {
      const o = await getOrder(q.id);
      if (o) await removeOrder(o);
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
};
