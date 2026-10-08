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
  const catName = (slug) => JW.catPath(slug, S.cats) || slug;
  const mainCats = () => S.cats.filter((c) => !c.parent);
  const subCats = (slug) => S.cats.filter((c) => c.parent === slug);
  const ownCount = (slug) => S.products.filter((p) => p.category === slug).length;
  const totalCount = (slug) => ownCount(slug) + subCats(slug).reduce((n, c) => n + ownCount(c.slug), 0);

  // <option> list for choosing a category: sub-categories grouped under their main category
  function catOptions(selected) {
    const opt = (c, label) => `<option value="${esc(c.slug)}"${c.slug === selected ? ' selected' : ''}>${esc(label)}</option>`;
    return mainCats().map((t) => {
      const kids = subCats(t.slug);
      if (!kids.length) return opt(t, t.name);
      return `<optgroup label="${esc(t.name)}">${kids.map((k) => opt(k, k.name)).join('')}${opt(t, t.name + ' (general)')}</optgroup>`;
    }).join('');
  }
  const waNumber = (p) => { let n = String(p || '').replace(/\D/g, ''); if (n.startsWith('0')) n = '88' + n; return n; };

  // ---------- login / logout ----------
  $('#loginStar').innerHTML = STAR('#0A0A0A', '#D8B35A');

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
    // ---------- media library data ----------
  const M = { items: [] };
  async function loadMedia() { const r = await A('media'); M.items = r.items; }
  const usedBy = (url) => S.products.filter((p) => (p.images || []).includes(url)).length + S.cats.filter((c) => c.image === url).length;
  const fmtSize = (b) => (!b ? '' : b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');

  // upload a photo and also save it in the Media library
  async function uploadFile(file) {
    const dataUrl = await compress(file);
    const r = await A('image', { method: 'POST', body: { dataUrl } });
    const rec = await A('media', { method: 'POST', body: { url: r.url, name: file.name, bytes: Math.round(dataUrl.length * 0.75) } });
    M.items = [rec, ...M.items.filter((m) => m.id !== rec.id)];
    return r.url;
  }
  // photos now stay in the Media library, so nothing is deleted automatically
  function dropImages() {}
  // ---------- router ----------
    const VIEWS = { overview, products, media, categories, orders, settings };
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

  // ---------- products ----------  // ---------- products ----------
  // view state: search, filters and sort (kept while you move around the admin)
  const PV = { q: '', cat: '', status: '', sort: 'order', dir: 'asc' };
  const slugsIn = (slug) => [slug, ...subCats(slug).map((c) => c.slug)];
  const orderCmp = (a, b) => {
    const ao = Number.isFinite(a.order), bo = Number.isFinite(b.order);
    if (ao && bo && a.order !== b.order) return a.order - b.order;
    if (ao !== bo) return ao ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  };
  const SORTS = {
    order: orderCmp,
    name: (a, b) => a.name.localeCompare(b.name),
    category: (a, b) => catName(a.category).localeCompare(catName(b.category)) || a.name.localeCompare(b.name),
    price: (a, b) => JW.unitPrice(a) - JW.unitPrice(b),
    stock: (a, b) => a.stock - b.stock,
    date: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
  };

  function filteredProducts() {
    const t = PV.q.trim().toLowerCase();
    const slugs = PV.cat ? slugsIn(PV.cat) : null;
    let list = S.products.filter((p) =>
      (!slugs || slugs.includes(p.category)) &&
      (!t || p.name.toLowerCase().includes(t)) &&
      (!PV.status ||
        (PV.status === 'visible' && p.active !== false) ||
        (PV.status === 'hidden' && p.active === false) ||
        (PV.status === 'soldout' && p.stock <= 0) ||
        (PV.status === 'featured' && p.featured)));
    list = list.slice().sort(SORTS[PV.sort] || orderCmp);
    if (PV.sort !== 'order' && PV.dir === 'desc') list.reverse();
    return list;
  }

  function products() {
    const sortable = (key, label, cls = '') => {
      const on = PV.sort === key;
      return `<th class="${cls}"><button type="button" class="th-sort${on ? ' on' : ''}" data-act="sortBy" data-id="${key}">${label}<span class="arrow">${on ? (PV.dir === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>`;
    };
    view.innerHTML = `
      <div class="view-head"><div><h1>Products</h1><p id="pcount"></p></div>
        <button class="btn btn-primary" data-act="newProduct">Add product</button></div>
      ${S.products.length ? `
      <div class="p-tools">
        <input class="input" id="pv-q" type="search" placeholder="Search products" value="${esc(PV.q)}" aria-label="Search products">
        <select class="select" id="pv-cat" aria-label="Filter by category"><option value="">All categories</option>${mainCats().map((t) => {
          const kids = subCats(t.slug);
          return `<option value="${esc(t.slug)}"${PV.cat === t.slug ? ' selected' : ''}>${esc(t.name)}${kids.length ? ' (all)' : ''}</option>` +
            kids.map((k) => `<option value="${esc(k.slug)}"${PV.cat === k.slug ? ' selected' : ''}>&nbsp;&nbsp;&nbsp;${esc(k.name)}</option>`).join('');
        }).join('')}</select>
        <select class="select" id="pv-status" aria-label="Filter by status">
          ${[['', 'All statuses'], ['visible', 'Visible'], ['hidden', 'Hidden'], ['soldout', 'Sold out'], ['featured', 'Featured']].map(([v, l]) => `<option value="${v}"${PV.status === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <select class="select" id="pv-sort" aria-label="Sort products">
          ${[['order', 'Custom order (drag to arrange)'], ['date', 'Date added'], ['name', 'Name'], ['price', 'Price'], ['stock', 'Stock'], ['category', 'Category']].map(([v, l]) => `<option value="${v}"${PV.sort === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" type="button" data-act="resetFilters">Reset</button>
      </div>
      <div class="p-note" id="pnote"></div>
      <div class="table-wrap"><table class="t">
        <thead><tr><th class="grip-col"></th>${sortable('name', 'Product')}${sortable('category', 'Category')}${sortable('price', 'Price', 'num')}${sortable('stock', 'Stock', 'num')}<th>Status</th>${sortable('date', 'Added')}<th></th></tr></thead>
        <tbody id="pbody"></tbody></table></div>`
        : `<div class="empty"><h3>No products yet</h3><p>Add your first product with photos, price and sizes.</p><button class="btn btn-primary" data-act="newProduct">Add product</button></div>`}`;
    if (S.products.length) {
      $('#pv-q').addEventListener('input', (e) => { PV.q = e.target.value; drawRows(); });
      $('#pv-cat').addEventListener('change', (e) => { PV.cat = e.target.value; drawRows(); });
      $('#pv-status').addEventListener('change', (e) => { PV.status = e.target.value; drawRows(); });
      $('#pv-sort').addEventListener('change', (e) => { PV.sort = e.target.value; PV.dir = PV.sort === 'date' ? 'desc' : 'asc'; products(); });
      drawRows();
    }
  }

  // can the owner drag rows right now? Only in custom order, with nothing filtered out
  const canDrag = () => PV.sort === 'order' && !PV.q.trim() && !PV.cat && !PV.status;

  function drawRows() {
    const list = filteredProducts();
    const drag = canDrag();
    $('#pcount').textContent = list.length === S.products.length ? `${S.products.length} in your store` : `Showing ${list.length} of ${S.products.length}`;
    $('#pnote').textContent = PV.sort === 'order'
      ? (drag ? 'Drag the ⋮⋮ handle (or use the arrows) to arrange products. This is the order customers see in the store.' : 'To rearrange products, clear the search and filters first.')
      : 'Click a column title to sort. Choose "Custom order" to arrange products by hand.';
    $('#pbody').innerHTML = list.length ? list.map((p, i) => `
      <tr data-id="${esc(p.id)}"${drag ? ' draggable="true"' : ''}>
        <td class="grip-col">${drag ? `<span class="grip" title="Drag to move">⋮⋮</span><span class="mv"><button type="button" data-act="moveUp" data-id="${esc(p.id)}" aria-label="Move up"${i === 0 ? ' disabled' : ''}>▲</button><button type="button" data-act="moveDown" data-id="${esc(p.id)}" aria-label="Move down"${i === list.length - 1 ? ' disabled' : ''}>▼</button></span>` : ''}</td>
        <td><div class="t-name"><div class="t-thumb">${p.images[0] ? `<img src="${esc(p.images[0])}" alt="">` : ''}</div><div>${esc(p.name)}${p.featured ? ' <span class="badge">Featured</span>' : ''}</div></div></td>
        <td>${esc(catName(p.category))}</td>
        <td class="num">${JW.onSale(p) ? `<b>${money(p.salePrice)}</b> <s class="muted">${money(p.price)}</s>` : money(p.price)}</td>
        <td class="num">${p.stock <= 0 ? '<span class="badge off">Sold out</span>' : p.stock}</td>
        <td><span class="badge ${p.active !== false ? 'ok' : 'off'}">${p.active !== false ? 'Visible' : 'Hidden'}</span></td>
        <td class="muted">${p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</td>
        <td><div class="t-actions"><button class="btn btn-ghost btn-sm" data-act="editProduct" data-id="${esc(p.id)}">Edit</button><button class="btn btn-danger btn-sm" data-act="delProduct" data-id="${esc(p.id)}">Delete</button></div></td>
      </tr>`).join('') : `<tr><td colspan="8" class="muted" style="padding:1.6rem;text-align:center">No products match. Try another search or filter.</td></tr>`;
  }

  actions.sortBy = (key) => {
    if (PV.sort === key) PV.dir = PV.dir === 'asc' ? 'desc' : 'asc';
    else { PV.sort = key; PV.dir = key === 'date' ? 'desc' : 'asc'; }
    products();
  };
  actions.resetFilters = () => { Object.assign(PV, { q: '', cat: '', status: '', sort: 'order', dir: 'asc' }); products(); };

  // save a new arrangement: order numbers are updated locally, then sent to the server
  async function saveOrder(ids) {
    ids.forEach((id, i) => { const p = S.products.find((x) => x.id === id); if (p) p.order = i + 1; });
    try { await A('products?reorder=1', { method: 'PUT', body: JSON.stringify({ ids }) }); toast('Order saved'); }
    catch (e) { toast(e.message, true); S.products = await A('products').catch(() => S.products); }
    drawRows();
  }
  const move = (id, d) => {
    if (!canDrag()) return;
    const ids = filteredProducts().map((p) => p.id);
    const i = ids.indexOf(id), j = i + d;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    saveOrder(ids);
  };
  actions.moveUp = (id) => move(id, -1);
  actions.moveDown = (id) => move(id, 1);

  // drag and drop rows
  let dragId = null;
  view.addEventListener('dragstart', (e) => {
    const tr = e.target.closest && e.target.closest('#pbody tr[draggable]'); if (!tr) return;
    dragId = tr.dataset.id; tr.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragId); } catch (x) {}
  });
  view.addEventListener('dragover', (e) => {
    const tr = e.target.closest && e.target.closest('#pbody tr[draggable]'); if (!tr || !dragId) return;
    e.preventDefault();
    $$('#pbody tr').forEach((r) => r.classList.remove('drop-above', 'drop-below'));
    if (tr.dataset.id === dragId) return;
    const after = e.clientY > tr.getBoundingClientRect().top + tr.offsetHeight / 2;
    tr.classList.add(after ? 'drop-below' : 'drop-above');
  });
  view.addEventListener('drop', (e) => {
    const tr = e.target.closest && e.target.closest('#pbody tr[draggable]'); if (!tr || !dragId) return;
    e.preventDefault();
    const after = e.clientY > tr.getBoundingClientRect().top + tr.offsetHeight / 2;
    const ids = filteredProducts().map((p) => p.id).filter((id) => id !== dragId);
    let at = ids.indexOf(tr.dataset.id); if (after) at++;
    ids.splice(at, 0, dragId);
    dragId = null;
    saveOrder(ids);
  });
  view.addEventListener('dragend', () => { dragId = null; $$('#pbody tr').forEach((r) => r.classList.remove('dragging', 'drop-above', 'drop-below')); });

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
    const d = p || { name: '', description: '', price: '', salePrice: '', category: (S.cats.find((c) => c.parent) || S.cats[0]).slug, images: [], sizes: [], colors: [], stock: 10, featured: false, active: true };
    let imgs = [...d.images]; const original = [...d.images]; const uploaded = []; let saved = false; let busy = 0;

        const cimg = { ...(d.colorImages || {}) };
    const vstore = {};
    (d.variants || []).forEach((v) => { vstore[v.size + '|' + v.color] = { price: v.price || '', stock: v.stock }; });

    dlg.innerHTML = `
      <div class="dlg-head"><h2>${p ? 'Edit product' : 'Add product'}</h2><button class="dlg-x" type="button" data-close aria-label="Close">&times;</button></div>
      <form id="pf" novalidate style="display:contents">
        <div class="dlg-body">
          <div class="field"><label for="f-name">Product name</label><input class="input" id="f-name" value="${esc(d.name)}" maxlength="120" required></div>
          <div class="row2">
            <div class="field"><label for="f-cat">Category</label><select class="select" id="f-cat">${catOptions(d.category)}</select></div>
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

                    <div class="field" id="colorBox" hidden><span class="lbl">Photo for each color</span>
            <div id="colorRows"></div>
            <div class="hint">When a customer picks a color, the store shows that color's photo.</div></div>
          <div class="field" id="varBox" hidden>
            <label class="check"><input type="checkbox" id="f-usevar"${(d.variants || []).length ? ' checked' : ''}> Different price and stock for each size and color</label>
            <div id="varTable" style="margin-top:.6rem"></div>
            <div class="hint">Leave a price empty to use the product price. Total stock is counted automatically.</div></div>

          <div class="field"><label for="f-desc">Description</label><textarea class="textarea" id="f-desc" rows="4" maxlength="3000">${esc(d.description)}</textarea></div>

          <div class="field"><span class="lbl">Photos</span>
            <div class="img-grid" id="imgGrid"></div>
            <div class="upload-row">
              <button class="btn btn-dark btn-sm" type="button" id="f-pick">Choose from Media</button>
              <label class="btn btn-ghost btn-sm" for="f-file" style="cursor:pointer">Upload new</label>
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

    $('#f-pick', dlg).addEventListener('click', () => {
      const room = 8 - imgs.length;
      if (room <= 0) { $('#pf-err', dlg).textContent = 'You can add up to 8 photos.'; return; }
      openPicker({ multiple: true, max: room, onPick: (urls) => { urls.forEach((u) => { if (!imgs.includes(u) && imgs.length < 8) imgs.push(u); }); $('#pf-err', dlg).textContent = ''; drawImgs(); } });
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
                colorImages: Object.fromEntries(csv('#f-colors').filter((c) => cimg[c]).map((c) => [c, cimg[c]])),
        variants: useVars() ? combos().map((cb) => { const r = rowOf(cb); return { size: cb.size, color: cb.color, price: Number(r.price) || 0, stock: Math.max(0, Math.floor(Number(r.stock) || 0)) }; }) : [],
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

    // ---------- media (photo library) ----------
  async function media() {
    view.innerHTML = '<div class="view-head"><div><h1>Media</h1><p>Loading photos...</p></div></div>';
    try { await loadMedia(); } catch (e) { view.innerHTML = `<div class="empty"><h3>Could not load photos</h3><p>${esc(e.message)}</p></div>`; return; }
    drawMedia();
  }

  function mediaCards() {
    return M.items.map((m) => {
      const n = usedBy(m.url);
      return `<div class="m-card">
        <div class="m-img"><img loading="lazy" src="${esc(m.url)}" alt=""></div>
        <div class="m-meta"><div class="m-name" title="${esc(m.name)}">${esc(m.name)}</div>
          <div class="muted">${esc(fmtSize(m.bytes)) || '&nbsp;'}</div>
          <span class="badge ${n ? 'ok' : ''}">${n ? 'Used ' + n + (n > 1 ? ' times' : ' time') : 'Not used'}</span></div>
        <div class="m-actions"><button class="btn btn-ghost btn-sm" data-act="copyMedia" data-id="${esc(m.id)}">Copy link</button>
          <button class="btn btn-danger btn-sm" data-act="delMedia" data-id="${esc(m.id)}">Delete</button></div>
      </div>`;
    }).join('');
  }

  function drawMedia() {
    view.innerHTML = `
      <div class="view-head"><div><h1>Media</h1><p>${M.items.length} photo${M.items.length === 1 ? '' : 's'}. Upload once, then use a photo in any product or category.</p></div>
        <div class="head-actions">
          <button class="btn btn-ghost" type="button" data-act="backup">Download backup</button>
          <label class="btn btn-primary" for="m-file" style="cursor:pointer">Upload photos</label>
          <input id="m-file" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>
        </div></div>
      <div class="m-status warn">Photos are kept in the site database, which has limited free space. Download a backup now and then.</div>
      <div class="m-prog" id="m-prog" role="status"></div>
      <div id="m-drop">${M.items.length ? `<div class="media-grid" id="m-grid">${mediaCards()}</div>`
        : `<div class="empty"><h3>No photos yet</h3><p>Upload your product photos here. You can also drop photos onto this page.</p><label class="btn btn-primary" for="m-file" style="cursor:pointer">Upload photos</label></div>`}</div>`;
    $('#m-file').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; uploadMany(f, $('#m-prog'), drawMedia); });
  }

  // upload several photos one after the other and show progress in `box`
  async function uploadMany(files, box, done, onEach) {
    let ok = 0; const errs = [];
    for (let i = 0; i < files.length; i++) {
      box.textContent = `Uploading ${i + 1} of ${files.length}...`;
      try { const url = await uploadFile(files[i]); ok++; if (onEach) onEach(url); } catch (ex) { errs.push(`${files[i].name}: ${ex.message}`); }
    }
    const msg = errs.length ? errs.join(' | ') : (ok ? `${ok} photo${ok === 1 ? '' : 's'} uploaded.` : '');
    if (done) done();
    const target = box.isConnected ? box : $('#m-prog');
    if (target) { target.textContent = msg; target.classList.toggle('err', !!errs.length); }
  }

  actions.copyMedia = async (id) => {
    const m = M.items.find((x) => x.id === id); if (!m) return;
    const full = location.origin + m.url;
    try { await navigator.clipboard.writeText(full); toast('Link copied'); } catch { prompt('Copy this link:', full); }
  };
  actions.delMedia = async (id) => {
    const m = M.items.find((x) => x.id === id); if (!m) return;
    const cover = S.cats.find((c) => c.image === m.url);
    if (cover) { toast(`This photo is the cover of "${cover.name}". Change that category photo first.`, true); return; }
    const n = usedBy(m.url);
    if (!confirm(n ? `This photo is used in ${n} product${n > 1 ? 's' : ''}. If you delete it, it is removed from them too. Delete anyway?` : 'Delete this photo permanently?')) return;
    try {
      await A('media?id=' + encodeURIComponent(id), { method: 'DELETE' });
      M.items = M.items.filter((x) => x.id !== id);
      S.products = await A('products');
      toast('Photo deleted'); drawMedia();
    } catch (e) { toast(e.message, true); }
  };
  actions.backup = async () => {
    try {
      const data = await A('backup');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'janissary-wear-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Backup downloaded');
    } catch (e) { toast(e.message, true); }
  };

  // drop photos anywhere on the Media page to upload them
  view.addEventListener('dragover', (e) => { if ($('#m-drop') && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  view.addEventListener('drop', (e) => {
    if (!$('#m-drop') || !e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    uploadMany([...e.dataTransfer.files], $('#m-prog'), drawMedia);
  });

  // photo picker window used by the product and category forms
  const picker = $('#picker');
  picker.addEventListener('click', (e) => { if (e.target.closest('[data-pclose]')) picker.close(); });

  async function openPicker({ multiple, max, onPick }) {
    let sel = [];
    picker.innerHTML = `
      <div class="dlg-head"><h2>Choose from Media</h2><button class="dlg-x" type="button" data-pclose aria-label="Close">&times;</button></div>
      <div class="dlg-body">
        <div class="upload-row" style="margin-bottom:12px"><label class="btn btn-ghost btn-sm" for="pk-file" style="cursor:pointer">Upload new</label>
          <input id="pk-file" type="file" accept="image/jpeg,image/png,image/webp" multiple><span class="muted" id="pk-msg"></span></div>
        <div class="media-grid pick" id="pk-grid"><div class="muted">Loading...</div></div>
      </div>
      <div class="dlg-foot"><div class="form-error" id="pk-err" role="alert"></div>
        <button class="btn btn-ghost" type="button" data-pclose>Cancel</button>
        <button class="btn btn-primary" type="button" id="pk-ok" disabled>Use selected</button></div>`;
    const grid = $('#pk-grid', picker), ok = $('#pk-ok', picker), err = $('#pk-err', picker);
    function draw() {
      grid.innerHTML = M.items.length ? M.items.map((m) => {
        const i = sel.indexOf(m.url);
        return `<button type="button" class="m-pick${i >= 0 ? ' sel' : ''}" data-url="${esc(m.url)}" aria-pressed="${i >= 0}" title="${esc(m.name)}"><img loading="lazy" src="${esc(m.url)}" alt="${esc(m.name)}">${i >= 0 ? `<span class="tick">${multiple ? i + 1 : '✓'}</span>` : ''}</button>`;
      }).join('') : '<div class="muted">No photos yet. Use "Upload new" above.</div>';
      ok.disabled = !sel.length;
      ok.textContent = multiple && sel.length ? `Use ${sel.length} selected` : 'Use selected';
    }
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('.m-pick'); if (!b) return;
      const u = b.dataset.url; err.textContent = '';
      if (sel.includes(u)) sel = sel.filter((x) => x !== u);
      else if (!multiple) sel = [u];
      else if (sel.length >= max) { err.textContent = `You can pick up to ${max} photo${max === 1 ? '' : 's'} here.`; return; }
      else sel.push(u);
      draw();
    });
    $('#pk-file', picker).addEventListener('change', (e) => {
      const f = [...e.target.files]; e.target.value = '';
      uploadMany(f, $('#pk-msg', picker), draw, (url) => { if (!multiple) sel = [url]; else if (sel.length < max) sel.push(url); });
    });
    ok.addEventListener('click', () => { picker.close(); onPick(sel); });
    picker.showModal();
    try { await loadMedia(); } catch (e) { err.textContent = e.message; }
    draw();
  }

  // ---------- categories ----------
  function categories() {
    const rows = [];
    const row = (c, child) => {
      const n = child ? ownCount(c.slug) : totalCount(c.slug);
      return `<tr>
        <td><div class="t-name" style="${child ? 'padding-left:28px' : ''}"><div class="t-thumb">${c.image ? `<img src="${esc(c.image)}" alt="">` : ''}</div>
          <div>${child ? '' : '<b>'}${esc(c.name)}${child ? '' : '</b>'}<div class="muted">${child ? 'Sub-category of ' + esc(catName(c.parent)) : 'Main category'}</div></div></div></td>
        <td class="num">${n}</td>
        <td><div class="t-actions">
          ${child ? '' : `<button class="btn btn-dark btn-sm" data-act="newSub" data-id="${esc(c.id)}">Add sub-category</button>`}
          <button class="btn btn-ghost btn-sm" data-act="editCat" data-id="${esc(c.id)}">Edit</button>
          <button class="btn btn-danger btn-sm" data-act="delCat" data-id="${esc(c.id)}">Delete</button></div></td>
      </tr>`;
    };
    mainCats().forEach((t) => { rows.push(row(t, false)); subCats(t.slug).forEach((k) => rows.push(row(k, true))); });

    view.innerHTML = `
      <div class="view-head"><div><h1>Categories</h1><p>Main categories (like Men and Women) hold sub-categories (like T-Shirt or Polo Shirt). Add products inside the sub-categories.</p></div>
        <button class="btn btn-primary" data-act="newCat">Add category</button></div>
      ${S.cats.length ? `<div class="table-wrap"><table class="t">
        <thead><tr><th>Category</th><th class="num">Products</th><th></th></tr></thead>
        <tbody>${rows.join('')}</tbody></table></div>`
        : `<div class="empty"><h3>No categories yet</h3><p>Start with a main category like Men or Women.</p><button class="btn btn-primary" data-act="newCat">Add category</button></div>`}`;
  }

  actions.newCat = () => openCat();
  actions.newSub = (id) => { const c = S.cats.find((x) => x.id === id); if (c) openCat(null, c.slug); };
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

  function openCat(id, presetParent) {
    const c = id ? S.cats.find((x) => x.id === id) : null;
    const d = c || { name: '', description: '', image: '', parent: presetParent || '' };
    const hasKids = c ? subCats(c.slug).length > 0 : false;
    let img = d.image; const original = d.image; const uploaded = []; let saved = false; let busy = false;
    const parentOpts = `<option value="">None, this is a main category (like Men)</option>` +
      mainCats().filter((t) => !c || t.slug !== c.slug).map((t) => `<option value="${esc(t.slug)}"${t.slug === d.parent ? ' selected' : ''}>Inside ${esc(t.name)}</option>`).join('');

    dlg.innerHTML = `
      <div class="dlg-head"><h2>${c ? 'Edit category' : (presetParent ? 'Add sub-category' : 'Add category')}</h2><button class="dlg-x" type="button" data-close aria-label="Close">&times;</button></div>
      <form id="cf" novalidate style="display:contents">
        <div class="dlg-body">
          <div class="field"><label for="c-name">Category name</label><input class="input" id="c-name" value="${esc(d.name)}" maxlength="60" placeholder="For example: Polo Shirt" required>${c ? '<div class="hint">The web address of the category stays the same when you rename it.</div>' : ''}</div>
          <div class="field"><label for="c-parent">Where does it go?</label>
            <select class="select" id="c-parent"${hasKids ? ' disabled' : ''}>${parentOpts}</select>
            <div class="hint">${hasKids ? 'This category has sub-categories, so it stays a main category.' : 'Choose "Inside Men" to make a sub-category like T-Shirt under Men.'}</div></div>
          <div class="field"><label for="c-desc">Short description</label><input class="input" id="c-desc" value="${esc(d.description)}" maxlength="300" placeholder="Optional. Shown on the category page"></div>
          <div class="field"><span class="lbl">Cover photo</span>
            <div class="img-grid" id="cImg"></div>
            <div class="upload-row"><button class="btn btn-dark btn-sm" type="button" id="c-pick">Choose from Media</button><label class="btn btn-ghost btn-sm" for="c-file" style="cursor:pointer">Upload new</label><input id="c-file" type="file" accept="image/jpeg,image/png,image/webp"></div>
            <div class="hint">Optional. Main categories look best with a wide photo, sub-categories with a tall one.</div>
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

        $('#c-pick', dlg).addEventListener('click', () => openPicker({ multiple: false, max: 1, onPick: (urls) => { if (urls[0]) { img = urls[0]; draw(); } } }));

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
      if (!hasKids) body.parent = $('#c-parent', dlg).value;
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
