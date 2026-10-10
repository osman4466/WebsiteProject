// Serves the storefront pages with the SEO tags already in the HTML
// (title, description, canonical, share preview, Google Search Console code, structured data).
// The page templates live in /views; the page itself still builds its content in the browser.
const fs = require('fs');
const path = require('path');
const { getQuery, getSettings, getCategories, getProducts, findBySlug, productSlug, withSlug, siteBase } = require('./_lib');
const { getTracking } = require('./_track');
const { renderProduct, renderNotFound, priceRange } = require('./_pdp');

const FILES = { index: 'index.html', products: 'products.html', product: 'product.html', cart: 'cart.html', categories: 'categories.html' };
const templates = {};
const template = (name) => templates[name] || (templates[name] = fs.readFileSync(path.join(__dirname, '..', 'views', FILES[name]), 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trim() + '…' : s; };

function head(m) {
  const t = esc(m.title), d = esc(m.description);
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}">`,
    m.noindex ? '<meta name="robots" content="noindex, nofollow">' : '<meta name="robots" content="index, follow, max-image-preview:large">',
    `<link rel="canonical" href="${esc(m.url)}">`,
    `<meta property="og:site_name" content="${esc(m.site)}">`,
    `<meta property="og:type" content="${m.ogType || 'website'}">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta property="og:url" content="${esc(m.url)}">`,
    m.image ? `<meta property="og:image" content="${esc(m.image)}">` : '',
    `<meta name="twitter:card" content="${m.image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
    m.image ? `<meta name="twitter:image" content="${esc(m.image)}">` : '',
    m.gsc ? `<meta name="google-site-verification" content="${esc(m.gsc)}">` : '',
    ...(m.ld || []).map(ld),
  ].filter(Boolean).join('\n  ');
}

module.exports = async (req, res) => {
  try {
    const q = getQuery(req);
    const name = FILES[q.p] ? q.p : 'index';
    const [settings, cats, trk] = await Promise.all([getSettings(), getCategories(), getTracking()]);
    const base = siteBase(req, trk.siteUrl);
    const abs = (u) => (!u ? '' : /^https?:\/\//i.test(u) ? u : base + (u.startsWith('/') ? '' : '/') + u);
    const site = settings.storeName || 'Janissary Wear';
    const m = { site, gsc: trk.gscCode, url: base + '/', title: site, description: settings.tagline || '', image: base + '/img/share.jpg' };
    let status = 200, extra = '', body = '';

    if (name === 'index') {
      m.title = `${site} | ${settings.tagline || 'Streetwear'}`;
      m.description = "Men's and women's streetwear drawn from the Janissary orders: tees, polos and drop shoulders. Cash on delivery across Bangladesh.";
      const sameAs = [settings.facebook, settings.instagram].filter(Boolean);
      m.ld = [
        { '@context': 'https://schema.org', '@type': 'Organization', name: site, url: base + '/', logo: base + '/img/logo.png', ...(sameAs.length ? { sameAs } : {}), ...(settings.phone ? { contactPoint: { '@type': 'ContactPoint', telephone: settings.phone, contactType: 'customer service' } } : {}) },
        { '@context': 'https://schema.org', '@type': 'WebSite', name: site, url: base + '/' },
      ];
    } else if (name === 'products') {
      const cat = cats.find((c) => c.slug === q.category);
      const parent = cat && cat.parent ? cats.find((c) => c.slug === cat.parent) : null;
      const label = cat ? (parent ? parent.name + ' ' + cat.name : cat.name) : 'All products';
      m.title = `${label} | ${site}`;
      m.description = cat && cat.description ? cut(cat.description, 155) : `Shop ${cat ? label.toLowerCase() : 'every piece'} from ${site}. Pay on delivery anywhere in Bangladesh.`;
      m.url = base + '/products' + (cat ? '?category=' + encodeURIComponent(cat.slug) : '');
      m.noindex = !!q.q;                       // search result pages should not be indexed
      if (cat && cat.image) m.image = abs(cat.image);
    } else if (name === 'categories') {
      m.title = `Categories | ${site}`;
      m.description = `Browse ${site} by category: men and women, t-shirts, polo shirts and drop shoulders.`;
      m.url = base + '/categories';
    } else if (name === 'cart') {
      m.title = `Your cart | ${site}`;
      m.description = 'Review your cart and place your cash on delivery order.';
      m.url = base + '/cart';
      m.noindex = true;
    } else if (name === 'product') {
      const products = await getProducts();
      const p = findBySlug(products.filter((x) => x.active !== false), q.slug || q.id);
      if (!p) {
        status = 404; m.title = `Product not found | ${site}`; m.description = 'This product is no longer available.'; m.noindex = true; m.url = base + '/products';
        body = renderNotFound();
      } else {
        const slug = productSlug(p);
        // old links (/product?id=...) and renamed products go to the current address
        if (q.slug !== slug) { res.statusCode = 301; res.setHeader('Location', '/product/' + slug); return res.end(); }
        const cat = cats.find((c) => c.slug === p.category);
        const range = priceRange(p);
        m.url = `${base}/product/${slug}`;
        m.title = `${p.name} | ${site}`;
        m.description = cut(p.description, 155) || `Buy ${p.name} for ৳${range.low.toLocaleString('en-IN')} from ${site}. Cash on delivery across Bangladesh.`;
        m.image = abs((p.images || [])[0]) || m.image;
        m.ogType = 'product';
        const inStock = p.stock > 0;
        const crumbs = [{ name: 'Home', url: base + '/' }];
        if (cat && cat.parent) { const par = cats.find((c) => c.slug === cat.parent); if (par) crumbs.push({ name: par.name, url: `${base}/products?category=${par.slug}` }); }
        if (cat) crumbs.push({ name: cat.name, url: `${base}/products?category=${cat.slug}` });
        crumbs.push({ name: p.name, url: m.url });
        m.ld = [
          { '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: cut(p.description, 500) || p.name, sku: p.id, ...((p.images || []).length ? { image: p.images.map(abs) } : {}), brand: { '@type': 'Brand', name: site },
            offers: { ...(range.low === range.high ? { '@type': 'Offer', price: String(range.low) } : { '@type': 'AggregateOffer', lowPrice: String(range.low), highPrice: String(range.high) }), url: m.url, priceCurrency: 'BDT', availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', itemCondition: 'https://schema.org/NewCondition' } },
          { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })) },
        ];
        body = renderProduct(p, { cats, settings });
        extra = `<script>window.__P__=${JSON.stringify(withSlug(p)).replace(/</g, '\\u003c')};</script>`;
      }
    }

    const html = template(name).replace('<!--SEO-->', () => head(m) + (extra ? '\n  ' + extra : '')).replace('<!--PRODUCT-->', () => body);
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', status === 200 ? 'public, s-maxage=60, stale-while-revalidate=300' : 'no-store');
    res.end(html);
  } catch (e) {
    res.statusCode = 500; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('Something went wrong: ' + e.message);
  }
};
