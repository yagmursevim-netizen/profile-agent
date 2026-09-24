import { profileSignals } from './profile-signals.mjs';
export function cachedProfile(jobs, handle, platform = 'instagram') {
  const candidates = jobs
    .filter((j) => !j.demo && (j.platform || 'instagram') === platform)
    .flatMap((j) => j.rows.map((row) => ({ row, jobId: j.id })));
  const found = candidates
    .filter(
      ({ row }) =>
        row.username.toLowerCase() === handle.toLowerCase() &&
        (!row.error ||
          row.partialRead === true ||
          row.error ===
            'Bazı profil alanları Instagram tarafından verilmedi; eksik alanlar null bırakıldı.') &&
        typeof row.bio === 'string',
    )
    .sort(
      (a, b) =>
        (Date.parse(b.row.collectedAt) || 0) -
        (Date.parse(a.row.collectedAt) || 0),
    )[0];
  return found
    ? {
        ...structuredClone(found.row),
        ...profileSignals(found.row.bio),
        cachedFromJobId: found.row.cachedFromJobId || found.jobId,
        reused: true,
      }
    : null;
}
export function cachedFollowing(jobs, source, limit, platform = 'instagram') {
  for (const j of jobs) {
    if (
      (j.platform || 'instagram') !== platform ||
      j.demo ||
      j.mode !== 'following'
    )
      continue;
    let saved = j.sourceLists?.[source];
    // Older completed, single-source scans also contain their discovered list.
    if (
      !saved &&
      j.sources.length === 1 &&
      j.sources[0] === source &&
      ['completed', 'partial'].includes(j.status) &&
      j.rows.length === j.total &&
      j.rows.length
    ) {
      saved = {
        users: j.rows.map((r) => r.username),
        requestedLimit: j.limit,
        warning: j.warnings.filter(Boolean).join(' '),
      };
    }
    if (!saved || saved.requestedLimit < limit || !saved.users.length) continue;
    return { ...saved, users: saved.users.slice(0, limit), reused: true };
  }
  return null;
}
// Usernames the user (or AI) already marked "Uygun değil" in any past job —
// used to skip them during future following-list scans instead of
// re-collecting and re-showing candidates already ruled out once.
export function rejectedUsernames(jobs, platform = 'instagram') {
  const set = new Set();
  for (const j of jobs) {
    if (j.demo || (j.platform || 'instagram') !== platform) continue;
    for (const row of j.rows)
      if (row.ai?.verdict === 'Uygun değil')
        set.add(row.username.toLowerCase());
  }
  return set;
}
export function needsInstagram(
  jobs,
  sources,
  mode,
  limit,
  platform = 'instagram',
) {
  const targets =
    mode === 'following'
      ? sources.flatMap(
          (source) =>
            cachedFollowing(jobs, source, limit, platform)?.users || [null],
        )
      : sources;
  return targets.some(
    (handle) => !handle || !cachedProfile(jobs, handle, platform),
  );
}
