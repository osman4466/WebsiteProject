// Admin > Store settings > Order email
//   GET  /api/notify            the settings (the key is never returned, only a hint)
//   PUT  /api/notify            save; an empty key box keeps the saved key
//   POST /api/notify?test=1     send a sample order email and report what Resend answered
const { send, getQuery, getBody, dbSet, getProducts, getSettings, requireAdmin, clean, siteBase } = require('./_lib');
const { getTracking } = require('./_track');
const { DEFAULT_FROM, getNotify, sendMail, orderEmail } = require('./_mail');

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

module.exports = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const q = getQuery(req);
    const n = await getNotify();

    if (req.method === 'GET') {
      return send(res, 200, { enabled: !!n.enabled, to: n.to, from: n.from, defaultFrom: DEFAULT_FROM, key: { set: !!n.apiKey, hint: n.apiKey ? '••••••' + n.apiKey.slice(-4) : '' } });
    }

    if (req.method === 'PUT') {
      const b = await getBody(req);
      const next = { ...n };
      if (b.enabled !== undefined) next.enabled = !!b.enabled;
      if (b.to !== undefined) next.to = clean(b.to, 120);
      if (b.from !== undefined) next.from = clean(b.from, 120);
      if (b.clearKey) next.apiKey = '';
      else if (clean(b.apiKey, 200)) next.apiKey = clean(b.apiKey, 200);
      if (next.to && !EMAIL.test(next.to)) return send(res, 400, { error: 'The email address to notify does not look right.' });
      if (next.from && !EMAIL.test(next.from)) return send(res, 400, { error: 'The sender address does not look right.' });
      if (next.enabled && (!next.to || !next.apiKey)) return send(res, 400, { error: 'To switch order emails on, fill in the email address and the Resend API key.' });
      await dbSet('notify', next);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && q.test) {
      if (!n.to || !n.apiKey) return send(res, 400, { error: 'Save the email address and the Resend API key first.' });
      const [settings, products, trk] = await Promise.all([getSettings(), getProducts(), getTracking()]);
      const p = products.find((x) => x.active !== false) || {};
      const sample = {
        number: 'JW-TEST01', subtotal: 1000, shipping: settings.shippingInside, total: 1000 + settings.shippingInside,
        items: [{ name: p.name || 'Sample product', image: (p.images || [])[0] || '', size: 'M', color: (p.colors || [])[0] || '', qty: 2, price: 500 }],
        customer: { name: 'Test Customer', phone: '01700000000', address: 'House 1, Road 1, Dhaka', area: 'inside', note: 'This is a test email' },
      };
      const r = await sendMail({ apiKey: n.apiKey, from: `${settings.storeName || 'Janissary Wear'} <${n.from || DEFAULT_FROM}>`, to: n.to, ...orderEmail(sample, { base: siteBase(req, trk.siteUrl), store: settings.storeName || 'Janissary Wear' }) });
      return send(res, 200, r);
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
};
