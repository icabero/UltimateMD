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
  hit: { path: string; line: number; text: string };
}

export interface LinkInfo {
  outgoing: string[];
  unresolved: string[];
  backlinks: string[];
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
  rename: (id: string, from: string, to: string) => invoke<void>('rename_path', { id, from, to }),
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
  listTemplates: () => invoke<string[]>('list_templates'),
  importTemplate: () => invoke<string | null>('import_template'),
  renameTemplate: (name: string, newName: string) => invoke<void>('rename_template', { name, newName }),
  deleteTemplate: (name: string) => invoke<void>('delete_template', { name }),
  readImage: (id: string, path: string) => invoke<number[]>('read_image', { id, path }),
  exportDocx: (id: string, path: string, template: string | null, date: string, diagrams: number[][]) =>
    invoke<boolean>('export_docx', { id, path, template, date, diagrams }),
  exportFile: (name: string, data: Uint8Array) => invoke<boolean>('export_file', { name, data: Array.from(data) }),
};

/** URL of a vault file, served by the app's `umd` protocol. */
export const fileUrl = (vaultId: string, path: string) => convertFileSrc(`${vaultId}/${path}`, 'umd');
