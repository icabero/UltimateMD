import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { api, type TreeNode, type Vault, type VaultThemes } from './api';
import { withColors, type DiagramStyle } from './diagramStyle';
import { tr } from './i18n.svelte';
import { baseName, dirName, join, kindOf, resolveLink, type FileKind } from './paths';
import { checksAtStart, isNewer, latestVersion } from './updates';
import { THEMES, applyTheme, frontmatterValue, resolveTheme, themeById, type Theme } from './themes';

export type ViewMode = 'visual' | 'edit' | 'split' | 'preview';

export interface Tab {
  key: string;
  vaultId: string;
  path: string;
  kind: FileKind;
  content: string;
  version: string | null;
  dirty: boolean;
  saving: boolean;
  view: ViewMode;
  /** Bumped when content changes from outside the editor. */
  revision: number;
  /** A different version on disk while this tab has unsaved edits. */
  conflict: { content: string; version: string } | null;
  missing: boolean;
  /** Set for a file outside any vault: its location on disk. */
  loose: { absolute: string; dir: string } | null;
}

/** A place to show in a tab: a line, with the words of a search marked. Line 0 is the top. */
export interface Reveal {
  key: string;
  line: number;
  terms: string[];
  /** Set when going to a heading: its place among the note's headings, for the preview. */
  heading?: number;
}

export type PanelTab = 'outline' | 'links';

/** Which side bars someone wants. A narrow window hides them anyway. */
interface Layout {
  left: boolean;
  right: boolean;
  panelTab: PanelTab;
  rightWidth: number;
}

export interface Dialog {
  title: string;
  /** Text field value. Null for a yes/no question. */
  value: string | null;
  action: string;
  danger: boolean;
  resolve: (value: string | null) => void;
}

const SAVE_DELAY = 700;
const SESSION_KEY = 'ultimatemd.session';
const THEME_KEY = 'ultimatemd.theme';
const TUTORIAL_KEY = 'ultimatemd.tutorial';
const VIEW_KEY = 'ultimatemd.view';
const LAYOUT_KEY = 'ultimatemd.layout';
/** Below these window widths a side bar folds away by itself. */
const LEFT_MIN = 760;
const RIGHT_MIN = 1080;
const VIEWS: ViewMode[] = ['visual', 'edit', 'split', 'preview'];

/** `fixed` null means following the system, with one theme for each mode. */
export interface ThemeChoice {
  fixed: string | null;
  light: string;
  dark: string;
}

function loadThemeChoice(): ThemeChoice {
  const fallback = { fixed: null, light: 'claro', dark: 'oscuro' };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(THEME_KEY) ?? '{}') };
  } catch {
    return fallback;
  }
}

function loadLayout(): Layout {
  const fallback: Layout = { left: true, right: false, panelTab: 'outline', rightWidth: 260 };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') };
  } catch {
    return fallback;
  }
}

function loadView(): ViewMode {
  try {
    const saved = localStorage.getItem(VIEW_KEY) as ViewMode | null;
    return saved && VIEWS.includes(saved) ? saved : 'split';
  } catch {
    return 'split';
  }
}

function tutorialSeen() {
  try {
    return localStorage.getItem(TUTORIAL_KEY) !== null;
  } catch {
    return true;
  }
}

const tabKey = (vaultId: string, path: string) => `${vaultId}:${path}`;
const isText = (kind: FileKind) => kind === 'md' || kind === 'html';

function flatten(nodes: TreeNode[], out: string[] = []) {
  for (const n of nodes) {
    if (n.isDir) flatten(n.children, out);
    else out.push(n.path);
  }
  return out;
}

class Store {
  vaults = $state<Vault[]>([]);
  trees = $state<Record<string, TreeNode[]>>({});
  tabs = $state<Tab[]>([]);
  activeKey = $state<string | null>(null);
  toast = $state<string | null>(null);
  systemDark = $state(matchMedia('(prefers-color-scheme: dark)').matches);
  themeChoice = $state(loadThemeChoice());

