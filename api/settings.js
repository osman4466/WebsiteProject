const { send, getBody, getSettings, dbSet, requireAdmin, clean, DEFAULT_SETTINGS } = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      return send(res, 200, await getSettings());
    }
    if (req.method === 'PUT') {
      if (!requireAdmin(req, res)) return;
      const b = await getBody(req);
      const cur = await getSettings();
      const next = {
        ...cur,
        storeName: clean(b.storeName ?? cur.storeName, 60) || DEFAULT_SETTINGS.storeName,
        tagline: clean(b.tagline ?? cur.tagline, 120),
        phone: clean(b.phone ?? cur.phone, 30),
        whatsapp: clean(b.whatsapp ?? cur.whatsapp, 30).replace(/[^0-9]/g, ''),
        email: clean(b.email ?? cur.email, 80),
        address: clean(b.address ?? cur.address, 160),
        announcement: clean(b.announcement ?? cur.announcement, 160),
        shippingInside: Math.max(0, Number(b.shippingInside ?? cur.shippingInside) || 0),
        shippingOutside: Math.max(0, Number(b.shippingOutside ?? cur.shippingOutside) || 0),
        freeShippingOver: Math.max(0, Number(b.freeShippingOver ?? cur.freeShippingOver) || 0),
        facebook: clean(b.facebook ?? cur.facebook, 200),
        instagram: clean(b.instagram ?? cur.instagram, 200),
      };
      await dbSet('settings', next);
      return send(res, 200, next);
    }
    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
};
