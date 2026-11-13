<script module lang="ts">
  // What is being dragged: while it moves over a row, the browser does not say.
  let dragged: { vaultId: string; path: string; isDir: boolean } | null = null;
</script>

<script lang="ts">
  import { unfold } from '../motion';
  import Self from './TreeItem.svelte';
  import Icon from './Icon.svelte';
  import type { TreeNode } from '../api';
  import { tr } from '../i18n.svelte';
  import { baseName, dirName, join, kindOf } from '../paths';
  import { store } from '../store.svelte';

  /** As Git writes them. */
  const GIT_LETTER = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflict: '!' } as const;

  let { vaultId, node, depth, onmenu }: {
    vaultId: string;
    node: TreeNode;
    depth: number;
    onmenu: (e: MouseEvent, vaultId: string, node: TreeNode) => void;
  } = $props();

  let expanded = $state(false);
  let over = $state(false);
  let edge = $state<'before' | 'after' | null>(null);
  const manual = $derived(store.orders[vaultId] === 'manual');
  // Only the active tab's key, not the tab itself: a large folder has thousands
  // of rows, and each change to any open tab would otherwise reach every one.
  const active = $derived(store.activeKey === `${vaultId}:${node.path}`);
  const git = $derived(node.isDir ? null : store.gitState(vaultId, node.path));
  const icon = $derived(node.isDir ? 'folder' : { md: 'file', html: 'code', image: 'image', other: 'file' }[kindOf(node.path)]);

  // Reveals the note being edited, including one opened from a link or search.
  $effect(() => {
    if (node.isDir && store.activeKey?.startsWith(`${vaultId}:${node.path}/`)) expanded = true;
  });

  let row = $state<HTMLButtonElement>();
  // Asked to show a note or folder: opens the folders above it and takes the focus if it is this one.
  const asked = $derived(store.treeReveal?.vaultId === vaultId ? store.treeReveal.path : null);
  $effect(() => {
    if (asked === null) return;
    if (node.isDir && asked.startsWith(`${node.path}/`)) expanded = true;
    else if (asked === node.path) {
      row?.scrollIntoView({ block: 'nearest' });
      row?.focus({ preventScroll: true });
    }
  });

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'F2') void store.renamePrompt(vaultId, node.path);
    else if (e.key === 'Delete') void store.trash(vaultId, node.path);
    else return;
    e.preventDefault();
  }

  function dragStart(e: DragEvent) {
    e.dataTransfer!.setData('application/x-umd', JSON.stringify({ vaultId, path: node.path }));
    e.dataTransfer!.effectAllowed = 'move';
    dragged = { vaultId, path: node.path, isDir: node.isDir };
  }

  /**
   * With a manual order, the edges of a row place what is dragged before or
   * after it, if they are of the same kind in the same folder. The middle of a
   * folder still moves it inside.
   */
  function edgeOf(e: DragEvent): 'before' | 'after' | null {
    const from = dragged;
    if (!manual || !from || from.vaultId !== vaultId || from.path === node.path) return null;
    if (from.isDir !== node.isDir || dirName(from.path) !== dirName(node.path)) return null;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const at = (e.clientY - box.top) / box.height;
    const band = node.isDir ? 0.3 : 0.5;
    return at < band ? 'before' : at > 1 - band ? 'after' : null;
  }

  function dragOver(e: DragEvent) {
    edge = edgeOf(e);
    if (edge) e.preventDefault();
    else if (node.isDir) {
      e.preventDefault();
      over = true;
    }
    if (edge) over = false;
  }

  function dropHere(e: DragEvent) {
    const at = edgeOf(e);
    edge = null;
    if (!at) return node.isDir ? drop(e) : undefined;
    e.preventDefault();
    e.stopPropagation();
    if (dragged) void store.place(vaultId, dragged.path, node.path, at === 'after');
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
  bind:this={row}
  class="row"
  class:active
  class:over
  class:before={edge === 'before'}
  class:after={edge === 'after'}
  data-row
  data-depth={depth}
  aria-expanded={node.isDir ? expanded : undefined}
  onkeydown={onKey}
  style:padding-left="{depth * 14 + 8}px"
  draggable="true"
  ondragstart={dragStart}
  ondragend={() => (dragged = null)}
  ondragover={dragOver}
  ondragleave={() => { over = false; edge = null; }}
  ondrop={dropHere}
  onclick={() => (node.isDir ? (expanded = !expanded) : store.openFile(vaultId, node.path))}
  oncontextmenu={(e) => onmenu(e, vaultId, node)}
  title={node.path}
>
  {#if node.isDir}
    <span class="chev" class:open={expanded}><Icon name="chevron" size={12} /></span>
  {/if}
  <span class="ico"><Icon name={icon} size={15} /></span>
  <span class="label">{node.isDir ? node.name : node.name.replace(/\.(md|markdown)$/i, '')}</span>
  {#if git}<span class="git {git}" title={tr(`git.${git}`)}>{GIT_LETTER[git]}</span>{/if}
</button>
{#if node.isDir && expanded}
  <div transition:unfold>
    {#each node.children as child (child.path)}
      <Self {vaultId} node={child} depth={depth + 1} {onmenu} />
    {/each}
  </div>
{/if}

<style>
  .row {
    display: flex; align-items: center; gap: var(--space-1-5); width: 100%; height: 27px;
    padding-right: var(--space-2); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-2);
    font-size: var(--font-md); text-align: left; cursor: default;
  }
  .row:hover { background: var(--hover); color: var(--text); }
  .row.active { background: var(--accent-soft); color: var(--accent-text); font-weight: 500; }
  .row.over { outline: 1.5px dashed var(--accent); outline-offset: -2px; }
  .row.before { box-shadow: inset 0 2px 0 var(--accent); }
  .row.after { box-shadow: inset 0 -2px 0 var(--accent); }
  .label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .git { flex: none; margin-left: auto; color: var(--accent-text); font: 600 var(--font-xs)/1 var(--mono); }
  .git.untracked, .git.added { color: var(--text-2); }
  .git.conflict { color: var(--danger); }
  .ico { display: flex; flex: none; opacity: .65; }
  .chev { display: flex; flex: none; transition: transform .12s; }
  .chev.open { transform: rotate(90deg); }
</style>
