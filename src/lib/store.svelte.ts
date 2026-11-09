import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { anchorLabel, findAnchor, parseAnchor } from './anchors';
import { api, type TreeNode, type Vault, type VaultThemes } from './api';
import { fold } from './fold';
import { fillTemplate } from './noteTemplates';
import { withColors, type DiagramStyle } from './diagramStyle';
import { tr } from './i18n.svelte';
import { baseName, dirName, join, kindOf, linkFrom, resolveLink, type FileKind } from './paths';
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

export type PanelTab = 'outline' | 'links' | 'properties';

/** Which side bars someone wants. A narrow window hides them anyway. */
interface Layout {
  left: boolean;
  right: boolean;
  panelTab: PanelTab;
  rightWidth: number;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

/** A notice at the bottom. Long texts, such as errors, show their first line and fold the rest. */
export interface Toast {
  id: number;
  message: string;
  details: string | null;
  actions: ToastAction[];
  /** Runs once when the notice goes, however it goes. */
  onDone?: () => void;
}

const TOAST_TIME = 4500;
/** Longer when there is something to do with it. */
const TOAST_TIME_ACTIONS = 9000;
const TOAST_SHORT = 140;

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
const READING_KEY = 'ultimatemd.reading';
const IMAGES_KEY = 'ultimatemd.images';
/** Where pasted and dropped images go: a folder at the vault root, or beside the note. */
export type ImagePlace = 'vault' | 'note';
export const IMAGE_FOLDER = 'adjuntos';
export const ZOOM = { min: 0.6, max: 2, step: 0.1 };
export const TEXT_SCALES = [0.9, 1, 1.15, 1.3] as const;
export const LINE_WIDTHS = { narrow: '600px', normal: null, wide: '960px', full: 'none' } as const;
export type LineWidth = keyof typeof LINE_WIDTHS;

/** How someone likes to read: the interface zoom, the notes' text size and line width. */
interface Reading {
  zoom: number;
  textScale: number;
  lineWidth: LineWidth;
}
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

function loadReading(): Reading {
  const fallback: Reading = { zoom: 1, textScale: 1, lineWidth: 'normal' };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(READING_KEY) ?? '{}') };
  } catch {
    return fallback;
  }
}

function loadImagePlace(): ImagePlace {
  try {
    return localStorage.getItem(IMAGES_KEY) === 'note' ? 'note' : 'vault';
  } catch {
    return 'vault';
  }
}

function loadLayout(): Layout {
  const fallback: Layout = { left: true, right: false, panelTab: 'outline', rightWidth: 280 };
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

const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp' };

/** A screenshot gets a dated name; a dropped file keeps its own, without characters systems refuse. */
function imageName(file: File) {
  const ext = IMAGE_TYPES[file.type] ?? 'png';
  // eslint-disable-next-line no-control-regex -- control characters are not valid in file names
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-');
  const stamp = new Date().toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '');
  return `pegado-${stamp}.${ext}`;
}

class Store {
  vaults = $state<Vault[]>([]);
  trees = $state<Record<string, TreeNode[]>>({});
  tabs = $state<Tab[]>([]);
  activeKey = $state<string | null>(null);
  toast = $state<Toast | null>(null);
  systemDark = $state(matchMedia('(prefers-color-scheme: dark)').matches);
  themeChoice = $state(loadThemeChoice());

  /** The quick switcher's starting text while it is open: `>` for actions, `#` for headings. */
  palette = $state<string | null>(null);
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
  /** Where a note from a template goes, while choosing the template. */
  templatePicker = $state<{ vaultId: string; dir: string } | null>(null);
  /** Taken by the editor, or the preview when it shows alone. */
  reveal = $state<Reveal | null>(null);
  layout = $state(loadLayout());
  reading = $state(loadReading());
  imagePlace = $state<ImagePlace>(loadImagePlace());
  windowWidth = $state(innerWidth);
  /** A bar shown by hand while the window is too narrow for it. It folds again once the width changes enough. */
  peek = $state({ left: false, right: false });
  /** A diagram to open in the builder, by its order in the note. Taken by the editor. */
  editDiagram = $state<{ key: string; index: number } | null>(null);
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
  /** Follows a link written in `tab`. An empty name means the same note; `anchor` is `#Heading` or `^block`. */
  async followLink(tab: Tab, name: string, anchor?: string | null) {
    const target = name.trim();
    if (!target) return this.goToAnchor(tab.vaultId, tab.path, anchor);
    const path = resolveLink(target, tab.path, this.files(tab.vaultId));
    if (path) return this.openNoteAt(tab.vaultId, path, anchor);
    if (await this.confirm(tr('preview.createMissing', { name: target }), tr('common.create'))) await this.createNote(tab.vaultId, dirName(tab.path), target);
  }

