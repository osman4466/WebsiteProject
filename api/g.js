// One serverless function that serves six small endpoints.
// Why: Vercel's free (Hobby) plan allows at most 12 functions per deployment, and every non-underscore file in /api is one function.
// The old files were renamed to api/_h_<name>.js (an underscore means "not a function") and are loaded from here.
// vercel.json rewrites the usual addresses to this file, so nothing else changes:
//   /api/health /api/login /api/backup /api/notify  ->  /api/g?__h=<name>
//   /robots.txt  ->  /api/g?__h=robots        /sitemap.xml  ->  /api/g?__h=sitemap
// The require() lines are written out in full on purpose, so Vercel includes every file in the bundle.
const { getQuery } = require('./_lib');

const HANDLERS = {
  health: () => require('./_h_health'),
  login: () => require('./_h_login'),
  backup: () => require('./_h_backup'),
  notify: () => require('./_h_notify'),
  robots: () => require('./_h_robots'),
  sitemap: () => require('./_h_sitemap'),
};

module.exports = async (req, res) => {
  const name = String(getQuery(req).__h || '');
  if (!Object.prototype.hasOwnProperty.call(HANDLERS, name)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ error: 'Not found' }));
  }
  return HANDLERS[name]()(req, res);
};
