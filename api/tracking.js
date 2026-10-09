// Admin > Tracking
//   GET  /api/tracking            settings (tokens are never returned, only a hint), plus the recent log
//   PUT  /api/tracking            save settings; a token field left empty keeps the saved token
//   POST /api/tracking?test=1     send a test event to Meta and GA4 and report what they answered
const { send, getQuery, getBody, dbGet, dbSet, requireAdmin, clean } = require('./_lib');
const T = require('./_track');

const hint = (v, fromEnv) => ({ set: !!v, fromEnv: !!fromEnv, hint: v ? '••••••' + String(v).slice(-4) : '' });

function pick(b, cur) {
  const str = (k, max) => (b[k] !== undefined ? clean(b[k], max) : cur[k] || '');
  // people often paste the whole <meta ...> tag from Search Console: keep only the code
  let gsc = str('gscCode', 400);
  const m = /content\s*=\s*["']([^"']+)["']/i.exec(gsc);
  if (m) gsc = m[1];
  let site = str('siteUrl', 200).replace(/\/+$/, '');
  if (site) { try { const u = new URL(/^https?:\/\//i.test(site) ? site : 'https://' + site); site = u.origin; } catch { site = ''; } }
  const flag = (k) => (b[k] !== undefined ? !!b[k] : cur[k] !== false);
  return {
    metaPixelId: str('metaPixelId', 30).replace(/\D/g, ''),
    metaBrowser: flag('metaBrowser'), metaServer: flag('metaServer'),
    testEventCode: str('testEventCode', 30).replace(/[^A-Za-z0-9]/g, ''),
    gaId: str('gaId', 30).toUpperCase().replace(/[^A-Z0-9-]/g, ''),
    gaEnabled: flag('gaEnabled'), gaServer: flag('gaServer'),
    gscCode: gsc.replace(/[^A-Za-z0-9_-]/g, ''), siteUrl: site,
  };
}

module.exports = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const q = getQuery(req);

    if (req.method === 'GET') {
      const cfg = await T.getTracking(true);
      const s = await T.getSecrets();
      return send(res, 200, {
        config: cfg,
        secrets: { metaToken: hint(s.metaToken, s.metaFromEnv), gaSecret: hint(s.gaSecret, s.gaFromEnv) },
        log: (await dbGet('tracking_log', [])) || [],
      });
    }

    if (req.method === 'PUT') {
      const b = await getBody(req);
      const cur = await T.getTracking(true);
      const secrets = (await dbGet('tracking_secrets', null)) || {};
      const next = { ...cur, ...pick(b, cur) };
      if (next.metaPixelId && !/^\d{5,20}$/.test(next.metaPixelId)) return send(res, 400, { error: 'Meta Pixel ID should be only numbers.' });
      if (next.gaId && !/^G-[A-Z0-9]{4,}$/.test(next.gaId)) return send(res, 400, { error: 'GA4 Measurement ID looks like G-XXXXXXXXXX.' });

      if (b.clearMetaToken) delete secrets.metaToken;
      else if (clean(b.metaToken, 400)) secrets.metaToken = clean(b.metaToken, 400);
      if (b.clearGaSecret) delete secrets.gaSecret;
      else if (clean(b.gaSecret, 200)) secrets.gaSecret = clean(b.gaSecret, 200);
      next.metaTokenSet = !!secrets.metaToken;
      next.gaSecretSet = !!secrets.gaSecret;

      await dbSet('tracking_secrets', secrets);
      await dbSet('tracking', next);
      T.resetCache();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && q.test) {
      const cfg = await T.getTracking(true);
      const secrets = await T.getSecrets();
      const ev = T.sanitize({ name: 'PageView', eventId: 'test_' + Date.now().toString(36), url: 'https://test.invalid/', value: 100,
        items: [{ id: 'test', name: 'Test product', price: 100, qty: 1 }] });
      const out = {};
      if (!cfg.metaPixelId) out.meta = { state: 'off', message: 'Meta Pixel ID is empty.' };
      else if (!secrets.metaToken) out.meta = { state: 'off', message: 'Conversions API token is not saved.' };
      else if (!cfg.testEventCode) out.meta = { state: 'off', message: 'Put the Test Event Code in the box first, so the test does not mix with real data.' };
      else out.meta = await T.sendMeta(ev, req, { ...cfg, metaServer: true }, secrets);
      if (!cfg.gaId) out.ga = { state: 'off', message: 'GA4 Measurement ID is empty.' };
      else if (!secrets.gaSecret) out.ga = { state: 'off', message: 'GA4 API secret is not saved.' };
      else out.ga = await T.sendGA({ ...ev, name: 'Purchase' }, { ...cfg, gaEnabled: true, gaServer: true }, secrets, true);
      await T.addLog({ event: 'TEST', id: ev.eventId, value: 100, meta: out.meta.state + (out.meta.message ? ': ' + out.meta.message : ''), ga: out.ga.state + (out.ga.message ? ': ' + out.ga.message : '') });
      return send(res, 200, out);
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
};
