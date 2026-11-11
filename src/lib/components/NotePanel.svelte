<script lang="ts">
  import Icon from './Icon.svelte';
  import NoteProperties from './NoteProperties.svelte';
  import NoteHistory from './NoteHistory.svelte';
  import { IS_MAC, frame } from '../frame.svelte';
  import { api, type LinkInfo } from '../api';
  import { tr, type Key } from '../i18n.svelte';
  import { headingAt, outline, type Heading } from '../markdown';
  import { baseName, dirName } from '../paths';
  import { store, type PanelTab, type Tab } from '../store.svelte';

  let { tab }: { tab: Tab } = $props();

  const TABS: { id: PanelTab; label: Key }[] = [
    { id: 'outline', label: 'panel.outline' },
    { id: 'links', label: 'panel.links' },
    { id: 'properties', label: 'panel.properties' },
    { id: 'history', label: 'panel.history' },
  ];
  const OUTLINE_DELAY = 200;
  const LINKS_DELAY = 250;

  // The outline follows the text a moment after typing stops, and at once on another note.
  let headings = $state<Heading[]>([]);
  let outlineOf = '';
  let outlineTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    const { key, content } = tab;
    clearTimeout(outlineTimer);
    const run = () => (headings = outline(content));
    if (key !== outlineOf) {
      outlineOf = key;
      run();
    } else {
      outlineTimer = setTimeout(run, OUTLINE_DELAY);
    }
  });

  const current = $derived(store.position?.key === tab.key ? headingAt(headings, store.position.line) : -1);
  const top = $derived(Math.min(...headings.map((h) => h.level)));

  function goTo(index: number) {
    store.reveal = { key: tab.key, line: headings[index].line, terms: [], heading: index };
  }

  // Links are worked out by the backend, so only while that tab shows, and again after a save.
  let links = $state<LinkInfo | null>(null);
  let run = 0;
  $effect(() => {
    if (store.layout.panelTab !== 'links' || tab.loose) return;
    const { vaultId, path } = tab;
    void tab.version;
    void store.trees[vaultId];
    const id = ++run;
    const timer = setTimeout(async () => {
      const found = await api.links(vaultId, path).catch(() => null);
      if (id === run) links = found;
    }, LINKS_DELAY);
    return () => clearTimeout(timer);
  });

  const name = (path: string) => baseName(path).replace(/\.(md|markdown)$/i, '');
</script>

{#snippet notes(paths: string[], empty: Key)}
  {#each paths as path (path)}
    <button class="item" title={path} onclick={() => store.openFile(tab.vaultId, path)}>
      <span class="name">{name(path)}</span>
      {#if dirName(path)}<span class="where">{dirName(path)}</span>{/if}
    </button>
  {:else}
    <p class="empty">{tr(empty)}</p>
  {/each}
{/snippet}

<aside class="panel" aria-label={tr('panel.title')}>
  {#if frame.own && !IS_MAC}
    <!-- Room for the window buttons, which would not fit beside the tabs. -->
    <div class="frame-gap" data-tauri-drag-region></div>
  {/if}
  <div class="head" data-tauri-drag-region>
    <div class="tabs" role="tablist">
      {#each TABS as t (t.id)}
        <button role="tab" aria-selected={store.layout.panelTab === t.id} class:on={store.layout.panelTab === t.id} onclick={() => store.openPanel(t.id)}>{tr(t.label)}</button>
      {/each}
    </div>
    <button class="icon small" title={tr('panel.hide')} onclick={() => store.toggleBar('right', false)}><Icon name="close" size={14} /></button>
  </div>

  <div class="body" role="tabpanel">
    {#if store.layout.panelTab === 'outline'}
      <nav aria-label={tr('panel.outline')}>
        {#each headings as h, i (i)}
          <button class="heading" class:current={i === current} aria-current={i === current ? 'location' : undefined} style:padding-left="calc(var(--space-2) + {h.level - top} * var(--space-3))" onclick={() => goTo(i)}>
            {h.text || '…'}
          </button>
        {:else}
          <p class="empty">{tr('panel.noHeadings')}</p>
        {/each}
      </nav>
    {:else if store.layout.panelTab === 'properties'}
      <NoteProperties {tab} />
    {:else if store.layout.panelTab === 'history'}
      {#if tab.loose}<p class="empty">{tr('history.loose')}</p>{:else}{#key tab.key}<NoteHistory {tab} />{/key}{/if}
    {:else if tab.loose}
      <p class="empty">{tr('panel.looseLinks')}</p>
    {:else if links}
      <h3>{tr('panel.backlinks')}</h3>
      {@render notes(links.backlinks, 'panel.noBacklinks')}
      <h3>{tr('panel.outgoing')}</h3>
      {@render notes(links.outgoing, 'panel.noOutgoing')}
      {#if links.unresolved.length}
        <h3>{tr('panel.unresolved')}</h3>
        {#each links.unresolved as target (target)}
          <button class="item missing" title={tr('panel.createMissing')} onclick={() => store.followLink(tab, target)}>
            <span class="name">{target}</span>
          </button>
        {/each}
        <button class="all" onclick={() => (store.brokenLinks = tab.vaultId)}>{tr('broken.inVault')}</button>
      {/if}
    {/if}
  </div>
</aside>

<style>
  .all { margin: var(--space-1-5) var(--space-2) 0; padding: 0; border: 0; background: none; color: var(--accent-text); font-size: var(--font-sm); text-align: left; }
  .all:hover { text-decoration: underline; }
  .panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--panel); border-left: 1px solid var(--line); }
  .head { display: flex; align-items: center; gap: var(--space-1); height: 38px; flex: none; padding: 0 var(--space-1-5) 0 var(--space-2); border-bottom: 1px solid var(--line); }
  .frame-gap { height: 38px; flex: none; border-bottom: 1px solid var(--line); }
  .tabs { display: flex; flex: 1; gap: var(--space-0-5); min-width: 0; overflow: hidden; }
  .tabs button { min-width: 0; overflow: hidden; padding: var(--space-1) var(--space-2); white-space: nowrap; text-overflow: ellipsis; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-2); font-size: var(--font-sm); transition: background var(--ease), color var(--ease); }
  .tabs button:hover { background: var(--hover); color: var(--text); }
  .tabs button.on { background: var(--accent-soft); color: var(--accent-text); }
  .body { flex: 1; min-height: 0; padding: var(--space-2); overflow-y: auto; }
  .heading, .item { display: block; width: 100%; padding: var(--space-1) var(--space-2); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-2); font-size: var(--font-sm); text-align: left; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .heading:hover, .item:hover { background: var(--hover); color: var(--text); }
  .heading.current { background: var(--accent-soft); color: var(--accent-text); }
  .item .name { display: block; overflow: hidden; color: var(--text); text-overflow: ellipsis; }
  .item .where { display: block; overflow: hidden; color: var(--text-3); font-size: var(--font-xs); text-overflow: ellipsis; }
  .item.missing .name { color: var(--text-2); text-decoration: underline dashed; text-underline-offset: 3px; }
  h3 { margin: var(--space-3) var(--space-2) var(--space-1); color: var(--text-3); font-size: var(--font-xs); font-weight: 600; letter-spacing: .02em; text-transform: uppercase; }
  h3:first-child { margin-top: var(--space-1); }
  .empty { margin: 0; padding: var(--space-1) var(--space-2); color: var(--text-3); font-size: var(--font-sm); }
</style>
