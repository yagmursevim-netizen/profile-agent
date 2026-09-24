import https from 'node:https';
import http from 'node:http';
export function createGateway({
  host,
  port,
  cert,
  key,
  webPort = 3000,
  apiPort = 4318,
  publicOrigin,
}) {
  const origin = publicOrigin || `https://${host}:${port}`;
  if (
    publicOrigin &&
    (host !== '127.0.0.1' ||
      !/^https:\/\/[a-z0-9-]+\.ngrok-free\.(dev|app)$/.test(publicOrigin))
  )
    throw new Error('Geçersiz ngrok adresi veya yerel dinleme adresi.');
  const expectedHost = publicOrigin
    ? new URL(publicOrigin).host
    : `${host}:${port}`;
  const handler = (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (
      req.headers.host !== expectedHost ||
      (req.headers.origin && req.headers.origin !== origin)
    ) {
      res.writeHead(403);
      res.end('Geçersiz uygulama adresi.');
      return;
    }
    const pathname = new URL(req.url, origin).pathname;
    if (publicOrigin && pathname.startsWith('/api/tiktok/bridge')) {
      res.writeHead(403);
      res.end('Eklenti bağlantısı yalnızca ana bilgisayarda kullanılabilir.');
      return;
    }
    const api = req.url === '/api' || req.url?.startsWith('/api/');
    if (
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      req.headers.origin !== origin
    ) {
      res.writeHead(403);
      res.end('Uygulama adresinden işlem yapın.');
      return;
    }
    const targetPort = api ? apiPort : webPort;
    const headers = { ...req.headers, host: `127.0.0.1:${targetPort}` };
    for (const name of [
      'forwarded',
      'x-forwarded-for',
      'x-forwarded-host',
      'x-forwarded-proto',
      'connection',
      'upgrade',
      'proxy-authorization',
      'proxy-authenticate',
    ])
      delete headers[name];
    // This is the only network-facing server; the API and compiled web app stay on loopback.
    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: targetPort,
        path: req.url,
        method: req.method,
        headers,
      },
      (reply) => {
        const responseHeaders = { ...reply.headers };
        for (const name of ['connection', 'keep-alive', 'transfer-encoding'])
          delete responseHeaders[name];
        res.writeHead(reply.statusCode || 502, responseHeaders);
        reply.pipe(res);
      },
    );
    upstream.setTimeout(180000, () => upstream.destroy());
    upstream.on('error', () => {
      if (!res.headersSent)
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(
        'Uygulama hazırlanıyor veya yerel servis durdu. Biraz sonra tekrar deneyin.',
      );
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => {
      if (!res.writableEnded) upstream.destroy();
    });
    req.pipe(upstream);
  };
  const gateway = publicOrigin
    ? http.createServer(handler)
    : https.createServer({ cert, key, minVersion: 'TLSv1.2' }, handler);
  gateway.on('upgrade', (_, socket) => socket.destroy());
  return gateway;
}
