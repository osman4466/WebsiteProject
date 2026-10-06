// Image storage inside the same free database (no extra service needed).
// POST  /api/image   (admin)  body: { dataUrl: "data:image/jpeg;base64,..." }  -> { url }
// GET   /api/image?id=xxx     -> the image
// DELETE /api/image?id=xxx    (admin)
const { send, getQuery, getBody, dbGet, dbSet, dbDel, requireAdmin, uid } = require('./_lib');

const MAX_CHARS = 900 * 1024; // ~650KB image after base64

module.exports = async (req, res) => {
  try {
    const q = getQuery(req);

    if (req.method === 'GET') {
      const id = String(q.id || '').replace(/[^a-zA-Z0-9_]/g, '');
      const img = id ? await dbGet('img:' + id) : null;
      if (!img) {
        res.statusCode = 404;
        return res.end('Not found');
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', img.type);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.end(Buffer.from(img.data, 'base64'));
    }

    if (!requireAdmin(req, res)) return;

    if (req.method === 'POST') {
      const b = await getBody(req);
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || ''));
      if (!m) return send(res, 400, { error: 'Only JPG, PNG or WEBP images are allowed' });
      if (m[2].length > MAX_CHARS) return send(res, 400, { error: 'Image is too large. Please use a smaller image.' });
      const id = uid('i');
      await dbSet('img:' + id, { type: m[1], data: m[2] });
      return send(res, 201, { url: '/api/image?id=' + id });
    }

    if (req.method === 'DELETE') {
      const id = String(q.id || '').replace(/[^a-zA-Z0-9_]/g, '');
      if (id) await dbDel('img:' + id);
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
};
