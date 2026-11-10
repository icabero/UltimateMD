import { convertFileSrc, invoke } from '@tauri-apps/api/core';

export type McpAccess = 'off' | 'read' | 'write';

export interface Vault {
  id: string;
  name: string;
  path: string;
  open: boolean;
  mcp: McpAccess;
  allowScripts: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

export interface Note {
  path: string;
  content: string;
  version: string;
}

export interface VaultHit {
  vaultId: string;
  /** `score` ranks the note as a whole; line 0 means the name matched. */
  hit: { path: string; line: number; text: string; score: number };
}

/** Links rewritten by a move, and the notes they are in, at their new paths. */
export interface LinkUpdate {
  links: number;
  notes: string[];
}

/** For the start screen. `notes` is null for a vault that cannot be read. Times are ms since the epoch. */
export interface HomeInfo {
  vaults: { vaultId: string; notes: number | null; lastEdit: number | null; lastNote: string | null }[];
  recent: { vaultId: string; path: string; modified: number }[];
}

export interface WatchProblem {
  vaultId: string;
  error: string;
}

export interface LinkInfo {
  outgoing: string[];
  unresolved: string[];
  backlinks: string[];
}

export interface ThemeFile {
  id: string;
  name: string;
  base: string;
  colors: Record<string, string>;
  diagram: Record<string, string>;
  prose?: 'serif' | 'sans';
}

export interface VaultThemes {
  defaultTheme: string | null;
  defaultDiagramTheme: string | null;
  themes: ThemeFile[];
  invalid: string[];
}

/** A link that leads nowhere. */
export interface BrokenLink {
  note: string;
  /** What it points to, as written. */
  target: string;
  line: number;
  /** It points to a note, which can be created, rather than a file. */
  toNote: boolean;
  /** The closest note or file there is. */
  suggestion: string | null;
}

export type PlanSection =
  | { kind: 'heading'; text: string; style: string | null; level: number; pageBreak: boolean }
  | { kind: 'note'; path: string; shift: number; pageBreak: boolean };

export interface ExportPlan {
  vaultId: string;
  title: string;
  fixedTitle: boolean;
  date: string;
  language: string;
  /** The title of the table of contents, in that language. */
  contents: string;
  cover: boolean;
  /** PDF/A, for archiving. */
  archive: boolean;
  template: string | null;
  sections: PlanSection[];
  diagrams: number[][];
}

export interface WordSettings {
  headings: (string | null)[];
  body: string | null;
  headerFill: string | null;
  tableTextSize: number | null;
  codeTextSize: number | null;
  imageMaxWidth: number | null;
  plainCode: boolean;
}

export interface WordConfig {
  settings: WordSettings;
  hasTemplate: boolean;
  info: {
    headings: (string | null)[];
    body: string | null;
    headerFill: string | null;
    styles: TemplateStyle[];
  };
}

export interface TemplateStyle {
  id: string;
  name: string;
}

export type Opened =
  | { kind: 'vault'; vaultId: string; path: string }
  | { kind: 'loose'; id: string; name: string; absolute: string; dir: string };

export interface DefaultAppInfo {
  platform: string;
  appimage: boolean;
  isDefault: boolean;
}

export const api = {
  listVaults: () => invoke<Vault[]>('list_vaults'),
  createVault: (parent: string, name: string) => invoke<Vault>('create_vault', { parent, name }),
  openVault: (path: string) => invoke<Vault>('open_vault', { path }),
  setVaultOpen: (id: string, open: boolean) => invoke<void>('set_vault_open', { id, open }),
  removeVault: (id: string) => invoke<void>('remove_vault', { id }),
  renameVault: (id: string, name: string) => invoke<void>('rename_vault', { id, name }),
  setVaultAccess: (id: string, mcp: McpAccess) => invoke<void>('set_vault_access', { id, mcp }),
  setVaultScripts: (id: string, allow: boolean) => invoke<void>('set_vault_scripts', { id, allow }),
  tree: (id: string) => invoke<TreeNode[]>('vault_tree', { id }),
  read: (id: string, path: string) => invoke<Note>('read_note', { id, path }),
  write: (id: string, path: string, content: string, expected: string | null) =>
    invoke<string>('write_note', { id, path, content, expected }),
  create: (id: string, path: string, content: string) => invoke<string>('create_note', { id, path, content }),
  createDir: (id: string, path: string) => invoke<void>('create_dir', { id, path }),
  /** Moves or renames, rewriting the links that would break. */
  rename: (id: string, from: string, to: string) => invoke<LinkUpdate>('rename_path', { id, from, to }),
  /** Sets a file or folder aside and returns the token that undoes it or trashes it for good. */
  trash: (id: string, path: string) => invoke<string>('trash_path', { id, path }),
  undoTrash: (id: string, token: string) => invoke<string>('undo_trash', { id, token }),
  noteTemplates: (id: string) => invoke<string[]>('note_templates', { id }),
  noteTemplate: (id: string, name: string) => invoke<string>('note_template', { id, name }),
  saveNoteTemplate: (id: string, name: string, content: string) => invoke<void>('save_note_template', { id, name, content }),
  deleteNoteTemplate: (id: string, name: string) => invoke<void>('delete_note_template', { id, name }),
  /** Saves an image in `dir` under `name`, or a numbered variant. Its path in the vault. */
  saveImage: (id: string, dir: string, name: string, data: Uint8Array) => invoke<string>('save_image', { id, dir, name, data: Array.from(data) }),
  finishTrash: (id: string, token: string) => invoke<void>('finish_trash', { id, token }),
  search: (query: string) => invoke<VaultHit[]>('search_all', { query }),
  homeInfo: () => invoke<HomeInfo>('home_info'),
  links: (id: string, path: string) => invoke<LinkInfo>('note_links', { id, path }),
  brokenLinks: (id: string) => invoke<BrokenLink[]>('broken_links', { id }),
  /** How many links it changed. */
  repointLink: (id: string, note: string, target: string, to: string) => invoke<number>('repoint_link', { id, note, target, to }),
  openWithSystem: (id: string, path: string) => invoke<void>('open_with_system', { id, path }),
  mcpInfo: () => invoke<{ binary: string; available: boolean }>('mcp_info'),
  openPath: (path: string) => invoke<Opened>('open_path', { path }),
  closeLoose: (id: string) => invoke<void>('close_loose', { id }),
  takePendingFiles: () => invoke<string[]>('take_pending_files'),
  defaultAppInfo: () => invoke<DefaultAppInfo>('default_app_info'),
  setDefaultApp: () => invoke<void>('set_default_app'),
  vaultThemes: (id: string) => invoke<VaultThemes>('vault_themes', { id }),
  saveVaultTheme: (id: string, theme: ThemeFile) => invoke<void>('save_vault_theme', { id, theme }),
  deleteVaultTheme: (id: string, theme: string) => invoke<void>('delete_vault_theme', { id, theme }),
  setVaultDefaultTheme: (id: string, theme: string | null) => invoke<void>('set_vault_default_theme', { id, theme }),
  setVaultDiagramTheme: (id: string, theme: string | null) => invoke<void>('set_vault_diagram_theme', { id, theme }),
  listTemplates: () => invoke<string[]>('list_templates'),
  importTemplate: () => invoke<string | null>('import_template'),
  renameTemplate: (name: string, newName: string) => invoke<void>('rename_template', { name, newName }),
  deleteTemplate: (name: string) => invoke<void>('delete_template', { name }),
  readImage: (id: string, path: string) => invoke<number[]>('read_image', { id, path }),
  /** The saved file's path, or null if the save dialog was cancelled. */
  exportDocx: (plan: ExportPlan) => invoke<string | null>('export_docx', { plan }),
  exportPdf: (plan: ExportPlan) => invoke<string | null>('export_pdf', { plan }),
  /** Only for files exported in this session. */
  openExported: (path: string) => invoke<void>('open_exported', { path }),
  revealExported: (path: string) => invoke<void>('reveal_exported', { path }),
  previewDocx: (plan: ExportPlan) => invoke<number[]>('preview_docx', { plan }),
  previewPdf: (plan: ExportPlan) => invoke<string[]>('preview_pdf', { plan }),
  templateStyles: (template: string | null) => invoke<TemplateStyle[]>('template_styles', { template }),
  saveTemplateCopy: (name: string) => invoke<boolean>('save_template_copy', { name }),
  wordConfig: (id: string) => invoke<WordConfig>('word_config', { id }),
  saveWordSettings: (id: string, settings: WordSettings) => invoke<void>('save_word_settings', { id, settings }),
  chooseVaultTemplate: (id: string) => invoke<boolean>('choose_vault_template', { id }),
  removeVaultTemplate: (id: string) => invoke<void>('remove_vault_template', { id }),
  wordSample: (id: string, settings: WordSettings, markdown: string, picture: number[]) => invoke<number[]>('word_sample', { id, settings, markdown, picture }),
  /** Tells the system spell checker which dictionaries to use, where it needs telling. */
  /** Vaults whose changes on disk are not followed, and why. */
  watchProblems: () => invoke<WatchProblem[]>('watch_problems'),
  setSpellcheck: (languages: string[]) => invoke<void>('set_spellcheck', { languages }),
  installerLanguage: () => invoke<string | null>('installer_language'),
  exportFile: (name: string, data: Uint8Array) => invoke<string | null>('export_file', { name, data: Array.from(data) }),
};

/** URL of a vault file, served by the app's `umd` protocol. */
export const fileUrl = (vaultId: string, path: string) => convertFileSrc(`${vaultId}/${path}`, 'umd');
