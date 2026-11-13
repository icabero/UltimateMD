<script lang="ts">
  import { enter } from '../motion';
  import Icon from './Icon.svelte';
  import { tr, type Key } from '../i18n.svelte';
  import { baseName } from '../paths';
  import { store, type MenuItem, type Tab, type ViewMode } from '../store.svelte';

  const VIEWS: { mode: ViewMode; icon: string; title: Key }[] = [
    { mode: 'visual', icon: 'visual', title: 'tabs.visual' },
    { mode: 'edit', icon: 'edit', title: 'tabs.edit' },
    { mode: 'split', icon: 'split', title: 'tabs.split' },
    { mode: 'preview', icon: 'eye', title: 'tabs.preview' },
  ];
  const active = $derived(store.active);
  // The bar touching a window corner leaves room for the window's buttons there.
  const panelShown = $derived(store.showRight && active?.kind === 'md');

  /** The tab being dragged, and the one it would land before or after. */
  let dragged = $state<string | null>(null);
  let over = $state<{ key: string; after: boolean } | null>(null);

  function select(tab: Tab) {
    store.activeKey = tab.key;
    store.persist();
  }

  function menu(e: MouseEvent, tab: Tab) {
    const others = store.tabs.some((t) => t.key !== tab.key && !t.pinned);
    const items: MenuItem[] = [
      { label: tr('common.close'), icon: 'close', keys: ['Ctrl', 'W'], run: () => void store.close(tab) },
      { label: tr('tabs.closeOthers'), disabled: !others, run: () => void store.closeOthers(tab) },
      { label: tr('tabs.closeRight'), disabled: !store.tabsBeside(tab, 'right').length, run: () => void store.closeBeside(tab, 'right') },
      { label: tr('tabs.closeLeft'), disabled: !store.tabsBeside(tab, 'left').length, run: () => void store.closeBeside(tab, 'left') },
      { label: tr('tabs.closeAll'), run: () => void store.closeAll() },
      { label: tr(tab.pinned ? 'tabs.unpin' : 'tabs.pin'), icon: 'pin', separator: true, run: () => store.togglePin(tab) },
    ];
    if (store.tabs.length > 1) {
      items.push(
        store.sideKey === tab.key
          ? { label: tr('tabs.closeSide'), icon: 'split', run: () => (store.sideKey = null) }
          : { label: tr('menu.openBeside'), icon: 'split', disabled: tab.key === store.activeKey, run: () => void store.openBeside(tab.vaultId, tab.path) },
      );
    }
    if (!tab.loose && tab.kind === 'md') items.push({ label: tr('menu.copyLink'), icon: 'link', separator: true, run: () => store.copyLink(tab.vaultId, tab.path) });
    items.push(
      { label: tr('menu.copyPath'), icon: 'copy', separator: !!tab.loose || tab.kind !== 'md', run: () => void store.copyText(store.absolutePath(tab), tr('menu.pathCopied')) },
      { label: tr('menu.reveal'), icon: 'folder', run: () => store.revealInFolder(tab.vaultId, tab.path) },
    );
    store.openMenu(e, items);
  }

  function onKey(e: KeyboardEvent, tab: Tab, index: number) {
    const tabs = [...(e.currentTarget as HTMLElement).closest('[role=tablist]')!.querySelectorAll<HTMLElement>('[role=tab]')];
    if (e.key === 'Enter' || e.key === ' ') select(tab);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const step = e.key === 'ArrowRight' ? 1 : -1;
      // With Ctrl+Shift the tab itself moves; alone, only the focus.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        store.moveTab(tab.key, index + step);
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[role=tab][data-key="${CSS.escape(tab.key)}"]`)?.focus());
      } else tabs[(index + step + tabs.length) % tabs.length]?.focus();
    } else if (e.key === 'Home') tabs[0]?.focus();
    else if (e.key === 'End') tabs.at(-1)?.focus();
    else if (e.key === 'Delete') void store.close(tab);
    else return;
    e.preventDefault();
  }

  function dragOver(e: DragEvent, tab: Tab) {
    if (!dragged || dragged === tab.key) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    over = { key: tab.key, after: e.clientX > box.left + box.width / 2 };
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    if (dragged && over) {
      const from = store.tabs.findIndex((t) => t.key === dragged);
      let to = store.tabs.findIndex((t) => t.key === over!.key) + (over.after ? 1 : 0);
      if (from < to) to--;
      store.moveTab(dragged, to);
    }
    dragged = over = null;
  }
</script>

<div class="bar" data-tauri-drag-region class:corner-left={!store.showLeft} class:corner-right={!panelShown}>
  {#if !store.showLeft}
    <button class="icon show-left" title={tr('sidebar.show')} onclick={() => store.toggleBar('left', true)}><Icon name="panelLeft" /></button>
  {/if}
  <div class="tabs" role="tablist" data-tauri-drag-region>
    {#each store.tabs as tab, index (tab.key)}
      <div class="tab" in:enter class:active={tab.key === store.activeKey} class:side={tab.key === store.sideKey && tab.key !== store.activeKey} class:pinned={tab.pinned}
        class:before={over?.key === tab.key && !over.after} class:after={over?.key === tab.key && over.after}
        role="presentation"
        draggable="true"
        ondragstart={(e) => { dragged = tab.key; e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('application/x-umd-tab', tab.key); }}
        ondragover={(e) => dragOver(e, tab)}
        ondragleave={() => (over = null)}
        ondrop={drop}
        ondragend={() => (dragged = over = null)}
        onmousedown={(e) => { if (e.button === 1) e.preventDefault(); }}
        onauxclick={(e) => { if (e.button === 1) { e.preventDefault(); void store.close(tab); } }}
        oncontextmenu={(e) => menu(e, tab)}
        title="{store.location(tab)} · {tab.path}">
        <!-- The close button sits beside the tab, not inside it: a control
             within another is lost to screen readers. Delete closes it too. -->
        <div class="sel" role="tab" tabindex={tab.key === store.activeKey ? 0 : -1} aria-selected={tab.key === store.activeKey} data-key={tab.key}
          onclick={() => select(tab)} onkeydown={(e) => onKey(e, tab, index)}>
          {#if tab.pinned}<span class="mark" title={tr('tabs.pinned')}><Icon name="pin" size={12} /></span>{/if}
          {#if tab.loose}<span class="mark" title={tr('tabs.looseFile')}><Icon name="file" size={12} /></span>{/if}
          <span class="name">{baseName(tab.path).replace(/\.(md|markdown)$/i, '')}</span>
          {#if tab.dirty}<span class="dirty" title={tr('tabs.unsaved')}></span>{/if}
        </div>
        {#if !tab.pinned}
          <button class="x" tabindex="-1" aria-hidden="true" title={tr('tabs.close')} onclick={(e) => { e.stopPropagation(); store.close(tab); }}><Icon name="close" size={12} /></button>
        {/if}
      </div>
    {/each}
  </div>
  {#if active && (active.kind === 'md' || active.kind === 'html')}
    <div class="views">
      {#each VIEWS.filter((v) => active.kind === 'md' || v.mode !== 'visual') as v}
        <button class="icon" class:on={active.view === v.mode} title={tr(v.title)} onclick={() => store.setView(active, v.mode)}><Icon name={v.icon} /></button>
      {/each}
      {#if active.kind === 'md'}
        <button class="icon" title={tr('tabs.export')} onclick={() => (store.exporting = true)}><Icon name="export" /></button>
        <button class="icon" class:on={store.showRight} aria-pressed={store.showRight} title={tr('panel.toggle')} onclick={() => store.toggleBar('right')}><Icon name="panelRight" /></button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .bar { display: flex; align-items: stretch; height: 38px; flex: none; background: var(--panel); border-bottom: 1px solid var(--line); }
  .tabs { display: flex; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
  .tab { display: flex; align-items: center; gap: var(--space-1-5); max-width: 200px; padding: 0 var(--space-1-5) 0 0; border-right: 1px solid var(--line); color: var(--text-2); font-size: var(--font-sm); cursor: default; }
  .sel { display: flex; flex: 1; align-items: center; align-self: stretch; gap: var(--space-1-5); min-width: 0; padding-left: var(--space-3); outline: none; }
  .tab:hover { color: var(--text); }
  .tab:has(.sel:focus-visible) { outline: 2px solid var(--accent); outline-offset: -2px; }
  .tab.active { background: var(--bg); color: var(--text); box-shadow: inset 0 -2px 0 var(--accent); }
  .tab.side { box-shadow: inset 0 -2px 0 var(--line); color: var(--text); }
  .tab.pinned { padding-right: var(--space-3); }
  .tab.before { box-shadow: inset 2px 0 0 var(--accent); }
  .tab.after { box-shadow: inset -2px 0 0 var(--accent); }
  .name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .mark { display: flex; flex: none; color: var(--text-3); }
  .dirty { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
  .x { display: flex; flex: none; padding: var(--space-1); border: 0; border-radius: var(--radius-xs); background: none; color: inherit; opacity: 0; }
  .tab:hover .x, .tab.active .x { opacity: .7; }
  .x:hover { background: var(--hover); opacity: 1; }
  .show-left { align-self: center; flex: none; margin: 0 var(--space-1); }
  .corner-left { padding-left: var(--frame-left, 0px); }
  .corner-right { padding-right: var(--frame-right, 0px); }
  .views { display: flex; align-items: center; gap: 1px; padding: 0 var(--space-2); }
</style>
