import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { anchorLabel, findAnchor, parseAnchor } from './anchors';
import { api, type GitStatus, type ReplaceOptions, type SortMode, type TreeNode, type Vault, type VaultThemes, type WatchProblem } from './api';
import { fold } from './fold';
import { addDays, dailyPath, dailyTitle } from './daily';
import { fillTemplate } from './noteTemplates';
import { withColors, type DiagramStyle } from './diagramStyle';
import { language, tr } from './i18n.svelte';
import { sampleVault } from './sampleVault';
import { baseName, dirName, join, kindOf, linkFrom, resolveLink, stem, type FileKind } from './paths';
import { checksAtStart, isNewer, latestVersion } from './updates';
import { newsFor, unseenNews } from './news';
import { changedLines } from './diff';
import { loadSpellSetting, saveSpellSetting, type SpellSetting } from './spellcheck';
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
  /** Kept at the left, without a close button, and spared by "close the others". */
  pinned: boolean;
  /** Edited here since it was opened, so closing it keeps a version. */
  touched: boolean;
  /** Changed on disk by someone else while open and untouched here, until seen or edited. */
  outside: OutsideChange | null;
  /** Set for a file outside any vault: its location on disk. */
  loose: { absolute: string; dir: string } | null;
}

/** A note changed outside the app while open: what it was, and which lines of it now changed. */
export interface OutsideChange {
  before: string;
  /** The version written from outside, so undoing can tell if it changed again. */
  version: string;
  lines: number[];
  /** The AI changed it through the MCP server, as far as its log says. */
  ai: boolean;
  /** Bumped on each change, so the marks show again. */
  seen: number;
}

/** A place to show in a tab: a line, with the words of a search marked. Line 0 is the top. */
export interface Reveal {
  key: string;
  line: number;
  terms: string[];
  /** Set when going to a heading: its place among the note's headings, for the preview. */
  heading?: number;
}

export type PanelTab = 'outline' | 'links' | 'properties' | 'history';
/** The parts of a vault's settings screen. */
export type VaultSection = 'general' | 'look' | 'diagrams' | 'word' | 'daily' | 'ai';

/** Which side bars someone wants. A narrow window hides them anyway. */
interface Layout {
  left: boolean;
  right: boolean;
  panelTab: PanelTab;
  rightWidth: number;
}

/** An entry of a context menu. `separator` draws a line above it. */
export interface MenuItem {
  label: string;
  icon?: string;
  keys?: string[];
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  run: () => void;
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
const RECENT_KEY = 'ultimatemd.recent';
const FAVORITES_KEY = 'ultimatemd.favorites';
const RECENT_MAX = 30;

/** A note somewhere: in which vault and where in it. */
export interface Place {
  vaultId: string;
  path: string;
}

function loadPlaces(key: string): Place[] {
  try {
    const list = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(list) ? list.filter((p) => typeof p?.vaultId === 'string' && typeof p?.path === 'string') : [];
  } catch {
    return [];
  }
}

function savePlaces(key: string, places: Place[]) {
  try {
    localStorage.setItem(key, JSON.stringify(places));
  } catch {
    // Lasts for this session only.
  }
}
/** Where pasted and dropped images go: a folder at the vault root, or beside the note. */
export type ImagePlace = 'vault' | 'note';
export const IMAGE_FOLDER = 'adjuntos';
export const ZOOM = { min: 0.6, max: 2, step: 0.1 };
export const TEXT_SCALES = [0.9, 1, 1.15, 1.3] as const;
export const LINE_WIDTHS = { narrow: '600px', normal: null, wide: '960px', full: 'none' } as const;
export type LineWidth = keyof typeof LINE_WIDTHS;
/** How far apart lines are, as an amount added to each view's own spacing. */
export const LEADINGS = { compact: -0.2, normal: 0, relaxed: 0.25 } as const;
export type Leading = keyof typeof LEADINGS;

/** How someone likes to read: the interface zoom, the notes' text size, line width and line spacing. */
interface Reading {
  zoom: number;
  textScale: number;
  lineWidth: LineWidth;
  leading: Leading;
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
  const fallback: Reading = { zoom: 1, textScale: 1, lineWidth: 'normal', leading: 'normal' };
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
  /** How each vault's tree is ordered. */
  orders = $state<Record<string, SortMode>>({});
  /** Each vault's Git status, or null when it is not in a repository. */
  git = $state<Record<string, GitStatus | null>>({});
  /** The vault whose Git changes are on screen. */
  gitScreen = $state<string | null>(null);
  #gitTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  /** Each vault's notes that declare `aliases:`, by path. */
  aliases = $state<Record<string, Record<string, string[]>>>({});
  tabs = $state<Tab[]>([]);
  activeKey = $state<string | null>(null);
  toast = $state<Toast | null>(null);
  systemDark = $state(matchMedia('(prefers-color-scheme: dark)').matches);
  themeChoice = $state(loadThemeChoice());

