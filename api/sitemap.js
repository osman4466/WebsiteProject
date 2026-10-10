// /sitemap.xml  - lists every page Google should know about; it updates itself when products change.
const { getProducts, getCategories, productSlug, siteBase } = require('./_lib');
const { getTracking } = require('./_track');

const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

module.exports = async (req, res) => {
  try {
    const trk = await getTracking();
    const base = siteBase(req, trk.siteUrl);
    const [products, cats] = await Promise.all([getProducts(), getCategories()]);
    const urls = [
      { loc: base + '/' }, { loc: base + '/products' }, { loc: base + '/categories' }, { loc: base + '/returns' }, { loc: base + '/privacy' },
      ...cats.map((c) => ({ loc: `${base}/products?category=${encodeURIComponent(c.slug)}` })),
      ...products.filter((p) => p.active !== false).map((p) => ({ loc: `${base}/product/${productSlug(p)}`, lastmod: new Date(p.updatedAt || p.createdAt || Date.now()).toISOString().slice(0, 10) })),
    ];
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map((u) => `  <url><loc>${x(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n') + '\n</urlset>\n';
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    res.end(xml);
  } catch (e) {
    res.statusCode = 500; res.end(e.message);
  }
};
