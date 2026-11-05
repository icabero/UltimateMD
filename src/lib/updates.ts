// Compares this build with the latest release published on GitHub. It only tells
// the user; installing stays their decision, on the releases page.

const REPOSITORY = 'icabero/UltimateMD';
const LATEST = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const AUTO_KEY = 'ultimatemd.updates';

export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;

const parts = (version: string) => version.replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0);

export function isNewer(candidate: string, current: string) {
  const [a, b] = [parts(candidate), parts(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return difference > 0;
  }
  return false;
}

/** The latest published version, or null if none has been published yet. */
export async function latestVersion() {
  const response = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const { tag_name: tag } = (await response.json()) as { tag_name: string };
  return tag.replace(/^v/, '');
}

export function checksAtStart() {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setChecksAtStart(on: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');
  } catch {
    // The choice lasts for this session only.
  }
}
