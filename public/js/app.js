/* Janissary Wear - shared storefront code */
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '৳' + Number(n || 0).toLocaleString('en-IN');

  const STAR = (c1 = '#B4232C', c2 = '#D8B35A') =>
    `<svg viewBox="0 0 40 40" aria-hidden="true"><g fill="${c1}"><rect x="9" y="9" width="22" height="22"/><rect x="9" y="9" width="22" height="22" transform="rotate(45 20 20)"/></g><circle cx="20" cy="20" r="4.2" fill="${c2}"/></svg>`;

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const r = await fetch('/api/' + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
    return j;
  }

  // ---------- cart (localStorage) ----------
  const CART_KEY = 'jw_cart_v1';
  const cart = {
    get() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; } },
    set(items) { try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch {} updateCartCount(); },
    count() { return cart.get().reduce((n, i) => n + i.qty, 0); },
    add(item) {
      const items = cart.get();
      const hit = items.find((i) => i.id === item.id && i.size === item.size && i.color === item.color);
      if (hit) hit.qty = Math.min(20, hit.qty + item.qty);
      else items.push(item);
      cart.set(items);
    },
    clear() { cart.set([]); },
  };
  function updateCartCount() {
    const n = cart.count();
    $$('.cart-count').forEach((el) => { el.textContent = n; el.dataset.n = n; });
  }

  // ---------- toast ----------
  let toastTimer;
  function toast(msg, isError) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- product helpers ----------
  const unitPrice = (p) => (p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price);
  const onSale = (p) => p.salePrice > 0 && p.salePrice < p.price;

  function imgTag(src, alt, cls) {
    return src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy"${cls ? ` class="${cls}"` : ''}>` : '';
  }

  function productCard(p, cats) {
    const cat = (cats || []).find((c) => c.slug === p.category);
    const out = p.stock <= 0;
    const tag = out ? '<span class="tag out">Sold out</span>' : onSale(p) ? `<span class="tag">Save ${Math.round((1 - p.salePrice / p.price) * 100)}%</span>` : '';
    const media = p.images.length
      ? imgTag(p.images[0], p.name) + (p.images[1] ? imgTag(p.images[1], '', 'alt') : '')
      : `<div class="ph">${STAR('#1A2A5C', '#B08A3A')}</div>`;
    return `<a class="product" href="/product?id=${encodeURIComponent(p.id)}">
      <div class="product-media">${media}${tag}</div>
      <div class="product-name">${esc(p.name)}</div>
      ${cat ? `<div class="product-cat">${esc(cat.name)}</div>` : ''}
      <div class="price"><span class="now${onSale(p) ? ' sale' : ''}">${money(unitPrice(p))}</span>${onSale(p) ? `<s>${money(p.price)}</s>` : ''}</div>
    </a>`;
  }

  function catTile(c, large) {
    return `<a class="cat-tile" href="/products?category=${encodeURIComponent(c.slug)}">
      ${c.image ? imgTag(c.image, c.name) : ''}
      <div class="cat-info"><h3>${esc(c.name)}</h3><span>${c.count || 0} ${c.count === 1 ? 'item' : 'items'}</span>${large && c.description ? `<span class="cat-desc">${esc(c.description)}</span>` : ''}</div>
    </a>`;
  }

  // ---------- page chrome ----------
  let settings = null;
  async function loadSettings() {
    if (settings) return settings;
    try { settings = await api('settings'); } catch { settings = { storeName: 'Janissary Wear', tagline: '', shippingInside: 70, shippingOutside: 130, freeShippingOver: 0 }; }
    return settings;
  }

  function renderChrome(active) {
    const top = $('#chrome-top');
    const bottom = $('#chrome-bottom');
    if (top) {
      top.innerHTML = `
      <div class="announce on-dark" id="announce" hidden></div>
      <header class="site-header"><div class="wrap">
        <a class="brand" href="/" aria-label="Home">${STAR()}<span class="store-name">Janissary Wear</span></a>
        <nav class="nav" aria-label="Main">
          <a href="/" class="${active === 'home' ? 'active' : ''}">Home</a>
          <a href="/categories" class="${active === 'categories' ? 'active' : ''}">Categories</a>
          <a href="/products" class="${active === 'products' ? 'active' : ''}">All products</a>
        </nav>
        <a class="cart-link" href="/cart" aria-label="Cart">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1.2 11.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8L5 8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>
          <span class="cart-count" data-n="0">0</span>
        </a>
      </div></header>`;
    }
    if (bottom) {
      bottom.innerHTML = `
      <footer class="site-footer on-dark"><div class="wrap">
        <div class="footer-grid">
          <div><a class="brand" href="/">${STAR('#B4232C', '#D8B35A')}<span class="store-name">Janissary Wear</span></a><p class="footer-tagline"></p></div>
          <div><h4>Shop</h4><ul><li><a href="/products">All products</a></li><li><a href="/categories">Categories</a></li><li><a href="/cart">Your cart</a></li></ul></div>
          <div><h4>Contact</h4><ul class="footer-contact"></ul></div>
        </div>
        <div class="footer-bottom">© <span class="year"></span> <span class="store-name">Janissary Wear</span>. All rights reserved.</div>
      </div></footer>`;
      $('.year', bottom).textContent = new Date().getFullYear();
    }
    updateCartCount();

    loadSettings().then((s) => {
      $$('.store-name').forEach((el) => (el.textContent = s.storeName));
      const a = $('#announce');
      if (a && s.announcement) { a.textContent = s.announcement; a.hidden = false; }
      const tg = $('.footer-tagline');
      if (tg) tg.textContent = s.tagline || '';
      const fc = $('.footer-contact');
      if (fc) {
        const rows = [];
        if (s.phone) rows.push(`<li><a href="tel:${esc(s.phone)}">${esc(s.phone)}</a></li>`);
        if (s.whatsapp) rows.push(`<li><a href="https://wa.me/${esc(s.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a></li>`);
        if (s.email) rows.push(`<li><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></li>`);
        if (s.address) rows.push(`<li>${esc(s.address)}</li>`);
        if (s.facebook) rows.push(`<li><a href="${esc(s.facebook)}" target="_blank" rel="noopener">Facebook</a></li>`);
        if (s.instagram) rows.push(`<li><a href="${esc(s.instagram)}" target="_blank" rel="noopener">Instagram</a></li>`);
        fc.innerHTML = rows.join('') || '<li>Contact details coming soon</li>';
      }
      document.dispatchEvent(new CustomEvent('jw:settings', { detail: s }));
    });
  }

  window.JW = { $, $$, esc, money, STAR, api, cart, toast, unitPrice, onSale, imgTag, productCard, catTile, loadSettings, renderChrome, updateCartCount };
})();
