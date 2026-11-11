// What the test DOM lacks and the app's modules expect when they load.
import { vi } from 'vitest';

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia;

// The editor measures text; here there is nothing to measure.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

// The backend is not there: commands answer with nothing.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async () => null,
  convertFileSrc: (path: string, scheme: string) => `${scheme}://localhost/${encodeURIComponent(path)}`,
}));
