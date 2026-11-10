<script lang="ts">
  import { swap } from './lib/motion';
  import Toast from './lib/components/Toast.svelte';
  import { onMount } from 'svelte';
  import Editor from './lib/components/Editor.svelte';
  import About from './lib/components/About.svelte';
  import Export from './lib/components/Export.svelte';
  import Modal from './lib/components/Modal.svelte';
  import WindowControls from './lib/components/WindowControls.svelte';
  import TemplatePicker from './lib/components/TemplatePicker.svelte';
  import { IS_MAC, frame } from './lib/frame.svelte';
  import NotePanel from './lib/components/NotePanel.svelte';
  import Palette from './lib/components/Palette.svelte';
  import Preview from './lib/components/Preview.svelte';
  import Settings from './lib/components/Settings.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import ThemeEditor from './lib/components/ThemeEditor.svelte';
  import Tutorial from './lib/components/Tutorial.svelte';
  import Shortcuts from './lib/components/Shortcuts.svelte';
  import WordScreen from './lib/components/WordScreen.svelte';
  import BrokenLinks from './lib/components/BrokenLinks.svelte';
  import Tabs from './lib/components/Tabs.svelte';
  import Welcome from './lib/components/Welcome.svelte';
  import { applyInstallerLanguage, tr } from './lib/i18n.svelte';
  import { LINE_WIDTHS, ZOOM, store, type ViewMode } from './lib/store.svelte';
  import { applyTheme } from './lib/themes';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  const VIEWS: ViewMode[] = ['visual', 'edit', 'split', 'preview'];
  const SIDEBAR_KEY = 'ultimatemd.sidebar';

  let preview = $state<Preview>();
  let sidebarWidth = $state(260);
  const tab = $derived(store.active);
  const panel = $derived(store.showRight && tab?.kind === 'md');
  const columns = $derived(`${store.showLeft ? `${sidebarWidth}px ` : ''}minmax(0, 1fr)${panel ? ` ${store.layout.rightWidth}px` : ''}`);
  const words = $derived(tab?.content.trim() ? tab.content.trim().split(/\s+/).length : 0);
  const status = $derived(
    !tab ? '' : tr(tab.missing ? 'app.statusDeleted' : tab.conflict ? 'app.statusConflict' : tab.saving ? 'app.statusSaving' : tab.dirty ? 'app.statusUnsaved' : 'app.statusSaved'),
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
    void frame.watch();
    void store.applyZoom();
    // The window starts hidden so it first appears with the right theme, language and frame.
    void Promise.all([applyInstallerLanguage(), frame.apply()]).finally(() => {
      try {
        void getCurrentWindow().show();
      } catch {
        // Outside the app, in the interface tests.
      }
    });
  });


  function onKey(e: KeyboardEvent) {
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      if (store.tutorial) store.closeTutorial();
      store.settings = store.exporting = store.about = store.shortcuts = false;
      store.palette = null;
      store.themeEditor = null;
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    const actions: Record<string, () => void> = {
      p: () => (store.palette = ''),
      e: () => {
        if (tab?.kind === 'md') store.exporting = true;
      },
      n: () => void store.newNote(),
      s: () => void store.saveAll(),
      w: () => tab && void store.close(tab),
      '\\': () => {
        if (tab) store.setView(tab, VIEWS[(VIEWS.indexOf(tab.view) + 1) % VIEWS.length]);
      },
      tab: () => store.cycleTab(e.shiftKey ? -1 : 1),
      '+': () => store.setZoom(store.reading.zoom + ZOOM.step),
      '=': () => store.setZoom(store.reading.zoom + ZOOM.step),
      '-': () => store.setZoom(store.reading.zoom - ZOOM.step),
      '0': () => store.setZoom(null),
      '/': () => (store.shortcuts = !store.shortcuts),
    };
    const shifted: Record<string, () => void> = {
      f: () => {
        store.searching = true;
        store.toggleBar('left', true);
      },
      p: () => (store.palette = '>'),
      e: () => store.toggleBar('left'),
      o: () => {
        if (tab?.kind === 'md') store.toggleBar('right');
      },
      tab: actions.tab,
      // On some keyboards + needs Shift.
      '+': actions['+'],
    };
    const run = e.shiftKey ? shifted[key] : actions[key];
    if (!run) return;
    // Caught before the editor sees it: on macOS, Ctrl+O, P, N and E also edit or move the cursor there.
    e.preventDefault();
    e.stopPropagation();
    run();
  }

  const clampWidth = (width: number) => Math.min(480, Math.max(180, width));

  function resize(down: PointerEvent) {
    const el = down.currentTarget as HTMLElement;
    el.setPointerCapture(down.pointerId);
    const move = (e: PointerEvent) => (sidebarWidth = clampWidth(e.clientX));
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

  function resizePanel(down: PointerEvent) {
    const el = down.currentTarget as HTMLElement;
    el.setPointerCapture(down.pointerId);
    const move = (e: PointerEvent) => (store.layout.rightWidth = clampWidth(innerWidth - e.clientX));
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', () => {
      el.removeEventListener('pointermove', move);
      store.saveLayout();
    }, { once: true });
  }
