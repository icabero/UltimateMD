<script lang="ts">
  import Icon from './Icon.svelte';
  import TreeItem from './TreeItem.svelte';
  import SearchPanel from './SearchPanel.svelte';
  import type { TreeNode, Vault } from '../api';
  import { tr } from '../i18n.svelte';
  import { baseName, dirName, join, kindOf } from '../paths';
  import { store, type MenuItem } from '../store.svelte';
  import { ORDERS } from '../treeOrder';
  import { vaultColor } from '../vaultColor';

  const colorOf = vaultColor;

  let collapsed = $state<Record<string, boolean>>({});
  let dropVault = $state<string | null>(null);

  // A vault folded away opens when something in it is to be shown.
  $effect(() => {
    const asked = store.treeReveal;
    if (asked) collapsed[asked.vaultId] = false;
  });

  const newNote = async (id: string, dir: string) => {
    const name = await store.prompt(tr('sidebar.noteName'), '', tr('common.create'));
    if (name?.trim()) await store.createNote(id, dir, name.trim());
  };
  const newFolder = async (id: string, dir: string) => {
    const name = await store.prompt(tr('sidebar.folderName'), '', tr('common.create'));
    if (name?.trim()) await store.createFolder(id, dir, name.trim());
  };

  function entryMenu(e: MouseEvent, id: string, node: TreeNode) {
    const dir = node.isDir ? node.path : dirName(node.path);
    const items: MenuItem[] = [
      { label: tr('sidebar.newNote'), icon: 'plus', run: () => void newNote(id, dir) },
      { label: tr('cmd.fromTemplate'), icon: 'tasks', run: () => store.newNoteFromTemplate(id, dir) },
      { label: tr('sidebar.newFolder'), icon: 'folderPlus', run: () => void newFolder(id, dir) },
    ];
    if (node.isDir) {
      items.push(
        { label: tr('reader.readFolder'), icon: 'eye', separator: true, run: () => (store.reader = { vaultId: id, folder: node.path }) },
        { label: tr('look.menu'), icon: 'palette', run: () => void store.chooseFolderLook(id, node.path) },
      );
    }
    if (!node.isDir) {
      const favorite = store.isFavorite(id, node.path);
      if (kindOf(node.path) !== 'other') items.push({ label: tr('menu.openBeside'), icon: 'split', separator: true, run: () => void store.openBeside(id, node.path) });
      items.push({ label: tr(favorite ? 'sidebar.removeFavorite' : 'sidebar.addFavorite'), icon: 'star', separator: kindOf(node.path) === 'other', run: () => store.toggleFavorite(id, node.path) });
      if (kindOf(node.path) === 'md') items.push({ label: tr('menu.copyLink'), icon: 'link', run: () => store.copyLink(id, node.path) });
    }
    if (store.order(id) === 'manual') {
      items.push(
        { label: tr('sort.moveUp'), icon: 'sort', separator: true, disabled: !store.neighbour(id, node.path, -1), run: () => void store.nudge(id, node.path, -1) },
        { label: tr('sort.moveDown'), icon: 'sort', disabled: !store.neighbour(id, node.path, 1), run: () => void store.nudge(id, node.path, 1) },
      );
    }
    items.push(
      { label: tr('menu.copyPath'), icon: 'copy', separator: node.isDir || store.order(id) === 'manual', run: () => void store.copyText(store.absolutePath({ vaultId: id, path: node.path }), tr('menu.pathCopied')) },
      { label: tr('menu.reveal'), icon: 'folder', run: () => store.revealInFolder(id, node.path) },
      { label: tr('common.rename'), icon: 'edit', keys: ['F2'], separator: true, run: () => void store.renamePrompt(id, node.path) },
      { label: tr('sidebar.trash'), icon: 'trash', keys: ['Del'], danger: true, run: () => void store.trash(id, node.path) },
    );
    store.openMenu(e, items);
  }

  /** The ways to order a vault's notes, the current one ticked. */
  function sortItems(id: string): MenuItem[] {
    return ORDERS.map((o) => ({
      label: tr(o.label),
      icon: store.order(id) === o.value ? 'check' : undefined,
      run: () => void store.setOrder(id, o.value),
    }));
  }

  function sortMenu(e: MouseEvent, id: string) {
    store.openMenu(e, sortItems(id));
  }

  function vaultMenu(e: MouseEvent, vault: Vault) {
    store.openMenu(e, [
      { label: tr('sort.open'), icon: 'sort', run: () => setTimeout(() => (store.menu = { x: e.clientX, y: e.clientY, items: sortItems(vault.id) })) },
      { label: tr('sidebar.newNote'), icon: 'plus', run: () => void newNote(vault.id, '') },
      { label: tr('cmd.fromTemplate'), icon: 'tasks', run: () => store.newNoteFromTemplate(vault.id, '') },
      { label: tr('daily.today'), icon: 'calendar', run: () => void store.openDaily(0, vault.id) },
      { label: tr('sidebar.newFolder'), icon: 'folderPlus', run: () => void newFolder(vault.id, '') },
      { label: tr('reader.readVault'), icon: 'eye', separator: true, run: () => (store.reader = { vaultId: vault.id, folder: '' }) },
      { label: tr('broken.open'), icon: 'link', run: () => (store.brokenLinks = vault.id) },
      { label: tr('aiLog.open'), icon: 'list', run: () => (store.aiLog = vault.id) },
      { label: tr('menu.reveal'), icon: 'folder', separator: true, run: () => store.revealInFolder(vault.id, '') },
      { label: tr('vaultSettings.open'), icon: 'settings', run: () => store.openVaultSettings(vault.id) },
      { label: tr('sidebar.closeVault'), icon: 'close', run: () => void store.setVaultOpen(vault.id, false) },
    ]);
  }

  /** Favourites of the vaults that are open and still there. */
  const favorites = $derived(
    store.favorites.flatMap((f) => {
      const vault = store.vault(f.vaultId);
      return vault?.open && store.files(f.vaultId).includes(f.path) ? [{ ...f, vault }] : [];
    }),
  );

  function favoriteMenu(e: MouseEvent, vaultId: string, path: string) {
    store.openMenu(e, [
      { label: tr('menu.openBeside'), icon: 'split', run: () => void store.openBeside(vaultId, path) },
      { label: tr('sidebar.removeFavorite'), icon: 'star', run: () => store.toggleFavorite(vaultId, path) },
    ]);
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

  /**
   * The tree with the keyboard, as file managers do: up and down move through
   * what shows, right opens a folder or goes into it, left closes it or goes
   * to the one it is in. Each row handles its own Enter, F2 and Delete.
   */
  function treeKeys(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const here = e.target as HTMLElement;
    if (!here.matches('[data-row]')) return;
    const rows = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-row]')];
    const at = rows.indexOf(here);
    const depth = (el: HTMLElement) => Number(el.dataset.depth ?? 0);
    const open = here.getAttribute('aria-expanded');
    let target: HTMLElement | undefined;
    if (e.key === 'ArrowDown') target = rows[at + 1];
    else if (e.key === 'ArrowUp') target = rows[at - 1];
    else if (e.key === 'Home') target = rows[0];
    else if (e.key === 'End') target = rows.at(-1);
    else if (e.key === 'ArrowRight') {
      if (open === 'false') here.click();
      else if (open === 'true' && rows[at + 1] && depth(rows[at + 1]) > depth(here)) target = rows[at + 1];
    } else if (e.key === 'ArrowLeft') {
      if (open === 'true') here.click();
      else target = rows.slice(0, at).reverse().find((r) => depth(r) < depth(here));
    } else return;
    e.preventDefault();
    target?.focus();
  }
