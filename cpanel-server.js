// The site as one Node server:  node server.js   ->  http://localhost:3000
// - on your computer it is the local test site
// - on a Node.js host (cPanel "Setup Node.js App", a VPS ...) it is the live site
// (On Vercel this file is NOT used. Vercel serves /public and runs /api/*.js by itself.)
//
// What it does for you, so one busy minute does not take the site down:
//   * the address rules (rewrites) and the security / cache headers are read from vercel.json, so they live in one place
//   * every page and public answer is kept in memory for the time the site asks for (like Vercel's CDN does),
//     and when 1000 visitors ask for the same page at once the database is asked only once
//   * everything is compressed (gzip) and files get ETags, so repeat visits cost almost nothing
//   * a change made in the admin clears the saved copies at once
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- load .env (next to this file). Tolerates quotes, Windows line endings and a BOM. ----
const ENV_PATH = path.join(__dirname, '.env');
let envStatus = '';
try {
  const text = fs.readFileSync(ENV_PATH, 'utf8').replace(/^﻿/, '');
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

const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};
const SQUEEZE = /^(text\/|application\/(json|javascript|xml)|image\/svg)/;     // worth compressing
const MAX_BODY = 2 * 1024 * 1024;                                              // the biggest request accepted (photos are ~0.9 MB)

// ---- address rules and headers from vercel.json ----
let CONFIG = {};
try { CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'vercel.json'), 'utf8')); } catch (e) { console.log('vercel.json not read: ' + e.message); }
const REWRITES = (CONFIG.rewrites || []).map((r) => ({ re: new RegExp('^' + r.source.replace(/:([A-Za-z_]+)/g, '(?<$1>[^/]+)') + '$'), dest: r.destination }));
const HEADERS = (CONFIG.headers || []).map((h) => ({ re: new RegExp('^' + h.source.replace(/:([A-Za-z_]+)/g, '([^/]+)') + '$'), list: h.headers }));

// ---- saved copies of answers ----
const SAVE_MAX_BYTES = 64 * 1024 * 1024, SAVE_MAX_ENTRIES = 2000;
const saved = new Map();      // key -> { status, headers, body, gz, until, size }
const busy = new Map();       // key -> promise of the one request that is making it right now
let savedBytes = 0;
const forget = () => { saved.clear(); busy.clear(); savedBytes = 0; };
function keep(key, e) {
  const old = saved.get(key); if (old) savedBytes -= old.size;
  saved.set(key, e); savedBytes += e.size;
  for (const k of saved.keys()) {                       // oldest go first when full
    if (savedBytes <= SAVE_MAX_BYTES && saved.size <= SAVE_MAX_ENTRIES) break;
    savedBytes -= saved.get(k).size; saved.delete(k);
  }
}
// how long a finished answer may be reused: s-maxage (pages, public lists) or a long max-age with immutable (photos)
function lifetime(h) {
  const cc = String(h['cache-control'] || '');
  if (/no-store|private/.test(cc)) return 0;
  const s = /s-maxage=(\d+)/.exec(cc);
  if (s) return Number(s[1]);
  return /immutable/.test(cc) ? 86400 : 0;
}

// a stand-in for the response, so the answer can be checked, saved and then sent the same way every time
function Capture() { this.statusCode = 200; this.headers = {}; this.chunks = []; }
Capture.prototype.setHeader = function (k, v) { this.headers[String(k).toLowerCase()] = v; };
Capture.prototype.getHeader = function (k) { return this.headers[String(k).toLowerCase()]; };
Capture.prototype.removeHeader = function (k) { delete this.headers[String(k).toLowerCase()]; };
Capture.prototype.writeHead = function (code, h) { this.statusCode = code; Object.entries(h || {}).forEach(([k, v]) => this.setHeader(k, v)); return this; };
Capture.prototype.write = function (c) { if (c != null) this.chunks.push(Buffer.from(c)); return true; };
Capture.prototype.end = function (c) { if (c != null) this.write(c); };

