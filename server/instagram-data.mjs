// Instagram returns Relay/GraphQL JSON with JSON or x-javascript MIME types,
// sometimes prefixed by an anti-XSSI guard or split into newline-delimited chunks.
export function parseInstagramPayload(raw) {
  const text = raw.trim().replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, '');
  try {
    return [JSON.parse(text)];
  } catch {}
  return text.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

export function findProfileObjects(root, handle) {
  const found = [];
  const visit = (value, depth = 0) => {
    if (depth > 80 || !value) return;
    if (typeof value === 'string' && /^[[{]/.test(value)) {
      try {
        visit(JSON.parse(value), depth + 1);
      } catch {}
      return;
    }
    if (typeof value !== 'object') return;
    if (
      String(value.username).toLowerCase() === handle &&
      ('biography' in value ||
        'follower_count' in value ||
        'edge_followed_by' in value)
    )
      found.push(value);
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(root);
  return found;
}

export const FOLLOWING_NAME =
  /^(?:[\d.,\s]+[KMBkmb]?\s+following|following\s+[\d.,\s]+|[\d.,\s]+(?:bin|mn)?\s+takip|takip edilen(?:ler)?(?:\s+[\d.,\s]+)?)$/i;