  palette = $state(false);
  settings = $state(false);
  searching = $state(false);
  exporting = $state(false);
  tutorial = $state(!tutorialSeen());
  about = $state(false);
  /** A newer published version, once known. */
  update = $state<string | null>(null);
  /** The view new tabs open in: the last one the user chose. */
  preferredView = $state(loadView());
  dialog = $state<Dialog | null>(null);
  vaultThemes = $state<Record<string, VaultThemes>>({});
  themeEditor = $state<string | null>(null);
  /** The vault whose Word settings are open. */
  wordScreen = $state<string | null>(null);
  /** Taken by the editor, or the preview when it shows alone. */
  reveal = $state<Reveal | null>(null);
  layout = $state(loadLayout());
  windowWidth = $state(innerWidth);
  /** A bar shown by hand while the window is too narrow for it. It folds again once the width changes enough. */
  peek = $state({ left: false, right: false });
  /** The line with the cursor, or the top of the preview when it shows alone. */
  position = $state<{ key: string; line: number } | null>(null);

  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #toastTimer: ReturnType<typeof setTimeout> | undefined;

  get theme(): Theme {
    const { fixed, light, dark } = this.themeChoice;
    const id = fixed ?? (this.systemDark ? dark : light);
    return themeById(id) ?? THEMES[0];
  }

  /** Finds a theme by id: this vault's own first, then the built-in ones. */
  lookUpTheme(vaultId: string, id: string | null | undefined) {
    if (!id) return null;
    const file = this.vaultThemes[vaultId]?.themes.find((t) => t.id === id);
    return file ? resolveTheme(file) : (themeById(id) ?? null);
  }

  /** The theme of a note's content: note, then vault, then application. */
  noteTheme(tab: Tab) {
    return (
      this.lookUpTheme(tab.vaultId, frontmatterValue(tab.content, 'tema')) ??
      this.lookUpTheme(tab.vaultId, this.vaultThemes[tab.vaultId]?.defaultTheme) ??
      this.theme
    );
  }

  /**
   * A diagram's look: its own style, then its note, then its vault, and finally
   * the note's theme. `boceto` keeps the colours it would have had, hand-drawn.
   */
  diagramLook(tab: Tab, style: DiagramStyle = {}, note = tab.content, fallback?: Theme) {
    const value = style.theme ?? frontmatterValue(note, 'tema-diagramas') ?? this.vaultThemes[tab.vaultId]?.defaultDiagramTheme ?? null;
    const theme = (value !== 'boceto' && this.lookUpTheme(tab.vaultId, value)) || fallback || this.noteTheme(tab);
    return { theme: withColors(theme, style), sketch: !!style.sketch || value === 'boceto' };
  }

  /** Follows a `[[link]]` written in a note, offering to create it if it is missing. */
  async followLink(tab: Tab, name: string) {
    const path = resolveLink(name, tab.path, this.files(tab.vaultId));
    if (path) return this.openFile(tab.vaultId, path);
    if (await this.confirm(tr('preview.createMissing', { name }), tr('common.create'))) await this.createNote(tab.vaultId, dirName(tab.path), name);
  }

  async loadVaultThemes(id: string) {
    const loaded = await api.vaultThemes(id).catch(() => null);
    if (!loaded) return;
    this.vaultThemes[id] = loaded;
    if (loaded.invalid.length) this.notify(tr('store.invalidThemes', { list: loaded.invalid.join(', ') }));
  }

  setThemeChoice(change: Partial<ThemeChoice>) {
    this.themeChoice = { ...this.themeChoice, ...change };
    try {
      localStorage.setItem(THEME_KEY, JSON.stringify(this.themeChoice));
    } catch {
      // The choice lasts for this session only.
    }
  }

  closeTutorial() {
    this.tutorial = false;
    try {
      localStorage.setItem(TUTORIAL_KEY, '1');
    } catch {
      // It may show again next time.
    }
  }

