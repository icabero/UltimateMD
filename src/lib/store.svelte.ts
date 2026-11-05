import { listen } from '@tauri-apps/api/event';
import { api, type TreeNode, type Vault } from './api';
import { baseName, dirName, join, kindOf, type FileKind } from './paths';

export type ViewMode = 'edit' | 'split' | 'preview';

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
  dark = $state(matchMedia('(prefers-color-scheme: dark)').matches);

  palette = $state(false);
  settings = $state(false);
  searching = $state(false);
  dialog = $state<Dialog | null>(null);

  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #toastTimer: ReturnType<typeof setTimeout> | undefined;

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

  prompt(title: string, value = '', action = 'Aceptar') {
    return this.#ask(title, value, action, false);
  }

  async confirm(title: string, action: string, danger = false) {
    return (await this.#ask(title, null, action, danger)) !== null;
  }

  async init() {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => (this.dark = e.matches));
    await listen<{ vaultId: string; paths: string[] }>('vault-changed', (e) => this.onChanged(e.payload));
    await this.loadVaults();
    await this.restore();
  }

  async loadVaults() {
    this.vaults = await api.listVaults();
    await Promise.all(this.openVaults.map((v) => this.refreshTree(v.id)));
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

  async openFile(vaultId: string, path: string) {
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
      dirty: false, saving: false, view: 'split', revision: 0, conflict: null, missing: false,
    });
    this.activeKey = key;
    this.persist();
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
    if (tab.conflict && !(await this.confirm(`«${name}» cambió en disco y tiene ediciones sin guardar. ¿Cerrar y perderlas?`, 'Cerrar', true))) return;
    const i = this.tabs.findIndex((t) => t.key === tab.key);
    if (i < 0) return;
    this.tabs.splice(i, 1);
    if (this.activeKey === tab.key) this.activeKey = this.tabs[Math.min(i, this.tabs.length - 1)]?.key ?? null;
    this.persist();
  }

  cycleTab(step: number) {
    if (this.tabs.length < 2) return;
    const i = this.tabs.findIndex((t) => t.key === this.activeKey);
    this.activeKey = this.tabs[(i + step + this.tabs.length) % this.tabs.length].key;
  }

  async onChanged({ vaultId, paths }: { vaultId: string; paths: string[] }) {
    await this.refreshTree(vaultId);
    const known = new Set(this.files(vaultId));
    for (const tab of this.tabs) {
      if (tab.vaultId !== vaultId || !paths.includes(tab.path)) continue;
      tab.missing = !known.has(tab.path);
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

  /** Moves a file or folder and repoints any tabs inside it. */
  async move(vaultId: string, from: string, to: string) {
    if (from === to) return;
    await this.saveAll();
    try {
      await api.rename(vaultId, from, to);
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
    await this.refreshTree(vaultId);
    this.persist();
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
      const open = this.tabs.map(({ vaultId, path, view }) => ({ vaultId, path, view }));
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
        open: { vaultId: string; path: string; view: ViewMode }[];
        active: string | null;
      };
      for (const { vaultId, path, view } of open) {
        if (!this.vault(vaultId)?.open || !this.files(vaultId).includes(path)) continue;
        await this.openFile(vaultId, path);
        if (this.active) this.active.view = view;
      }
      if (active && this.tabs.some((t) => t.key === active)) this.activeKey = active;
    } catch {
      // A damaged session only means starting with no tabs.
    }
  }
}

export const store = new Store();
