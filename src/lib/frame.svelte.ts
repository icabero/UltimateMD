// The window frame. By default the app draws its own title bar: on macOS the
// system buttons sit over the app, elsewhere the app has its own. Anyone can
// go back to the system's title bar in Settings, without restarting.
import { getCurrentWindow } from '@tauri-apps/api/window';

const KEY = 'ultimatemd.nativeFrame';

export const IS_MAC = /Mac/i.test(navigator.platform || navigator.userAgent);

function loadNative() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** The window, or null outside the app, as in the interface tests. */
function current() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

class Frame {
  /** The system's title bar instead of the app's own. */
  native = $state(loadNative());
  maximized = $state(false);

  get own() {
    return !this.native;
  }

  /** Makes the window match the choice. Called before the window first shows. */
  async apply() {
    const win = current();
    if (!win) return;
    try {
      if (IS_MAC) await win.setTitleBarStyle(this.native ? 'visible' : 'overlay');
      else await win.setDecorations(this.native);
    } catch {
      // A system that refuses keeps the frame it has.
    }
  }

  async setNative(native: boolean) {
    this.native = native;
    try {
      localStorage.setItem(KEY, native ? '1' : '0');
    } catch {
      // Lasts for this session only.
    }
    await this.apply();
  }

  /** Follows maximising from any source: the button, a double click or the system. */
  async watch() {
    const win = current();
    if (!win) return;
    const update = async () => {
      this.maximized = await win.isMaximized().catch(() => false);
    };
    await update();
    await win.onResized(update).catch(() => undefined);
  }

  minimize() {
    void current()?.minimize().catch(() => undefined);
  }

  toggleMaximize() {
    void current()?.toggleMaximize().catch(() => undefined);
  }

  close() {
    void current()?.close().catch(() => undefined);
  }
}

export const frame = new Frame();