  /** The quick switcher's starting text while it is open: `>` for actions, `#` for headings. */
  palette = $state<string | null>(null);
  settings = $state(false);
  searching = $state(false);
  /** Text for the search panel to look for, handed over by another part of the app. */
  searchQuery = $state<string | null>(null);
  exporting = $state(false);
  tutorial = $state(!tutorialSeen());
  about = $state(false);
  /** The list of every keyboard shortcut. */
  shortcuts = $state(false);
  /** Choosing, place by place, between the edits in the tab on screen and its version on disk. */
  merging = $state(false);
  /** The context menu on screen, and where. */
  menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  /** A note or folder the side bar is being asked to show, for a moment. */
  treeReveal = $state<{ vaultId: string; path: string } | null>(null);
  /** The tab shown beside the one being edited, for reference. */
  sideKey = $state<string | null>(null);
  /** Showing what changed outside the app in the note on screen. */
  outsideDiff = $state(false);
  /** Whether and in which language spelling is checked while writing. */
  spellcheck = $state<SpellSetting>(loadSpellSetting());
  /** The version whose news show, as `0.7`. */
  news = $state<string | null>(null);
  /** A newer published version, once known. */
  update = $state<string | null>(null);
  /** The view new tabs open in: the last one the user chose. */
  preferredView = $state(loadView());
  dialog = $state<Dialog | null>(null);
  vaultThemes = $state<Record<string, VaultThemes>>({});
  /** The vault whose settings are open, and at which part. */
  vaultSettings = $state<{ vaultId: string; section: VaultSection } | null>(null);
  /** The vault whose broken links are listed. */
  brokenLinks = $state<string | null>(null);
  /** The vault whose log of what the AI did is open. */
  aiLog = $state<string | null>(null);
  /** A vault or folder being read top to bottom, in place of the editor. */
  reader = $state<{ vaultId: string; folder: string } | null>(null);
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
  /** The words and characters the editor has selected; null when nothing is. */
  selection = $state<{ key: string; words: number; chars: number } | null>(null);
  /** Tags of each vault, the most used first. Dropped when the vault changes, read again when needed. */
  tags = $state<Record<string, { tag: string; notes: number }[]>>({});
  /** Vaults whose changes made outside the app are not followed, with why. */
  unwatched = $state<Record<string, string>>({});
  /** Notes opened lately, the last one first. */
  recent = $state<Place[]>(loadPlaces(RECENT_KEY));
  /** Notes pinned to the top of the side bar, in the order they were added. */
  favorites = $state<Place[]>(loadPlaces(FAVORITES_KEY));

  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Above zero while the app itself rewrites notes, such as links after a move: those are not outside changes. */
  #ownWrites = 0;
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

  /** How the app draws a vault's diagrams when a note says nothing else. */
  vaultDiagramLook(vaultId: string) {
    const value = this.vaultThemes[vaultId]?.defaultDiagramTheme ?? null;
    const theme =
      (value !== 'boceto' && this.lookUpTheme(vaultId, value)) ||
      this.lookUpTheme(vaultId, this.vaultThemes[vaultId]?.defaultTheme) ||
      this.theme;
    return { theme, sketch: value === 'boceto' };
  }

  /** Follows a `[[link]]` written in a note, offering to create it if it is missing. */
  /** Follows a link written in `tab`. An empty name means the same note; `anchor` is `#Heading` or `^block`. */
  async followLink(tab: Tab, name: string, anchor?: string | null) {
    const target = name.trim();
    if (!target) return this.goToAnchor(tab.vaultId, tab.path, anchor);
    const path = this.resolve(tab.vaultId, target, tab.path);
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

  isFavorite(vaultId: string, path: string) {
    return this.favorites.some((f) => f.vaultId === vaultId && f.path === path);
  }

  toggleFavorite(vaultId: string, path: string) {
    this.favorites = this.isFavorite(vaultId, path)
      ? this.favorites.filter((f) => !(f.vaultId === vaultId && f.path === path))
      : [...this.favorites, { vaultId, path }];
    savePlaces(FAVORITES_KEY, this.favorites);
  }

  #remember(vaultId: string, path: string) {
    this.recent = [{ vaultId, path }, ...this.recent.filter((r) => !(r.vaultId === vaultId && r.path === path))].slice(0, RECENT_MAX);
    savePlaces(RECENT_KEY, this.recent);
  }

