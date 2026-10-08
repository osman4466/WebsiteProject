// GET /api/backup  (admin) -> one JSON file with everything needed to move the store to another host.
const { send, requireAdmin, getProducts, getCategories, getSettings, dbGet } = require('./_lib');

module.exports = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
    const [products, categories, settings, orders, media, homepage] = await Promise.all([
      getProducts(), getCategories(), getSettings(), dbGet('orders', []), dbGet('media', []), dbGet('homepage', null),
    ]);
    return send(res, 200, {
      app: 'janissary-wear',
      exportedAt: new Date().toISOString(),
      note: 'Photos are stored in the site database and are not inside this file. Keep your original photos on your computer.',
      products, categories, settings, orders: orders || [], media: media || [], homepage: homepage || null,
    });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
};
