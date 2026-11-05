<script lang="ts">
  import { open as openDialog } from '@tauri-apps/plugin-dialog';
  import Icon from './Icon.svelte';
  import TreeItem from './TreeItem.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import { api, type TreeNode, type Vault } from '../api';
  import { baseName, dirName, join } from '../paths';
  import { store } from '../store.svelte';

  // Tints of the theme's text, accent and syntax colours, to tell vaults apart.
  const COLORS = ['--accent', '--syn-string', '--syn-attr', '--syn-number', '--syn-keyword', '--text-2'];
  const colorOf = (id: string) => `var(${COLORS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length]})`;

  interface Menu {
    x: number;
    y: number;
    items: { label: string; danger?: boolean; run: () => void }[];
  }

  let menu = $state<Menu | null>(null);
  let collapsed = $state<Record<string, boolean>>({});
  let dropVault = $state<string | null>(null);

  const newNote = async (id: string, dir: string) => {
    const name = await store.prompt('Nombre de la nota', '', 'Crear');
    if (name?.trim()) await store.createNote(id, dir, name.trim());
  };
  const newFolder = async (id: string, dir: string) => {
    const name = await store.prompt('Nombre de la carpeta', '', 'Crear');
    if (name?.trim()) await store.createFolder(id, dir, name.trim());
  };

  function entryMenu(e: MouseEvent, id: string, node: TreeNode) {
    e.preventDefault();
    const dir = node.isDir ? node.path : dirName(node.path);
    menu = {
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Nueva nota', run: () => newNote(id, dir) },
        { label: 'Nueva carpeta', run: () => newFolder(id, dir) },
        {
          label: 'Renombrar',
          run: async () => {
            const name = await store.prompt('Nuevo nombre', node.name, 'Renombrar');
            if (name?.trim()) await store.renameEntry(id, node.path, name.trim());
          },
        },
        {
          label: 'Enviar a la papelera',
          danger: true,
          run: async () => {
            if (await store.confirm(`¿Enviar «${node.name}» a la papelera?`, 'Enviar a la papelera', true)) await store.trash(id, node.path);
          },
        },
      ],
    };
  }

  function vaultMenu(e: MouseEvent, vault: Vault) {
    e.preventDefault();
    menu = {
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Nueva nota', run: () => newNote(vault.id, '') },
        { label: 'Nueva carpeta', run: () => newFolder(vault.id, '') },
        { label: 'Cerrar vault', run: () => store.setVaultOpen(vault.id, false) },
      ],
    };
  }

  async function createVault() {
    const parent = await openDialog({ directory: true, title: 'Carpeta donde crear el vault' });
    if (typeof parent !== 'string') return;
    const name = await store.prompt('Nombre del vault', '', 'Crear');
    if (name?.trim()) await store.addVault(() => api.createVault(parent, name.trim()));
  }

  async function openVault() {
    const path = await openDialog({ directory: true, title: 'Abrir carpeta como vault' });
    if (typeof path === 'string') await store.addVault(() => api.openVault(path));
  }

  function dropOnVault(e: DragEvent, id: string) {
    e.preventDefault();
    dropVault = null;
    const raw = e.dataTransfer!.getData('application/x-umd');
    if (!raw) return;
    const from = JSON.parse(raw) as { vaultId: string; path: string };
    if (from.vaultId !== id) return store.notify('Solo se puede mover dentro del mismo vault');
    void store.move(id, from.path, join('', baseName(from.path)));
  }
</script>

<svelte:window onclick={() => (menu = null)} />