  /** Keeps favourites and recent notes pointing at a file or folder that moved, or drops them when it is gone. */
  #repointPlaces(vaultId: string, from: string, to: string | null) {
    const fix = (list: Place[]) =>
      list.flatMap((p) => {
        if (p.vaultId !== vaultId || !(p.path === from || p.path.startsWith(`${from}/`))) return [p];
        return to === null ? [] : [{ vaultId, path: to + p.path.slice(from.length) }];
      });
    this.recent = fix(this.recent);
    this.favorites = fix(this.favorites);
    savePlaces(RECENT_KEY, this.recent);
    savePlaces(FAVORITES_KEY, this.favorites);
  }

  /** Opens a context menu where the pointer is, or by the element when it came from the keyboard. */
  openMenu(e: MouseEvent, items: MenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    let { clientX: x, clientY: y } = e;
    if (!x && !y && e.target instanceof Element) {
      const box = e.target.getBoundingClientRect();
      [x, y] = [box.left + 12, box.bottom - 4];
    }
    this.menu = { x, y, items };
  }

  /** Where a file is on this computer. */
  absolutePath(tab: { vaultId: string; path: string; loose?: Tab['loose'] }) {
    if (tab.loose) return tab.loose.absolute;
    const root = this.vault(tab.vaultId)?.path ?? '';
    const back = String.fromCharCode(92);
    return root.includes(back) ? `${root}${back}${tab.path.replaceAll('/', back)}` : `${root}/${tab.path}`;
  }