  /** Opens a note and goes to a heading or block in it. */
  async openNoteAt(vaultId: string, path: string, anchor?: string | null) {
    await this.openFile(vaultId, path);
    this.goToAnchor(vaultId, path, anchor);
  }

  goToAnchor(vaultId: string, path: string, raw?: string | null) {
    const anchor = parseAnchor(raw);
    const tab = this.tabs.find((t) => t.key === tabKey(vaultId, path));
    if (!anchor || !tab) return;
    const found = findAnchor(tab.content, anchor);
    if (!found) return this.notify(tr('links.anchorMissing', { anchor: anchorLabel(anchor), note: baseName(path).replace(/\.(md|markdown)$/i, '') }));
    // A block is found in the preview by its marker, a heading by its place.
    const terms = anchor.kind === 'block' ? [fold(`^${anchor.id}`)] : [];
    this.reveal = { key: tab.key, line: found.line, terms, heading: found.heading };
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

  /** Opens a note's diagram in the builder, showing the editor if only the preview is on screen. */
  openDiagram(tab: Tab, index: number) {
    if (tab.view === 'preview') tab.view = 'split';
    this.editDiagram = { key: tab.key, index };
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

  notify(message: unknown, options: { actions?: ToastAction[]; details?: string; onDone?: () => void } = {}) {
    const text = String(message);
    const firstLine = text.split(/\r?\n/)[0];
    const long = text.length > TOAST_SHORT || firstLine !== text;
    const message_ = long ? `${firstLine.slice(0, TOAST_SHORT).trimEnd()}${firstLine.length > TOAST_SHORT ? '…' : ''}` : text;
    const details = options.details ?? (long ? text : null);
    const before = this.toast;
    this.toast = { id: (before?.id ?? 0) + 1, message: message_, details, actions: options.actions ?? [], onDone: options.onDone };
    before?.onDone?.();
    this.holdToast(false);
  }

  /** Takes the notice away, letting whatever waited on it finish. */
  dismissToast() {
    clearTimeout(this.#toastTimer);
    const gone = this.toast;
    this.toast = null;
    gone?.onDone?.();
  }

  /** Keeps the notice while the pointer is over it or its details are open; lets it go otherwise. */
  holdToast(hold: boolean) {
    clearTimeout(this.#toastTimer);
    if (hold || !this.toast) return;
    const time = this.toast.actions.length || this.toast.details ? TOAST_TIME_ACTIONS : TOAST_TIME;
    this.#toastTimer = setTimeout(() => this.dismissToast(), time);
  }

  /** The notice after an export, with ways to reach the file. */
  notifyExported(path: string | null) {
    if (!path) return;
    this.notify(tr('export.done'), {
      actions: [
        { label: tr('export.openFile'), run: () => void api.openExported(path).catch((e) => this.notify(e)) },
        { label: tr('export.showInFolder'), run: () => void api.revealExported(path).catch((e) => this.notify(e)) },
      ],
    });
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

  /** Asks where and how to call a new vault, then creates it. */
  async createVaultDialog() {
    const parent = await openDialog({ directory: true, title: tr('sidebar.createVaultWhere') });
    if (typeof parent !== 'string') return;
    const name = await this.prompt(tr('sidebar.vaultName'), '', tr('common.create'));
    if (name?.trim()) await this.addVault(() => api.createVault(parent, name.trim()));
  }

  /** Asks for a folder and opens it as a vault. */
  async openVaultDialog() {
    const path = await openDialog({ directory: true, title: tr('sidebar.openAsVault') });
    if (typeof path === 'string') await this.addVault(() => api.openVault(path));
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

  /** Zooms the whole interface, as a browser does. `null` goes back to 100 %. */
  setZoom(zoom: number | null, announce = true) {
    const next = zoom === null ? 1 : Math.round(Math.min(ZOOM.max, Math.max(ZOOM.min, zoom)) * 10) / 10;
    this.setReading({ zoom: next });
    void this.applyZoom();
    if (announce) this.notify(tr('zoom.level', { n: Math.round(next * 100) }));
  }

  async applyZoom() {
    try {
      await getCurrentWebview().setZoom(this.reading.zoom);
    } catch {
      // Outside the app, in the interface tests.
    }
  }

  setImagePlace(place: ImagePlace) {
    this.imagePlace = place;
    try {
      localStorage.setItem(IMAGES_KEY, place);
    } catch {
      // Lasts for this session only.
    }
  }

  /**
   * Saves pasted or dropped images in the vault and returns their Markdown,
   * one per line, linked from the note. Null when they cannot be saved here.
   */
  async saveImages(tab: Tab, files: File[]): Promise<string | null> {
    if (tab.loose) {
      this.notify(tr('images.looseOnly'));
      return null;
    }
    const dir = this.imagePlace === 'note' ? dirName(tab.path) : IMAGE_FOLDER;
    const links: string[] = [];
    for (const file of files) {
      const name = imageName(file);
      try {
        const path = await api.saveImage(tab.vaultId, dir, name, new Uint8Array(await file.arrayBuffer()));
        links.push(`![](${linkFrom(tab.path, path)})`);
      } catch (e) {
        this.notify(e);
      }
    }
    if (!links.length) return null;
    await this.refreshTree(tab.vaultId);
    return links.join('\n');
  }

  setReading(change: Partial<Reading>) {
    this.reading = { ...this.reading, ...change };
    try {
      localStorage.setItem(READING_KEY, JSON.stringify(this.reading));
    } catch {
      // Lasts for this session only.
    }
  }

  saveLayout() {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layout));
    } catch {
      // Only a convenience.
    }
  }

  /** Asks for a name and creates a note beside the one open, or in the first vault. */
  async newNote() {
    const tab = this.active;
    const vaultId = tab?.vaultId ?? this.openVaults[0]?.id;
    if (!vaultId) return this.notify(tr('app.openVaultFirst'));
    const name = await this.prompt(tr('sidebar.noteName'), '', tr('common.create'));
    if (name?.trim()) await this.createNote(vaultId, tab ? dirName(tab.path) : '', name.trim());
  }

  /** Chooses a template for a new note beside the one open, or in the first vault. */
  newNoteFromTemplate(vaultId?: string, dir?: string) {
    const tab = this.active;
    const vault = vaultId ?? (tab && !tab.loose ? tab.vaultId : this.openVaults[0]?.id);
    if (!vault) return this.notify(tr('app.openVaultFirst'));
    this.templatePicker = { vaultId: vault, dir: dir ?? (tab && tab.vaultId === vault ? dirName(tab.path) : '') };
  }

  /** Asks for a name and creates the note, filled from a template or blank. */
  async createFromTemplate(vaultId: string, dir: string, template: string | null) {
    const name = (await this.prompt(tr('sidebar.noteName'), '', tr('common.create')))?.trim();
    if (!name) return;
    let content = '';
    if (template) {
      try {
        content = fillTemplate(await api.noteTemplate(vaultId, template), { titulo: name.replace(/\.md$/i, ''), vault: this.vault(vaultId)?.name ?? '' });
      } catch (e) {
        return this.notify(e);
      }
    }
    await this.createNote(vaultId, dir, name, content);
  }

  /** Keeps the note open as a template of its vault. */
  async saveAsTemplate(tab: Tab) {
    const name = (await this.prompt(tr('templates.name'), baseName(tab.path).replace(/\.(md|markdown)$/i, ''), tr('common.save')))?.trim();
    if (!name) return;
    try {
      await api.saveNoteTemplate(tab.vaultId, name, tab.content);
      this.notify(tr('templates.saved', { name }));
    } catch (e) {
      this.notify(e);
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

  async createNote(vaultId: string, dir: string, name: string, content = '') {
    const file = /\.(md|markdown|html?)$/i.test(name) ? name : `${name}.md`;
    const path = join(dir, file);
    try {
      await api.create(vaultId, path, content);
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

  /**
   * Deletes a file or folder with a chance to undo it: it waits aside while
   * the notice shows, and goes to the system trash when the notice goes.
   */
  async trash(vaultId: string, path: string) {
    // Saved first, so undoing brings back the latest text.
    await this.saveAll();
    let token: string;
    try {
      token = await api.trash(vaultId, path);
    } catch (e) {
      this.notify(e);
      return;
    }
    const inside = (t: Tab) => t.vaultId === vaultId && (t.path === path || t.path.startsWith(`${path}/`));
    const closed = this.tabs.filter(inside).map((t) => ({ path: t.path, view: t.view }));
    for (const tab of this.tabs.filter(inside)) {
      tab.dirty = false;
      await this.close(tab);
    }
    await this.refreshTree(vaultId);
    let undone = false;
    const undo = async () => {
      undone = true;
      try {
        await api.undoTrash(vaultId, token);
      } catch (e) {
        this.notify(e);
        return;
      }
      await this.refreshTree(vaultId);
      for (const t of closed) {
        await this.openFile(vaultId, t.path);
        if (this.active) this.active.view = t.view;
      }
    };
    this.notify(tr('store.trashed', { name: baseName(path).replace(/\.(md|markdown)$/i, '') }), {
      actions: [{ label: tr('common.undo'), run: () => void undo() }],
      onDone: () => {
        if (!undone) void api.finishTrash(vaultId, token).catch((e) => this.notify(e));
      },
    });
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
