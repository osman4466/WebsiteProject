// Homepage sections.
//   GET  /api/home            public: sections with their products already chosen
//   GET  /api/home?raw=1      admin:  the saved settings (what the admin screen edits)
//   PUT  /api/home            admin:  save { sections: [...] }
const { send, getQuery, getBody, getProducts, getCategories, dbGet, dbSet, isAdmin, requireAdmin, uid, clean, withDescendants, withSlug } = require('./_lib');

const SOURCES = ['manual', 'newest', 'featured', 'sale', 'category', 'all'];

const DEFAULTS = [
  { id: 'h_new', title: 'New arrivals', type: 'carousel', source: 'newest', category: '', productIds: [], limit: 10, visible: true },
  { id: 'h_all', title: 'Shop the collection', type: 'grid', source: 'all', category: '', productIds: [], limit: 24, visible: true },
];

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

const byNew = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
const byOrder = (a, b) => {
  const ao = Number.isFinite(a.order), bo = Number.isFinite(b.order);
  if (ao && bo && a.order !== b.order) return a.order - b.order;
  if (ao !== bo) return ao ? 1 : -1;
  return byNew(a, b);
};
const onSale = (p) => p.salePrice > 0 && p.salePrice < p.price;

module.exports = async (req, res) => {
  try {
    const q = getQuery(req);

    if (req.method === 'GET') {
      const saved = await dbGet('homepage', null);
      const sections = saved && Array.isArray(saved.sections) ? saved.sections : DEFAULTS;
      if (q.raw) {
        if (!requireAdmin(req, res)) return;
        return send(res, 200, { sections });
      }
      const products = (await getProducts()).filter((p) => p.active !== false);
      const cats = await getCategories();
      const out = [];
      for (const s of sections) {
        if (s.visible === false) continue;
        let list = [];
        if (s.source === 'manual') {
          const byId = new Map(products.map((p) => [p.id, p]));
          list = (s.productIds || []).map((id) => byId.get(id)).filter(Boolean);
        } else if (s.source === 'newest') list = products.slice().sort(byNew);
        else if (s.source === 'featured') list = products.filter((p) => p.featured).sort(byOrder);
        else if (s.source === 'sale') list = products.filter(onSale).sort(byOrder);
        else if (s.source === 'category') {
          const slugs = withDescendants(cats, s.category);
          list = products.filter((p) => slugs.includes(p.category)).sort(byOrder);
        } else list = products.slice().sort(byOrder);
        if (s.source !== 'manual') list = list.slice(0, s.limit || 10);
        if (!list.length) continue;           // never show an empty section to customers
        const cat = s.source === 'category' ? cats.find((c) => c.slug === s.category) : null;
        out.push({ id: s.id, title: s.title, type: s.type, link: cat ? '/products?category=' + encodeURIComponent(cat.slug) : '/products', products: list.map(withSlug) });
      }
      return send(res, 200, { sections: out });
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