</script>

<svelte:window onkeydowncapture={onKey} onblur={() => store.saveAll()} onresize={() => store.setWindowWidth(innerWidth)} />

<div class="app" style:grid-template-columns={columns} style:--frame-left={frame.own && IS_MAC ? '76px' : '0px'} style:--frame-right={frame.own && !IS_MAC ? '138px' : '0px'}>
  {#if frame.own && !IS_MAC}<WindowControls />{/if}
  {#if store.showLeft}
    <Sidebar />
    <button class="grip" aria-label={tr('app.resize')} style:left="{sidebarWidth - 3}px" onpointerdown={resize}></button>
  {/if}
  <main>
    <Tabs />
    {#if tab?.conflict}
      <div class="banner" role="alert">
        <span>{tr('app.conflictBanner')}</span>
        <button onclick={() => store.acceptDisk(tab)}>{tr('app.useDisk')}</button>
        <button onclick={() => store.keepMine(tab)}>{tr('app.keepMine')}</button>
      </div>
    {:else if tab?.missing}
      <div class="banner" role="alert"><span>{tr('app.missingBanner')}</span></div>
    {/if}
    <div class="content" style:--text-scale={store.reading.textScale} style:--prose-width={LINE_WIDTHS[store.reading.lineWidth]}>
      {#if !tab}
        <Welcome />
      {:else if tab.kind === 'image'}
        {#key tab.key}<Preview {tab} />{/key}
      {:else}
        <div class="pane" class:hidden={tab.view === 'preview'}>
          <Editor {tab} onscroll={(ratio) => preview?.scrollTo(ratio)} />
        </div>
        {#if tab.view === 'split' || tab.view === 'preview'}
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
          <button class="adopt" onclick={() => store.adoptFolder(tab)}>{tr('app.adoptFolder')}</button>
        {/if}
        <span class="spacer"></span>
        {#if tab.kind === 'md' || tab.kind === 'html'}<span>{tr('app.words', { n: words })}</span>{/if}
        {#key status}<span class="status" in:swap>{status}</span>{/key}
      {/if}
      {#if store.update}
        <button class="adopt" onclick={() => (store.about = true)}>{tr('app.updateAvailable', { version: store.update })}</button>
      {/if}
    </footer>
  </main>
  {#if panel && tab}
    <button class="grip" aria-label={tr('app.resize')} style:right="{store.layout.rightWidth - 3}px" onpointerdown={resizePanel}></button>
    <NotePanel {tab} />
  {/if}
</div>

{#if store.palette !== null}<Palette initial={store.palette} />{/if}
{#if store.settings}<Settings />{/if}
{#if store.about}<About />{/if}
{#if store.shortcuts}<Shortcuts />{/if}
{#if store.themeEditor}<ThemeEditor vaultId={store.themeEditor} />{/if}
{#if store.wordScreen}<WordScreen vaultId={store.wordScreen} />{/if}
{#if store.brokenLinks}<BrokenLinks vaultId={store.brokenLinks} />{/if}
{#if store.templatePicker}<TemplatePicker {...store.templatePicker} />{/if}
{#if store.exporting && tab}<Export {tab} />{/if}
{#if store.dialog}
  {#key store.dialog}<Modal dialog={store.dialog} />{/key}
{/if}
{#if store.tutorial}<Tutorial />{/if}
{#if store.toast}{#key store.toast.id}<Toast toast={store.toast} />{/key}{/if}

<style>
  .app { position: relative; display: grid; height: 100vh; overflow: hidden; }
  .grip { position: absolute; top: 0; bottom: 0; z-index: var(--z-raised); width: 6px; padding: 0; border: 0; background: none; cursor: col-resize; }
  .grip:hover { background: var(--line); }
  main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .content { display: flex; flex: 1; min-height: 0; background: var(--bg); }
  .pane { flex: 1 1 0; min-width: 0; min-height: 0; }
  .pane.hidden { display: none; }
  .pane.preview:not(:first-child) { border-left: 1px solid var(--line); }
  .banner { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); flex: none; background: var(--warn); color: var(--text); font-size: var(--font-md); }
  .banner span { flex: 1; }
  .banner button { padding: var(--space-1) var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--raised); color: var(--text); font-size: var(--font-sm); }
  footer { display: flex; gap: var(--space-4); align-items: center; height: 24px; flex: none; padding: 0 var(--space-3); background: var(--panel); border-top: 1px solid var(--line); color: var(--text-3); font-size: var(--font-xs); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; }
  .spacer { flex: 1; }
  .where { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .adopt { flex: none; padding: 0; border: 0; background: none; color: var(--accent-text); font-size: inherit; }
  .adopt:hover { text-decoration: underline; }
</style>
