import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
// Tracks who's already been handed out in a previous download, so the next
// pull of the same export only returns people not seen before — separately
// for the DM list (a global, cross-job pool) and per scan job (the "Profil
// listesi" export, re-pulled daily while a long multi-day scan is still
// filling in). No secrets here, just usernames and timestamps, so this is a
// plain JSON file like settings.json rather than anything encrypted.
let state = { dmList: {}, profilesByJob: {} };
try {
  state = JSON.parse(await readFile('.local/export-log.json', 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
let queue = Promise.resolve();
function persist() {
  queue = queue
    .catch(() => {})
    .then(async () => {
      await mkdir('.local', { recursive: true, mode: 0o700 });
      await writeFile('.local/export-log.tmp', JSON.stringify(state), {
        mode: 0o600,
      });
      await rename('.local/export-log.tmp', '.local/export-log.json');
    });
  return queue;
}
const key = (platform, username) => `${platform}:${username.toLowerCase()}`;
export function wasExportedToDmList(platform, username) {
  return !!state.dmList[key(platform, username)];
}
export async function markExportedToDmList(platform, usernames) {
  const now = new Date().toISOString();
  for (const u of usernames) state.dmList[key(platform, u)] = now;
  await persist();
}
export function wasExportedForJob(jobId, platform, username) {
  return !!state.profilesByJob[jobId]?.[key(platform, username)];
}
export async function markExportedForJob(jobId, platform, usernames) {
  const now = new Date().toISOString();
  state.profilesByJob[jobId] ||= {};
  for (const u of usernames) state.profilesByJob[jobId][key(platform, u)] = now;
  await persist();
}
