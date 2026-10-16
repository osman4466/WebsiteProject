const { send, getBody, sign, safeEqual, rateLimit } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    return send(res, 500, {
      error: 'ADMIN_EMAIL / ADMIN_PASSWORD is not set. Add them in Vercel -> Settings -> Environment Variables, then redeploy.',
    });
  }

  if (await rateLimit(req, 'login', 10, 600)) return send(res, 429, { error: 'Too many login attempts. Please wait 10 minutes and try again.' });

  const body = await getBody(req);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  const okEmail = safeEqual(email, adminEmail.trim().toLowerCase());
  const okPass = safeEqual(password, adminPassword);

  if (!(okEmail && okPass)) {
    await new Promise((r) => setTimeout(r, 800)); // slow down brute force
    return send(res, 401, { error: 'Wrong email or password' });
  }

  const token = sign({ role: 'admin', exp: Date.now() + 1000 * 60 * 60 * 12 }); // 12 hours
  return send(res, 200, { token });
};
