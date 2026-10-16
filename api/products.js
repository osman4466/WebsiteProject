const {
  send, getQuery, getBody, getProducts, getCategories, dbSet, isAdmin,
  requireAdmin, uid, clean, withDescendants, withSlug, stockSet, stockDrop,
} = require('./_lib');

function normalize(b, cur = {}) {
  const num = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
    .map((x) => clean(x, 40)).filter(Boolean).slice(0, 20);
  const images = (Array.isArray(b.images) ? b.images : cur.images || [])
    .map((x) => clean(x, 500)).filter(Boolean).slice(0, 8);
  const sizes = b.sizes !== undefined ? list(b.sizes) : cur.sizes || [];
  const colors = b.colors !== undefined ? list(b.colors) : cur.colors || [];

  // one row for each size + color: its own price (0 = use the product price) and its own stock
  const rows = Array.isArray(b.variants) ? b.variants : b.variants === undefined ? cur.variants || [] : [];
  const seen = new Set();
  const variants = [];
  for (const v of rows.slice(0, 120)) {
    const size = clean(v.size, 40), color = clean(v.color, 40);
    if (!size && !color) continue;
    if ((size && !sizes.includes(size)) || (color && !colors.includes(color))) continue;
    if (seen.has(size + '|' + color)) continue;
    seen.add(size + '|' + color);
    variants.push({ size, color, price: num(v.price), stock: Math.floor(num(v.stock)) });
  }

  // the photo shown when a customer picks a color
  const source = b.colorImages !== undefined ? b.colorImages : cur.colorImages;
  const colorImages = {};
  if (source && typeof source === 'object') colors.forEach((c) => { const u = clean(source[c], 500); if (u) colorImages[c] = u; });

  return {
    name: clean(b.name ?? cur.name, 120),
    description: clean(b.description ?? cur.description, 3000),
    price: num(b.price ?? cur.price),
    salePrice: num(b.salePrice ?? cur.salePrice),
    category: clean(b.category ?? cur.category, 80),
    images,
    sizes,
    colors,
    variants,
    colorImages,
    stock: variants.length ? variants.reduce((n, v) => n + v.stock, 0) : Math.floor(num(b.stock ?? cur.stock)),
    featured: b.featured !== undefined ? !!b.featured : !!cur.featured,
    active: b.active !== undefined ? !!b.active : cur.active !== false,
  };
}

// custom (drag & drop) order first; products never ordered go on top, newest first
const byOrder = (a, b) => {
  const ao = Number.isFinite(a.order), bo = Number.isFinite(b.order);
  if (ao && bo && a.order !== b.order) return a.order - b.order;
  if (ao !== bo) return ao ? 1 : -1;
  return (b.createdAt || 0) - (a.createdAt || 0);
};
const byNew = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);

module.exports = async (req, res) => {
  try {
    const q = getQuery(req);

    if (req.method === 'GET') {
      let list = await getProducts();
      const admin = isAdmin(req);
      if (!admin) list = list.filter((p) => p.active !== false);
      if (q.id) {
        const p = list.find((x) => x.id === q.id);
        return p ? send(res, 200, withSlug(p), admin ? 0 : 30) : send(res, 404, { error: 'Product not found' });
      }
      if (q.category) {
        // a main category (like Men) also shows everything inside its sub-categories
        const slugs = withDescendants(await getCategories(), q.category);
        list = list.filter((p) => slugs.includes(p.category));
      }
      if (q.featured) list = list.filter((p) => p.featured);
      if (q.q) {
        const t = String(q.q).toLowerCase();
        list = list.filter((p) => (p.name + ' ' + p.description).toLowerCase().includes(t));
      }
      list = list.slice().sort(q.sort === 'new' ? byNew : byOrder);
      if (q.limit) list = list.slice(0, Math.max(1, Number(q.limit) || 20));
      return send(res, 200, list.map(withSlug), admin ? 0 : 30);
    }

    if (!requireAdmin(req, res)) return;
    const products = await getProducts();

    if (req.method === 'POST') {
      const b = await getBody(req);
      const data = normalize(b);
      if (!data.name) return send(res, 400, { error: 'Product name is required' });
      if (!data.price) return send(res, 400, { error: 'Price is required' });
      const cats = await getCategories();
      if (!cats.some((c) => c.slug === data.category)) return send(res, 400, { error: 'Please choose a valid category' });
      const orders = products.map((x) => x.order).filter(Number.isFinite);
      const p = { id: uid('p'), ...data, order: orders.length ? Math.min(...orders) - 1 : 0, createdAt: Date.now() };
      products.push(p);
      await dbSet('products', products);
      await stockSet(p);
      return send(res, 201, p);
    }

    if (req.method === 'PUT' && q.reorder) {
      // body: { ids: [...] } the new order, top to bottom
      const b = await getBody(req);
      const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
      const byId = new Map(products.map((p) => [p.id, p]));
      const seq = [...new Set(ids)].filter((id) => byId.has(id));
      const rest = products.slice().sort(byOrder).filter((p) => !seq.includes(p.id)).map((p) => p.id);
      [...seq, ...rest].forEach((id, i) => { byId.get(id).order = i + 1; });
      await dbSet('products', products);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'PUT') {
      const b = await getBody(req);
      const i = products.findIndex((p) => p.id === q.id);
      if (i < 0) return send(res, 404, { error: 'Product not found' });
      const data = normalize(b, products[i]);
      if (!data.name) return send(res, 400, { error: 'Product name is required' });
      if (!data.price) return send(res, 400, { error: 'Price is required' });
      const cats = await getCategories();
      if (!cats.some((c) => c.slug === data.category)) return send(res, 400, { error: 'Please choose a valid category' });
      const old = products[i];
      products[i] = { ...old, ...data, updatedAt: Date.now() };
      await dbSet('products', products);
      await stockSet(products[i], old);
      return send(res, 200, products[i]);
    }

    if (req.method === 'DELETE') {
      const gone = products.find((p) => p.id === q.id);
      if (!gone) return send(res, 404, { error: 'Product not found' });
      await dbSet('products', products.filter((p) => p.id !== q.id));
      await stockDrop(gone);
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
};
