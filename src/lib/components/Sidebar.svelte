<script lang="ts">
  import Icon from './Icon.svelte';
  import TreeItem from './TreeItem.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import type { TreeNode, Vault } from '../api';
  import { tr } from '../i18n.svelte';
  import { baseName, dirName, join } from '../paths';
  import { store } from '../store.svelte';
  import { vaultColor } from '../vaultColor';

  const colorOf = vaultColor;

  interface Menu {
    x: number;
    y: number;
    items: { label: string; danger?: boolean; run: () => void }[];
  }

  let menu = $state<Menu | null>(null);
  let collapsed = $state<Record<string, boolean>>({});
  let dropVault = $state<string | null>(null);

  const newNote = async (id: string, dir: string) => {
    const name = await store.prompt(tr('sidebar.noteName'), '', tr('common.create'));
    if (name?.trim()) await store.createNote(id, dir, name.trim());
  };
  const newFolder = async (id: string, dir: string) => {
    const name = await store.prompt(tr('sidebar.folderName'), '', tr('common.create'));
    if (name?.trim()) await store.createFolder(id, dir, name.trim());
  };

  function entryMenu(e: MouseEvent, id: string, node: TreeNode) {
    e.preventDefault();
    const dir = node.isDir ? node.path : dirName(node.path);
    menu = {
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: tr('sidebar.newNote'), run: () => newNote(id, dir) },
        { label: tr('cmd.fromTemplate'), run: () => store.newNoteFromTemplate(id, dir) },
        { label: tr('sidebar.newFolder'), run: () => newFolder(id, dir) },
        {
          label: tr('common.rename'),
          run: async () => {
            const name = await store.prompt(tr('sidebar.newName'), node.name, tr('common.rename'));
            if (name?.trim()) await store.renameEntry(id, node.path, name.trim());
          },
        },
        {
          label: tr('sidebar.trash'),
          danger: true,
          run: () => store.trash(id, node.path),
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
        { label: tr('sidebar.newNote'), run: () => newNote(vault.id, '') },
        { label: tr('cmd.fromTemplate'), run: () => store.newNoteFromTemplate(vault.id, '') },
        { label: tr('sidebar.newFolder'), run: () => newFolder(vault.id, '') },
        { label: tr('broken.open'), run: () => (store.brokenLinks = vault.id) },
        { label: tr('word.openSettings'), run: () => (store.wordScreen = vault.id) },
        { label: tr('sidebar.closeVault'), run: () => store.setVaultOpen(vault.id, false) },
      ],
    };
  }

  const createVault = () => store.createVaultDialog();
  const openVault = () => store.openVaultDialog();

  function dropOnVault(e: DragEvent, id: string) {
    e.preventDefault();
    dropVault = null;
    const raw = e.dataTransfer!.getData('application/x-umd');
    if (!raw) return;
    const from = JSON.parse(raw) as { vaultId: string; path: string };
    if (from.vaultId !== id) return store.notify(tr('sidebar.sameVaultOnly'));
    void store.move(id, from.path, join('', baseName(from.path)));
  }
</script>

<svelte:window onclick={() => (menu = null)} />

<aside>
  <header data-tauri-drag-region>
    <span class="brand" data-tauri-drag-region>Ultimate<b>MD</b></span>
    <button class="icon" title={tr('sidebar.searchTitle')} class:on={store.searching} onclick={() => (store.searching = !store.searching)}><Icon name="search" /></button>
    <button class="icon" title={tr('sidebar.settingsTitle')} onclick={() => (store.settings = true)}><Icon name="settings" /></button>
    <button class="icon" title={tr('about.title')} onclick={() => (store.about = true)}><Icon name="info" /></button>
    <button class="icon" title={tr('sidebar.hide')} onclick={() => store.toggleBar('left', false)}><Icon name="panelLeft" /></button>
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
            <button class="icon small" title={tr('sidebar.newNote')} onclick={() => newNote(vault.id, '')}><Icon name="plus" size={14} /></button>
            <button class="icon small" title={tr('sidebar.newFolder')} onclick={() => newFolder(vault.id, '')}><Icon name="folderPlus" size={14} /></button>
            <button class="icon small" title={tr('word.openSettings')} onclick={() => (store.wordScreen = vault.id)}><Icon name="word" size={14} /></button>
          </div>
          {#if !collapsed[vault.id]}
            {#each store.trees[vault.id] ?? [] as node (node.path)}
              <TreeItem vaultId={vault.id} {node} depth={1} onmenu={entryMenu} />
            {:else}
              <p class="empty">{tr('sidebar.emptyVault')}</p>
            {/each}
          {/if}
        </section>
      {/each}
    </div>
  {/if}

  <footer>
    <button onclick={createVault}><Icon name="plus" size={14} /> {tr('sidebar.createVault')}</button>
    <button onclick={openVault}><Icon name="folder" size={14} /> {tr('sidebar.openFolder')}</button>
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
  header { display: flex; align-items: center; gap: var(--space-0-5); height: 38px; padding: 0 var(--space-2) 0 calc(var(--space-3-5) + var(--frame-left, 0px)); }
  .brand { flex: 1; font-size: var(--font-md); letter-spacing: -.01em; color: var(--text-2); }
  .brand b { color: var(--text); font-weight: 700; }
  .vaults { flex: 1; min-height: 0; overflow-y: auto; padding: 0 var(--space-1-5) var(--space-2); }
  .vault { margin-bottom: var(--space-2); border-radius: var(--radius-md); }
  .vault.drop { background: var(--accent-soft); }
  .vhead { display: flex; align-items: center; height: 30px; }
  .vhead .small { opacity: 0; }
  .vhead:hover .small, .vhead .small:focus-visible { opacity: 1; }
  .vname { display: flex; flex: 1; align-items: center; gap: var(--space-1-5); min-width: 0; padding: 0 var(--space-1); border: 0; background: none; color: var(--text); font-size: var(--font-sm); font-weight: 600; text-align: left; }
  .label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .chev { display: flex; flex: none; color: var(--text-3); transition: transform .12s; }
  .chev.open { transform: rotate(90deg); }
  .dot { flex: none; width: 8px; height: 8px; border-radius: var(--radius-2xs); }
  .empty { margin: var(--space-0-5) 0 var(--space-1-5) var(--space-8); color: var(--text-3); font-size: var(--font-sm); }
  footer { display: flex; gap: var(--space-1); padding: var(--space-2); border-top: 1px solid var(--line); }
  footer button { display: flex; flex: 1; align-items: center; justify-content: center; gap: var(--space-1-5); height: 30px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-2); font-size: var(--font-sm); white-space: nowrap; }
  footer button:hover { background: var(--hover); color: var(--text); }
  .menu { position: fixed; z-index: var(--z-menu); min-width: 180px; padding: var(--space-1); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--raised); box-shadow: var(--shadow-lg); }
  .menu button { display: block; width: 100%; padding: var(--space-1-5) var(--space-2-5); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text); font-size: var(--font-md); text-align: left; }
  .menu button:hover { background: var(--hover); }
  .menu .danger { color: var(--danger); }
</style>
