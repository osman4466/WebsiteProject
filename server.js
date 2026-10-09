// Local dev server:  node server.js   ->  http://localhost:3000
// (On Vercel this file is NOT used. Vercel serves /public and runs /api/*.js automatically.)
const http = require('http');
const fs = require('fs');
const path = require('path');

// ---- load .env (next to this file). Tolerates quotes, Windows line endings and a BOM. ----
const ENV_PATH = path.join(__dirname, '.env');
let envStatus = '';
try {
  const text = fs.readFileSync(ENV_PATH, 'utf8').replace(/^\uFEFF/, '');
  text.split(/\r?\n/).forEach((line) => {
    if (/^\s*#/.test(line)) return;
    const m = /^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) return;
    let v = m[2];
    if (v.length > 1 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  });
  envStatus = '.env found: ' + ENV_PATH;
} catch (e) {
  envStatus = '.env NOT found. Looked here: ' + ENV_PATH;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');

  // the same address rewrites as vercel.json, so the site behaves the same here
  const prod = /^\/product\/([^/]+)$/.exec(u.pathname);
  const REWRITES = { '/': 'page?p=index', '/products': 'page?p=products', '/categories': 'page?p=categories', '/cart': 'page?p=cart', '/product': 'page?p=product', '/sitemap.xml': 'sitemap', '/robots.txt': 'robots' };
  const target = prod ? 'page?p=product&slug=' + prod[1] : REWRITES[u.pathname];
  if (target) {
    const [file, qs] = target.split('?');
    const merged = new URLSearchParams(qs);
    u.searchParams.forEach((v, k) => merged.set(k, v));
    u.pathname = '/api/' + file;
    u.search = '?' + merged.toString();
  }

  if (u.pathname.startsWith('/api/')) {
    const name = u.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '');
    const file = path.join(__dirname, 'api', name + '.js');
    if (name.startsWith('_') || !fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
    req.query = Object.fromEntries(u.searchParams);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    if (raw && (req.headers['content-type'] || '').includes('json')) { try { req.body = JSON.parse(raw); } catch { req.body = {}; } }
    return require(file)(req, res);
  }

  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(__dirname, 'public', p);
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.statusCode = 403; return res.end(); }
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

const PORT = process.env.PORT || 3000;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('\nPort ' + PORT + ' is already in use, so an older copy of the server is still running.');
    console.log('Stop it (Ctrl+C in its terminal), or start this one on another port, for example:');
    console.log('  $env:PORT=3001; node server.js\n');
  } else console.log(e);
  process.exit(1);
});
server.listen(PORT, () => {
  console.log('Janissary Wear running on http://localhost:' + PORT);
  console.log(envStatus);
  console.log('ADMIN_EMAIL:    ' + (process.env.ADMIN_EMAIL ? 'set' : 'MISSING'));
  console.log('ADMIN_PASSWORD: ' + (process.env.ADMIN_PASSWORD ? 'set (' + process.env.ADMIN_PASSWORD.length + ' characters)' : 'MISSING'));
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) console.log('Login will not work until both are set in the .env file next to server.js.');
});
