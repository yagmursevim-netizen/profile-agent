import { spawn } from 'node:child_process';
const children = [
  // Headroom above Node's default heap limit, which a large jobs.json
  // can otherwise reach.
  spawn(process.execPath, ['--max-old-space-size=4096', 'server/index.mjs'], {
    stdio: 'inherit',
  }),
  spawn(
    process.execPath,
    [
      'node_modules/vinext/dist/cli.js',
      'dev',
      '--host',
      '127.0.0.1',
      '--port',
      '3000',
    ],
    { stdio: 'inherit' },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const p of children) p.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1000);
}
children.forEach((p) => {
  p.on('error', (e) => {
    console.error(e);
    stop(1);
  });
  p.on('exit', (code) => stop(code ?? 0));
});
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
