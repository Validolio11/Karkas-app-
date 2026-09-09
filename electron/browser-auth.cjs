const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomBytes, timingSafeEqual } = require('node:crypto');

/** A short-lived, same-origin bridge from the system browser to Electron. */
function beginBrowserGoogleLogin({ openExternal, assetDir, signal, timeoutMs = 180000 }) {
  return new Promise((resolve, reject) => {
    const state = randomBytes(32).toString('hex');
    const root = path.resolve(assetDir);
    let origin;
    let expectedHost;
    let finished = false;
    let accepted = false;
    let timer;
    const sockets = new Set();
    const finish = (error, credential) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      server.close();
      for (const socket of sockets) socket.destroy();
      if (error) reject(error);
      else resolve(credential);
    };
    const abort = () => finish(new Error('auth/browser-login-cancelled'));
    const reply = (res, status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    const server = http.createServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (finished || accepted) return reply(res, 410, { error: 'Login already completed' });
      if (req.headers.host !== expectedHost) return reply(res, 403, { error: 'Invalid host' });
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(req.url, origin).pathname);
      } catch {
        return reply(res, 400, { error: 'Invalid path' });
      }

      if (pathname === '/callback') {
        if (req.method !== 'POST') return reply(res, 405, { error: 'POST required' });
        if (req.headers.origin !== origin) return reply(res, 403, { error: 'Invalid origin' });
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
          return reply(res, 415, { error: 'JSON required' });
        }
        let size = 0;
        const chunks = [];
        try {
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 16384) {
              reply(res, 413, { error: 'Request too large' });
              return;
            }
            chunks.push(chunk);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (typeof body.state !== 'string' || body.state.length !== state.length ||
              !timingSafeEqual(Buffer.from(body.state), Buffer.from(state))) {
            return reply(res, 403, { error: 'Invalid state' });
          }
          const validToken = (value) => typeof value === 'string' && value.length > 0 && value.length <= 12000;
          if ((!validToken(body.idToken) && !validToken(body.accessToken)) ||
              (body.idToken != null && !validToken(body.idToken)) ||
              (body.accessToken != null && !validToken(body.accessToken))) {
            return reply(res, 400, { error: 'Missing or invalid Google credential' });
          }
          if (accepted || finished) return reply(res, 410, { error: 'Login already completed' });
          accepted = true;
          const credential = {
            ...(body.idToken ? { idToken: body.idToken } : {}),
            ...(body.accessToken ? { accessToken: body.accessToken } : {}),
          };
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true }), () => finish(null, credential));
        } catch {
          if (!res.headersSent) reply(res, 400, { error: 'Invalid callback' });
        }
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, { error: 'GET required' });
      let file;
      if (pathname === '/desktop-auth.html') file = path.join(root, 'desktop-auth.html');
      else if (pathname.startsWith('/assets/') && !pathname.includes('\\') && !pathname.includes('\0')) {
        file = path.resolve(root, `.${pathname}`);
        if (!file.startsWith(path.join(root, 'assets') + path.sep)) return reply(res, 404, { error: 'Not found' });
      } else return reply(res, 404, { error: 'Not found' });
      try {
        const realFile = await fs.realpath(file);
        const realRoot = await fs.realpath(root);
        if (!realFile.startsWith(realRoot + path.sep)) return reply(res, 404, { error: 'Not found' });
        const data = await fs.readFile(realFile);
        const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
        res.end(req.method === 'HEAD' ? undefined : data);
      } catch {
        if (!res.headersSent) reply(res, 404, { error: 'Not found' });
      }
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    server.on('error', (error) => finish(error));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new Error('auth/browser-login-timeout')), timeoutMs);
    server.listen(0, '127.0.0.1', () => {
      if (finished) return server.close();
      expectedHost = `localhost:${server.address().port}`;
      origin = `http://${expectedHost}`;
      Promise.resolve().then(() => openExternal(`${origin}/desktop-auth.html#state=${state}`)).catch((error) => finish(error));
    });
  });
}

module.exports = { beginBrowserGoogleLogin };
