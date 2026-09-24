import { isIP } from 'node:net';
export function privateIPv4(host) {
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split('.').map(Number);
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}
export function allowedOrigin(origin, port, lanOrigin = '') {
  const allowed = lanOrigin
    ? [lanOrigin]
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
      ];
  return origin ? allowed.includes(origin) : !lanOrigin;
}
export function parseLanConfig(config) {
  const port = Number(config.port || 3443);
  if (
    !privateIPv4(config.host) ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535
  )
    throw new Error(
      'Ağ ayarı için özel bir IPv4 adresi ve 1024–65535 arası port gerekiyor. npm run lan:setup komutunu çalıştırın.',
    );
  return { host: config.host, port, origin: `https://${config.host}:${port}` };
}
