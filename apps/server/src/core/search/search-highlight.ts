function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

// Substring matches cannot use ts_headline: its parser has the same word
// boundaries as the full-text index that misses words inside Chinese text.
export function highlightSubstrings(text: string, terms: string[]) {
  const normalizedText = text.replace(/\s+/g, ' ');
  const pattern = terms
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  if (!pattern) {
    return { highlight: escapeHtml(normalizedText), matchedText: [] };
  }

  const matchedText = new Set<string>();
  let highlight = '';
  let cursor = 0;
  for (const match of normalizedText.matchAll(new RegExp(pattern, 'giu'))) {
    highlight += escapeHtml(normalizedText.slice(cursor, match.index));
    highlight += `<b>${escapeHtml(match[0])}</b>`;
    matchedText.add(match[0]);
    cursor = match.index + match[0].length;
  }
  highlight += escapeHtml(normalizedText.slice(cursor));

  return { highlight, matchedText: [...matchedText] };
}
