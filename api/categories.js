const {
  send, getQuery, getBody, getCategories, getProducts, dbSet,
  requireAdmin, uid, slugify, clean,
} = require('./_lib');

module.exports = async (req, res) => {
  try {
    const q = getQuery(req);

    if (req.method === 'GET') {
      const cats = await getCategories();
      const products = await getProducts();
      const counts = {};
      products.filter((p) => p.active !== false).forEach((p) => { counts[p.category] = (counts[p.category] || 0) + 1; });
      return send(res, 200, cats.map((c) => ({ ...c, count: counts[c.slug] || 0 })));
    }

    if (!requireAdmin(req, res)) return;
    const cats = await getCategories();

    if (req.method === 'POST') {
      const b = await getBody(req);
      const name = clean(b.name, 60);
      if (!name) return send(res, 400, { error: 'Category name is required' });
      let slug = slugify(b.slug || name);
      if (cats.some((c) => c.slug === slug)) return send(res, 400, { error: 'A category with this name already exists' });
      const cat = { id: uid('c'), name, slug, image: clean(b.image, 500), description: clean(b.description, 300) };
      cats.push(cat);
      await dbSet('categories', cats);
      return send(res, 201, cat);
    }

    if (req.method === 'PUT') {
      const b = await getBody(req);
      const i = cats.findIndex((c) => c.id === q.id);
      if (i < 0) return send(res, 404, { error: 'Category not found' });
      const name = clean(b.name ?? cats[i].name, 60);
      if (!name) return send(res, 400, { error: 'Category name is required' });
      cats[i] = { ...cats[i], name, image: clean(b.image ?? cats[i].image, 500), description: clean(b.description ?? cats[i].description, 300) };
      await dbSet('categories', cats);
      return send(res, 200, cats[i]);
    }

    if (req.method === 'DELETE') {
      const cat = cats.find((c) => c.id === q.id);
      if (!cat) return send(res, 404, { error: 'Category not found' });
      const products = await getProducts();
      const used = products.filter((p) => p.category === cat.slug).length;
      if (used > 0) return send(res, 400, { error: `This category has ${used} product(s). Move or delete them first.` });
      await dbSet('categories', cats.filter((c) => c.id !== q.id));
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
};
