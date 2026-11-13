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
  import VaultSettings from './lib/components/VaultSettings.svelte';
  import Tutorial from './lib/components/Tutorial.svelte';
  import Shortcuts from './lib/components/Shortcuts.svelte';
  import OutsideChanges from './lib/components/OutsideChanges.svelte';
  import AiLog from './lib/components/AiLog.svelte';
  import ContextMenu from './lib/components/ContextMenu.svelte';
  import Icon from './lib/components/Icon.svelte';
  import { baseName } from './lib/paths';
  import { manageDialogFocus } from './lib/dialogFocus';
  import News from './lib/components/News.svelte';
  import ConflictMerge from './lib/components/ConflictMerge.svelte';
  import Reader from './lib/components/Reader.svelte';
  import GitScreen from './lib/components/GitScreen.svelte';
  import BrokenLinks from './lib/components/BrokenLinks.svelte';
  import Tabs from './lib/components/Tabs.svelte';
  import Welcome from './lib/components/Welcome.svelte';
  import { applyInstallerLanguage, tr } from './lib/i18n.svelte';
  import { LEADINGS, LINE_WIDTHS, ZOOM, store, type ViewMode } from './lib/store.svelte';
  import { applyTheme } from './lib/themes';
  import { api } from './lib/api';
  import { countText } from './lib/formatting';
  import { dictionaryOf, spellLanguage } from './lib/spellcheck';
  import { getCurrentWindow } from '@tauri-apps/api/window';

  const VIEWS: ViewMode[] = ['visual', 'edit', 'split', 'preview'];
  const SIDEBAR_KEY = 'ultimatemd.sidebar';

  let preview = $state<Preview>();
  let sidebarWidth = $state(260);
  const tab = $derived(store.active);
  const side = $derived(store.sideTab);
  const panel = $derived(store.showRight && tab?.kind === 'md');
  const columns = $derived(`${store.showLeft ? `${sidebarWidth}px ` : ''}minmax(0, 1fr)${panel ? ` ${store.layout.rightWidth}px` : ''}`);
  const count = $derived(countText(tab?.content ?? ''));
  // The editor's selection, unless the editor is hidden behind the preview.
  const picked = $derived(store.selection && tab && store.selection.key === tab.key && tab.view !== 'preview' ? store.selection : null);
  const status = $derived(
    !tab ? '' : tr(tab.missing ? 'app.statusDeleted' : tab.conflict ? 'app.statusConflict' : tab.saving ? 'app.statusSaving' : tab.dirty ? 'app.statusUnsaved' : 'app.statusSaved'),
  );

  $effect(() => {
    applyTheme(store.theme);
  });

  // Linux's spell checker needs telling which dictionary to use; elsewhere this does nothing.
  const spelling = $derived(tab?.kind === 'md' ? spellLanguage(store.spellcheck, tab.content) : null);
  $effect(() => {
    void api.setSpellcheck(spelling ? [dictionaryOf(spelling)] : []).catch(() => {});
  });

  onMount(() => {
    try {
      const saved = Number(localStorage.getItem(SIDEBAR_KEY));
      if (saved) sidebarWidth = saved;
    } catch {
      // Keeps the default width.
    }
    // Failures nobody caught still reach the log.
    addEventListener('error', (e) => void api.logError('window', e.error?.stack ?? e.message).catch(() => {}));
    addEventListener('unhandledrejection', (e) => void api.logError('promise', e.reason?.stack ?? String(e.reason)).catch(() => {}));
    const stopDialogFocus = manageDialogFocus();
    store.init().catch((e) => store.fail(e));
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
    return stopDialogFocus;
  });


  function onKey(e: KeyboardEvent) {
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      // The settings search clears itself first.
      if (e.target instanceof HTMLInputElement && e.target.dataset.clearOnEscape !== undefined && e.target.value) return;
      if (store.tutorial) store.closeTutorial();
      store.settings = store.exporting = store.about = store.shortcuts = false;
      store.palette = null;
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
      d: () => void store.openDaily(0),
      w: () => void store.closeAll(),
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
        <button onclick={() => (store.merging = true)}>{tr('merge.compare')}</button>
        <button onclick={() => store.acceptDisk(tab)}>{tr('app.useDisk')}</button>
        <button onclick={() => store.keepMine(tab)}>{tr('app.keepMine')}</button>
      </div>
    {:else if tab?.missing}
      <div class="banner" role="alert"><span>{tr('app.missingBanner')}</span></div>
    {:else if tab?.outside}
      <div class="banner info" aria-live="polite">
        <span>{tr(tab.outside.ai ? 'outside.aiBanner' : 'outside.banner', { n: tab.outside.lines.length })}</span>
        <button onclick={() => (store.outsideDiff = true)}>{tr('outside.show')}</button>
        <button onclick={() => store.undoOutside(tab)}>{tr('common.undo')}</button>
        <button class="dismiss" title={tr('common.close')} aria-label={tr('common.close')} onclick={() => (tab.outside = null)}>×</button>
      </div>
    {/if}
    <div class="content" style:--text-scale={store.reading.textScale} style:--prose-width={LINE_WIDTHS[store.reading.lineWidth]} style:--leading={LEADINGS[store.reading.leading] ?? 0}>
      {#if store.reader}
        {#key `${store.reader?.vaultId}:${store.reader?.folder}`}<Reader vaultId={store.reader?.vaultId ?? ""} folder={store.reader?.folder ?? ""} />{/key}
      {:else if !tab}
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
      {#if tab && side}
        <section class="pane beside" aria-label={tr('side.title', { name: baseName(side.path) })}>
          <header>
            <span class="name" title={side.path}>{baseName(side.path).replace(/\.(md|markdown)$/i, '')}</span>
            <button class="icon small" title={tr('side.edit')} onclick={() => store.swapSide()}><Icon name="edit" size={14} /></button>
            <button class="icon small" title={tr('side.close')} onclick={() => (store.sideKey = null)}><Icon name="close" size={14} /></button>
          </header>
          <div class="body">{#key side.key}<Preview tab={side} />{/key}</div>
        </section>
      {/if}
    </div>
    <footer>
      {#if tab}
        <span class="where">{store.location(tab)} / {tab.path}</span>
        {#if tab.loose}
          <button class="adopt" onclick={() => store.adoptFolder(tab)}>{tr('app.adoptFolder')}</button>
        {/if}
        <span class="spacer"></span>
        {#if tab.kind === 'md' || tab.kind === 'html'}
          <span class="count">{picked ? tr('app.countSelected', { words: picked.words, total: count.words, chars: picked.chars }) : tr('app.count', { words: count.words, chars: count.chars })}</span>
        {/if}
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
{#if store.outsideDiff && tab?.outside}<OutsideChanges {tab} />{/if}
{#if store.vaultSettings}<VaultSettings vaultId={store.vaultSettings.vaultId} section={store.vaultSettings.section} />{/if}
{#if store.gitScreen}<GitScreen vaultId={store.gitScreen} />{/if}
{#if store.merging && tab?.conflict}<ConflictMerge {tab} />{/if}
{#if store.news}<News version={store.news} />{/if}
{#if store.aiLog}<AiLog vaultId={store.aiLog} />{/if}
{#if store.brokenLinks}<BrokenLinks vaultId={store.brokenLinks} />{/if}
{#if store.templatePicker}<TemplatePicker {...store.templatePicker} />{/if}
{#if store.exporting && tab}<Export {tab} />{/if}
{#if store.menu}{#key store.menu}<ContextMenu {...store.menu} />{/key}{/if}
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
  .beside { display: flex; flex-direction: column; border-left: 1px solid var(--line); }
  .beside header { display: flex; align-items: center; gap: var(--space-1); height: 28px; flex: none; padding: 0 var(--space-1-5) 0 var(--space-3); border-bottom: 1px solid var(--line); background: var(--panel); color: var(--text-2); font-size: var(--font-sm); }
  .beside .name { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .beside .body { flex: 1; min-height: 0; }
  .banner { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); flex: none; background: var(--warn); color: var(--text); font-size: var(--font-md); }
  .banner span { flex: 1; }
  .banner.info { background: var(--accent-soft); }
  .banner .dismiss { padding: 0 var(--space-2); border: 0; background: none; font-size: var(--font-lg); line-height: 1; }
  .banner button { padding: var(--space-1) var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--raised); color: var(--text); font-size: var(--font-sm); }
  footer { display: flex; gap: var(--space-4); align-items: center; height: 24px; flex: none; padding: 0 var(--space-3); background: var(--panel); border-top: 1px solid var(--line); color: var(--text-3); font-size: var(--font-xs); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; }
  .spacer { flex: 1; }
  .where { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .adopt { flex: none; padding: 0; border: 0; background: none; color: var(--accent-text); font-size: inherit; }
  .adopt:hover { text-decoration: underline; }
</style>
