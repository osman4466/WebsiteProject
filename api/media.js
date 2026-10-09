// Media library (like WordPress > Media). Photos are kept in the site database.
//   GET    /api/media          list all photos           (admin)
//   POST   /api/media          save a photo record       (admin)
//   DELETE /api/media?id=...   delete a photo            (admin)
const {
  send, getQuery, getBody, getProducts, getCategories, dbGet, dbSet, dbDel, requireAdmin, uid, clean,
} = require('./_lib');

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0);

module.exports = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const q = getQuery(req);
    const media = (await dbGet('media', [])) || [];

    if (req.method === 'GET') {
      // photos already used by products or categories join the library automatically
      const [products, cats] = await Promise.all([getProducts(), getCategories()]);
      const known = new Set(media.map((m) => m.url));
      let changed = false;
      const adopt = (url) => {
        if (!url || known.has(url)) return;
        known.add(url); changed = true;
        media.push({ id: uid('m'), url, name: 'Photo', createdAt: Date.now() });
      };
      products.forEach((p) => (p.images || []).forEach(adopt));
      cats.forEach((c) => adopt(c.image));
      if (changed) await dbSet('media', media);
      return send(res, 200, { items: media.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) });
    }

    if (req.method === 'POST') {
      const b = await getBody(req);
      const url = String(b.url || '');
      if (!/^\/api\/image\?id=[a-zA-Z0-9_]+$/.test(url)) return send(res, 400, { error: 'This photo address is not allowed.' });
      const same = media.find((m) => m.url === url);
      if (same) return send(res, 200, same);
      const rec = { id: uid('m'), url, name: clean(b.name, 120) || 'Photo', bytes: num(b.bytes), createdAt: Date.now() };
      media.push(rec);
      await dbSet('media', media);
      return send(res, 201, rec);
    }

    if (req.method === 'DELETE') {
      const rec = media.find((m) => m.id === q.id);
      if (!rec) return send(res, 404, { error: 'Photo not found' });
      const cats = await getCategories();
      const cat = cats.find((c) => c.image === rec.url);
      if (cat) return send(res, 409, { error: `This photo is the cover of the category "${cat.name}". Change that category photo first.` });

      const id = rec.url.split('id=')[1];
      if (id) await dbDel('img:' + id);
      const products = await getProducts();
      if (products.some((p) => (p.images || []).includes(rec.url))) {
        await dbSet('products', products.map((p) => ((p.images || []).includes(rec.url) ? { ...p, images: p.images.filter((u) => u !== rec.url) } : p)));
      }
      await dbSet('media', media.filter((m) => m.id !== rec.id));
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
};
