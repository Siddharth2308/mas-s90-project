// Vite plugin: lets a phone on the same Wi-Fi act as the visitor's controller.
//   - relays 'pie:remote' messages between the booth page and phone pages over Vite's own WebSocket
//   - serves the phone over https on PHONE_PORT (phones only allow motion sensors and the mic on https),
//     as a small proxy in front of the dev server; the laptop keeps using plain http://localhost
//   - GET /api/remote/info -> { urls: [...] } the addresses a phone can open (for the QR code)
//   - the phone server only answers requests carrying this run's random key: it is in the QR code (?k=...),
//     then kept as a cookie. On a network where the laptop is reachable from outside, strangers get 403.
// Everything stays on the local network. The certificate is self-signed and made on first run (embodiment/.cert).
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import { resolve } from 'node:path';

const PHONE_PORT = Number(process.env.PHONE_PORT ?? 5174);
const CERT_DIR = resolve(import.meta.dirname, '..', '.cert');
const KEY = randomBytes(12).toString('hex'); // new every start: re-scan the QR after restarting

function lanIps() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

function certificate() {
  const key = resolve(CERT_DIR, 'key.pem'), cert = resolve(CERT_DIR, 'cert.pem');
  if (!existsSync(key) || !existsSync(cert)) {
    mkdirSync(CERT_DIR, { recursive: true });
    const san = ['DNS:localhost', 'IP:127.0.0.1', ...lanIps().map((ip) => `IP:${ip}`)].join(',');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
      '-keyout', key, '-out', cert, '-subj', '/CN=pie-booth', '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

const paired = (req) => (req.headers.cookie ?? '').split(/;\s*/).includes(`pie_k=${KEY}`);

// https://<lan ip>:PHONE_PORT -> http://localhost:<vite port>, including the HMR WebSocket.
function startPhoneProxy(port) {
  const target = { host: 'localhost', port };
  const headers = (h) => ({ ...h, host: `localhost:${port}` });
  const server = https.createServer(certificate(), (req, res) => {
    const url = new URL(req.url, 'https://x');
    if (url.searchParams.get('k') === KEY) {                 // first visit from the QR code: remember the key
      url.searchParams.delete('k');
      res.writeHead(302, { 'Set-Cookie': `pie_k=${KEY}; Path=/; HttpOnly; Secure; SameSite=Strict`, Location: url.pathname + url.search });
      return res.end();
    }
    if (!paired(req)) { res.statusCode = 403; return res.end('Scan the QR code at the booth to play.'); }
    const up = http.request({ ...target, path: req.url, method: req.method, headers: headers(req.headers) }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { res.statusCode = 502; res.end('booth not running'); });
    req.pipe(up);
  });
  server.on('upgrade', (req, socket, head) => {
    if (!paired(req)) return socket.destroy();
    const up = net.connect(target, () => {
      const lines = Object.entries(headers(req.headers)).map(([k, v]) => `${k}: ${v}`);
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
      up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });
  server.on('error', (e) => console.error(`[remote] phone server: ${e.message}`));
  server.listen(PHONE_PORT, '0.0.0.0', () => {
    for (const ip of lanIps()) console.log(`[remote] phone controller: https://${ip}:${PHONE_PORT}/remote.html?k=${KEY}`);
  });
  return server;
}

export function remote() {
  return {
    name: 'remote',
    configureServer(server) {
      server.ws.on('pie:remote', (data) => server.ws.send('pie:remote', data)); // everyone hears; each side filters by `to`

      server.middlewares.use('/api/remote/info', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        // only the laptop itself may ask (the phone server never forwards this: it answers 403 without the key)
        res.end(JSON.stringify({ urls: lanIps().map((ip) => `https://${ip}:${PHONE_PORT}/remote.html?k=${KEY}`) }));
      });

      let proxy = null;
      server.httpServer?.once('listening', () => { proxy = startPhoneProxy(server.httpServer.address().port); });
      server.httpServer?.on('close', () => proxy?.close());
    },
  };
}
