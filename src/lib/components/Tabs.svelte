<script lang="ts">
  import Icon from './Icon.svelte';
  import { tr, type Key } from '../i18n.svelte';
  import { baseName } from '../paths';
  import { store, type ViewMode } from '../store.svelte';

  const VIEWS: { mode: ViewMode; icon: string; title: Key }[] = [
    { mode: 'visual', icon: 'visual', title: 'tabs.visual' },
    { mode: 'edit', icon: 'edit', title: 'tabs.edit' },
    { mode: 'split', icon: 'split', title: 'tabs.split' },
    { mode: 'preview', icon: 'eye', title: 'tabs.preview' },
  ];
  const active = $derived(store.active);
</script>

<div class="bar">
  <div class="tabs" role="tablist">
    {#each store.tabs as tab (tab.key)}
      <div class="tab" class:active={tab.key === store.activeKey} role="tab" tabindex="0" aria-selected={tab.key === store.activeKey}
        onclick={() => { store.activeKey = tab.key; store.persist(); }}
        onkeydown={(e) => { if (e.key === 'Enter') store.activeKey = tab.key; }}
        onauxclick={(e) => { if (e.button === 1) store.close(tab); }}
        title="{store.location(tab)} · {tab.path}">
        {#if tab.loose}<span class="loose" title={tr('tabs.looseFile')}><Icon name="file" size={12} /></span>{/if}
        <span class="name">{baseName(tab.path).replace(/\.(md|markdown)$/i, '')}</span>
        {#if tab.dirty}<span class="dirty" title={tr('tabs.unsaved')}></span>{/if}
        <button class="x" title={tr('tabs.close')} onclick={(e) => { e.stopPropagation(); store.close(tab); }}><Icon name="close" size={12} /></button>
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
      {/if}
    </div>
  {/if}
</div>

<style>
  .bar { display: flex; align-items: stretch; height: 38px; flex: none; background: var(--panel); border-bottom: 1px solid var(--line); }
  .tabs { display: flex; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
  .tab { display: flex; align-items: center; gap: var(--space-1-5); max-width: 200px; padding: 0 var(--space-1-5) 0 var(--space-3); border-right: 1px solid var(--line); color: var(--text-2); font-size: var(--font-sm); cursor: default; }
  .tab:hover { color: var(--text); }
  .tab.active { background: var(--bg); color: var(--text); box-shadow: inset 0 -2px 0 var(--accent); }
  .name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .loose { display: flex; flex: none; color: var(--text-3); }
  .dirty { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
  .x { display: flex; flex: none; padding: var(--space-1); border: 0; border-radius: var(--radius-xs); background: none; color: inherit; opacity: 0; }
  .tab:hover .x, .tab.active .x { opacity: .7; }
  .x:hover { background: var(--hover); opacity: 1; }
  .views { display: flex; align-items: center; gap: 1px; padding: 0 var(--space-2); }
</style>
