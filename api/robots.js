// /robots.txt
const { siteBase } = require('./_lib');
const { getTracking } = require('./_track');

module.exports = async (req, res) => {
  const base = siteBase(req, (await getTracking()).siteUrl);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600');
  // Google must be able to fetch product photos (they are served from /api/image), so that one path stays open
  res.end(['User-agent: *', 'Disallow: /admin', 'Disallow: /cart', 'Disallow: /api/', 'Allow: /api/image', '', `Sitemap: ${base}/sitemap.xml`, ''].join('\n'));
};