  setView(tab: Tab, view: ViewMode) {
    tab.view = view;
    this.preferredView = view;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // New tabs fall back to the default view.
    }
    this.persist();
  }

  /** Quiet on failure: being offline is no reason to bother anyone. */
  async checkUpdates() {
    if (!checksAtStart()) return;
    try {
      const [latest, current] = await Promise.all([latestVersion(), getVersion()]);
      if (latest && isNewer(latest, current)) this.update = latest;
    } catch {
      // The next start tries again, and About can check by hand.
    }
  }

  get active() {
    return this.tabs.find((t) => t.key === this.activeKey) ?? null;
  }

  get openVaults() {
    return this.vaults.filter((v) => v.open);
  }

  vault(id: string) {
    return this.vaults.find((v) => v.id === id);
  }

  files(vaultId: string) {
    return flatten(this.trees[vaultId] ?? []);
  }

  notify(message: unknown) {
    this.toast = String(message);
    clearTimeout(this.#toastTimer);
    this.#toastTimer = setTimeout(() => (this.toast = null), 4500);
  }

  #ask(title: string, value: string | null, action: string, danger: boolean) {
    return new Promise<string | null>((resolve) => {
      this.dialog = {
        title, value, action, danger,
        resolve: (result) => {
          this.dialog = null;
          resolve(result);
        },
      };
    });
  }

  prompt(title: string, value = '', action = tr('common.accept')) {
    return this.#ask(title, value, action, false);
  }

  async confirm(title: string, action: string, danger = false) {
    return (await this.#ask(title, null, action, danger)) !== null;
  }

  constructor() {
    // Before the first paint, so the app never flashes the wrong colours.
    applyTheme(this.theme);
  }

  async init() {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => (this.systemDark = e.matches));
    await listen<{ vaultId: string; paths: string[] }>('vault-changed', (e) => this.onChanged(e.payload));
    await listen<string>('themes-changed', (e) => this.loadVaultThemes(e.payload));
    await listen<string[]>('open-files', (e) => this.openPaths(e.payload));
    await this.loadVaults();
    await this.restore();
    await this.openPaths(await api.takePendingFiles());
    void this.checkUpdates();
  }

  async loadVaults() {
    this.vaults = await api.listVaults();
    await Promise.all(this.openVaults.flatMap((v) => [this.refreshTree(v.id), this.loadVaultThemes(v.id)]));
  }

  async refreshTree(id: string) {
    try {
      this.trees[id] = await api.tree(id);
    } catch (e) {
      this.trees[id] = [];
      this.notify(e);
    }
  }

  async addVault(run: () => Promise<Vault>) {
    try {
      const vault = await run();
      await this.loadVaults();
      return vault;
    } catch (e) {
      this.notify(e);
    }
  }

  async setVaultOpen(id: string, open: boolean) {
    if (!open) {
      for (const tab of this.tabs.filter((t) => t.vaultId === id)) await this.close(tab);
    }
    await api.setVaultOpen(id, open);
    await this.loadVaults();
  }

  async removeVault(id: string) {
    for (const tab of this.tabs.filter((t) => t.vaultId === id)) await this.close(tab);
    await api.removeVault(id);
    await this.loadVaults();
  }

  /** Opens files by absolute path, as handed over by the operating system. */
  async openPaths(paths: string[]) {
    for (const path of paths) {
      try {
        const opened = await api.openPath(path);
        if (opened.kind === 'vault') {
          await this.loadVaults();
          await this.openFile(opened.vaultId, opened.path);
        } else {
          await this.openFile(opened.id, opened.name, { absolute: opened.absolute, dir: opened.dir });
        }
      } catch (e) {
        this.notify(tr('store.openFailed', { path, error: String(e) }));
      }
    }
  }

  /** Turns the folder of a loose file into a vault and reopens the file there. */
  async adoptFolder(tab: Tab) {
    if (!tab.loose) return;
    const { absolute, dir } = tab.loose;
    await this.addVault(() => api.openVault(dir));
    await this.close(tab);
    await this.openPaths([absolute]);
  }

  /** Where a tab's file lives, for display. */
  location(tab: Tab) {
    return tab.loose ? tab.loose.dir : (this.vault(tab.vaultId)?.name ?? '');
  }

  async openFile(vaultId: string, path: string, loose: Tab['loose'] = null) {
    const key = tabKey(vaultId, path);
    if (this.tabs.some((t) => t.key === key)) {
      this.activeKey = key;
      this.persist();
      return;
    }
    const kind = kindOf(path);
    if (kind === 'other') {
      // Not text this app can edit: hand it to the system's default program.
      await api.openWithSystem(vaultId, path).catch((e) => this.notify(e));
      return;
    }
    let content = '';
    let version: string | null = null;
    if (isText(kind)) {
      try {
        ({ content, version } = await api.read(vaultId, path));
      } catch (e) {
        this.notify(e);
        return;
      }
    }
    this.tabs.push({
      key, vaultId, path, kind, content, version,
      dirty: false, saving: false, view: kind === 'md' || this.preferredView !== 'visual' ? this.preferredView : 'split', revision: 0, conflict: null, missing: false, loose,
    });
    this.activeKey = key;
    this.persist();
  }

  get showLeft() {
    return this.windowWidth >= LEFT_MIN ? this.layout.left : this.peek.left;
  }

  get showRight() {
    return this.windowWidth >= RIGHT_MIN ? this.layout.right : this.peek.right;
  }

  /** Shows or hides a side bar. In a narrow window the change lasts until it widens. */
  toggleBar(side: 'left' | 'right', show?: boolean) {
    const min = side === 'left' ? LEFT_MIN : RIGHT_MIN;
    const next = show ?? !(side === 'left' ? this.showLeft : this.showRight);
    if (this.windowWidth >= min) {
      this.layout[side] = next;
      this.saveLayout();
    } else {
      this.peek[side] = next;
    }
  }

  setWindowWidth(width: number) {
    // Crossing a threshold forgets bars shown by hand while it was narrow.
    if ((this.windowWidth < LEFT_MIN) !== (width < LEFT_MIN)) this.peek.left = false;
    if ((this.windowWidth < RIGHT_MIN) !== (width < RIGHT_MIN)) this.peek.right = false;
    this.windowWidth = width;
  }

  openPanel(tab: PanelTab) {
    this.layout.panelTab = tab;
    this.toggleBar('right', true);
    this.saveLayout();
  }

  saveLayout() {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layout));
    } catch {
      // Only a convenience.
    }
  }

  /** Opens a note at a line, with the words of a search marked. */
  async openAt(vaultId: string, path: string, line: number, terms: string[]) {
    await this.openFile(vaultId, path);
    const key = tabKey(vaultId, path);
    if (this.activeKey === key) this.reveal = { key, line, terms };
  }

  edit(tab: Tab, content: string) {
    if (content === tab.content) return;
    tab.content = content;
    tab.dirty = true;
    clearTimeout(this.#timers.get(tab.key));
    this.#timers.set(tab.key, setTimeout(() => this.save(tab), SAVE_DELAY));
  }

  async save(tab: Tab) {
    clearTimeout(this.#timers.get(tab.key));
    if (!tab.dirty || tab.saving || tab.conflict || tab.missing) return;
    tab.saving = true;
    const text = tab.content;
    try {
      tab.version = await api.write(tab.vaultId, tab.path, text, tab.version);
      tab.dirty = tab.content !== text;
    } catch (e) {
      if (String(e).includes('changed since')) await this.detectConflict(tab);
      else this.notify(e);
    } finally {
      tab.saving = false;
    }
    if (tab.dirty && !tab.conflict) this.#timers.set(tab.key, setTimeout(() => this.save(tab), SAVE_DELAY));
  }

  async saveAll() {
    await Promise.all(this.tabs.map((t) => this.save(t)));
  }

  async detectConflict(tab: Tab) {
    const disk = await api.read(tab.vaultId, tab.path);
    if (disk.version !== tab.version && disk.content !== tab.content) {
      tab.conflict = { content: disk.content, version: disk.version };
    } else tab.version = disk.version;
  }

  /** Takes the version on disk, discarding the edits in this tab. */
  acceptDisk(tab: Tab) {
    if (!tab.conflict) return;
    tab.content = tab.conflict.content;
    tab.version = tab.conflict.version;
    tab.conflict = null;
    tab.dirty = false;
    tab.revision++;
  }

  /** Keeps the edits in this tab, replacing the version on disk. */
  async keepMine(tab: Tab) {
    if (!tab.conflict) return;
    tab.version = tab.conflict.version;
    tab.conflict = null;
    tab.dirty = true;
    await this.save(tab);
  }

  async close(tab: Tab) {
    await this.save(tab);
    const name = baseName(tab.path);
    if (tab.conflict && !(await this.confirm(tr('store.closeConflict', { name }), tr('common.close'), true))) return;
    const i = this.tabs.findIndex((t) => t.key === tab.key);
    if (i < 0) return;
    this.tabs.splice(i, 1);
    if (tab.loose) await api.closeLoose(tab.vaultId);
    if (this.activeKey === tab.key) this.activeKey = this.tabs[Math.min(i, this.tabs.length - 1)]?.key ?? null;
    this.persist();
  }

  cycleTab(step: number) {
    if (this.tabs.length < 2) return;
    const i = this.tabs.findIndex((t) => t.key === this.activeKey);
    this.activeKey = this.tabs[(i + step + this.tabs.length) % this.tabs.length].key;
  }

  async onChanged({ vaultId, paths }: { vaultId: string; paths: string[] }) {
    const inVault = this.tabs.every((t) => t.vaultId !== vaultId || !t.loose);
    if (inVault) await this.refreshTree(vaultId);
    const known = new Set(this.files(vaultId));
    for (const tab of this.tabs) {
      if (tab.vaultId !== vaultId || !paths.includes(tab.path)) continue;
      if (tab.loose) tab.missing = !(await api.read(vaultId, tab.path).catch(() => null));
      else tab.missing = !known.has(tab.path);
      if (tab.missing) continue;
      if (!isText(tab.kind)) {
        tab.revision++;
        continue;
      }
      const disk = await api.read(vaultId, tab.path).catch(() => null);
      if (!disk || disk.version === tab.version) continue;
      if (tab.dirty) {
        await this.detectConflict(tab);
      } else {
        tab.content = disk.content;
        tab.version = disk.version;
        tab.revision++;
      }
    }
  }

  async createNote(vaultId: string, dir: string, name: string) {
    const file = /\.(md|markdown|html?)$/i.test(name) ? name : `${name}.md`;
    const path = join(dir, file);
    try {
      await api.create(vaultId, path, '');
      await this.refreshTree(vaultId);
      await this.openFile(vaultId, path);
    } catch (e) {
      this.notify(e);
    }
  }

  async createFolder(vaultId: string, dir: string, name: string) {
    try {
      await api.createDir(vaultId, join(dir, name));
      await this.refreshTree(vaultId);
    } catch (e) {
      this.notify(e);
    }
  }

  /** Moves a file or folder, repoints any tabs inside it and rewrites the links that would break. */
  async move(vaultId: string, from: string, to: string) {
    if (from === to) return;
    await this.saveAll();
    let update;
    try {
      update = await api.rename(vaultId, from, to);
    } catch (e) {
      this.notify(e);
      return;
    }
    for (const tab of this.tabs) {
      if (tab.vaultId !== vaultId) continue;
      if (tab.path === from || tab.path.startsWith(`${from}/`)) {
        const wasActive = this.activeKey === tab.key;
        tab.path = to + tab.path.slice(from.length);
        tab.kind = kindOf(tab.path);
        tab.key = tabKey(vaultId, tab.path);
        if (wasActive) this.activeKey = tab.key;
      }
    }
    // Open tabs of the notes rewritten show the new links.
    await this.onChanged({ vaultId, paths: update.notes });
    this.persist();
    const { links, notes } = update;
    if (links === 0) return;
    const note = baseName(notes[0]).replace(/\.(md|markdown)$/i, '');
    if (notes.length > 1) this.notify(tr('links.updatedMany', { links, notes: notes.length }));
    else this.notify(tr(links === 1 ? 'links.updatedOne' : 'links.updatedNote', { links, note }));
  }

  async renameEntry(vaultId: string, path: string, name: string) {
    await this.move(vaultId, path, join(dirName(path), name));
  }

  async trash(vaultId: string, path: string) {
    try {
      await api.trash(vaultId, path);
    } catch (e) {
      this.notify(e);
      return;
    }
    for (const tab of this.tabs.filter((t) => t.vaultId === vaultId && (t.path === path || t.path.startsWith(`${path}/`)))) {
      tab.dirty = false;
      await this.close(tab);
    }
    await this.refreshTree(vaultId);
  }

  persist() {
    try {
      const open = this.tabs.map(({ vaultId, path, view, loose }) => ({ vaultId, path, view, file: loose?.absolute }));
      localStorage.setItem(SESSION_KEY, JSON.stringify({ open, active: this.activeKey }));
    } catch {
      // The session is a convenience; the app works without it.
    }
  }

  async restore() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const { open, active } = JSON.parse(raw) as {
        open: { vaultId: string; path: string; view: ViewMode; file?: string }[];
        active: string | null;
      };
      for (const { vaultId, path, view, file } of open) {
        if (file) {
          // A loose file gets a new id each run, and may no longer exist.
          const opened = await api.openPath(file).catch(() => null);
          if (opened?.kind === 'loose') await this.openFile(opened.id, opened.name, opened);
          else continue;
        } else {
          if (!this.vault(vaultId)?.open || !this.files(vaultId).includes(path)) continue;
          await this.openFile(vaultId, path);
        }
        if (this.active) this.active.view = view;
      }
      if (active && this.tabs.some((t) => t.key === active)) this.activeKey = active;
    } catch {
      // A damaged session only means starting with no tabs.
    }
  }
}

export const store = new Store();
