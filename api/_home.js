// Homepage sections: chooses the products for each section (used by /api/home and by the homepage itself)
// and builds the homepage HTML on the server, so the page arrives complete and the photos start loading at once.
const { dbGet, withDescendants, productSlug } = require('./_lib');

const DEFAULTS = [
  { id: 'h_new', title: 'New arrivals', type: 'carousel', source: 'newest', category: '', productIds: [], limit: 10, visible: true },
  { id: 'h_all', title: 'Shop the collection', type: 'grid', source: 'all', category: '', productIds: [], limit: 24, visible: true },
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '৳' + Number(n || 0).toLocaleString('en-IN');
const onSale = (p) => p.salePrice > 0 && p.salePrice < p.price;
const unitPrice = (p) => (onSale(p) ? p.salePrice : p.price);
const byNew = (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
const byOrder = (a, b) => {
  const ao = Number.isFinite(a.order), bo = Number.isFinite(b.order);
  if (ao && bo && a.order !== b.order) return a.order - b.order;
  if (ao !== bo) return ao ? 1 : -1;
  return byNew(a, b);
};

async function savedSections() {
  const saved = await dbGet('homepage', null);
  return saved && Array.isArray(saved.sections) ? saved.sections : DEFAULTS;
}

// the sections customers see, with their products already chosen
function pickSections(sections, products, cats) {
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
    out.push({ id: s.id, title: s.title, type: s.type, link: cat ? '/products?category=' + encodeURIComponent(cat.slug) : '/products', products: list });
  }
  return out;
}

// ---------- HTML ----------
const STAR = '<svg viewBox="0 0 40 40" aria-hidden="true"><g fill="#0A0A0A"><rect x="9" y="9" width="22" height="22"/><rect x="9" y="9" width="22" height="22" transform="rotate(45 20 20)"/></g><circle cx="20" cy="20" r="4.2" fill="#B08A3A"/></svg>';
const BAND_STAR = '<svg class="star" viewBox="0 0 40 40" aria-hidden="true"><g fill="#D8B35A"><rect x="9" y="9" width="22" height="22"/><rect x="9" y="9" width="22" height="22" transform="rotate(45 20 20)"/></g><circle cx="20" cy="20" r="4.2" fill="#0A0A0A"/></svg>';

const catPath = (cats, slug) => {
  const c = cats.find((x) => x.slug === slug); if (!c) return '';
  const par = c.parent ? cats.find((x) => x.slug === c.parent) : null;
  return par ? par.name + ' / ' + c.name : c.name;
};

// same card as JW.productCard in public/js/app.js. The very first photo gets top priority (it is the one Google measures),
// the first two photos of every section load at once, the others wait until they come near the screen.
function card(p, cats, i, first) {
  const label = catPath(cats, p.category);
  const tag = p.stock <= 0 ? '<span class="tag out">Sold out</span>' : onSale(p) ? `<span class="tag">Save ${Math.round((1 - p.salePrice / p.price) * 100)}%</span>` : '';
  const [a, b] = p.images || [];
  const load = first ? ' fetchpriority="high"' : i < 2 ? '' : ' loading="lazy"';
  const media = a
    ? `<img src="${esc(a)}" alt="${esc(p.name)}"${load} decoding="async">` + (b ? `<img class="alt" src="${esc(b)}" alt="" loading="lazy" fetchpriority="low" decoding="async">` : '')
    : `<div class="ph">${STAR}</div>`;
  return `<a class="product" href="/product/${productSlug(p)}">
      <div class="product-media">${media}${tag}</div>
      <div class="product-name">${esc(p.name)}</div>
      ${label ? `<div class="product-cat">${esc(label)}</div>` : ''}
      <div class="price"><span class="now${onSale(p) ? ' sale' : ''}">${money(unitPrice(p))}</span>${onSale(p) ? `<s>${money(p.price)}</s>` : ''}</div>
    </a>`;
}

function renderSections(list, cats) {
  if (!list.length) return '<div class="wrap home-sec"><div class="empty"><h3>The first drop is being prepared</h3><p>New pieces will appear here as soon as they are added.</p></div></div>';
  return list.map((s, k) => {
    const cards = s.products.map((p, i) => card(p, cats, i, k === 0 && i === 0)).join('');
    const body = s.type === 'grid'
      ? `<div class="product-grid">${cards}</div>`
      : `<div class="carousel"><button class="car-btn prev" type="button" aria-label="Previous" data-dir="-1">&#8249;</button><div class="car-track">${cards}</div><button class="car-btn next" type="button" aria-label="Next" data-dir="1">&#8250;</button></div>`;
    return `
          <section class="home-sec" aria-label="${esc(s.title)}"><div class="wrap">
            <div class="section-head"><h2>${esc(s.title)}</h2><a class="link-more" href="${esc(s.link)}">View all</a></div>
            ${body}
          </div></section>`;
  }).join('');
}

// the three "Pay on delivery / delivery charge / no account" blocks
function renderBand(s) {
  const free = s.freeShippingOver > 0 ? `Free delivery on orders over ${money(s.freeShippingOver)}.` : '';
  return `
        <div>${BAND_STAR}<h3>Pay on delivery</h3><p>Check your order first, then pay the courier. No card needed.</p></div>
        <div>${BAND_STAR}<h3>Inside Dhaka ${money(s.shippingInside)}</h3><p>Outside Dhaka ${money(s.shippingOutside)}. ${esc(free)}</p></div>
        <div>${BAND_STAR}<h3>No account needed</h3><p>Pick your size, add your address and place the order in a minute.</p></div>`;
}

module.exports = { savedSections, pickSections, renderSections, renderBand };
