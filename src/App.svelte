<script lang="ts">
  import { onMount } from 'svelte';
  import Editor from './lib/components/Editor.svelte';
  import Export from './lib/components/Export.svelte';
  import Modal from './lib/components/Modal.svelte';
  import Palette from './lib/components/Palette.svelte';
  import Preview from './lib/components/Preview.svelte';
  import Settings from './lib/components/Settings.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import Tabs from './lib/components/Tabs.svelte';
  import Welcome from './lib/components/Welcome.svelte';
  import { dirName } from './lib/paths';
  import { store, type ViewMode } from './lib/store.svelte';
  import { applyTheme } from './lib/themes';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  const VIEWS: ViewMode[] = ['edit', 'split', 'preview'];
  const SIDEBAR_KEY = 'ultimatemd.sidebar';

  let preview = $state<Preview>();
  let sidebarWidth = $state(260);
  const tab = $derived(store.active);
  const words = $derived(tab?.content.trim() ? tab.content.trim().split(/\s+/).length : 0);
  const status = $derived(
    !tab ? '' : tab.missing ? 'Eliminada en disco' : tab.conflict ? 'Conflicto' : tab.saving ? 'Guardando…' : tab.dirty ? 'Sin guardar' : 'Guardado',
  );

  $effect(() => {
    applyTheme(store.theme);
  });

  onMount(() => {
    try {
      const saved = Number(localStorage.getItem(SIDEBAR_KEY));
      if (saved) sidebarWidth = saved;
    } catch {
      // Keeps the default width.
    }
    store.init().catch((e) => store.notify(e));
    // The window starts hidden so it first appears with the right theme.
    try {
      void getCurrentWindow().show();
    } catch {
      // Outside the app, in the interface tests.
    }
  });

  async function newNote() {
    const vaultId = tab?.vaultId ?? store.openVaults[0]?.id;
    if (!vaultId) return store.notify('Abre un vault primero');
    const name = await store.prompt('Nombre de la nota', '', 'Crear');
    if (name?.trim()) await store.createNote(vaultId, tab ? dirName(tab.path) : '', name.trim());
  }

  function onKey(e: KeyboardEvent) {
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      store.palette = store.settings = store.exporting = false;
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    const actions: Record<string, () => void> = {
      p: () => (store.palette = true),
      e: () => {
        if (tab?.kind === 'md') store.exporting = true;
      },
      n: () => void newNote(),
      s: () => void store.saveAll(),
      w: () => tab && void store.close(tab),
      '\\': () => {
        if (tab) tab.view = VIEWS[(VIEWS.indexOf(tab.view) + 1) % VIEWS.length];
      },
      tab: () => store.cycleTab(e.shiftKey ? -1 : 1),
    };
    if (e.shiftKey && key === 'f') {
      e.preventDefault();
      store.searching = true;
    } else if (actions[key] && (!e.shiftKey || key === 'tab')) {
      e.preventDefault();
      actions[key]();
    }
  }

  function resize(down: PointerEvent) {
    const el = down.currentTarget as HTMLElement;
    el.setPointerCapture(down.pointerId);
    const move = (e: PointerEvent) => (sidebarWidth = Math.min(480, Math.max(180, e.clientX)));
    const up = () => {
      el.removeEventListener('pointermove', move);
      try {
        localStorage.setItem(SIDEBAR_KEY, String(sidebarWidth));
      } catch {
        // Only a convenience.
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up, { once: true });
  }
</script>

<svelte:window onkeydown={onKey} onblur={() => store.saveAll()} />

<div class="app" style:grid-template-columns="{sidebarWidth}px 1fr">
  <Sidebar />
  <button class="grip" aria-label="Cambiar ancho" style:left="{sidebarWidth - 3}px" onpointerdown={resize}></button>
  <main>
    <Tabs />
    {#if tab?.conflict}
      <div class="banner" role="alert">
        <span>Esta nota ha cambiado fuera de la app mientras la editabas.</span>
        <button onclick={() => store.acceptDisk(tab)}>Usar la del disco</button>
        <button onclick={() => store.keepMine(tab)}>Mantener la mía</button>
      </div>
    {:else if tab?.missing}
      <div class="banner" role="alert"><span>Este archivo ya no existe en disco. Sus cambios no se guardarán.</span></div>
    {/if}
    <div class="content">
      {#if !tab}
        <Welcome />
      {:else if tab.kind === 'image'}
        {#key tab.key}<Preview {tab} />{/key}
      {:else}
        <div class="pane" class:hidden={tab.view === 'preview'}>
          <Editor {tab} onscroll={(ratio) => preview?.scrollTo(ratio)} />
        </div>
        {#if tab.view !== 'edit'}
          <div class="pane preview">
            {#key tab.key}<Preview bind:this={preview} {tab} />{/key}
          </div>
        {/if}
      {/if}
    </div>
    <footer>
      {#if tab}
        <span class="where">{store.location(tab)} / {tab.path}</span>
        {#if tab.loose}
          <button class="adopt" onclick={() => store.adoptFolder(tab)}>Abrir la carpeta como vault</button>
        {/if}
        <span class="spacer"></span>
        {#if tab.kind === 'md' || tab.kind === 'html'}<span>{words} palabras</span>{/if}
        <span>{status}</span>
      {/if}
    </footer>
  </main>
</div>

{#if store.palette}<Palette />{/if}
{#if store.settings}<Settings />{/if}
{#if store.exporting && tab}<Export {tab} />{/if}
{#if store.dialog}
  {#key store.dialog}<Modal dialog={store.dialog} />{/key}
{/if}
{#if store.toast}<div class="toast" role="status">{store.toast}</div>{/if}

<style>
  .app { position: relative; display: grid; height: 100vh; overflow: hidden; }
  .grip { position: absolute; top: 0; bottom: 0; z-index: 5; width: 6px; padding: 0; border: 0; background: none; cursor: col-resize; }
  .grip:hover { background: var(--line); }
  main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .content { display: flex; flex: 1; min-height: 0; background: var(--bg); }
  .pane { flex: 1 1 0; min-width: 0; min-height: 0; }
  .pane.hidden { display: none; }
  .pane.preview:not(:first-child) { border-left: 1px solid var(--line); }
  .banner { display: flex; align-items: center; gap: 8px; padding: 7px 12px; flex: none; background: var(--warn); color: var(--text); font-size: 13px; }
  .banner span { flex: 1; }
  .banner button { padding: 3px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--raised); color: var(--text); font-size: 12.5px; }
  footer { display: flex; gap: 16px; align-items: center; height: 24px; flex: none; padding: 0 12px; background: var(--panel); border-top: 1px solid var(--line); color: var(--text-3); font-size: 11.5px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; }
  .spacer { flex: 1; }
  .where { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .adopt { flex: none; padding: 0; border: 0; background: none; color: var(--accent-text); font-size: inherit; }
  .adopt:hover { text-decoration: underline; }
  .toast { position: fixed; bottom: 36px; left: 50%; z-index: 60; max-width: min(560px, calc(100vw - 32px)); padding: 9px 14px; border-radius: 8px; background: var(--text); color: var(--bg); box-shadow: var(--shadow); font-size: 13px; transform: translateX(-50%); }
</style>