<aside>
  <header>
    <span class="brand">Ultimate<b>MD</b></span>
    <button class="icon" title="Buscar en todos los vaults (Ctrl+Mayús+F)" class:on={store.searching} onclick={() => (store.searching = !store.searching)}><Icon name="search" /></button>
    <button class="icon" title="Ajustes y MCP" onclick={() => (store.settings = true)}><Icon name="settings" /></button>
  </header>

  {#if store.searching}
    <SearchPanel />
  {:else}
    <div class="vaults">
      {#each store.openVaults as vault (vault.id)}
        <section
          class="vault"
          class:drop={dropVault === vault.id}
          ondragover={(e) => { e.preventDefault(); dropVault = vault.id; }}
          ondragleave={() => (dropVault = null)}
          ondrop={(e) => dropOnVault(e, vault.id)}
          aria-label={vault.name}
        >
          <div class="vhead">
            <button class="vname" oncontextmenu={(e) => vaultMenu(e, vault)} onclick={() => (collapsed[vault.id] = !collapsed[vault.id])} title={vault.path}>
              <span class="chev" class:open={!collapsed[vault.id]}><Icon name="chevron" size={12} /></span>
              <span class="dot" style:background={colorOf(vault.id)}></span>
              <span class="label">{vault.name}</span>
            </button>
            <button class="icon small" title="Nueva nota" onclick={() => newNote(vault.id, '')}><Icon name="plus" size={14} /></button>
            <button class="icon small" title="Nueva carpeta" onclick={() => newFolder(vault.id, '')}><Icon name="folderPlus" size={14} /></button>
          </div>
          {#if !collapsed[vault.id]}
            {#each store.trees[vault.id] ?? [] as node (node.path)}
              <TreeItem vaultId={vault.id} {node} depth={1} onmenu={entryMenu} />
            {:else}
              <p class="empty">Vault vacío</p>
            {/each}
          {/if}
        </section>
      {/each}
    </div>
  {/if}

  <footer>
    <button onclick={createVault}><Icon name="plus" size={14} /> Crear vault</button>
    <button onclick={openVault}><Icon name="folder" size={14} /> Abrir carpeta</button>
  </footer>
</aside>

{#if menu}
  <div class="menu" role="menu" style:left="{menu.x}px" style:top="{menu.y}px">
    {#each menu.items as item}
      <button role="menuitem" class:danger={item.danger} onclick={item.run}>{item.label}</button>
    {/each}
  </div>
{/if}

<style>
  aside { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--panel); border-right: 1px solid var(--line); }
  header { display: flex; align-items: center; gap: 2px; padding: 10px 8px 8px 14px; }
  .brand { flex: 1; font-size: 13.5px; letter-spacing: -.01em; color: var(--text-2); }
  .brand b { color: var(--text); font-weight: 700; }
  .vaults { flex: 1; min-height: 0; overflow-y: auto; padding: 0 6px 8px; }
  .vault { margin-bottom: 8px; border-radius: 8px; }
  .vault.drop { background: var(--accent-soft); }
  .vhead { display: flex; align-items: center; height: 30px; }
  .vhead .small { opacity: 0; }
  .vhead:hover .small, .vhead .small:focus-visible { opacity: 1; }
  .vname { display: flex; flex: 1; align-items: center; gap: 6px; min-width: 0; padding: 0 4px; border: 0; background: none; color: var(--text); font-size: 12.5px; font-weight: 600; text-align: left; }
  .label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .chev { display: flex; flex: none; color: var(--text-3); transition: transform .12s; }
  .chev.open { transform: rotate(90deg); }
  .dot { flex: none; width: 8px; height: 8px; border-radius: 2px; }
  .empty { margin: 2px 0 6px 28px; color: var(--text-3); font-size: 12.5px; }
  footer { display: flex; gap: 4px; padding: 8px; border-top: 1px solid var(--line); }
  footer button { display: flex; flex: 1; align-items: center; justify-content: center; gap: 5px; height: 30px; border: 0; border-radius: 6px; background: none; color: var(--text-2); font-size: 12px; white-space: nowrap; }
  footer button:hover { background: var(--hover); color: var(--text); }
  .menu { position: fixed; z-index: 40; min-width: 180px; padding: 4px; border: 1px solid var(--line); border-radius: 8px; background: var(--raised); box-shadow: var(--shadow); }
  .menu button { display: block; width: 100%; padding: 6px 10px; border: 0; border-radius: 6px; background: none; color: var(--text); font-size: 13px; text-align: left; }
  .menu button:hover { background: var(--hover); }
  .menu .danger { color: var(--danger); }
</style>
