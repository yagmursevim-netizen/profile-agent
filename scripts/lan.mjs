import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createSecureContext } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { parseLanConfig } from '../server/network.mjs';
import { createGateway } from '../server/lan-gateway.mjs';
try {
  process.loadEnvFile('.env');
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
let config, cert, key;
try {
  config = parseLanConfig(
    JSON.parse(await readFile('.local/lan.json', 'utf8')),
  );
  cert = await readFile('.local/tls/server.pem');
  key = await readFile('.local/tls/server-key.pem');
  createSecureContext({ cert, key });
  const certificate = new X509Certificate(cert);
  if (
    !certificate.checkIP(config.host) ||
    Date.parse(certificate.validTo) <= Date.now()
  )
    throw new Error('Sertifika bu IP için geçerli değil veya süresi dolmuş.');
} catch (e) {
  console.error(
    `Ağ kurulumu eksik veya geçersiz: ${e.message}\nÖnce npm run lan:setup çalıştırın.`,
  );
  process.exit(1);
}
try {
  await access('dist/server/wrangler.json');
} catch {
  console.error('Önce npm run build çalıştırın.');
  process.exit(1);
}
async function available(host, port) {
  await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(port, host, () => s.close(resolve));
  });
}
try {
  await available('127.0.0.1', 4318);
  await available('127.0.0.1', 3000);
  await available(config.host, config.port);
} catch (e) {
  console.error(
    `Port açılamadı (${e.code}). npm run dev veya eski npm run lan işlemini kendi Terminal penceresinde Ctrl+C ile durdurun.`,
  );
  process.exit(1);
}
const env = {
  ...process.env,
  API_PORT: '4318',
  APP_LAN_ORIGIN: config.origin,
  WRANGLER_WRITE_LOGS: 'false',
  WRANGLER_LOG_PATH: '.wrangler/logs',
  MINIFLARE_REGISTRY_PATH: '.wrangler/registry',
};
const children = [
  spawn(process.execPath, ['server/index.mjs'], { env, stdio: 'inherit' }),
  spawn(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'dev',
      '--config',
      'dist/server/wrangler.json',
      '--ip',
      '127.0.0.1',
      '--port',
      '3000',
      '--inspector-port',
      '0',
    ],
    { env, stdio: 'inherit' },
  ),
];
const gateway = createGateway({ ...config, cert, key });
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  gateway.close();
  gateway.closeAllConnections();
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => {
    for (const c of children) if (c.exitCode === null) c.kill('SIGKILL');
    process.exit(code);
  }, 5000);
}
for (const c of children) {
  c.on('error', () => stop(1));
  c.on('exit', (code) => stop(code || 0));
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
gateway.on('error', (e) => {
  console.error(`HTTPS açılamadı: ${e.message}`);
  stop(1);
});
gateway.listen(config.port, config.host, () =>
  console.log(
    `\nHiwell Partner Studio · ${config.origin}\nAna Mac açık ve uyanık kalmalı. Diğer bilgisayarlar bu adresi kullanabilir.\n`,
  ),
);
