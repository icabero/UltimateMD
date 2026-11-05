<script lang="ts">
  import Icon from './Icon.svelte';
  import { baseName } from '../paths';
  import { store, type ViewMode } from '../store.svelte';

  const VIEWS: { mode: ViewMode; icon: string; title: string }[] = [
    { mode: 'edit', icon: 'edit', title: 'Editar' },
    { mode: 'split', icon: 'split', title: 'Dividido' },
    { mode: 'preview', icon: 'eye', title: 'Vista previa' },
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
        {#if tab.loose}<span class="loose" title="Archivo suelto, fuera de cualquier vault"><Icon name="file" size={12} /></span>{/if}
        <span class="name">{baseName(tab.path).replace(/\.(md|markdown)$/i, '')}</span>
        {#if tab.dirty}<span class="dirty" title="Sin guardar"></span>{/if}
        <button class="x" title="Cerrar (Ctrl+W)" onclick={(e) => { e.stopPropagation(); store.close(tab); }}><Icon name="close" size={12} /></button>
      </div>
    {/each}
  </div>
  {#if active && (active.kind === 'md' || active.kind === 'html')}
    <div class="views">
      {#each VIEWS as v}
        <button class="icon" class:on={active.view === v.mode} title={v.title} onclick={() => { active.view = v.mode; store.persist(); }}><Icon name={v.icon} /></button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .bar { display: flex; align-items: stretch; height: 38px; flex: none; background: var(--panel); border-bottom: 1px solid var(--line); }
  .tabs { display: flex; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
  .tab { display: flex; align-items: center; gap: 6px; max-width: 200px; padding: 0 6px 0 12px; border-right: 1px solid var(--line); color: var(--text-2); font-size: 12.5px; cursor: default; }
  .tab:hover { color: var(--text); }
  .tab.active { background: var(--bg); color: var(--text); box-shadow: inset 0 -2px 0 var(--accent); }
  .name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .loose { display: flex; flex: none; color: var(--text-3); }
  .dirty { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
  .x { display: flex; flex: none; padding: 3px; border: 0; border-radius: 4px; background: none; color: inherit; opacity: 0; }
  .tab:hover .x, .tab.active .x { opacity: .7; }
  .x:hover { background: var(--hover); opacity: 1; }
  .views { display: flex; align-items: center; gap: 1px; padding: 0 8px; }
</style>
