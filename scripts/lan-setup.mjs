import { spawnSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { privateIPv4, parseLanConfig } from '../server/network.mjs';
const candidates = [
  ...new Set(
    Object.entries(networkInterfaces())
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([, entries]) =>
        (entries || [])
          .filter((e) => !e.internal && privateIPv4(e.address))
          .map((e) => e.address),
      ),
  ),
];
const args = process.argv.slice(2);
const index = args.indexOf('--host');
const host =
  index >= 0 ? args[index + 1] : candidates.length === 1 ? candidates[0] : '';
if (!host || !candidates.includes(host)) {
  console.error(
    `Ana bilgisayarın ağ adresini belirtin: npm run lan:setup -- --host ADRES\nBulunan adresler: ${candidates.join(', ') || 'yok; ofis ağına bağlanın'}`,
  );
  process.exit(1);
}
const config = parseLanConfig({ host, port: 3443 });
const check = spawnSync('mkcert', ['-version'], { stdio: 'ignore' });
if (check.status !== 0) {
  console.error('Önce mkcert kurun. macOS/Homebrew: brew install mkcert');
  process.exit(1);
}
const dir = path.resolve('.local/tls');
await mkdir(dir, { recursive: true, mode: 0o700 });
const env = { ...process.env, CAROOT: dir };
console.log(
  'Bu uygulamaya özel HTTPS sertifikası hazırlanıyor. Sistem sertifika güveni için macOS şifreniz istenebilir.',
);
for (const argv of [
  ['-install'],
  [
    '-cert-file',
    path.join(dir, 'server.pem'),
    '-key-file',
    path.join(dir, 'server-key.pem'),
    host,
    'localhost',
    '127.0.0.1',
  ],
]) {
  const result = spawnSync('mkcert', argv, { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(1);
}
for (const file of ['server-key.pem', 'rootCA-key.pem'])
  await chmod(path.join(dir, file), 0o600);
await writeFile(
  '.local/lan.json',
  JSON.stringify({ host, port: 3443 }, null, 2),
  { mode: 0o600 },
);
console.log(
  `\nAğ adresi: ${config.origin}\nBaşlatma: npm run lan\nDiğer bilgisayarlara yalnızca ${path.join(dir, 'rootCA.pem')} dosyasını iletip güvenilir sertifika olarak kurun.\nserver-key.pem ve rootCA-key.pem dosyalarını paylaşmayın.\nIP adresi değişirse kurulumu tekrar çalıştırın.`,
);
