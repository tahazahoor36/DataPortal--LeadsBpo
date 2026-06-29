/**
 * DataPortal – Local Development Server
 *
 * Serves index.html for all non-API routes and routes /api/* requests
 * to the corresponding handler in the /api/ directory (Vercel-style).
 *
 * Usage:
 *   node server.js
 *   PORT=3000 node server.js
 *
 * Requires environment variables (set in .env):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, JWT_SECRET
 */

import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// ── Tiny .env loader (no extra dependency) ──────────────────────────────────
async function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!existsSync(envPath)) {
    console.warn('[server] No .env file found — relying on existing environment variables.');
    return;
  }
  const text = await readFile(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
  console.log('[server] Loaded .env');
}

// ── MIME types ───────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

// ── Body parser helper ───────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      if (!body) return resolve({});
      const ct = req.headers['content-type'] || '';
      if (ct.includes('application/json')) {
        try { resolve(JSON.parse(body)); }
        catch { resolve({}); }
      } else {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

// ── Pre-load API handlers once at startup ────────────────────────────────────
const handlers = {};
async function loadHandlers() {
  const apiDir = path.join(__dirname, 'api');
  const files = ['auth', 'records', 'credentials', 'util'];
  for (const name of files) {
    const filePath = path.join(apiDir, name + '.js');
    if (existsSync(filePath)) {
      try {
        handlers[name] = await import('file:///' + filePath.replace(/\\/g, '/'));
        console.log('[server] Loaded handler: ' + name);
      } catch (e) {
        console.error('[server] Failed to load handler ' + name + ':', e.message);
      }
    }
  }
}

// ── API handler router ───────────────────────────────────────────────────────
async function handleApi(req, res, pathname) {
  const segment = pathname.split('/')[2]; // e.g. "records"
  if (!segment) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Not found' }));
  }

  const handler = handlers[segment];
  if (!handler || typeof handler.default !== 'function') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'API handler not found: ' + segment }));
  }

  // Parse query string into req.query
  const url = new URL(req.url, 'http://localhost');
  req.query = Object.fromEntries(url.searchParams.entries());
  req.body  = await readBody(req);

  // Build a proper Express-like response shim
  // Collects all headers (including Set-Cookie) before writing to the real response
  const resShim = {
    _code: 200,
    _headers: {},
    _cookieList: [],
    _sent: false,
    status(code) { this._code = code; return this; },
    setHeader(k, v) {
      if (k.toLowerCase() === 'set-cookie') {
        this._cookieList.push(v);
      } else {
        this._headers[k] = v;
      }
    },
    json(data) {
      if (this._sent) return; // guard against double-send
      this._sent = true;
      const body = JSON.stringify(data);
      this._headers['Content-Type'] = 'application/json';
      if (this._cookieList.length > 0) {
        this._headers['Set-Cookie'] = this._cookieList;
      }
      res.writeHead(this._code || 200, this._headers);
      res.end(body);
    },
  };

  try {
    await handler.default(req, resShim);
  } catch (err) {
    console.error('[server] API error in /' + segment + ':', err);
    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error', detail: err.message }));
    }
  }
}

// ── Static file server ───────────────────────────────────────────────────────
function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    res.writeHead(404);
    res.end('Not found');
  });
  res.writeHead(200, { 'Content-Type': mime });
  stream.pipe(res);
}

// ── Main HTTP server ─────────────────────────────────────────────────────────
async function main() {
  await loadEnv();
  await loadHandlers();

  // Validate required env vars
  const missing = ['SUPABASE_SERVICE_KEY', 'JWT_SECRET'].filter(k => !process.env[k]);
  if (missing.length) {
    console.error('[server] ⚠️  Missing environment variables:', missing.join(', '));
    console.error('[server]    Add these to your .env file and restart.');
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    // Log API calls
    if (pathname.startsWith('/api/')) {
      console.log('[api]', req.method, pathname + (url.search || ''));
    }

    // Handle preflight
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    // Route: /api/*
    if (pathname.startsWith('/api/')) {
      return handleApi(req, res, pathname);
    }

    // Route: static files (logo.png, etc.)
    if (pathname !== '/') {
      const staticPath = path.join(__dirname, pathname);
      if (existsSync(staticPath)) {
        return serveStatic(res, staticPath);
      }
    }

    // Fallback: serve index.html
    serveStatic(res, path.join(__dirname, 'index.html'));
  });

  server.listen(PORT, () => {
    console.log(`\n✅ DataPortal running at http://localhost:${PORT}\n`);
  });
}

main().catch(err => {
  console.error('[server] Fatal error:', err);
  process.exit(1);
});
