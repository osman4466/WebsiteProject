// POST /api/track  - the storefront sends every tracking event here, and the server forwards it to Meta.
const { send, getBody } = require('./_lib');
const { forward } = require('./_track');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  // only our own pages may send events (stops other sites from filling the pixel with fake data)
  const origin = req.headers.origin || '';
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* ignore */ }
    const mine = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (host !== mine) return send(res, 403, { error: 'Forbidden' });
  }
  const b = await getBody(req);
  if (b.name === 'Purchase') return send(res, 200, { ok: true });      // purchases are sent by the server itself when the order is saved
  await forward(req, b);
  return send(res, 200, { ok: true });
};
