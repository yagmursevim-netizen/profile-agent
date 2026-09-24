/** @template T @param {T[]} rows @param {object} [f] @returns {T[]} */
export function selectProfiles(rows, f = {}) {
  const q = String(f.q || '').toLocaleLowerCase('tr');
  const bound = (v) =>
    v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0
      ? Number(v)
      : null;
  const min = bound(f.minFollowers),
    max = bound(f.maxFollowers);
  const selected = rows.filter(
    (r) =>
      (!q ||
        `${r.username} ${r.email ?? ''} ${r.bio ?? ''}`
          .toLocaleLowerCase('tr')
          .includes(q)) &&
      // emailOnly and dmOnly combine with OR, not AND — checking both means
      // "has an email OR a DM signal", not "must have both at once" (a
      // profile rarely has both, so AND would hide almost everything).
      ((!f.emailOnly && !f.dmOnly) ||
        (f.emailOnly && !!r.email) ||
        (f.dmOnly && !!r.dmForCollaboration)) &&
      (!f.publicOnly || r.private === false) &&
      (min === null || (r.followers != null && r.followers >= min)) &&
      (max === null || (r.followers != null && r.followers <= max)) &&
      // fit accepts multiple selected verdicts (OR match) so pills in the
      // UI can be combined instead of one at a time.
      (!f.fit ||
        !f.fit.length ||
        f.fit.some((v) =>
          v === '__unassessed__' ? !r.ai : r.ai?.verdict === v,
        )),
  );
  const [key, direction] = String(f.sort || 'original').split(':');
  if (!['followers', 'following', 'username', 'collectedAt'].includes(key))
    return selected;
  return selected.sort((a, b) => {
    const x = a[key],
      y = b[key];
    if (x == null || x === '') return y == null || y === '' ? 0 : 1;
    if (y == null || y === '') return -1;
    const comparison =
      key === 'followers' || key === 'following'
        ? x - y
        : String(x).localeCompare(String(y), 'tr', { numeric: true });
    return comparison * (direction === 'asc' ? 1 : -1);
  });
}
