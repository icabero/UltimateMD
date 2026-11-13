<script lang="ts">
  import { dim, pop } from '../motion';
  import { onMount, untrack } from 'svelte';
  import { fold } from '../fold';
  import { themeName, tr, type Key } from '../i18n.svelte';
  import { outline } from '../markdown';
  import { store, type ViewMode } from '../store.svelte';
  import { THEMES } from '../themes';
  import { EDIT_DIAGRAM, SORT_LINES, TOGGLE_TASK } from '../visual';
  import { keyLabel } from '../shortcuts';

  let { initial = '' }: { initial?: string } = $props();

  const MAX = 40;
  const RECENT_KEY = 'ultimatemd.recentCommands';
  const RECENT_MAX = 5;

  let query = $state(untrack(() => initial));
  let index = $state(0);
  let input = $state<HTMLInputElement>();

  /** The first character picks what to look for: `>` actions, `#` headings, anything else notes. */
  const mode = $derived(query.startsWith('>') ? 'commands' : query.startsWith('#') ? 'headings' : 'notes');
  const words = $derived(fold(mode === 'notes' ? query : query.slice(1)).replace(/\s+/g, ''));
  const tab = $derived(store.active);
  const md = $derived(tab?.kind === 'md');
  const editing = $derived(md && tab?.view !== 'preview');

  /** Subsequence match, ignoring case and accents. Tighter matches rank higher; `bonus` favours a part of the text. */
  function score(text: string, q: string, bonusFrom = 0) {
    const lower = fold(text);
    let at = -1;
    let gaps = 0;
    for (const c of q) {
      const next = lower.indexOf(c, at + 1);
      if (next < 0) return null;
      if (at >= 0) gaps += next - at - 1;
      at = next;
    }
    return gaps - (at >= bonusFrom ? 50 : 0) + (lower.startsWith(q[0] ?? '') ? -5 : 0);
  }

  function ranked<T>(items: T[], text: (item: T) => string, bonus?: (item: T) => number) {
    if (!words) return items.slice(0, MAX);
    return items
      .map((item) => ({ item, s: score(text(item), words, bonus?.(item)) }))
      .filter((r): r is { item: T; s: number } => r.s !== null)
      .sort((a, b) => a.s - b.s)
      .slice(0, MAX)
      .map((r) => r.item);
  }

  // Notes.
  const files = $derived(store.openVaults.flatMap((v) => store.files(v.id).map((path) => ({ vault: v, path, recent: false }))));
  /** With nothing typed, the notes opened last come first, leaving out the one on screen. */
  const recentFiles = $derived.by(() => {
    const rank = new Map(store.recent.map((r, i) => [`${r.vaultId}:${r.path}`, i]));
    const at = (f: { vault: { id: string }; path: string }) => rank.get(`${f.vault.id}:${f.path}`);
    const recent = files
      .filter((f) => at(f) !== undefined && `${f.vault.id}:${f.path}` !== store.activeKey)
      .sort((a, b) => at(a)! - at(b)!)
      .map((f) => ({ ...f, recent: true }));
    const rest = files.filter((f) => at(f) === undefined);
    return [...recent, ...rest];
  });

  // Actions. `when` hides the ones that make no sense right now.
  interface Command {
    id: string;
    label: string;
    keys?: string[];
    when?: boolean;
    run: () => void;
  }

  const view = (mode: ViewMode, label: Key): Command => ({
    id: `view.${mode}`,
    label: tr('cmd.view', { name: tr(label) }),
    when: md || (tab?.kind === 'html' && mode !== 'visual'),
    run: () => tab && store.setView(tab, mode),
  });

  const commands = $derived<Command[]>(
    [
      { id: 'note.new', label: tr('cmd.newNote'), keys: ['Ctrl', 'N'], run: () => void store.newNote() },
      { id: 'note.template', label: tr('cmd.fromTemplate'), when: store.openVaults.length > 0, run: () => store.newNoteFromTemplate() },
      { id: 'note.saveTemplate', label: tr('cmd.saveAsTemplate'), when: md && !tab?.loose, run: () => tab && void store.saveAsTemplate(tab) },
      { id: 'note.open', label: tr('cmd.openNote'), keys: ['Ctrl', 'P'], run: () => switchTo('') },
      { id: 'note.heading', label: tr('cmd.goToHeading'), when: md, run: () => switchTo('#') },
      { id: 'search', label: tr('cmd.searchAll'), keys: ['Ctrl', 'Shift', 'F'], run: () => { store.searching = true; store.toggleBar('left', true); } },
      { id: 'note.export', label: tr('cmd.export'), keys: ['Ctrl', 'E'], when: md, run: () => (store.exporting = true) },
      { id: 'note.diagram', label: tr('cmd.diagram'), when: md, run: () => document.querySelector('.cm-editor')?.dispatchEvent(new CustomEvent(EDIT_DIAGRAM)) },
      { id: 'edit.task', label: tr('cmd.toggleTask'), keys: ['Ctrl', 'Enter'], when: editing, run: () => document.querySelector('.cm-editor')?.dispatchEvent(new CustomEvent(TOGGLE_TASK)) },
      { id: 'edit.sort', label: tr('cmd.sortLines'), keys: ['Alt', 'Shift', 'S'], when: editing, run: () => document.querySelector('.cm-editor')?.dispatchEvent(new CustomEvent(SORT_LINES)) },
      view('visual', 'tabs.visual'),
      view('edit', 'tabs.edit'),
      view('split', 'tabs.split'),
      view('preview', 'tabs.preview'),
      { id: 'panel.outline', label: tr('cmd.outline'), when: md, run: () => store.openPanel('outline') },
      { id: 'panel.properties', label: tr('cmd.properties'), when: md, run: () => store.openPanel('properties') },
      { id: 'panel.history', label: tr('cmd.history'), when: md && !tab?.loose, run: () => store.openPanel('history') },
      { id: 'panel.links', label: tr('cmd.links'), when: md && !tab?.loose, run: () => store.openPanel('links') },
      { id: 'bar.left', label: tr('cmd.toggleSidebar'), keys: ['Ctrl', 'Shift', 'E'], run: () => store.toggleBar('left') },
      { id: 'bar.right', label: tr('cmd.togglePanel'), keys: ['Ctrl', 'Shift', 'O'], when: md, run: () => store.toggleBar('right') },
      { id: 'tab.next', label: tr('cmd.nextTab'), keys: ['Ctrl', 'Tab'], when: store.tabs.length > 1, run: () => store.cycleTab(1) },
      { id: 'tab.close', label: tr('cmd.closeTab'), keys: ['Ctrl', 'W'], when: !!tab, run: () => tab && void store.close(tab) },
      { id: 'tab.closeAll', label: tr('cmd.closeAllTabs'), keys: ['Ctrl', 'Shift', 'W'], when: store.tabs.some((t) => !t.pinned), run: () => void store.closeAll() },
      { id: 'tab.closeRight', label: tr('cmd.closeRightTabs'), when: !!tab && store.tabsBeside(tab, 'right').length > 0, run: () => tab && void store.closeBeside(tab, 'right') },
      { id: 'tab.closeLeft', label: tr('cmd.closeLeftTabs'), when: !!tab && store.tabsBeside(tab, 'left').length > 0, run: () => tab && void store.closeBeside(tab, 'left') },
      { id: 'save', label: tr('cmd.saveAll'), keys: ['Ctrl', 'S'], run: () => void store.saveAll() },
      { id: 'zoom.in', label: tr('cmd.zoomIn'), keys: ['Ctrl', '+'], run: () => store.setZoom(store.reading.zoom + 0.1) },
      { id: 'zoom.out', label: tr('cmd.zoomOut'), keys: ['Ctrl', '-'], run: () => store.setZoom(store.reading.zoom - 0.1) },
      { id: 'zoom.reset', label: tr('cmd.zoomReset'), keys: ['Ctrl', '0'], run: () => store.setZoom(null) },
      { id: 'theme.system', label: tr('cmd.themeSystem'), run: () => store.setThemeChoice({ fixed: null }) },
      ...THEMES.map((t) => ({ id: `theme.${t.id}`, label: tr('cmd.theme', { name: themeName(t) }), run: () => store.setThemeChoice({ fixed: t.id }) })),
      { id: 'vault.broken', label: tr('broken.open'), when: !!tab && !tab.loose, run: () => tab && (store.brokenLinks = tab.vaultId) },
      { id: 'vault.aiLog', label: tr('aiLog.open'), when: !!tab && !tab.loose, run: () => tab && (store.aiLog = tab.vaultId) },
      { id: 'vault.read', label: tr('cmd.readVault'), when: !!tab && !tab.loose, run: () => tab && (store.reader = { vaultId: tab.vaultId, folder: '' }) },
      { id: 'vault.settings', label: tr('cmd.vaultSettings'), when: !!tab && !tab.loose, run: () => tab && store.openVaultSettings(tab.vaultId) },
      { id: 'vault.themes', label: tr('cmd.vaultThemes'), when: !!tab && !tab.loose, run: () => tab && store.openVaultSettings(tab.vaultId, 'look') },
      { id: 'vault.diagrams', label: tr('cmd.vaultDiagrams'), when: !!tab && !tab.loose, run: () => tab && store.openVaultSettings(tab.vaultId, 'diagrams') },
      { id: 'vault.word', label: tr('cmd.wordSettings'), when: !!tab && !tab.loose, run: () => tab && store.openVaultSettings(tab.vaultId, 'word') },
      { id: 'vault.ai', label: tr('cmd.vaultAi'), when: !!tab && !tab.loose, run: () => tab && store.openVaultSettings(tab.vaultId, 'ai') },
      { id: 'app.settings', label: tr('cmd.settings'), run: () => (store.settings = true) },
      { id: 'app.shortcuts', label: tr('cmd.shortcuts'), keys: ['Ctrl', '/'], run: () => (store.shortcuts = true) },
      { id: 'app.news', label: tr('news.open'), run: () => void store.showNews() },
      { id: 'app.sample', label: tr('sample.create'), run: () => void store.createSampleVault() },
      { id: 'app.tutorial', label: tr('cmd.tutorial'), run: () => (store.tutorial = true) },
      { id: 'app.about', label: tr('cmd.about'), run: () => (store.about = true) },
    ].filter((c) => c.when !== false),
  );

  function loadRecent(): string[] {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    } catch {
      return [];
    }
  }

  function remember(id: string) {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...loadRecent().filter((r) => r !== id)].slice(0, RECENT_MAX)));
    } catch {
      // Only a convenience.
    }
  }

  // With nothing typed, the actions used last come first.
  const recent = loadRecent();
  const byRecent = (list: Command[]) => [...list].sort((a, b) => (recent.indexOf(a.id) + 1 || 99) - (recent.indexOf(b.id) + 1 || 99));

  // Headings of the note open.
  const headings = $derived(md && tab ? outline(tab.content).map((h, i) => ({ ...h, index: i })) : []);
  const top = $derived(Math.min(...headings.map((h) => h.level)));

  const results = $derived.by(() => {
    if (mode === 'commands') return ranked(words ? commands : byRecent(commands), (c) => c.label).map((c) => ({ kind: 'command' as const, c }));
    if (mode === 'headings') return ranked(headings, (h) => h.text).map((h) => ({ kind: 'heading' as const, h }));
    return ranked(words ? files : recentFiles, (f) => f.path, (f) => f.path.lastIndexOf('/') + 1).map((f) => ({ kind: 'note' as const, f }));
  });

  function switchTo(prefix: string) {
    query = prefix;
    index = 0;
    input?.focus();
  }

  function pick(i: number) {
    const r = results[i];
    if (!r) return;
    if (r.kind === 'command') {
      remember(r.c.id);
      // Some actions open another mode of this same box.
      if (r.c.id === 'note.open' || r.c.id === 'note.heading') return r.c.run();
      store.palette = null;
      r.c.run();
    } else if (r.kind === 'heading') {
      store.palette = null;
      if (tab) store.reveal = { key: tab.key, line: r.h.line, terms: [], heading: r.h.index };
    } else {
      store.palette = null;
      void store.openFile(r.f.vault.id, r.f.path);
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') index = Math.min(index + 1, results.length - 1);
    else if (e.key === 'ArrowUp') index = Math.max(index - 1, 0);
    else if (e.key === 'Enter') pick(index);
    else if (e.key === 'Escape') store.palette = null;
    else return;
    e.preventDefault();
  }

  // The shortcut that opened this box may come from the editor, which would keep the focus.
  onMount(() => {
    const focus = () => {
      input?.focus();
      input?.setSelectionRange(query.length, query.length);
    };
    focus();
    requestAnimationFrame(focus);
  });

  const placeholder = $derived(tr(mode === 'commands' ? 'palette.commands' : mode === 'headings' ? 'palette.headings' : 'palette.placeholder'));
</script>

<button in:dim class="scrim" aria-label={tr('common.close')} onclick={() => (store.palette = null)}></button>
<div in:pop class="box" role="dialog" aria-label={tr('palette.title')}>
  <input bind:this={input} bind:value={query} oninput={() => (index = 0)} onkeydown={onKey} placeholder={placeholder} role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant="palette-{index}" />
  <div class="list" id="palette-list" role="listbox">
    {#each results as r, i}
      <button id="palette-{i}" role="option" aria-selected={i === index} class:on={i === index} onclick={() => pick(i)} onmousemove={() => (index = i)}>
        {#if r.kind === 'command'}
          <span class="label">{r.c.label}</span>
          {#if r.c.keys}<span class="keys">{#each r.c.keys as k}<kbd>{keyLabel(k)}</kbd>{/each}</span>{/if}
        {:else if r.kind === 'heading'}
          <span class="label" style:padding-left="calc({r.h.level - top} * var(--space-3))">{r.h.text || '…'}</span>
          <span class="meta">H{r.h.level}</span>
        {:else}
          <span class="label">{r.f.path}</span>
          <span class="meta">{#if r.f.recent}<span class="tag">{tr('palette.recent')}</span>{/if}{r.f.vault.name}</span>
        {/if}
      </button>
    {:else}
      <p>{tr(mode === 'headings' && !headings.length ? 'palette.noHeadings' : 'palette.empty')}</p>
    {/each}
  </div>
  {#if mode === 'notes'}
    <p class="hint">{tr('palette.hint')}</p>
  {/if}
</div>

<style>
  .box { position: fixed; top: 12vh; left: 50%; z-index: var(--z-dialog); width: min(600px, calc(100vw - 32px)); padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translateX(-50%); }
  input { width: 100%; }
  .list { max-height: 50vh; margin-top: var(--space-1-5); overflow-y: auto; }
  .list button { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); width: 100%; padding: var(--space-1-5) var(--space-2-5); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text); font-size: var(--font-md); text-align: left; }
  .list button.on { background: var(--accent-soft); }
  .label { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .meta { flex: none; color: var(--text-3); font-size: var(--font-sm); }
  .tag { margin-right: var(--space-2); color: var(--accent-text); }
  .keys { display: flex; flex: none; gap: var(--space-1); }
  kbd { padding: 0 var(--space-1-5); border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--bg); color: var(--text-2); font: var(--font-xs)/1.7 var(--sans); }
  p { margin: 0; padding: var(--space-2); color: var(--text-3); font-size: var(--font-md); }
  .hint { padding: var(--space-1-5) var(--space-2) 0; border-top: 1px solid var(--line); margin-top: var(--space-1-5); font-size: var(--font-xs); }
</style>
