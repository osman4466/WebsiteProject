// Open  /api/health  in the browser to check that the store is set up correctly.
// It never shows passwords or keys, only yes/no answers.
const { send, HAS_REDIS, ON_VERCEL, redis, getProducts } = require('./_lib');

module.exports = async (req, res) => {
  const out = {
    runningOnVercel: ON_VERCEL,
    adminEmailSet: !!process.env.ADMIN_EMAIL,
    adminPasswordSet: !!process.env.ADMIN_PASSWORD,
    sessionSecretSet: !!process.env.SESSION_SECRET,
    databaseVariablesFound: HAS_REDIS,
    database: 'not-connected',
  };

  if (!HAS_REDIS) {
    out.database = ON_VERCEL ? 'not-connected' : 'local-memory (testing only)';
    out.fix = ON_VERCEL
      ? 'Vercel > your project > Storage > connect Upstash Redis (Free) to this project, then Deployments > Redeploy.'
      : undefined;
    return send(res, 200, out);
  }

  try {
    await redis(['PING']);
    out.database = 'connected';
    const products = await getProducts();
    out.productsSaved = products.length;
    out.productsVisibleInStore = products.filter((p) => p.active !== false).length;
  } catch (e) {
    out.database = 'error';
    out.message = e.message;
  }
  return send(res, 200, out);
};
