const {
  send, getQuery, getBody, getProducts, getSettings, dbGet, dbSet,
  requireAdmin, uid, clean,
} = require('./_lib');

const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

const variantOf = (p, size, color) => (p.variants || []).find((v) => (v.size || '') === (size || '') && (v.color || '') === (color || ''));

// change the stock of one size + color (or of the whole product when it has no variants)
function changeStock(p, size, color, delta) {
  if (!p) return;
  if (p.variants && p.variants.length) {
    const v = variantOf(p, size, color);
    if (v) v.stock = Math.max(0, v.stock + delta);
    p.stock = p.variants.reduce((n, x) => n + x.stock, 0);
  } else p.stock = Math.max(0, p.stock + delta);
}

module.exports = async (req, res) => {
  try {
    const q = getQuery(req);

    // ---- Public: place an order (cash on delivery) ----
    if (req.method === 'POST') {
      const b = await getBody(req);
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

      const free = settings.freeShippingOver > 0 && subtotal >= settings.freeShippingOver;
      const shipping = free ? 0 : customer.area === 'outside' ? settings.shippingOutside : settings.shippingInside;

      // reduce stock
            for (const it of items) {
        changeStock(products.find((x) => x.id === it.id), it.size, it.color, -it.qty);
      }
      await dbSet('products', products);

      const orders = await dbGet('orders', []);
      const order = {
        id: uid('o'),
        number: 'JW-' + Date.now().toString(36).toUpperCase().slice(-6),
        items, subtotal, shipping, total: subtotal + shipping,
        customer, status: 'pending', createdAt: Date.now(),
      };
      orders.unshift(order);
      await dbSet('orders', orders.slice(0, 2000));
      return send(res, 201, { number: order.number, total: order.total });
    }

    // ---- Admin only below ----
    if (!requireAdmin(req, res)) return;
    const orders = await dbGet('orders', []);

    if (req.method === 'GET') return send(res, 200, orders);

    if (req.method === 'PUT') {
      const b = await getBody(req);
      const i = orders.findIndex((o) => o.id === q.id);
      if (i < 0) return send(res, 404, { error: 'Order not found' });
      if (!STATUSES.includes(b.status)) return send(res, 400, { error: 'Invalid status' });
      const prev = orders[i].status;

      // put stock back if an order is cancelled (and take it again if re-opened)
      if (b.status !== prev && (b.status === 'cancelled' || prev === 'cancelled')) {
        const products = await getProducts();
        for (const it of orders[i].items) {
          const p = products.find((x) => x.id === it.id);
          if (p) changeStock(p, it.size, it.color, b.status === 'cancelled' ? it.qty : -it.qty);
        }
        await dbSet('products', products);
      }
      orders[i].status = b.status;
      await dbSet('orders', orders);
      return send(res, 200, orders[i]);
    }

    if (req.method === 'DELETE') {
      await dbSet('orders', orders.filter((o) => o.id !== q.id));
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
};
