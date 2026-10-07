const {
  send, getQuery, getBody, getCategories, getProducts, dbSet,
  requireAdmin, uid, slugify, clean, withDescendants,
} = require('./_lib');

// parent must be '' (main category) or the slug of an existing main category
function checkParent(cats, parent, selfSlug) {
  if (!parent) return '';
  const p = cats.find((c) => c.slug === parent);
  if (!p) return null;
  if (p.parent) return null;            // only two levels
  if (p.slug === selfSlug) return null; // not under itself
  return p.slug;
}

module.exports = async (req, res) => {
  try {
    const q = getQuery(req);

    if (req.method === 'GET') {
      const cats = await getCategories();
      const products = (await getProducts()).filter((p) => p.active !== false);
      return send(res, 200, cats.map((c) => ({
        ...c,
        count: products.filter((p) => withDescendants(cats, c.slug).includes(p.category)).length,
      })));
    }

    if (!requireAdmin(req, res)) return;
    const cats = await getCategories();

    if (req.method === 'POST') {
      const b = await getBody(req);
      const name = clean(b.name, 60);
      if (!name) return send(res, 400, { error: 'Category name is required' });
      const parent = checkParent(cats, clean(b.parent, 80));
      if (parent === null) return send(res, 400, { error: 'Please choose a valid main category' });
      const slug = slugify(parent ? parent + '-' + name : name);
      if (cats.some((c) => c.slug === slug)) return send(res, 400, { error: 'A category with this name already exists here' });
      const cat = { id: uid('c'), name, slug, parent, image: clean(b.image, 500), description: clean(b.description, 300) };
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

      let parent = cats[i].parent || '';
      if (b.parent !== undefined) {
        const next = checkParent(cats, clean(b.parent, 80), cats[i].slug);
        if (next === null) return send(res, 400, { error: 'Please choose a valid main category' });
        if (next && cats.some((c) => c.parent === cats[i].slug)) {
          return send(res, 400, { error: 'This category has sub-categories, so it cannot be placed under another one.' });
        }
        parent = next;
      }
      cats[i] = {
        ...cats[i], name, parent,
        image: clean(b.image ?? cats[i].image, 500),
        description: clean(b.description ?? cats[i].description, 300),
      };
      await dbSet('categories', cats);
      return send(res, 200, cats[i]);
    }

    if (req.method === 'DELETE') {
      const cat = cats.find((c) => c.id === q.id);
      if (!cat) return send(res, 404, { error: 'Category not found' });
      const kids = cats.filter((c) => c.parent === cat.slug).length;
      if (kids > 0) return send(res, 400, { error: `This category has ${kids} sub-categories. Delete or move them first.` });
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
