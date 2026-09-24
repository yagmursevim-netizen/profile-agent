export function platformName(value = 'instagram') {
  if (!['instagram', 'tiktok'].includes(value))
    throw new Error('Geçersiz platform.');
  return value;
}
export function profileUrl(handle, platform = 'instagram') {
  return platform === 'tiktok'
    ? `https://www.tiktok.com/@${encodeURIComponent(handle)}`
    : `https://www.instagram.com/${encodeURIComponent(handle)}/`;
}
export function searchTerms(text) {
  const terms = [
    ...new Set(
      String(text)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (!terms.length || terms.length > 20 || terms.some((s) => s.length > 100))
    throw new Error(
      'Her satıra bir arama yazın; en fazla 20 arama ve arama başına 100 karakter.',
    );
  return terms;
}
