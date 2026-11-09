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
  trash: (id: string, path: string) => invoke<void>('trash_path', { id, path }),
  search: (query: string) => invoke<VaultHit[]>('search_all', { query }),
  links: (id: string, path: string) => invoke<LinkInfo>('note_links', { id, path }),
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
  exportDocx: (plan: ExportPlan) => invoke<boolean>('export_docx', { plan }),
  exportPdf: (plan: ExportPlan) => invoke<boolean>('export_pdf', { plan }),
  previewDocx: (plan: ExportPlan) => invoke<number[]>('preview_docx', { plan }),
  previewPdf: (plan: ExportPlan) => invoke<string[]>('preview_pdf', { plan }),
  templateStyles: (template: string | null) => invoke<TemplateStyle[]>('template_styles', { template }),
  saveTemplateCopy: (name: string) => invoke<boolean>('save_template_copy', { name }),
  wordConfig: (id: string) => invoke<WordConfig>('word_config', { id }),
  saveWordSettings: (id: string, settings: WordSettings) => invoke<void>('save_word_settings', { id, settings }),
  chooseVaultTemplate: (id: string) => invoke<boolean>('choose_vault_template', { id }),
  removeVaultTemplate: (id: string) => invoke<void>('remove_vault_template', { id }),
  wordSample: (id: string, settings: WordSettings, markdown: string, picture: number[]) => invoke<number[]>('word_sample', { id, settings, markdown, picture }),
  installerLanguage: () => invoke<string | null>('installer_language'),
  exportFile: (name: string, data: Uint8Array) => invoke<boolean>('export_file', { name, data: Array.from(data) }),
};

/** URL of a vault file, served by the app's `umd` protocol. */
export const fileUrl = (vaultId: string, path: string) => convertFileSrc(`${vaultId}/${path}`, 'umd');
