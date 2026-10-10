// The product page content, built on the server so search engines and link previews read the real text
// (name, price, description, photos). views/product.html only adds the buttons and the size/color behaviour.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '৳' + Number(n || 0).toLocaleString('en-IN');
const STAR = '<svg viewBox="0 0 40 40" aria-hidden="true"><g fill="#0A0A0A"><rect x="9" y="9" width="22" height="22"/><rect x="9" y="9" width="22" height="22" transform="rotate(45 20 20)"/></g><circle cx="20" cy="20" r="4.2" fill="#B08A3A"/></svg>';

const unitPrice = (p) => (p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price);
const hasVariants = (p) => Array.isArray(p.variants) && p.variants.length > 0;
const variantOf = (p, size, color) => (p.variants || []).find((v) => (v.size || '') === (size || '') && (v.color || '') === (color || '')) || null;
const stockOf = (p, size, color) => (hasVariants(p) ? (variantOf(p, size, color) || { stock: 0 }).stock : p.stock);
const priceOf = (p, size, color) => { const v = variantOf(p, size, color); return v && v.price > 0 ? v.price : unitPrice(p); };

// lowest and highest price over all sizes and colors (Google needs the price in the schema to match the page)
function priceRange(p) {
  const prices = hasVariants(p) ? p.variants.map((v) => (v.price > 0 ? v.price : unitPrice(p))) : [unitPrice(p)];
  return { low: Math.min(...prices), high: Math.max(...prices) };
}

// size and color choices
const optGroup = (name, label, values) => (!values.length ? '' :
  `<div class="opt"><div class="opt-label" id="lbl-${name}">${label}</div><div class="opt-list" role="radiogroup" aria-labelledby="lbl-${name}">` +
  values.map((v, i) => `<input type="radio" name="${name}" id="${name}-${i}" value="${esc(v)}"${i === 0 ? ' checked' : ''}><label for="${name}-${i}">${esc(v)}</label>`).join('') +
  '</div></div>');

function renderProduct(p, { cats, settings }) {
  const sizes = p.sizes || [], colors = p.colors || [];
  const size = sizes[0] || '', color = colors[0] || '';
  const cat = cats.find((c) => c.slug === p.category);
  const parent = cat && cat.parent ? cats.find((c) => c.slug === cat.parent) : null;
  const catPath = cat ? (parent ? parent.name + ' / ' : '') + cat.name : '';
  const catUrl = (c) => '/products?category=' + encodeURIComponent(c.slug);

  // photo descriptions come from the product name and color, so they stay right when photos or names change
  const colorImages = p.colorImages || {};
  const colorOf = (url) => colors.find((c) => colorImages[c] === url);
  const photos = p.images || [];
  const shown = colorImages[color] || photos[0] || '';
  const altOf = (url, i) => { const c = colorOf(url); return c ? `${p.name} – ${c}` : i === 0 ? p.name : `${p.name} – photo ${i + 1}`; };

  const stock = stockOf(p, size, color);
  const own = (variantOf(p, size, color) || {}).price > 0;
  const sale = !own && p.salePrice > 0 && p.salePrice < p.price;

  return `
        <div class="crumbs" style="padding-top:1.6rem"><a href="/">Home</a> / ${parent ? `<a href="${catUrl(parent)}">${esc(parent.name)}</a> / ` : ''}${cat ? `<a href="${catUrl(cat)}">${esc(cat.name)}</a> / ` : ''}${esc(p.name)}</div>
        <div class="pdp" style="padding-top:1rem">
          <div>
            <div class="gallery-main" id="main">${shown ? `<img src="${esc(shown)}" alt="${esc(colorOf(shown) ? `${p.name} – ${colorOf(shown)}` : p.name)}" fetchpriority="high">` : `<div class="ph">${STAR}</div>`}</div>
            ${photos.length > 1 ? `<div class="thumbs">${photos.map((u, i) => `<button class="thumb${u === shown ? ' active' : ''}" data-src="${esc(u)}" aria-label="Show photo ${i + 1}"><img src="${esc(u)}" alt="${esc(altOf(u, i))}"></button>`).join('')}</div>` : ''}
          </div>
          <div class="pdp-info">
            ${cat ? `<a class="product-cat" href="${catUrl(cat)}">${esc(catPath)}</a>` : ''}
            <h1>${esc(p.name)}</h1>
            <div class="pdp-price" id="price"><span class="now${sale ? ' sale' : ''}">${money(priceOf(p, size, color))}</span>${sale ? `<s>${money(p.price)}</s>` : ''}</div>
            ${p.description ? `<p class="pdp-desc">${esc(p.description)}</p>` : ''}
            ${optGroup('size', 'Size', sizes)}
            ${optGroup('color', 'Color', colors)}
            <div class="buy-row">
              <div class="qty" aria-label="Quantity">
                <button type="button" id="minus" aria-label="Decrease quantity">&minus;</button>
                <input id="qty" type="number" min="1" max="20" value="1" aria-label="Quantity">
                <button type="button" id="plus" aria-label="Increase quantity">+</button>
              </div>
              <button class="btn btn-ghost" id="add" style="flex:1"${stock <= 0 ? ' disabled' : ''}>${stock <= 0 ? 'Sold out' : 'Add to cart'}</button>
              <button class="btn btn-primary" id="buy" style="flex:1"${stock <= 0 ? ' disabled' : ''}>Buy now</button>
            </div>
            <div class="stock-note" id="stockNote">${stock > 0 && stock <= 5 ? `Only ${stock} left` : ''}</div>
            <div class="facts">
              <div><span>Delivery inside Dhaka</span><span>${money(settings.shippingInside)}</span></div>
              <div><span>Delivery outside Dhaka</span><span>${money(settings.shippingOutside)}</span></div>
              <div><span>Payment</span><span>Cash on delivery</span></div>
            </div>
          </div>
        </div>`;
}

const renderNotFound = () => '<div class="empty" style="margin:3rem 0 4.5rem"><h3>Product not found</h3><p>It may have been removed or is no longer available.</p><a class="btn btn-dark" href="/products">See all products</a></div>';

module.exports = { renderProduct, renderNotFound, priceRange };
