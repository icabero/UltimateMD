import type { Key } from './i18n.svelte';

/** What each version brought, the things worth telling. Keyed by major.minor. */
export const NEWS: Record<string, { title: Key; text: Key }[]> = {
  '0.7': [
    { title: 'news.07.ai', text: 'news.07.aiText' },
    { title: 'news.07.history', text: 'news.07.historyText' },
    { title: 'news.07.search', text: 'news.07.searchText' },
    { title: 'news.07.tags', text: 'news.07.tagsText' },
    { title: 'news.07.find', text: 'news.07.findText' },
    { title: 'news.07.writing', text: 'news.07.writingText' },
    { title: 'news.07.reading', text: 'news.07.readingText' },
    { title: 'news.07.diagrams', text: 'news.07.diagramsText' },
    { title: 'news.07.export', text: 'news.07.exportText' },
    { title: 'news.07.vaults', text: 'news.07.vaultsText' },
  ],
};

const SEEN_KEY = 'ultimatemd.newsSeen';

/** `0.7` from `0.7.2`. */
export const series = (version: string) => version.replace(/^v/, '').split('.').slice(0, 2).join('.');

/** The newest version with news that is not newer than `version`. */
export function newsFor(version: string) {
  const [major, minor] = series(version).split('.').map(Number);
  const known = Object.keys(NEWS)
    .map((s) => s.split('.').map(Number))
    .filter(([a, b]) => a < major || (a === major && b <= minor))
    .sort((x, y) => y[0] - x[0] || y[1] - x[1])[0];
  return known ? known.join('.') : null;
}

/**
 * The news to show on this start, if any: those of the running version, once,
 * to someone who used an older one. A first run shows the tutorial instead.
 */
export function unseenNews(version: string): string | null {
  const current = newsFor(version);
  try {
    const seen = localStorage.getItem(SEEN_KEY);
    localStorage.setItem(SEEN_KEY, series(version));
    if (seen === null || !current || seen === series(version)) return null;
    const [a, b] = seen.split('.').map(Number);
    const [c, d] = current.split('.').map(Number);
    return c > a || (c === a && d > b) ? current : null;
  } catch {
    return null;
  }
}
