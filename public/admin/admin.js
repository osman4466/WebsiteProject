/* Janissary Wear - admin panel logic */
(function () {
  const { $, $$, esc, money, api, toast, STAR } = JW;
  const KEY = 'jw_admin_token';
  let token = '';
  try { token = localStorage.getItem(KEY) || ''; } catch {}
  const S = { cats: [], products: [], orders: [], settings: {} };
  const view = $('#view');
  const dlg = $('#dlg');

  // authenticated API call; a 401 sends the admin back to the login screen
  const A = (path, opts = {}) =>
    api(path, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } })
      .catch((e) => { if (/Unauthorized/i.test(e.message)) logout('Your session ended. Please log in again.'); throw e; });

  const fmtDate = (t) => new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const catName = (slug) => (S.cats.find((c) => c.slug === slug) || {}).name || slug;
  const waNumber = (p) => { let n = String(p || '').replace(/\D/g, ''); if (n.startsWith('0')) n = '88' + n; return n; };

  // ---------- login / logout ----------
  $('#loginStar').innerHTML = STAR('#B4232C', '#D8B35A');

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn'); const err = $('#loginErr');
    err.textContent = ''; btn.disabled = true; btn.textContent = 'Logging in...';
    try {
      const r = await api('login', { method: 'POST', body: { email: $('#email').value, password: $('#password').value } });
      token = r.token;
      try { localStorage.setItem(KEY, token); } catch {}
      $('#password').value = '';
      await boot();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Log in';
    }
  });

  function logout(msg) {
    token = '';
    try { localStorage.removeItem(KEY); } catch {}
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#loginErr').textContent = typeof msg === 'string' ? msg : '';
  }
  $('#logout').addEventListener('click', () => logout());

  // ---------- data ----------
  async function loadAll() {
    const [products, cats, orders, settings] = await Promise.all([A('products'), A('categories'), A('orders'), api('settings')]);
    Object.assign(S, { products, cats, orders, settings });
    updateChrome();
  }

  function updateChrome() {
    $$('.store-name').forEach((el) => (el.textContent = S.settings.storeName || 'Janissary Wear'));
    const n = S.orders.filter((o) => o.status === 'pending').length;
    const pill = $('#pendingPill'); pill.textContent = n; pill.hidden = !n;
  }

  async function boot() {
    if (!token) return logout();
    try { await loadAll(); } catch (e) { if (token) logout(e.message); return; }
    $('#login').hidden = true;
    $('#app').hidden = false;
    route();
  }

  // ---------- images ----------
  function compress(file, max = 1100) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return reject(new Error('Please use JPG, PNG or WEBP images'));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        let q = 0.84, out = c.toDataURL('image/jpeg', q);
        while (out.length > 650 * 1024 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image')); };
      img.src = url;
    });
  }
  async function uploadFile(file) {
    const dataUrl = await compress(file);
    const r = await A('image', { method: 'POST', body: { dataUrl } });
    return r.url;
  }
  function dropImages(urls) {
    urls.filter((u) => u && u.startsWith('/api/image?id=')).forEach((u) => {
      A('image?id=' + encodeURIComponent(u.split('id=')[1]), { method: 'DELETE' }).catch(() => {});
    });
  }

  // ---------- router ----------
  const VIEWS = { overview, products, categories, orders, settings };
  function route() {
    const v = (location.hash || '#overview').slice(1);
    const name = VIEWS[v] ? v : 'overview';
    $$('#sideNav a').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
    VIEWS[name]();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => { if (token) route(); });

  // one click handler for every button inside the views
  const actions = {};
  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && actions[b.dataset.act]) actions[b.dataset.act](b.dataset.id, b);
  });

  // ---------- overview ----------
  function overview() {
    const live = S.orders.filter((o) => o.status !== 'cancelled');
    const revenue = live.reduce((n, o) => n + o.total, 0);
    const pending = S.orders.filter((o) => o.status === 'pending').length;
    const low = S.products.filter((p) => p.active !== false && p.stock <= 3);
    view.innerHTML = `
      <div class="view-head"><div><h1>Overview</h1><p>How the store is doing right now.</p></div></div>
      <div class="stats">
        <div class="stat"><b>${S.products.length}</b><span>Products</span></div>
        <div class="stat"><b>${S.cats.length}</b><span>Categories</span></div>
        <div class="stat"><b>${pending}</b><span>Orders waiting for confirmation</span></div>
        <div class="stat"><b>${money(revenue)}</b><span>Order value, excluding cancelled</span></div>
      </div>
      <div class="two">
        <div class="card"><h2>Latest orders</h2>
          ${S.orders.length ? `<table class="t" style="min-width:0"><tbody>${S.orders.slice(0, 6).map((o) => `
            <tr><td><b>${esc(o.number)}</b><div class="muted">${esc(o.customer.name)}</div></td><td class="num">${money(o.total)}</td><td class="num"><span class="badge ${o.status}">${o.status}</span></td></tr>`).join('')}</tbody></table>
            <p style="margin-top:.9rem"><a class="link-more" href="#orders">All orders</a></p>`
            : '<p class="muted">No orders yet. They will show up here when customers check out.</p>'}
        </div>
        <div class="card"><h2>Running low</h2>
          ${low.length ? `<table class="t" style="min-width:0"><tbody>${low.map((p) => `
            <tr><td><b>${esc(p.name)}</b></td><td class="num"><span class="badge ${p.stock <= 0 ? 'off' : 'pending'}">${p.stock <= 0 ? 'Sold out' : p.stock + ' left'}</span></td></tr>`).join('')}</tbody></table>`
            : '<p class="muted">Every visible product has more than 3 in stock.</p>'}
        </div>
      </div>
      ${!S.products.length ? `<div class="card"><h2>Add your first product</h2><p class="muted" style="margin-bottom:1rem">Your store is live but empty. Add products so customers can start ordering.</p><a class="btn btn-primary" href="#products">Go to products</a></div>` : ''}`;
  }

  // ---------- products ----------
  function products() {
    view.innerHTML = `
      <div class="view-head"><div><h1>Products</h1><p>${S.products.length} in your store</p></div>
        <button class="btn btn-primary" data-act="newProduct">Add product</button></div>
      ${S.products.length ? `<div class="table-wrap"><table class="t">
        <thead><tr><th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Stock</th><th>Status</th><th></th></tr></thead>
        <tbody>${S.products.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map((p) => `
          <tr>
            <td><div class="t-name"><div class="t-thumb">${p.images[0] ? `<img src="${esc(p.images[0])}" alt="">` : ''}</div><div>${esc(p.name)}${p.featured ? ' <span class="badge">Featured</span>' : ''}</div></div></td>
            <td>${esc(catName(p.category))}</td>
            <td class="num">${JW.onSale(p) ? `<b>${money(p.salePrice)}</b> <s class="muted">${money(p.price)}</s>` : money(p.price)}</td>
            <td class="num">${p.stock <= 0 ? '<span class="badge off">Sold out</span>' : p.stock}</td>
            <td><span class="badge ${p.active !== false ? 'ok' : 'off'}">${p.active !== false ? 'Visible' : 'Hidden'}</span></td>
            <td><div class="t-actions"><button class="btn btn-ghost btn-sm" data-act="editProduct" data-id="${esc(p.id)}">Edit</button><button class="btn btn-danger btn-sm" data-act="delProduct" data-id="${esc(p.id)}">Delete</button></div></td>
          </tr>`).join('')}</tbody></table></div>`
        : `<div class="empty"><h3>No products yet</h3><p>Add your first product with photos, price and sizes.</p><button class="btn btn-primary" data-act="newProduct">Add product</button></div>`}`;
  }

  actions.newProduct = () => openProduct();
  actions.editProduct = (id) => openProduct(id);
  actions.delProduct = async (id) => {
    const p = S.products.find((x) => x.id === id);
    if (!p || !confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    try {
      await A('products?id=' + encodeURIComponent(id), { method: 'DELETE' });
      dropImages(p.images);
      S.products = S.products.filter((x) => x.id !== id);
      toast('Product deleted'); products();
    } catch (e) { toast(e.message, true); }
  };

  function openProduct(id) {
    if (!S.cats.length) { toast('Create a category first', true); location.hash = '#categories'; return; }
    const p = id ? S.products.find((x) => x.id === id) : null;
    const d = p || { name: '', description: '', price: '', salePrice: '', category: S.cats[0].slug, images: [], sizes: [], colors: [], stock: 10, featured: false, active: true };
    let imgs = [...d.images]; const original = [...d.images]; const uploaded = []; let saved = false; let busy = 0;

    dlg.innerHTML = `
      <div class="dlg-head"><h2>${p ? 'Edit product' : 'Add product'}</h2><button class="dlg-x" type="button" data-close aria-label="Close">&times;</button></div>
      <form id="pf" novalidate style="display:contents">
        <div class="dlg-body">
          <div class="field"><label for="f-name">Product name</label><input class="input" id="f-name" value="${esc(d.name)}" maxlength="120" required></div>
          <div class="row2">
            <div class="field"><label for="f-cat">Category</label><select class="select" id="f-cat">${S.cats.map((c) => `<option value="${esc(c.slug)}"${c.slug === d.category ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
            <div class="field"><label for="f-stock">Stock (pieces)</label><input class="input" id="f-stock" type="number" min="0" step="1" value="${esc(d.stock)}"></div>
          </div>
          <div class="row2">
            <div class="field"><label for="f-price">Price (৳)</label><input class="input" id="f-price" type="number" min="0" step="1" value="${esc(d.price)}" required></div>
            <div class="field"><label for="f-sale">Sale price (৳)</label><input class="input" id="f-sale" type="number" min="0" step="1" value="${d.salePrice ? esc(d.salePrice) : ''}" placeholder="Leave empty for no sale"></div>
          </div>
          <div class="row2">
            <div class="field"><label for="f-sizes">Sizes</label><input class="input" id="f-sizes" value="${esc((d.sizes || []).join(', '))}" placeholder="S, M, L, XL"><div class="hint">Separate with commas. Leave empty if it has no sizes.</div></div>
            <div class="field"><label for="f-colors">Colors</label><input class="input" id="f-colors" value="${esc((d.colors || []).join(', '))}" placeholder="Black, Navy"><div class="hint">Separate with commas. Optional.</div></div>
          </div>
          <div class="field"><label for="f-desc">Description</label><textarea class="textarea" id="f-desc" rows="4" maxlength="3000">${esc(d.description)}</textarea></div>

          <div class="field"><span class="lbl">Photos</span>
            <div class="img-grid" id="imgGrid"></div>
            <div class="upload-row">
              <label class="btn btn-ghost btn-sm" for="f-file" style="cursor:pointer">Upload photos</label>
              <input id="f-file" type="file" accept="image/jpeg,image/png,image/webp" multiple>
              <input class="input" id="f-url" placeholder="or paste an image link" style="flex:1;min-width:180px">
              <button class="btn btn-dark btn-sm" type="button" id="f-urlAdd">Add link</button>
            </div>
            <div class="hint">The first photo is the cover. Photos are resized automatically. Up to 8.</div>
          </div>

          <div class="checks">
            <label class="check"><input type="checkbox" id="f-active"${d.active !== false ? ' checked' : ''}> Visible in the store</label>
            <label class="check"><input type="checkbox" id="f-featured"${d.featured ? ' checked' : ''}> Featured</label>
          </div>
        </div>
        <div class="dlg-foot"><div class="form-error" id="pf-err" role="alert"></div>
          <button class="btn btn-ghost" type="button" data-close>Cancel</button>
          <button class="btn btn-primary" type="submit" id="pf-save">${p ? 'Save changes' : 'Add product'}</button></div>
      </form>`;

    const grid = $('#imgGrid', dlg);
    function drawImgs() {
      grid.innerHTML = imgs.map((u, i) => `
        <div class="img-item${i === 0 ? ' cover' : ''}"><img src="${esc(u)}" alt="">
          <button type="button" class="rm" data-rm="${i}" aria-label="Remove photo">&times;</button>
          ${i === 0 ? '<button type="button" class="mk" disabled>Cover</button>' : `<button type="button" class="mk" data-cover="${i}">Make cover</button>`}
        </div>`).join('') + (busy ? `<div class="img-item busy">Uploading ${busy}...</div>` : '');
    }
    drawImgs();

    grid.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]'); const cv = e.target.closest('[data-cover]');
      if (rm) { imgs.splice(+rm.dataset.rm, 1); drawImgs(); }
      if (cv) { const [x] = imgs.splice(+cv.dataset.cover, 1); imgs.unshift(x); drawImgs(); }
    });

    $('#f-file', dlg).addEventListener('change', async (e) => {
      const files = [...e.target.files]; e.target.value = '';
      const err = $('#pf-err', dlg); err.textContent = '';
      for (const f of files) {
        if (imgs.length + busy >= 8) { err.textContent = 'You can add up to 8 photos.'; break; }
        busy++; drawImgs();
        try { const u = await uploadFile(f); uploaded.push(u); imgs.push(u); }
        catch (ex) { err.textContent = ex.message; }
        busy--; drawImgs();
      }
    });
    $('#f-urlAdd', dlg).addEventListener('click', () => {
      const v = $('#f-url', dlg).value.trim();
      if (!/^(https?:\/\/|\/)/.test(v)) { $('#pf-err', dlg).textContent = 'Please paste a full image link starting with https://'; return; }
      if (imgs.length >= 8) { $('#pf-err', dlg).textContent = 'You can add up to 8 photos.'; return; }
      imgs.push(v); $('#f-url', dlg).value = ''; $('#pf-err', dlg).textContent = ''; drawImgs();
    });

    $('#pf', dlg).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#pf-err', dlg); err.textContent = '';
      const body = {
        name: $('#f-name', dlg).value.trim(),
        category: $('#f-cat', dlg).value,
        price: Number($('#f-price', dlg).value),
        salePrice: Number($('#f-sale', dlg).value) || 0,
        stock: Math.max(0, Math.floor(Number($('#f-stock', dlg).value) || 0)),
        sizes: $('#f-sizes', dlg).value,
        colors: $('#f-colors', dlg).value,
        description: $('#f-desc', dlg).value.trim(),
        images: imgs,
        featured: $('#f-featured', dlg).checked,
        active: $('#f-active', dlg).checked,
      };
      if (!body.name) return (err.textContent = 'Please enter a product name.');
      if (!(body.price > 0)) return (err.textContent = 'Please enter a price.');
      if (body.salePrice && body.salePrice >= body.price) return (err.textContent = 'The sale price must be lower than the price.');
      if (busy) return (err.textContent = 'Please wait until the photos finish uploading.');

      const btn = $('#pf-save', dlg); btn.disabled = true; btn.textContent = 'Saving...';
      try {
        if (p) await A('products?id=' + encodeURIComponent(p.id), { method: 'PUT', body });
        else await A('products', { method: 'POST', body });
        saved = true;
        dropImages([...original, ...uploaded].filter((u) => !imgs.includes(u)));
        S.products = await A('products');
        dlg.close();
        toast(p ? 'Product updated' : 'Product added');
        if ((location.hash || '#overview') === '#products') products(); else route();
      } catch (ex) {
        err.textContent = ex.message; btn.disabled = false; btn.textContent = p ? 'Save changes' : 'Add product';
      }
    });

    dlg.onclose = () => { if (!saved) dropImages(uploaded); dlg.onclose = null; };
    dlg.showModal();
  }

  // close buttons inside any dialog
  dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) dlg.close(); });

  // ---------- categories ----------
  function categories() {
    view.innerHTML = `
      <div class="view-head"><div><h1>Categories</h1><p>Group your products so customers can find them.</p></div>
        <button class="btn btn-primary" data-act="newCat">Add category</button></div>
      ${S.cats.length ? `<div class="table-wrap"><table class="t">
        <thead><tr><th>Category</th><th>Description</th><th class="num">Products</th><th></th></tr></thead>
        <tbody>${S.cats.map((c) => {
          const n = S.products.filter((p) => p.category === c.slug).length;
          return `<tr>
            <td><div class="t-name"><div class="t-thumb">${c.image ? `<img src="${esc(c.image)}" alt="">` : ''}</div><div>${esc(c.name)}<div class="muted">/${esc(c.slug)}</div></div></div></td>
            <td class="muted">${esc(c.description) || '-'}</td>
            <td class="num">${n}</td>
            <td><div class="t-actions"><button class="btn btn-ghost btn-sm" data-act="editCat" data-id="${esc(c.id)}">Edit</button><button class="btn btn-danger btn-sm" data-act="delCat" data-id="${esc(c.id)}">Delete</button></div></td>
          </tr>`; }).join('')}</tbody></table></div>`
        : `<div class="empty"><h3>No categories yet</h3><p>Create a category like Hoodies or T-Shirts before adding products.</p><button class="btn btn-primary" data-act="newCat">Add category</button></div>`}`;
  }

  actions.newCat = () => openCat();
  actions.editCat = (id) => openCat(id);
  actions.delCat = async (id) => {
    const c = S.cats.find((x) => x.id === id);
    if (!c || !confirm(`Delete the category "${c.name}"?`)) return;
    try {
      await A('categories?id=' + encodeURIComponent(id), { method: 'DELETE' });
      dropImages([c.image]);
      S.cats = S.cats.filter((x) => x.id !== id);
      toast('Category deleted'); categories();
    } catch (e) { toast(e.message, true); }
  };

  function openCat(id) {
    const c = id ? S.cats.find((x) => x.id === id) : null;
    const d = c || { name: '', description: '', image: '' };
    let img = d.image; const original = d.image; const uploaded = []; let saved = false; let busy = false;

    dlg.innerHTML = `
      <div class="dlg-head"><h2>${c ? 'Edit category' : 'Add category'}</h2><button class="dlg-x" type="button" data-close aria-label="Close">&times;</button></div>
      <form id="cf" novalidate style="display:contents">
        <div class="dlg-body">
          <div class="field"><label for="c-name">Category name</label><input class="input" id="c-name" value="${esc(d.name)}" maxlength="60" required>${c ? '<div class="hint">The web address of the category stays the same when you rename it.</div>' : ''}</div>
          <div class="field"><label for="c-desc">Short description</label><input class="input" id="c-desc" value="${esc(d.description)}" maxlength="300" placeholder="Shown on the categories page"></div>
          <div class="field"><span class="lbl">Cover photo</span>
            <div class="img-grid" id="cImg"></div>
            <div class="upload-row"><label class="btn btn-ghost btn-sm" for="c-file" style="cursor:pointer">Upload photo</label><input id="c-file" type="file" accept="image/jpeg,image/png,image/webp"></div>
            <div class="hint">Optional. A tall (3:4) photo looks best.</div>
          </div>
        </div>
        <div class="dlg-foot"><div class="form-error" id="cf-err" role="alert"></div>
          <button class="btn btn-ghost" type="button" data-close>Cancel</button>
          <button class="btn btn-primary" type="submit" id="cf-save">${c ? 'Save changes' : 'Add category'}</button></div>
      </form>`;

    const box = $('#cImg', dlg);
    function draw() {
      box.innerHTML = busy ? '<div class="img-item busy">Uploading...</div>'
        : img ? `<div class="img-item cover"><img src="${esc(img)}" alt=""><button type="button" class="rm" aria-label="Remove photo">&times;</button></div>` : '';
    }
    draw();
    box.addEventListener('click', (e) => { if (e.target.closest('.rm')) { img = ''; draw(); } });
    $('#c-file', dlg).addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      busy = true; draw(); $('#cf-err', dlg).textContent = '';
      try { const u = await uploadFile(f); uploaded.push(u); img = u; } catch (ex) { $('#cf-err', dlg).textContent = ex.message; }
      busy = false; draw();
    });

    $('#cf', dlg).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#cf-err', dlg); err.textContent = '';
      const body = { name: $('#c-name', dlg).value.trim(), description: $('#c-desc', dlg).value.trim(), image: img };
      if (!body.name) return (err.textContent = 'Please enter a category name.');
      if (busy) return (err.textContent = 'Please wait until the photo finishes uploading.');
      const btn = $('#cf-save', dlg); btn.disabled = true; btn.textContent = 'Saving...';
      try {
        if (c) await A('categories?id=' + encodeURIComponent(c.id), { method: 'PUT', body });
        else await A('categories', { method: 'POST', body });
        saved = true;
        dropImages([original, ...uploaded].filter((u) => u && u !== img));
        S.cats = await A('categories');
        dlg.close(); toast(c ? 'Category updated' : 'Category added');
        if ((location.hash || '#overview') === '#categories') categories(); else route();
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = c ? 'Save changes' : 'Add category'; }
    });

    dlg.onclose = () => { if (!saved) dropImages(uploaded); dlg.onclose = null; };
    dlg.showModal();
  }

  // ---------- orders ----------
  let orderFilter = 'all';
  const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

  function orders() {
    const list = S.orders.filter((o) => orderFilter === 'all' || o.status === orderFilter);
    view.innerHTML = `
      <div class="view-head"><div><h1>Orders</h1><p>${S.orders.length} total</p></div>
        <div><label class="sr-only" for="of">Filter by status</label>
        <select class="select" id="of"><option value="all">All orders</option>${STATUSES.map((s) => `<option value="${s}"${s === orderFilter ? ' selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></div></div>
      ${list.length ? list.map((o) => `
        <details class="order">
          <summary><b>${esc(o.number)}</b><span>${esc(o.customer.name)} <span class="muted">${fmtDate(o.createdAt)}</span></span><b>${money(o.total)}</b><span class="badge ${o.status}">${o.status}</span></summary>
          <div class="order-body">
            <div class="order-items">
              ${o.items.map((i) => `<div><span>${esc(i.name)}${i.size ? ' / ' + esc(i.size) : ''}${i.color ? ' / ' + esc(i.color) : ''} x ${i.qty}</span><span>${money(i.price * i.qty)}</span></div>`).join('')}
              <div><span>Delivery (${o.customer.area === 'outside' ? 'outside Dhaka' : 'inside Dhaka'})</span><span>${money(o.shipping)}</span></div>
              <div><b>Total, cash on delivery</b><b>${money(o.total)}</b></div>
            </div>
            <div>
              <p><b>${esc(o.customer.name)}</b></p>
              <p><a href="tel:${esc(o.customer.phone)}" style="text-decoration:underline">${esc(o.customer.phone)}</a> &nbsp; <a href="https://wa.me/${waNumber(o.customer.phone)}" target="_blank" rel="noopener" style="text-decoration:underline">WhatsApp</a></p>
              <p style="margin-top:.5rem;white-space:pre-line">${esc(o.customer.address)}</p>
              ${o.customer.note ? `<p class="muted" style="margin-top:.5rem">Note: ${esc(o.customer.note)}</p>` : ''}
              <div class="order-actions">
                <label class="sr-only" for="st-${esc(o.id)}">Status</label>
                <select class="select" id="st-${esc(o.id)}" data-status="${esc(o.id)}">${STATUSES.map((s) => `<option value="${s}"${s === o.status ? ' selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select>
                <button class="btn btn-danger btn-sm" data-act="delOrder" data-id="${esc(o.id)}">Delete</button>
              </div>
            </div>
          </div>
        </details>`).join('')
        : `<div class="empty"><h3>${S.orders.length ? 'No orders with this status' : 'No orders yet'}</h3><p>${S.orders.length ? 'Choose another filter.' : 'Orders appear here as soon as a customer checks out.'}</p></div>`}`;

    const f = $('#of'); if (f) f.onchange = () => { orderFilter = f.value; orders(); };
  }

  view.addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-status]'); if (!sel) return;
    const o = S.orders.find((x) => x.id === sel.dataset.status); if (!o) return;
    const prev = o.status;
    try {
      const r = await A('orders?id=' + encodeURIComponent(o.id), { method: 'PUT', body: { status: sel.value } });
      o.status = r.status;
      if ((prev === 'cancelled') !== (r.status === 'cancelled')) S.products = await A('products'); // stock changed
      updateChrome(); toast('Order marked ' + r.status);
      const sum = sel.closest('.order').querySelector('summary .badge'); sum.className = 'badge ' + r.status; sum.textContent = r.status;
    } catch (ex) { sel.value = prev; toast(ex.message, true); }
  });

  actions.delOrder = async (id) => {
    const o = S.orders.find((x) => x.id === id);
    if (!o || !confirm(`Delete order ${o.number}? This cannot be undone.`)) return;
    try {
      await A('orders?id=' + encodeURIComponent(id), { method: 'DELETE' });
      S.orders = S.orders.filter((x) => x.id !== id);
      updateChrome(); toast('Order deleted'); orders();
    } catch (e) { toast(e.message, true); }
  };

  // ---------- settings ----------
  function settings() {
    const s = S.settings;
    const f = (id, label, val, extra = '') => `<div class="field"><label for="s-${id}">${label}</label><input class="input" id="s-${id}" value="${esc(val)}" ${extra}></div>`;
    view.innerHTML = `
      <div class="view-head"><div><h1>Store settings</h1><p>Contact details, delivery charges and the top banner.</p></div></div>
      <form class="card" id="sf" novalidate style="max-width:760px">
        <h2>Store</h2>
        <div class="row2">${f('storeName', 'Store name', s.storeName)}${f('tagline', 'Tagline', s.tagline)}</div>
        ${f('announcement', 'Top banner message', s.announcement, 'placeholder="Leave empty to hide the banner"')}
        <h2 style="margin-top:1.4rem">Contact</h2>
        <div class="row2">${f('phone', 'Phone number', s.phone, 'placeholder="01XXXXXXXXX"')}${f('whatsapp', 'WhatsApp number', s.whatsapp, 'placeholder="8801XXXXXXXXX"')}</div>
        <div class="hint" style="margin:-.6rem 0 1rem">Use the full international number for WhatsApp, for example 8801712345678. The Ask on WhatsApp button appears on products when this is filled.</div>
        <div class="row2">${f('email', 'Email', s.email)}${f('address', 'Address', s.address)}</div>
        <div class="row2">${f('facebook', 'Facebook page link', s.facebook, 'placeholder="https://facebook.com/..."')}${f('instagram', 'Instagram link', s.instagram, 'placeholder="https://instagram.com/..."')}</div>
        <h2 style="margin-top:1.4rem">Delivery charges (৳)</h2>
        <div class="row3">
          ${f('shippingInside', 'Inside Dhaka', s.shippingInside, 'type="number" min="0"')}
          ${f('shippingOutside', 'Outside Dhaka', s.shippingOutside, 'type="number" min="0"')}
          ${f('freeShippingOver', 'Free delivery over', s.freeShippingOver, 'type="number" min="0"')}
        </div>
        <div class="hint" style="margin:-.6rem 0 1rem">Set "Free delivery over" to 0 to charge delivery on every order.</div>
        <button class="btn btn-primary" id="s-save" type="submit">Save settings</button>
        <div class="form-error" id="s-err" role="alert"></div>
      </form>`;

    $('#sf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const g = (id) => $('#s-' + id).value;
      const body = {
        storeName: g('storeName'), tagline: g('tagline'), announcement: g('announcement'),
        phone: g('phone'), whatsapp: g('whatsapp'), email: g('email'), address: g('address'),
        facebook: g('facebook'), instagram: g('instagram'),
        shippingInside: Number(g('shippingInside')) || 0, shippingOutside: Number(g('shippingOutside')) || 0, freeShippingOver: Number(g('freeShippingOver')) || 0,
      };
      const btn = $('#s-save'); btn.disabled = true; btn.textContent = 'Saving...'; $('#s-err').textContent = '';
      try { S.settings = await A('settings', { method: 'PUT', body }); updateChrome(); toast('Settings saved'); }
      catch (ex) { $('#s-err').textContent = ex.message; }
      btn.disabled = false; btn.textContent = 'Save settings';
    });
  }

  boot();
})();
