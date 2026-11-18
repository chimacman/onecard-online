import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameManager } from './game.js';

const manager = new GameManager();
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const port = Number(process.env.PORT || 3000);
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    if (req.method === 'GET' && pathname === '/health') return sendJson(res, 200, { ok: true });
    if (req.method === 'GET' && pathname === '/api/events') {
      const code = url.searchParams.get('code');
      const token = url.searchParams.get('token');
      manager.lookup(code, token);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff',
      });
      res.write(': live\n\n');
      const detach = manager.attach(code, token, state => res.write(`data: ${JSON.stringify(state)}\n\n`));
      const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': ping\n\n'); }, 20_000);
      res.on('close', () => { clearInterval(heartbeat); detach(); });
      return;
    }
    if (req.method === 'POST' && pathname.startsWith('/api/')) {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 8000) return sendJson(res, 413, { error: '요청이 너무 커요.' });
      }
      let body;
      try { body = JSON.parse(raw); } catch { return sendJson(res, 400, { error: '올바르지 않은 요청이에요.' }); }
      let result;
      switch (pathname) {
        case '/api/create': result = manager.create(body.name); break;
        case '/api/join': result = manager.join(body.code, body.name); break;
        case '/api/reconnect': {
          const { room, player } = manager.lookup(body.code, body.token);
          result = { code: room.code, token: player.token, id: player.id }; break;
        }
        case '/api/action': {
          manager.action(body.code, body.token, body.action, body);
          result = { ok: true }; break;
        }
        default: return sendJson(res, 404, { error: '없는 API입니다.' });
      }
      return sendJson(res, 200, result);
    }
    if (req.method === 'GET' && files.has(pathname)) {
      const [filename, contentType] = files.get(pathname);
      const content = fs.readFileSync(path.join(root, filename));
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      return res.end(content);
    }
    return sendJson(res, 404, { error: '페이지를 찾을 수 없어요.' });
  } catch (err) {
    if (!res.headersSent) return sendJson(res, 400, { error: err.message || '서버 오류가 발생했어요.' });
    res.end();
  }
});

const ticker = setInterval(() => manager.tick(), 1000);
server.listen(port, '0.0.0.0', () => console.log(`🃏 One Card Online → http://localhost:${server.address().port}`));
process.on('SIGTERM', () => { clearInterval(ticker); server.close(); });
export { server, manager };
