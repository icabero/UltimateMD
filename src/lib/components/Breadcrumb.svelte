<script lang="ts">
  import Icon from './Icon.svelte';
  import type { TreeNode } from '../api';
  import { tr } from '../i18n.svelte';
  import { baseName, dirName, kindOf } from '../paths';
  import { store, type MenuItem, type Tab } from '../store.svelte';

  let { tab }: { tab: Tab } = $props();

  /** Folders shown before the middle ones fold into "…". */
  const MAX_FOLDERS = 2;
  /** More than this in a menu is a list nobody reads; the tree is the place for it. */
  const MAX_ITEMS = 150;

  const folders = $derived(dirName(tab.path) ? dirName(tab.path).split('/') : []);
  const vaultName = $derived(store.vault(tab.vaultId)?.name ?? '');
  const note = $derived(baseName(tab.path).replace(/\.(md|markdown|html|htm)$/i, ''));
  const pathTo = (count: number) => folders.slice(0, count).join('/');
  // With a long path only the first and the last folder stay; the rest are behind "…".
  const folded = $derived(folders.length > MAX_FOLDERS);
  const shown = $derived(
    folders.map((name, i) => ({ name, path: pathTo(i + 1), hidden: folded && i > 0 && i < folders.length - 1 })).filter((f) => !f.hidden),
  );
  const hidden = $derived(folded ? folders.slice(1, -1).map((name, i) => ({ name, path: pathTo(i + 2) })) : []);

  function contents(vaultId: string, dir: string): TreeNode[] {
    let level = store.trees[vaultId] ?? [];
    for (const part of dir ? dir.split('/') : []) level = level.find((n) => n.isDir && baseName(n.path) === part)?.children ?? [];
    return level;
  }

  const ICONS = { md: 'file', html: 'code', image: 'image', other: 'file' } as const;

  /** What is in a folder, as the tree orders it, to open any of it; and where to find it in the tree. */
  function folderItems(anchor: HTMLElement, dir: string, reveal = dir): MenuItem[] {
    const nodes = contents(tab.vaultId, dir).filter((n) => n.isDir || kindOf(n.path) !== 'other');
    const items: MenuItem[] = nodes.slice(0, MAX_ITEMS).map((n) =>
      n.isDir
        ? { label: n.name, icon: 'folder', run: () => setTimeout(() => openMenu(anchor, folderItems(anchor, n.path))) }
        : {
            label: n.name.replace(/\.(md|markdown|html|htm)$/i, ''),
            icon: n.path === tab.path ? 'check' : ICONS[kindOf(n.path)],
            run: () => void store.openFile(tab.vaultId, n.path),
          },
    );
    if (!items.length) items.push({ label: tr('crumb.empty'), disabled: true, run: () => {} });
    items.push({ label: tr('crumb.showInTree'), icon: 'folder', separator: true, run: () => store.showInTree(tab.vaultId, reveal) });
    return items;
  }

  function openMenu(anchor: HTMLElement, items: MenuItem[]) {
    const box = anchor.getBoundingClientRect();
    store.menu = { x: box.left, y: box.bottom + 2, items };
  }

  function show(e: MouseEvent, dir: string) {
    e.stopPropagation();
    const anchor = e.currentTarget as HTMLElement;
    openMenu(anchor, folderItems(anchor, dir));
  }

  function showHidden(e: MouseEvent) {
    e.stopPropagation();
    const anchor = e.currentTarget as HTMLElement;
    openMenu(
      anchor,
      hidden.map((f) => ({ label: f.name, icon: 'folder', run: () => setTimeout(() => openMenu(anchor, folderItems(anchor, f.path))) })),
    );
  }

  /** The note itself: its neighbours, and where it is in the tree. */
  const noteMenu = (e: MouseEvent) => {
    e.stopPropagation();
    const anchor = e.currentTarget as HTMLElement;
    openMenu(anchor, folderItems(anchor, dirName(tab.path), tab.path));
  };
</script>

<nav class="crumbs" aria-label={tr('crumb.label')}>
  <button class="crumb" aria-haspopup="menu" title={tr('crumb.title', { name: vaultName })} onclick={(e) => show(e, '')}>{vaultName}</button>
  {#each shown as f, i (f.path)}
    <span class="sep" aria-hidden="true"><Icon name="chevron" size={10} /></span>
    {#if folded && i === 1}
      <button class="crumb more" aria-haspopup="menu" title={tr('crumb.more')} aria-label={tr('crumb.more')} onclick={showHidden}>…</button>
      <span class="sep" aria-hidden="true"><Icon name="chevron" size={10} /></span>
    {/if}
    <button class="crumb" aria-haspopup="menu" title={tr('crumb.title', { name: f.name })} onclick={(e) => show(e, f.path)}>{f.name}</button>
  {/each}
  <span class="sep" aria-hidden="true"><Icon name="chevron" size={10} /></span>
  <button class="crumb note" aria-current="page" aria-haspopup="menu" title={tr('crumb.noteTitle')} onclick={noteMenu}>{note}</button>
</nav>

<style>
  .crumbs { display: flex; align-items: center; gap: var(--space-0-5); height: 24px; flex: none; min-width: 0; padding: 0 var(--space-3); border-bottom: 1px solid var(--line); background: var(--bg); color: var(--text-3); font-size: var(--font-sm); white-space: nowrap; overflow: hidden; }
  .sep { display: flex; flex: none; }
  .crumb { flex: 0 1 auto; min-width: 0; max-width: 18ch; padding: 0 var(--space-1); border: 0; border-radius: var(--radius-sm); background: none; color: inherit; font-size: inherit; overflow: hidden; text-overflow: ellipsis; }
  .crumb:hover, .crumb:focus-visible { background: var(--hover); color: var(--text); }
  .more { flex: none; }
  .note { max-width: none; color: var(--text-2); font-weight: 500; }
</style>
