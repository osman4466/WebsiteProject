/* Janissary Wear - shared storefront code */
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '৳' + Number(n || 0).toLocaleString('en-IN');

  const STAR = (c1 = '#0A0A0A', c2 = '#D8B35A') =>
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


  // ---------- categories (two levels: main category -> sub-category) ----------
  const CAT_KEY = 'jw_cats_v2';
  let CATS = [];
  try { CATS = JSON.parse(sessionStorage.getItem(CAT_KEY)) || []; } catch {}
  let catsPromise = null;
  function loadCats() {
    if (!catsPromise) {
      catsPromise = api('categories').then((c) => {
        CATS = c;
        try { sessionStorage.setItem(CAT_KEY, JSON.stringify(c)); } catch {}
        return c;
      });
    }
    return catsPromise;
  }
  const tops = (cats = CATS) => cats.filter((c) => !c.parent);
  const kidsOf = (slug, cats = CATS) => cats.filter((c) => c.parent === slug);
  const bySlug = (slug, cats = CATS) => cats.find((c) => c.slug === slug);
  const topOf = (slug, cats = CATS) => { const c = bySlug(slug, cats); return c ? (c.parent ? bySlug(c.parent, cats) : c) : null; };
  const catPath = (slug, cats = CATS) => {
    const c = bySlug(slug, cats); if (!c) return '';
    const p = c.parent ? bySlug(c.parent, cats) : null;
    return p ? p.name + ' / ' + c.name : c.name;
  };
  const catUrl = (slug) => '/products?category=' + encodeURIComponent(slug);

  // ---------- product helpers ----------
  const unitPrice = (p) => (p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : p.price);
  const onSale = (p) => p.salePrice > 0 && p.salePrice < p.price;

  // size + color options: each can have its own price, stock and photo
  const hasVariants = (p) => Array.isArray(p.variants) && p.variants.length > 0;
  const variantOf = (p, size, color) => (p.variants || []).find((v) => (v.size || '') === (size || '') && (v.color || '') === (color || '')) || null;
  const stockOf = (p, size, color) => (hasVariants(p) ? (variantOf(p, size, color) || { stock: 0 }).stock : p.stock);
  const priceOf = (p, size, color) => { const v = variantOf(p, size, color); return v && v.price > 0 ? v.price : unitPrice(p); };
  const productUrl = (p) => (p.slug ? '/product/' + p.slug : '/product?id=' + encodeURIComponent(p.id));
  const imageOf = (p, color) => (p.colorImages || {})[color] || (p.images || [])[0] || '';

  function imgTag(src, alt, cls) {
    return src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy"${cls ? ` class="${cls}"` : ''}>` : '';
  }

  function productCard(p, cats) {
    const label = catPath(p.category, cats || CATS);
    const out = p.stock <= 0;
    const tag = out ? '<span class="tag out">Sold out</span>' : onSale(p) ? `<span class="tag">Save ${Math.round((1 - p.salePrice / p.price) * 100)}%</span>` : '';
    const media = p.images.length
      ? imgTag(p.images[0], p.name) + (p.images[1] ? imgTag(p.images[1], '', 'alt') : '')
      : `<div class="ph">${STAR('#0A0A0A', '#B08A3A')}</div>`;
    return `<a class="product" href="${productUrl(p)}">
      <div class="product-media">${media}${tag}</div>
      <div class="product-name">${esc(p.name)}</div>
      ${label ? `<div class="product-cat">${esc(label)}</div>` : ''}
      <div class="price"><span class="now${onSale(p) ? ' sale' : ''}">${money(unitPrice(p))}</span>${onSale(p) ? `<s>${money(p.price)}</s>` : ''}</div>
    </a>`;
  }

  // a row that scrolls sideways (swipe on phones, arrow buttons on bigger screens)
  function carousel(products, cats) {
    return `<div class="carousel"><button class="car-btn prev" type="button" aria-label="Previous" data-dir="-1">&#8249;</button>` +
      `<div class="car-track">${products.map((p) => productCard(p, cats)).join('')}</div>` +
      `<button class="car-btn next" type="button" aria-label="Next" data-dir="1">&#8250;</button></div>`;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.car-btn'); if (!b) return;
    const t = b.parentElement.querySelector('.car-track');
    t.scrollBy({ left: Number(b.dataset.dir) * t.clientWidth * 0.85, behavior: 'smooth' });
  });

  function catTile(c, large) {
    return `<a class="cat-tile" href="${catUrl(c.slug)}">
      ${c.image ? imgTag(c.image, c.name) : ''}
      <div class="cat-info"><h3>${esc(c.name)}</h3><span>${c.count || 0} ${c.count === 1 ? 'item' : 'items'}</span>${large && c.description ? `<span class="cat-desc">${esc(c.description)}</span>` : ''}</div>
    </a>`;
  }

  // ---------- page chrome ----------
  const FALLBACK_SETTINGS = { storeName: 'Janissary Wear', tagline: '', shippingInside: 70, shippingOutside: 130, freeShippingOver: 0, tracking: {} };
  let settingsPromise = null;
  // one request per page, shared by everything that asks (menu, footer, tracking ...)
  function loadSettings() {
    if (!settingsPromise) settingsPromise = api('settings').catch(() => FALLBACK_SETTINGS);
    return settingsPromise;
  }

  let ACTIVE = null; // set by the product page (slug of the main category)
  function activeKey() {
    if (ACTIVE !== null) return ACTIVE;
    const path = location.pathname.replace(/\/$/, '') || '/';
    if (path === '/' || path === '/index') return 'home';
    if (path === '/products') {
      const c = new URLSearchParams(location.search).get('category');
      if (!c) return 'products';
      const t = topOf(c);
      return t ? t.slug : 'products';
    }
    return '';
  }
  function setActive(slug) { const t = topOf(slug); ACTIVE = t ? t.slug : ''; drawNav(); }

  function drawNav() {
    const nav = $('#mainNav');
    if (!nav) return;
    const key = activeKey();
    const cls = (k) => (k === key ? ' class="active"' : '');
    nav.innerHTML =
      `<a href="/" data-key="home"${cls('home')}>Home</a>` +
      tops().map((t) => {
        const kids = kidsOf(t.slug);
        return `<div class="nav-item"><a href="${catUrl(t.slug)}" data-key="${esc(t.slug)}"${cls(t.slug)}>${esc(t.name)}</a>` +
          (kids.length ? `<div class="drop"><a href="${catUrl(t.slug)}">All ${esc(t.name)}</a>${kids.map((k) => `<a href="${catUrl(k.slug)}">${esc(k.name)}</a>`).join('')}</div>` : '') +
          `</div>`;
      }).join('') +
      `<a href="/products" data-key="products"${cls('products')}>All products</a>`;
    const dn = $('#drawerNav');
    if (dn) {
      dn.innerHTML =
        `<a href="/"${cls('home')}>Home</a>` +
        tops().map((t) => {
          const kids = kidsOf(t.slug);
          return kids.length
            ? `<details${t.slug === key ? ' open' : ''}><summary>${esc(t.name)}</summary><a href="${catUrl(t.slug)}">All ${esc(t.name)}</a>${kids.map((k) => `<a href="${catUrl(k.slug)}">${esc(k.name)}</a>`).join('')}</details>`
            : `<a href="${catUrl(t.slug)}"${cls(t.slug)}>${esc(t.name)}</a>`;
        }).join('') +
        `<a href="/products"${cls('products')}>All products</a><a href="/cart">Your cart</a>`;
    }
    const shop = $('#footShop');
    if (shop) {
      shop.innerHTML = tops().map((t) => `<li><a href="${catUrl(t.slug)}">${esc(t.name)}</a></li>`).join('') +
        '<li><a href="/products">All products</a></li><li><a href="/categories">All categories</a></li><li><a href="/cart">Your cart</a></li>';
    }
  }

  function renderChrome() {
    const top = $('#chrome-top');
    const bottom = $('#chrome-bottom');
    if (top) {
      top.innerHTML = `
      <div class="announce on-dark" id="announce" hidden></div>
      <header class="site-header"><div class="wrap">
        <button class="menu-btn" id="menuBtn" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="drawer"><span></span><span></span><span></span></button>
        <a class="brand" href="/" aria-label="Home">${STAR()}<span class="store-name">Janissary Wear</span></a>
        <nav class="nav" id="mainNav" aria-label="Main"></nav>
        <a class="cart-link" href="/cart" aria-label="Cart">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1.2 11.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8L5 8z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>
          <span class="cart-count" data-n="0">0</span>
        </a>
      </div></header>
      <div class="drawer-bg" id="drawerBg" hidden></div>
      <aside class="drawer" id="drawer" aria-label="Menu" aria-hidden="true">
        <div class="drawer-head"><a class="brand" href="/">${STAR()}<span class="store-name">Janissary Wear</span></a><button class="drawer-x" id="drawerX" type="button" aria-label="Close menu">&times;</button></div>
        <nav class="drawer-nav" id="drawerNav"></nav>
        <div class="drawer-foot" id="drawerFoot"></div>
      </aside>`;
      const dr = $('#drawer'), bg = $('#drawerBg'), mb = $('#menuBtn');
      const setDrawer = (open) => {
        dr.classList.toggle('open', open); dr.setAttribute('aria-hidden', String(!open));
        bg.hidden = !open; mb.setAttribute('aria-expanded', String(open));
        document.body.classList.toggle('no-scroll', open);
      };
      mb.addEventListener('click', () => setDrawer(true));
      $('#drawerX').addEventListener('click', () => setDrawer(false));
      bg.addEventListener('click', () => setDrawer(false));
      dr.addEventListener('click', (e) => { if (e.target.closest('a')) setDrawer(false); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setDrawer(false); });
      window.matchMedia('(min-width: 861px)').addEventListener('change', (m) => { if (m.matches) setDrawer(false); });
    }
    if (bottom) {
      bottom.innerHTML = `
      <footer class="site-footer on-dark"><div class="wrap">
        <div class="footer-grid">
          <div><a class="brand" href="/">${STAR('#FAFAF7', '#D8B35A')}<span class="store-name">Janissary Wear</span></a><p class="footer-tagline"></p></div>
          <div><h4>Shop</h4><ul id="footShop"></ul></div>
          <div><h4>Contact</h4><ul class="footer-contact"></ul></div>
        </div>
        <div class="footer-bottom">© <span class="year"></span> <span class="store-name">Janissary Wear</span>. All rights reserved.</div>
      </div></footer>`;
      $('.year', bottom).textContent = new Date().getFullYear();
    }
    if (!$('#waFloat')) {
      const w = document.createElement('a');
      w.id = 'waFloat'; w.className = 'wa-float'; w.hidden = true;
      w.target = '_blank'; w.rel = 'noopener'; w.setAttribute('aria-label', 'Chat on WhatsApp');
      w.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16.04 3C8.84 3 3 8.8 3 15.95c0 2.29.6 4.52 1.74 6.48L3 29l6.76-1.7a13.1 13.1 0 0 0 6.28 1.6C23.2 28.9 29 23.1 29 15.95S23.2 3 16.04 3zm0 23.7c-1.95 0-3.86-.52-5.52-1.5l-.4-.23-4.01 1 1.07-3.9-.26-.4a10.6 10.6 0 0 1-1.63-5.7c0-5.86 4.8-10.6 10.75-10.6 5.9 0 10.7 4.74 10.7 10.6s-4.8 10.73-10.7 10.73zm5.9-7.9c-.32-.16-1.9-.93-2.2-1.04-.3-.1-.5-.16-.73.16-.2.32-.84 1.04-1.03 1.25-.19.22-.38.24-.7.08-.32-.16-1.36-.5-2.6-1.6-.95-.85-1.6-1.9-1.8-2.2-.18-.33-.02-.5.14-.66.15-.14.33-.38.5-.57.16-.19.2-.33.32-.55.1-.2.05-.4-.03-.56-.08-.16-.73-1.74-1-2.4-.26-.62-.53-.54-.73-.55h-.62c-.22 0-.57.08-.87.4-.3.33-1.14 1.1-1.14 2.7 0 1.58 1.17 3.13 1.33 3.35.16.2 2.3 3.5 5.57 4.9.78.33 1.38.53 1.86.68.78.25 1.5.2 2.06.12.63-.1 1.9-.78 2.17-1.53.27-.75.27-1.4.2-1.53-.08-.14-.3-.22-.62-.38z"/></svg>';
      document.body.appendChild(w);
    }
    updateCartCount();
    drawNav();                       // instant, from the cached list if there is one
    loadCats().then(drawNav).catch(() => {});

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
      const df = $('#drawerFoot');
      if (df) df.innerHTML = [s.phone && `<a href="tel:${esc(s.phone)}">Call ${esc(s.phone)}</a>`, s.whatsapp && `<a href="https://wa.me/${esc(s.whatsapp)}" target="_blank" rel="noopener">WhatsApp us</a>`].filter(Boolean).join('');
      const wf = $('#waFloat');
      if (wf && s.whatsapp) {
        if (!wf.dataset.custom) wf.href = 'https://wa.me/' + s.whatsapp + '?text=' + encodeURIComponent('Hello, I have a question about Janissary Wear.');
        wf.hidden = false;
      }
      document.dispatchEvent(new CustomEvent('jw:settings', { detail: s }));
    });
  }

  window.JW = { $, $$, esc, money, STAR, api, cart, toast, unitPrice, onSale, hasVariants, variantOf, stockOf, priceOf, imageOf, productUrl, imgTag, productCard, carousel, catTile, loadSettings, renderChrome, updateCartCount,
    loadCats, tops, kidsOf, bySlug, topOf, catPath, catUrl, setActive };
})();