  async copyText(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.notify(message);
    } catch (e) {
      this.fail(e);
    }
  }

  /** Copies a `[[link]]` to a note, as short as it can be told apart. */
  copyLink(vaultId: string, path: string) {
    const short = stem(path);
    const unique = this.files(vaultId).filter((f) => stem(f) === short).length < 2;
    void this.copyText(`[[${unique ? short : path.slice(0, path.lastIndexOf('.'))}]]`, tr('menu.linkCopied'));
  }

  /** Shows a note or folder in the side bar: opens the bar and the folders above it, and puts the focus on it. */
  showInTree(vaultId: string, path: string) {
    this.toggleBar('left', true);
    this.treeReveal = { vaultId, path };
    // Rows that appear later, when the user opens folders again, must not react.
    setTimeout(() => (this.treeReveal = null), 800);
  }

  revealInFolder(vaultId: string, path: string) {
    void api.revealPath(vaultId, path).catch((e) => this.fail(e));
  }

  get sideTab() {
    const tab = this.tabs.find((t) => t.key === this.sideKey) ?? null;
    return tab && tab.key !== this.activeKey ? tab : null;
  }

  /** Shows a note beside the one being edited, to read while writing. */
  async openBeside(vaultId: string, path: string) {
    const before = this.activeKey;
    await this.openFile(vaultId, path);
    const key = tabKey(vaultId, path);
    if (!this.tabs.some((t) => t.key === key)) return;
    if (before && before !== key) {
      this.sideKey = key;
      this.activeKey = before;
    }
    this.persist();
  }

  /** The note at the side becomes the one being edited, and the other goes to the side. */
  swapSide() {
    const side = this.sideTab;
    if (!side) return;
    [this.sideKey, this.activeKey] = [this.activeKey, side.key];
    this.persist();
  }

  togglePin(tab: Tab) {
    const from = this.tabs.indexOf(tab);
    if (from < 0) return;
    this.tabs.splice(from, 1);
    tab.pinned = !tab.pinned;
    // Pinned tabs sit together at the left: the tab goes to the end of that group, or right after it.
    this.tabs.splice(this.tabs.filter((t) => t.pinned).length, 0, tab);
    this.persist();
  }

  /** Moves a tab to another place, within its group: pinned ones stay before the rest. */
  moveTab(key: string, to: number) {
    const from = this.tabs.findIndex((t) => t.key === key);
    if (from < 0) return;
    const tab = this.tabs[from];
    const pinned = this.tabs.filter((t) => t.pinned).length;
    const [min, max] = tab.pinned ? [0, pinned - 1] : [pinned, this.tabs.length - 1];
    const target = Math.min(max, Math.max(min, to));
    if (target === from) return;
    this.tabs.splice(from, 1);
    this.tabs.splice(target, 0, tab);
    this.persist();
  }

  /** Closes every tab but this one and the pinned ones. */
  async closeOthers(keep: Tab) {
    await this.closeMany(this.tabs.filter((t) => t.key !== keep.key && !t.pinned), keep);
  }

  async closeAll() {
    await this.closeMany(this.tabs.filter((t) => !t.pinned));
  }

  /** The tabs after (or before) this one that a "close to the right/left" would close: pinned ones never. */
  tabsBeside(anchor: Tab, side: 'right' | 'left') {
    const i = this.tabs.findIndex((t) => t.key === anchor.key);
    if (i < 0) return [];
    return (side === 'right' ? this.tabs.slice(i + 1) : this.tabs.slice(0, i)).filter((t) => !t.pinned);
  }

  async closeBeside(anchor: Tab, side: 'right' | 'left') {
    await this.closeMany(this.tabsBeside(anchor, side), anchor);
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

  /** A vault's aliases in lower case, each to its note: the first note wins, as in the core. */
  aliasMap(vaultId: string) {
    // Built anew from the reactive aliases each time, so it needs no reactivity of its own.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<string, string>();
    for (const [path, names] of Object.entries(this.aliases[vaultId] ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
      for (const name of names) if (!map.has(name.toLowerCase())) map.set(name.toLowerCase(), path);
    }
    return map;
  }

  /** Reads a vault's notes as they are now: an open tab's text, unsaved or not, or the file. */
  noteReader(vaultId: string) {
    return async (path: string) =>
      this.tabs.find((t) => t.vaultId === vaultId && t.path === path)?.content ??
      (await api.read(vaultId, path).catch(() => null))?.content ??
      null;
  }

  /** Where a link written in a note leads, aliases included. */
  resolve(vaultId: string, target: string, from: string) {
    return resolveLink(target, from, this.files(vaultId), this.aliasMap(vaultId));
  }

  /** Asks Git what changed in a vault; quietly nothing when Git is not there. */
  async loadGit(vaultId: string) {
    try {
      this.git[vaultId] = await api.gitStatus(vaultId);
    } catch {
      this.git[vaultId] = null;
    }
  }

  /** The same, once a burst of changes settles. */
  laterGit(vaultId: string) {
    clearTimeout(this.#gitTimers[vaultId]);
    this.#gitTimers[vaultId] = setTimeout(() => void this.loadGit(vaultId), 800);
  }

  /** How a file differs from the last commit, if the vault is in Git. */
  gitState(vaultId: string, path: string) {
    return this.git[vaultId]?.changes.find((c) => c.path === path)?.state ?? null;
  }

  /** Reads the aliases of a whole vault, or again of the notes that changed. */
  async loadAliases(vaultId: string, paths?: string[]) {
    try {
      const found = await api.aliases(vaultId, paths);
      const next = paths ? { ...(this.aliases[vaultId] ?? {}) } : {};
      for (const path of paths ?? []) delete next[path];
      for (const note of found) next[note.path] = note.aliases;
      this.aliases[vaultId] = next;
    } catch {
      // Links by alias stay unresolved until the next change.
    }
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

  /** Shows something that went wrong and writes it to the log, where it can be read later. */
  fail(error: unknown, options: Parameters<Store['notify']>[1] = {}) {
    const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
    void api.logError('ui', text).catch(() => {});
    this.notify(error instanceof Error ? error.message : error, options);
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
        { label: tr('export.openFile'), run: () => void api.openExported(path).catch((e) => this.fail(e)) },
        { label: tr('export.showInFolder'), run: () => void api.revealExported(path).catch((e) => this.fail(e)) },
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
    await listen<WatchProblem>('watch-failed', (e) => this.onUnwatched(e.payload));
    await this.loadVaults();
    await this.restore();
    await this.openPaths(await api.takePendingFiles());
    for (const problem of await api.watchProblems().catch(() => [])) this.onUnwatched(problem);
    void this.checkUpdates();
    void this.showNews(false);
  }

  /** Shows what the running version brought: after an update by itself, or when asked. */
  async showNews(asked = true) {
    const version = await getVersion().catch(() => null);
    if (!version) return;
    const news = asked ? newsFor(version) : unseenNews(version);
    if (news && !(this.tutorial && !asked)) this.news = news;
  }

  /** Re-reads the notes of some vaults, in tabs and trees, after the app changed them on disk. */
  async #reloadChanged(paths: { vaultId: string; path: string }[]) {
    for (const vaultId of new Set(paths.map((p) => p.vaultId))) {
      await this.onChanged({ vaultId, paths: paths.filter((p) => p.vaultId === vaultId).map((p) => p.path) }, true);
    }
  }

  /** Replaces the chosen lines in several notes, with a notice that can undo it. */
  async replaceInVaults(replace: ReplaceOptions, notes: { vaultId: string; path: string; version: string; lines: number[] }[]) {
    await this.saveAll();
    let result;
    this.#ownWrites++;
    try {
      result = await api.replaceApply(replace, notes);
    } catch (e) {
      this.fail(e);
      return;
    } finally {
      this.#ownWrites--;
    }
    const { replaced, skipped } = result;
    await this.#reloadChanged(replaced);
    const lines = replaced.reduce((n, r) => n + r.lines, 0);
    const undo = async () => {
      const failed: string[] = [];
      for (const r of replaced) {
        await api.write(r.vaultId, r.path, r.before, r.version).catch(() => failed.push(baseName(r.path)));
      }
      await this.#reloadChanged(replaced);
      this.notify(failed.length ? tr('replace.undoPartly', { list: failed.join(', ') }) : tr('replace.undone'));
    };
    const message = tr('replace.done', { lines, notes: replaced.length });
    this.notify(skipped.length ? `${message} ${tr('replace.skipped', { list: skipped.map(baseName).join(', ') })}` : message, {
      actions: replaced.length ? [{ label: tr('common.undo'), run: () => void undo() }] : [],
    });
  }

  async loadTags(vaultId: string) {
    const known = this.tags[vaultId];
    if (known) return known;
    const loaded = await api.tags(vaultId).catch(() => []);
    this.tags[vaultId] = loaded;
    return loaded;
  }

  /** Lists the notes with a tag in the search panel. */
  searchTag(tag: string) {
    this.searchQuery = `etiqueta:${tag}`;
    this.searching = true;
    this.toggleBar('left', true);
  }

  /** Whether the AI wrote this note a moment ago, by the MCP server's log. */
  async changedByAi(vaultId: string, path: string, version: string) {
    return api.aiWrote(vaultId, path, version).catch(() => false);
  }

  /** Puts back a note as it was before a change made outside the app. */
  async undoOutside(tab: Tab) {
    const change = tab.outside;
    if (!change) return;
    try {
      tab.version = await api.write(tab.vaultId, tab.path, change.before, change.version);
    } catch (e) {
      if (String(e).includes('changed since')) this.notify(tr('outside.changedAgain'));
      else this.fail(e);
      return;
    }
    tab.content = change.before;
    tab.outside = null;
    tab.revision++;
    this.notify(tr('outside.undone'));
  }

  /** A vault that cannot be watched: changes made outside the app only show when it is read again. */
  onUnwatched({ vaultId, error }: WatchProblem) {
    const vault = this.vault(vaultId);
    if (!vault || this.unwatched[vaultId] === error) return;
    this.unwatched[vaultId] = error;
    this.notify(tr('watch.failed', { name: vault.name }), {
      details: `${tr('watch.failedHint')}\n\n${error}`,
      actions: [{ label: tr('watch.reread'), run: () => void this.reread(vaultId) }],
    });
  }

  /** Reads a vault again from disk: its tree and the notes open from it. */
  async reread(vaultId: string) {
    await this.refreshTree(vaultId);
    await this.onChanged({ vaultId, paths: this.tabs.filter((t) => t.vaultId === vaultId).map((t) => t.path) });
  }

  async loadVaults() {
    this.vaults = await api.listVaults();
    await Promise.all(this.openVaults.flatMap((v) => [this.refreshTree(v.id), this.loadVaultThemes(v.id), this.loadAliases(v.id), this.loadGit(v.id)]));
  }

  async refreshTree(id: string) {
    try {
      const [tree, order] = await Promise.all([api.tree(id), api.treeOrder(id)]);
      this.trees[id] = tree;
      this.orders[id] = order;
    } catch (e) {
      this.trees[id] = [];
      this.fail(e);
    }
  }

  /** How the vault's tree is ordered. */
  order(id: string): SortMode {
    return this.orders[id] ?? 'nameAsc';
  }

  async setOrder(id: string, mode: SortMode) {
    if (mode === this.order(id)) return;
    try {
      await api.setTreeOrder(id, mode);
    } catch (e) {
      return this.fail(e);
    }
    await this.refreshTree(id);
  }

  /** The entries beside `path`, in the order the tree shows them. */
  #siblings(id: string, path: string) {
    const dir = dirName(path);
    let level = this.trees[id] ?? [];
    for (const part of dir ? dir.split('/') : []) level = level.find((n) => n.isDir && baseName(n.path) === part)?.children ?? [];
    return level;
  }

  /** Puts `path` before or after `target`, a note or folder of the same kind in the same folder. Manual order only. */
  async place(id: string, path: string, target: string, after: boolean) {
    try {
      await api.placeInTree(id, path, target, after);
    } catch (e) {
      return this.fail(e);
    }
    await this.refreshTree(id);
  }

  /** The neighbour of `path` of the same kind, above (-1) or below (1), if any. */
  neighbour(id: string, path: string, step: -1 | 1) {
    const list = this.#siblings(id, path);
    const at = list.findIndex((n) => n.path === path);
    const next = list[at + step];
    return at >= 0 && next && next.isDir === list[at].isDir ? next : undefined;
  }

  async nudge(id: string, path: string, step: -1 | 1) {
    const next = this.neighbour(id, path, step);
    if (next) await this.place(id, path, next.path, step === 1);
  }

  /** Asks where and how to call a new vault, then creates it. */
  async createVaultDialog() {
    const parent = await openDialog({ directory: true, title: tr('sidebar.createVaultWhere') });
    if (typeof parent !== 'string') return;
    const name = await this.prompt(tr('sidebar.vaultName'), '', tr('common.create'));
    if (name?.trim()) await this.addVault(() => api.createVault(parent, name.trim()));
  }

  /** Asks where, and creates a vault of invented notes to learn with. */
  async createSampleVault() {
    const parent = await openDialog({ directory: true, title: tr('sample.where') });
    if (typeof parent !== 'string') return;
    const sample = sampleVault(language());
    const vault = await this.addVault(() => api.createVault(parent, sample.name));
    if (!vault) return;
    try {
      for (const [path, content] of Object.entries(sample.files)) await api.create(vault.id, path, content);
    } catch (e) {
      this.fail(e);
    }
    await this.refreshTree(vault.id);
    this.closeTutorial();
    await this.openFile(vault.id, sample.start);
    this.notify(tr('sample.created', { name: sample.name }));
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
      this.fail(e);
    }
  }

  /** Everything a vault can set, in one screen; it takes the place of the app settings. */
  openVaultSettings(vaultId: string, section: VaultSection = 'general') {
    this.settings = false;
    this.vaultSettings = { vaultId, section };
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
        this.fail(tr('store.openFailed', { path, error: String(e) }));
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
    if (!loose && this.vault(vaultId)) this.#remember(vaultId, path);
    if (this.tabs.some((t) => t.key === key)) {
      this.activeKey = key;
      this.persist();
      return;
    }
    const kind = kindOf(path);
    if (kind === 'other') {
      // Not text this app can edit: hand it to the system's default program.
      await api.openWithSystem(vaultId, path).catch((e) => this.fail(e));
      return;
    }
    let content = '';
    let version: string | null = null;
    if (isText(kind)) {
      try {
        ({ content, version } = await api.read(vaultId, path));
      } catch (e) {
        this.fail(e);
        return;
      }
    }
    this.tabs.push({
      key, vaultId, path, kind, content, version,
      dirty: false, saving: false, view: kind === 'md' || this.preferredView !== 'visual' ? this.preferredView : 'split', revision: 0, conflict: null, missing: false, pinned: false, touched: false, outside: null, loose,
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

  setSpellcheck(setting: SpellSetting) {
    this.spellcheck = setting;
    saveSpellSetting(setting);
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
        this.fail(e);
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
        return this.fail(e);
      }
    }
    await this.createNote(vaultId, dir, name, content);
  }

  /**
   * Opens the note of a day (today by default, `offset` days away otherwise) in the
   * vault of the note open or the first one, making it first if it isn't there. It
   * never replaces a note that exists.
   */
  async openDaily(offset = 0, vaultId?: string) {
    const tab = this.active;
    const id = vaultId ?? (tab && !tab.loose ? tab.vaultId : this.openVaults[0]?.id);
    if (!id) return this.notify(tr('app.openVaultFirst'));
    const date = addDays(new Date(), offset);
    try {
      const settings = await api.dailyNotes(id);
      const path = dailyPath(date, settings);
      if (!this.files(id).includes(path)) {
        const title = dailyTitle(date);
        let content = `# ${title}\n\n`;
        if (settings.template) {
          try {
            content = fillTemplate(await api.noteTemplate(id, settings.template), { titulo: title, vault: this.vault(id)?.name ?? '' }, date);
          } catch {
            this.notify(tr('daily.noTemplate', { name: settings.template }));
          }
        }
        // Creating fails if the note is already there, even if the tree didn't show it yet.
        await api.create(id, path, content).catch(async (e) => {
          if (!(await api.read(id, path).then(() => true, () => false))) throw e;
        });
        await this.refreshTree(id);
      }
      await this.openFile(id, path);
    } catch (e) {
      this.fail(e);
    }
  }

  /** Keeps the note open as a template of its vault. */
  async saveAsTemplate(tab: Tab) {
    const name = (await this.prompt(tr('templates.name'), baseName(tab.path).replace(/\.(md|markdown)$/i, ''), tr('common.save')))?.trim();
    if (!name) return;
    try {
      await api.saveNoteTemplate(tab.vaultId, name, tab.content);
      this.notify(tr('templates.saved', { name }));
    } catch (e) {
      this.fail(e);
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
    tab.outside = null;
    tab.touched = true;
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
      delete this.tags[tab.vaultId];
    } catch (e) {
      if (String(e).includes('changed since')) await this.detectConflict(tab);
      else this.fail(e);
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

  /** Ends a conflict with a text put together from both versions. */
  async resolveConflict(tab: Tab, text: string) {
    if (!tab.conflict) return;
    tab.version = tab.conflict.version;
    tab.conflict = null;
    tab.content = text;
    tab.dirty = true;
    tab.revision++;
    await this.save(tab);
  }

  /** Keeps the edits in this tab, replacing the version on disk. */
  async keepMine(tab: Tab) {
    if (!tab.conflict) return;
    tab.version = tab.conflict.version;
    tab.conflict = null;
    tab.dirty = true;
    await this.save(tab);
  }

  /** Brings back an older version of a note, keeping the one it replaces. */
  async restoreVersion(tab: Tab, text: string) {
    await this.save(tab);
    if (tab.conflict || tab.missing) return;
    await api.historyKeep(tab.vaultId, tab.path, true).catch(() => false);
    this.edit(tab, text);
    tab.revision++;
    await this.save(tab);
    this.notify(tr('history.restored'));
  }

  async close(tab: Tab) {
    await this.closeMany([tab]);
  }

  /**
   * Closes several tabs at once. Everything is saved first; the only edits that can still be lost are those
   * of tabs in conflict with the disk, and those are asked about once for the whole batch. If the user says
   * no, nothing is closed. `keep` is the tab to leave active when the active one is among those closed.
   */
  async closeMany(tabs: Tab[], keep?: Tab) {
    await Promise.all(tabs.map((tab) => this.save(tab)));
    // What was written in this sitting stays as a version.
    for (const tab of tabs) if (tab.touched && !tab.loose && isText(tab.kind) && !tab.conflict && !tab.missing) void api.historyKeep(tab.vaultId, tab.path, false).catch(() => false);
    const risky = tabs.filter((t) => t.conflict).map((t) => baseName(t.path));
    if (risky.length) {
      const text = risky.length === 1 ? tr('store.closeConflict', { name: risky[0] }) : tr('store.closeConflicts', { count: risky.length, names: risky.join(', ') });
      if (!(await this.confirm(text, tr('common.close'), true))) return;
    }
    for (const tab of tabs) {
      const i = this.tabs.findIndex((t) => t.key === tab.key);
      if (i < 0) continue;
      this.tabs.splice(i, 1);
      if (tab.loose) await api.closeLoose(tab.vaultId);
      if (this.sideKey === tab.key) this.sideKey = null;
      if (this.activeKey === tab.key) this.activeKey = keep && this.tabs.some((t) => t.key === keep.key) ? keep.key : (this.tabs[Math.min(i, this.tabs.length - 1)]?.key ?? null);
    }
    this.persist();
  }

  cycleTab(step: number) {
    if (this.tabs.length < 2) return;
    const i = this.tabs.findIndex((t) => t.key === this.activeKey);
    this.activeKey = this.tabs[(i + step + this.tabs.length) % this.tabs.length].key;
  }

  async onChanged({ vaultId, paths }: { vaultId: string; paths: string[] }, own = this.#ownWrites > 0) {
    delete this.tags[vaultId];
    const inVault = this.tabs.every((t) => t.vaultId !== vaultId || !t.loose);
    if (inVault) await this.refreshTree(vaultId);
    if (inVault) void this.loadAliases(vaultId, paths);
    if (inVault && this.git[vaultId]) this.laterGit(vaultId);
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
        if (own) tab.outside = null;
        else if (tab.kind === 'md') {
          const before = tab.outside?.before ?? tab.content;
          const lines = changedLines(before, disk.content);
          tab.outside = lines.length
            ? { before, version: disk.version, lines, ai: await this.changedByAi(vaultId, tab.path, disk.version), seen: (tab.outside?.seen ?? 0) + 1 }
            : null;
        }
        tab.content = disk.content;
        tab.version = disk.version;
        tab.revision++;
      }
    }
  }

  async createNote(vaultId: string, dir: string, name: string, content = '', open = true) {
    const file = /\.(md|markdown|html?)$/i.test(name) ? name : `${name}.md`;
    const path = join(dir, file);
    try {
      await api.create(vaultId, path, content);
      await this.refreshTree(vaultId);
      if (open) await this.openFile(vaultId, path);
    } catch (e) {
      this.fail(e);
    }
  }

  async createFolder(vaultId: string, dir: string, name: string) {
    try {
      await api.createDir(vaultId, join(dir, name));
      await this.refreshTree(vaultId);
    } catch (e) {
      this.fail(e);
    }
  }

  /** Moves a file or folder, repoints any tabs inside it and rewrites the links that would break. */
  async move(vaultId: string, from: string, to: string) {
    if (from === to) return;
    await this.saveAll();
    let update;
    this.#ownWrites++;
    try {
      update = await api.rename(vaultId, from, to);
    } catch (e) {
      this.#ownWrites--;
      this.fail(e);
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
    this.#repointPlaces(vaultId, from, to);
    // Open tabs of the notes rewritten show the new links.
    await this.onChanged({ vaultId, paths: update.notes }, true);
    this.#ownWrites--;
    this.persist();
    const { links, notes } = update;
    if (links === 0) return;
    const note = baseName(notes[0]).replace(/\.(md|markdown)$/i, '');
    if (notes.length > 1) this.notify(tr('links.updatedMany', { links, notes: notes.length }));
    else this.notify(tr(links === 1 ? 'links.updatedOne' : 'links.updatedNote', { links, note }));
  }

  /** Asks for the new name of a file or folder and renames it. */
  async renamePrompt(vaultId: string, path: string) {
    const name = await this.prompt(tr('sidebar.newName'), baseName(path), tr('common.rename'));
    if (name?.trim()) await this.renameEntry(vaultId, path, name.trim());
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
      this.fail(e);
      return;
    }
    const inside = (t: Tab) => t.vaultId === vaultId && (t.path === path || t.path.startsWith(`${path}/`));
    const closed = this.tabs.filter(inside).map((t) => ({ path: t.path, view: t.view }));
    for (const tab of this.tabs.filter(inside)) {
      tab.dirty = false;
      await this.close(tab);
    }
    await this.refreshTree(vaultId);
    const places = { recent: this.recent, favorites: this.favorites };
    this.#repointPlaces(vaultId, path, null);
    let undone = false;
    const undo = async () => {
      undone = true;
      try {
        await api.undoTrash(vaultId, token);
      } catch (e) {
        this.fail(e);
        return;
      }
      await this.refreshTree(vaultId);
      this.recent = places.recent;
      this.favorites = places.favorites;
      savePlaces(RECENT_KEY, this.recent);
      savePlaces(FAVORITES_KEY, this.favorites);
      for (const t of closed) {
        await this.openFile(vaultId, t.path);
        if (this.active) this.active.view = t.view;
      }
    };
    this.notify(tr('store.trashed', { name: baseName(path).replace(/\.(md|markdown)$/i, '') }), {
      actions: [{ label: tr('common.undo'), run: () => void undo() }],
      onDone: () => {
        if (!undone) void api.finishTrash(vaultId, token).catch((e) => this.fail(e));
      },
    });
  }

  persist() {
    try {
      const open = this.tabs.map(({ vaultId, path, view, loose, pinned }) => ({ vaultId, path, view, file: loose?.absolute, pinned: pinned || undefined }));
      localStorage.setItem(SESSION_KEY, JSON.stringify({ open, active: this.activeKey, side: this.sideKey }));
    } catch {
      // The session is a convenience; the app works without it.
    }
  }

  async restore() {
    const recent = this.recent;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const { open, active, side } = JSON.parse(raw) as {
        open: { vaultId: string; path: string; view: ViewMode; file?: string; pinned?: boolean }[];
        active: string | null;
        side?: string | null;
      };
      for (const { vaultId, path, view, file, pinned } of open) {
        if (file) {
          // A loose file gets a new id each run, and may no longer exist.
          const opened = await api.openPath(file).catch(() => null);
          if (opened?.kind === 'loose') await this.openFile(opened.id, opened.name, opened);
          else continue;
        } else {
          if (!this.vault(vaultId)?.open || !this.files(vaultId).includes(path)) continue;
          await this.openFile(vaultId, path);
        }
        if (this.active) {
          this.active.view = view;
          this.active.pinned = !!pinned;
        }
      }
      if (active && this.tabs.some((t) => t.key === active)) this.activeKey = active;
      if (side && this.tabs.some((t) => t.key === side)) this.sideKey = side;
    } catch {
      // A damaged session only means starting with no tabs.
    } finally {
      // Reopening the tabs is not opening notes anew.
      this.recent = recent;
      savePlaces(RECENT_KEY, recent);
    }
  }
}

export const store = new Store();
