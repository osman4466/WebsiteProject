// Homepage sections.
//   GET  /api/home            public: sections with their products already chosen
//   GET  /api/home?raw=1      admin:  the saved settings (what the admin screen edits)
//   PUT  /api/home            admin:  save { sections: [...] }
const { send, getQuery, getBody, getProducts, getCategories, dbSet, requireAdmin, uid, clean, withSlug } = require('./_lib');
const { savedSections, pickSections } = require('./_home');

const SOURCES = ['manual', 'newest', 'featured', 'sale', 'category', 'all'];

function normalize(list) {
  return (Array.isArray(list) ? list : []).slice(0, 20).map((s) => ({
    id: clean(s.id, 40) || uid('h'),
    title: clean(s.title, 80),
    type: s.type === 'grid' ? 'grid' : 'carousel',
    source: SOURCES.includes(s.source) ? s.source : 'newest',
    category: clean(s.category, 80),
    productIds: (Array.isArray(s.productIds) ? s.productIds : []).map((x) => clean(x, 60)).filter(Boolean).slice(0, 60),
    limit: Math.max(1, Math.min(60, Math.floor(Number(s.limit)) || 10)),
    visible: s.visible !== false,
  }));
}

module.exports = async (req, res) => {
  try {
    const q = getQuery(req);

    if (req.method === 'GET') {
      const sections = await savedSections();
      if (q.raw) {
        if (!requireAdmin(req, res)) return;
        return send(res, 200, { sections });
      }
      const products = (await getProducts()).filter((p) => p.active !== false);
      const out = pickSections(sections, products, await getCategories());
      return send(res, 200, { sections: out.map((s) => ({ ...s, products: s.products.map(withSlug) })) }, 60);
    }

    if (!requireAdmin(req, res)) return;

    if (req.method === 'PUT') {
      const b = await getBody(req);
      const sections = normalize(b.sections);
      await dbSet('homepage', { sections });
      return send(res, 200, { sections });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
};
