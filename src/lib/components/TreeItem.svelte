<script lang="ts">
  import Self from './TreeItem.svelte';
  import Icon from './Icon.svelte';
  import type { TreeNode } from '../api';
  import { tr } from '../i18n.svelte';
  import { baseName, join, kindOf } from '../paths';
  import { store } from '../store.svelte';

  let { vaultId, node, depth, onmenu }: {
    vaultId: string;
    node: TreeNode;
    depth: number;
    onmenu: (e: MouseEvent, vaultId: string, node: TreeNode) => void;
  } = $props();

  let expanded = $state(false);
  let over = $state(false);
  const active = $derived(store.active?.vaultId === vaultId && store.active.path === node.path);
  const icon = $derived(node.isDir ? 'folder' : { md: 'file', html: 'code', image: 'image', other: 'file' }[kindOf(node.path)]);

  // Reveals the note being edited, including one opened from a link or search.
  $effect(() => {
    if (node.isDir && store.active?.vaultId === vaultId && store.active.path.startsWith(`${node.path}/`)) expanded = true;
  });

  function dragStart(e: DragEvent) {
    e.dataTransfer!.setData('application/x-umd', JSON.stringify({ vaultId, path: node.path }));
    e.dataTransfer!.effectAllowed = 'move';
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    over = false;
    const raw = e.dataTransfer!.getData('application/x-umd');
    if (!raw) return;
    const from = JSON.parse(raw) as { vaultId: string; path: string };
    if (from.vaultId !== vaultId) return store.notify(tr('sidebar.sameVaultOnly'));
    if (node.path !== from.path) void store.move(vaultId, from.path, join(node.path, baseName(from.path)));
  }
</script>

<button
  class="row"
  class:active
  class:over
  style:padding-left="{depth * 14 + 8}px"
  draggable="true"
  ondragstart={dragStart}
  ondragover={(e) => { if (node.isDir) { e.preventDefault(); over = true; } }}
  ondragleave={() => (over = false)}
  ondrop={(e) => node.isDir && drop(e)}
  onclick={() => (node.isDir ? (expanded = !expanded) : store.openFile(vaultId, node.path))}
  oncontextmenu={(e) => onmenu(e, vaultId, node)}
  title={node.path}
>
  {#if node.isDir}
    <span class="chev" class:open={expanded}><Icon name="chevron" size={12} /></span>
  {/if}
  <span class="ico"><Icon name={icon} size={15} /></span>
  <span class="label">{node.isDir ? node.name : node.name.replace(/\.(md|markdown)$/i, '')}</span>
</button>
{#if node.isDir && expanded}
  {#each node.children as child (child.path)}
    <Self {vaultId} node={child} depth={depth + 1} {onmenu} />
  {/each}
{/if}

<style>
  .row {
    display: flex; align-items: center; gap: 5px; width: 100%; height: 27px;
    padding-right: 8px; border: 0; border-radius: 6px; background: none; color: var(--text-2);
    font-size: 13px; text-align: left; cursor: default;
  }
  .row:hover { background: var(--hover); color: var(--text); }
  .row.active { background: var(--accent-soft); color: var(--accent-text); font-weight: 500; }
  .row.over { outline: 1.5px dashed var(--accent); outline-offset: -2px; }
  .label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .ico { display: flex; flex: none; opacity: .65; }
  .chev { display: flex; flex: none; transition: transform .12s; }
  .chev.open { transform: rotate(90deg); }
</style>
