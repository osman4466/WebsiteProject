// GET /api/backup  (admin) -> one JSON file with everything needed to move the store to another host.
const { send, requireAdmin, getProducts, getCategories, getSettings, dbGet } = require('./_lib');
const { listOrders, ensureMigrated } = require('./_orders');

module.exports = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    await ensureMigrated();
    const [products, categories, settings, orders, media, homepage, tracking] = await Promise.all([
      getProducts(), getCategories(), getSettings(), listOrders(0), dbGet('media', []), dbGet('homepage', null), dbGet('tracking', null),
    ]);
    return send(res, 200, {
      app: 'janissary-wear',
      exportedAt: new Date().toISOString(),
      note: 'Photos are stored in the site database and are not inside this file. Keep your original photos on your computer. Secret tokens (Meta, GA4) are not included on purpose.',
      products, categories, settings, orders: orders || [], media: media || [], homepage: homepage || null, tracking: tracking || null,
    });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
};