</script>

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
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="vaults" onkeydown={treeKeys}>
      {#if favorites.length}
        <section class="favorites" aria-label={tr('sidebar.favorites')}>
          <h2>{tr('sidebar.favorites')}</h2>
          {#each favorites as f (`${f.vaultId}:${f.path}`)}
            <button
              class="fav"
              data-row
              data-depth="1"
              class:active={store.active?.vaultId === f.vaultId && store.active.path === f.path}
              title="{f.vault.name} / {f.path}"
              onclick={() => store.openFile(f.vaultId, f.path)}
              oncontextmenu={(e) => favoriteMenu(e, f.vaultId, f.path)}
            >
              <span class="dot" style:background={colorOf(f.vaultId)}></span>
              <span class="label">{baseName(f.path).replace(/\.(md|markdown)$/i, '')}</span>
            </button>
          {/each}
        </section>
      {/if}
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
            <button class="vname" data-row data-depth="0" aria-expanded={!collapsed[vault.id]} oncontextmenu={(e) => vaultMenu(e, vault)} onclick={() => (collapsed[vault.id] = !collapsed[vault.id])} title={vault.path}>
              <span class="chev" class:open={!collapsed[vault.id]}><Icon name="chevron" size={12} /></span>
              <span class="dot" style:background={colorOf(vault.id)}></span>
              <span class="label">{vault.name}</span>
            </button>
            {#if store.unwatched[vault.id]}
              <button class="icon small warn" title={tr('watch.badge')} onclick={() => store.reread(vault.id)}><Icon name="refresh" size={14} /></button>
            {/if}
            <button class="icon small" title={tr('sidebar.newNote')} onclick={() => newNote(vault.id, '')}><Icon name="plus" size={14} /></button>
            <button class="icon small" title={tr('daily.today')} aria-label={tr('daily.today')} onclick={() => void store.openDaily(0, vault.id)}><Icon name="calendar" size={14} /></button>
            <button class="icon small" title={tr('sidebar.newFolder')} onclick={() => newFolder(vault.id, '')}><Icon name="folderPlus" size={14} /></button>
            <button class="icon small" title={tr('sort.title')} aria-label={tr('sort.title')} onclick={(e) => sortMenu(e, vault.id)}><Icon name="sort" size={14} /></button>
            <button class="icon small" title={tr('reader.readVault')} onclick={() => (store.reader = { vaultId: vault.id, folder: '' })}><Icon name="eye" size={14} /></button>
            <button class="icon small" title={tr('vaultSettings.open')} onclick={() => store.openVaultSettings(vault.id)}><Icon name="settings" size={14} /></button>
            {#if store.git[vault.id]}
              {@const git = store.git[vault.id]!}
              {@const label = tr('git.open', { branch: git.branch ?? tr('git.detached'), n: git.changes.length })}
              <button class="icon small git" title={label} aria-label={label} onclick={() => (store.gitScreen = vault.id)}>
                <Icon name="branch" size={14} />{#if git.changes.length}<span class="count">{git.changes.length}</span>{/if}
              </button>
            {/if}
          </div>
          {#if !collapsed[vault.id]}
            {#each store.trees[vault.id] ?? [] as node (node.path)}
              <TreeItem vaultId={vault.id} {node} depth={1} onmenu={entryMenu} />
            {:else}
              <div class="empty">
                <p>{tr('sidebar.emptyVault')}</p>
                <button onclick={() => newNote(vault.id, '')}>{tr('sidebar.firstNote')}</button>
              </div>
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
  .vhead:hover .small, .vhead .small:focus-visible, .vhead .warn { opacity: 1; }
  .vhead .warn { color: var(--danger); }
  .vname { display: flex; flex: 1; align-items: center; gap: var(--space-1-5); min-width: 0; padding: 0 var(--space-1); border: 0; background: none; color: var(--text); font-size: var(--font-sm); font-weight: 600; text-align: left; }
  .label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .chev { display: flex; flex: none; color: var(--text-3); transition: transform .12s; }
  .chev.open { transform: rotate(90deg); }
  .dot { flex: none; width: 8px; height: 8px; border-radius: var(--radius-2xs); }
  .favorites { margin-bottom: var(--space-2); }
  .favorites h2 { margin: 0; padding: var(--space-1-5) var(--space-1) var(--space-1); color: var(--text-3); font-size: var(--font-xs); font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
  .fav { display: flex; align-items: center; gap: var(--space-2); width: 100%; height: 27px; padding: 0 var(--space-2) 0 var(--space-3); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-2); font-size: var(--font-md); text-align: left; }
  .fav:hover { background: var(--hover); color: var(--text); }
  .fav.active { background: var(--accent-soft); color: var(--accent-text); font-weight: 500; }
  .empty p { margin: 0; }
  .empty button { margin-top: var(--space-1); padding: 0; border: 0; background: none; color: var(--accent-text); font-size: var(--font-sm); }
  .empty button:hover { text-decoration: underline; }
  .empty { margin: var(--space-0-5) 0 var(--space-1-5) var(--space-8); color: var(--text-3); font-size: var(--font-sm); }
  footer { display: flex; gap: var(--space-1); padding: var(--space-2); border-top: 1px solid var(--line); }
  footer button { display: flex; flex: 1; align-items: center; justify-content: center; gap: var(--space-1-5); height: 30px; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-2); font-size: var(--font-sm); white-space: nowrap; }
  footer button:hover { background: var(--hover); color: var(--text); }
  .git { display: flex; align-items: center; gap: var(--space-0-5); width: auto; padding: 0 var(--space-1); }
  .git .count { font-size: var(--font-xs); }
</style>
