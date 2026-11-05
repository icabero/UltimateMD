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
  exportFile: (name: string, data: Uint8Array) => invoke<boolean>('export_file', { name, data: Array.from(data) }),
};

/** URL of a vault file, served by the app's `umd` protocol. */
export const fileUrl = (vaultId: string, path: string) => convertFileSrc(`${vaultId}/${path}`, 'umd');
