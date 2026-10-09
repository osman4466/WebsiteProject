/* Janissary Wear - tracking in the browser.
   JW.track(name, data) sends one event to the Meta Pixel, to Google Analytics 4 and to our server
   (which forwards it to the Meta Conversions API). All use the same event id, so nothing is counted twice. */
(function () {
  const GA_NAMES = { PageView: 'page_view', ViewContent: 'view_item', ViewCategory: 'view_item_list', Search: 'search', AddToCart: 'add_to_cart', InitiateCheckout: 'begin_checkout', AddPaymentInfo: 'add_shipping_info', Purchase: 'purchase', Contact: 'contact_whatsapp' };
  const CUSTOM_META = ['ViewCategory'];

  let cfg = null;
  const queue = [];

  // ---------- cookies ----------
  const getCookie = (n) => { const m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; };
  const setCookie = (n, v, days) => { document.cookie = `${n}=${encodeURIComponent(v)}; max-age=${days * 86400}; path=/; SameSite=Lax`; };
  const rand = () => Math.floor(Math.random() * 1e10);

  // Meta's browser id (_fbp) and click id (_fbc). We make them ourselves first, so the very first event already has them.
  function metaIds() {
    let fbp = getCookie('_fbp');
    if (!fbp) { fbp = `fb.1.${Date.now()}.${rand()}`; setCookie('_fbp', fbp, 90); }
    let fbc = getCookie('_fbc');
    const click = new URLSearchParams(location.search).get('fbclid');
    if (click && !fbc.endsWith(click)) { fbc = `fb.1.${Date.now()}.${click}`; setCookie('_fbc', fbc, 90); }
    return { fbp, fbc };
  }
  const gaClientId = () => { const m = getCookie('_ga').match(/^GA\d\.\d\.(.+)$/); return m ? m[1] : ''; };

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  // ---------- load the Meta Pixel and Google tag ----------
  function loadMeta(id) {
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq('init', id);
  }
  function loadGA(id) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    const s = document.createElement('script');
    s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
    window.gtag('js', new Date());
    window.gtag('config', id, { send_page_view: false });
  }

  // ---------- one event to every destination ----------
  function dispatch(ev) {
    const items = ev.items || [];
    const value = ev.value != null ? ev.value : items.reduce((n, i) => n + i.price * i.qty, 0);

    if (cfg.metaBrowser && window.fbq) {
      const p = { currency: 'BDT' };
      if (value) p.value = value;
      if (items.length) {
        p.content_type = 'product'; p.content_ids = items.map((i) => i.id);
        p.contents = items.map((i) => ({ id: i.id, quantity: i.qty, item_price: i.price }));
        p.num_items = items.reduce((n, i) => n + i.qty, 0);
        if (items.length === 1) p.content_name = items[0].name;
      }
      if (ev.category) p.content_category = ev.category;
      if (ev.search) p.search_string = ev.search;
      window.fbq(CUSTOM_META.includes(ev.name) ? 'trackCustom' : 'track', ev.name, p, { eventID: ev.eventId });
    }

    if (cfg.gaId && window.gtag) {
      const p = {};
      if (items.length) p.items = items.map((i) => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.qty, item_category: i.category || undefined }));
      if (value) { p.value = value; p.currency = 'BDT'; }
      if (ev.name === 'ViewCategory') p.item_list_name = ev.category || 'Products';
      if (ev.name === 'Search') p.search_term = ev.search;
      if (ev.name === 'Purchase') p.transaction_id = ev.eventId;
      if (ev.name === 'PageView') { p.page_location = location.href; p.page_title = document.title; }
      window.gtag('event', GA_NAMES[ev.name] || ev.name.toLowerCase(), p);
    }

    // the server copy (Purchase is sent by the server itself when the order is saved)
    if (cfg.metaServer && ev.name !== 'Purchase') {
      const ids = metaIds();
      const body = JSON.stringify({ name: ev.name, eventId: ev.eventId, url: location.href, items, value, category: ev.category, search: ev.search, fbp: ids.fbp, fbc: ids.fbc, gaClientId: gaClientId(), user: ev.user });
      try {
        if (!(navigator.sendBeacon && navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' })))) throw new Error('beacon');
      } catch { fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {}); }
    }
  }

  // JW.track('AddToCart', { items: [{ id, name, price, qty, category }], value, category, search, user: { phone, name } }, { eventId })
  // returns the event id
  function track(name, data = {}, opts = {}) {
    const ev = { name, eventId: opts.eventId || newId(), ...data };
    if (cfg) dispatch(ev); else queue.push(ev);
    return ev.eventId;
  }

  // the details the server needs to send the Purchase with the order
  const orderTracking = () => ({ ...metaIds(), gaClientId: gaClientId(), url: location.href });

  // a cart item in the shape tracking wants
  const item = (p, size, color, qty) => ({ id: p.id, name: p.name, price: JW.priceOf(p, size, color), qty: qty || 1, category: JW.catPath ? JW.catPath(p.category) : '' });

  JW.track = track;
  JW.trackItem = item;
  JW.orderTracking = orderTracking;

  JW.loadSettings().then((s) => {
    cfg = s.tracking || {};
    if (cfg.metaBrowser) { metaIds(); loadMeta(cfg.metaPixelId); }
    if (cfg.gaId) loadGA(cfg.gaId);
    track('PageView');
    queue.splice(0).forEach(dispatch);
  });

  // a tap on the WhatsApp button is a "Contact" event
  document.addEventListener('click', (e) => { if (e.target.closest('a[href*="wa.me"]')) track('Contact'); });
})();