function send(req, res, e, tag) {
  const h = { ...e.headers, 'x-cache': tag };
  let body = e.body;
  if (SQUEEZE.test(String(h['content-type'] || '')) && body.length > 860 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    body = e.gz || (e.gz = zlib.gzipSync(e.body, { level: 6 }));
    h['content-encoding'] = 'gzip'; h.vary = 'Accept-Encoding';
  }
  h['content-length'] = body.length;
  res.writeHead(e.status, h);
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---- the files in /public ----
const squeezed = new Map();   // file + time -> gzip copy
function sendFile(req, res, file) {
  const st = fs.statSync(file);
  const ext = path.extname(file);
  const type = TYPES[ext] || 'application/octet-stream';
  const etag = '"' + st.size.toString(36) + '-' + Math.floor(st.mtimeMs).toString(36) + '"';
  if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', ext === '.html' ? 'public, max-age=0, must-revalidate' : 'public, max-age=300');
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return res.end(); }
  res.setHeader('Content-Type', type);
  if (SQUEEZE.test(type) && st.size > 860 && st.size < 1024 * 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    const k = file + etag;
    if (!squeezed.has(k)) squeezed.set(k, zlib.gzipSync(fs.readFileSync(file), { level: 6 }));
    const gz = squeezed.get(k);
    res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding'); res.setHeader('Content-Length', gz.length);
    return res.end(req.method === 'HEAD' ? undefined : gz);
  }
  res.setHeader('Content-Length', st.size);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

async function readBody(req) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BODY) return null; chunks.push(c); }
  return Buffer.concat(chunks).toString();
}

async function handle(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const host = req.headers.host || 'localhost';

  HEADERS.forEach((h) => { if (h.re.test(u.pathname)) h.list.forEach((x) => res.setHeader(x.key, x.value)); });

  // the same address rewrites as vercel.json, so the site behaves the same everywhere
  for (const r of REWRITES) {
    const m = r.re.exec(u.pathname);
    if (!m) continue;
    const [file, qs] = r.dest.replace(/:([A-Za-z_]+)/g, (_, k) => (m.groups || {})[k] || '').split('?');
    const merged = new URLSearchParams(qs);
    u.searchParams.forEach((v, k) => merged.set(k, v));
    u.pathname = '/' + file.replace(/^\//, ''); u.search = '?' + merged.toString();
    break;
  }

  if (u.pathname.startsWith('/api/')) {
    const name = u.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '');
    const file = path.join(__dirname, 'api', name + '.js');
    if (name.startsWith('_') || !fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
    const handler = require(file);
    const get = req.method === 'GET' || req.method === 'HEAD';

    const run = async () => {
      const r2 = { headers: req.headers, method: req.method === 'HEAD' ? 'GET' : req.method, url: u.pathname + u.search, socket: req.socket, query: Object.fromEntries(u.searchParams) };
      if (!get) {
        const raw = await readBody(req);
        if (raw === null) { const c = new Capture(); c.statusCode = 413; c.setHeader('content-type', 'application/json'); c.end('{"error":"Too large"}'); return c; }
        r2.body = {};
        if (raw && (req.headers['content-type'] || '').includes('json')) { try { r2.body = JSON.parse(raw); } catch {} }
      }
      const c = new Capture();
      await handler(r2, c);
      return c;
    };
    const toEntry = (c) => { const body = Buffer.concat(c.chunks); return { status: c.statusCode, headers: c.headers, body, size: body.length + 300 }; };

    // reading and the visitor is not the admin: one saved copy serves everybody
    const shareable = get && !req.headers.authorization;
    const key = host + (req.headers['x-forwarded-proto'] || '') + u.pathname + u.search;
    if (shareable) {
      const hit = saved.get(key);
      if (hit && hit.until > Date.now()) return send(req, res, hit, 'HIT');
      if (busy.has(key)) { await busy.get(key).catch(() => {}); const again = saved.get(key); if (again && again.until > Date.now()) return send(req, res, again, 'HIT'); }
    }
    const job = run().then((c) => { const e = toEntry(c); const life = lifetime(e.headers); if (shareable && e.status === 200 && life > 0) { e.until = Date.now() + life * 1000; keep(key, e); } if (!get && e.status < 400) forget(); return e; });
    if (shareable) { busy.set(key, job); job.finally(() => { if (busy.get(key) === job) busy.delete(key); }).catch(() => {}); }
    return send(req, res, await job, 'MISS');
  }

  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(PUBLIC, p);
  if (!file.startsWith(PUBLIC) || path.basename(file).startsWith('.')) { res.statusCode = 403; return res.end(); }
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
  sendFile(req, res, file);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.log('Error on ' + req.method + ' ' + req.url + ': ' + (e && e.stack || e));
    if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end('{"error":"Something went wrong. Please try again."}'); } else res.end();
  });
});
server.headersTimeout = 20000; server.requestTimeout = 30000; server.keepAliveTimeout = 65000;
process.on('unhandledRejection', (e) => console.log('Unhandled: ' + (e && e.stack || e)));
process.on('uncaughtException', (e) => console.log('Uncaught: ' + (e && e.stack || e)));

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

// finish the requests in progress when the host stops or restarts the app
['SIGTERM', 'SIGINT'].forEach((s) => process.on(s, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); }));
