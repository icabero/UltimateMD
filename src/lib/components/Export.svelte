<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import DocxSheet from './DocxSheet.svelte';
  import Icon from './Icon.svelte';
  import { api, type TemplateStyle } from '../api';
  import { buildContent, buildPlan, documentCss, exportHtml, foldersOf, levelCount, levelExamples, type ExportOptions, type LevelChoice, type Scope } from '../export';
  import { tr } from '../i18n.svelte';
  import { store, type Tab } from '../store.svelte';

  type Format = 'pdf' | 'docx' | 'html';

  const FORMATS: { id: Format; label: string }[] = [
    { id: 'pdf', label: 'PDF' },
    { id: 'docx', label: 'Word' },
    { id: 'html', label: 'HTML' },
  ];
  const HEADINGS = [1, 2, 3, 4, 5, 6];
  const EXAMPLE = 'Ejemplo';
  /** The backend reads this one from the vault. */
  const VAULT_TEMPLATE = ':vault';
  const PREVIEW_DELAY = 400;
  const MEMORY_KEY = 'ultimatemd.export';

  /** The options of the last export, kept per vault in this computer. */
  interface Remembered {
    format: Format;
    scope: Scope;
    folder: string;
    levels: LevelChoice[];
    noteTitles: boolean;
    noteBreak: boolean;
    cover: boolean;
    template: string;
  }

  let { tab }: { tab: Tab } = $props();
  const memoryId = untrack(() => (tab.loose ? ':loose' : tab.vaultId));

  function loadMemory(): Partial<Remembered> {
    try {
      return JSON.parse(localStorage.getItem(MEMORY_KEY) ?? '{}')[memoryId] ?? {};
    } catch {
      return {};
    }
  }

  function saveMemory(value: Remembered) {
    try {
      const all = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? '{}');
      localStorage.setItem(MEMORY_KEY, JSON.stringify({ ...all, [memoryId]: value }));
    } catch {
      // Next time starts from the defaults.
    }
  }

  const memory = loadMemory();
  const remembered = untrack(() => {
    const wide = !tab.loose && (memory.scope === 'vault' || (memory.scope === 'folder' && foldersOf(store.trees[tab.vaultId] ?? []).includes(memory.folder ?? '')));
    return { scope: wide ? memory.scope! : 'note', folder: wide ? (memory.folder ?? '') : '' };
  });

  let format = $state<Format>(FORMATS.some((f) => f.id === memory.format) ? memory.format! : 'pdf');
  let scope = $state<Scope>(remembered.scope);
  let folder = $state(remembered.folder);
  let levels = $state<LevelChoice[]>(remembered.scope === 'note' ? [] : (memory.levels ?? []));
  let noteTitles = $state(memory.noteTitles ?? false);
  let noteBreak = $state(memory.noteBreak ?? false);
  let cover = $state(remembered.scope === 'note' ? false : (memory.cover ?? true));
  let templates = $state<string[]>([]);
  let template = $state(EXAMPLE);
  let vaultTemplate = $state(false);
  let styles = $state<TemplateStyle[]>([]);
  let busy = $state(false);

  let pages = $state<string[]>([]);
  let docx = $state<DocxSheet>();
  let htmlHost = $state<HTMLDivElement>();
  let previewing = $state(false);
  let previewError = $state('');
  let timer: ReturnType<typeof setTimeout>;
  let run = 0;

  const folders = $derived(foldersOf(store.trees[tab.vaultId] ?? []));
  const canWiden = $derived(!tab.loose);
  const options = $derived<ExportOptions>({ scope, folder, levels: levels.map((l) => ({ ...l })), noteTitles, noteBreak, cover, template: format === 'docx' && template ? template : null });
  const examples = $derived(scope === 'note' ? [] : levelExamples(tab, options));
  const customStyles = $derived(styles.filter((s) => !/^(heading|toc) \d$|^(header|footer|normal|footnote text|toc heading)$/i.test(s.name)));

  async function loadTemplates() {
    templates = await api.listTemplates().catch(() => []);
    if (template !== VAULT_TEMPLATE && template && !templates.includes(template)) template = EXAMPLE;
  }

  onMount(async () => {
    await loadTemplates();
    if (!tab.loose) vaultTemplate = await api.wordConfig(tab.vaultId).then((c) => c.hasTemplate).catch(() => false);
    // The template used last time while it still exists, else the vault's own.
    const last = memory.template;
    const exists = last === EXAMPLE || (last === VAULT_TEMPLATE ? vaultTemplate : !!last && templates.includes(last));
    if (exists) template = last!;
    else if (vaultTemplate) template = VAULT_TEMPLATE;
  });

  // One row per depth of folders; a new row titles folders at that depth.
  $effect(() => {
    const count = levelCount(tab, { scope, folder, levels: [], noteTitles: false, noteBreak: false, cover: false, template: null });
    const current = $state.snapshot(levels);
    if (current.length === count) return;
    levels = Array.from({ length: count }, (_, i) => current[i] ?? { value: i === 0 ? '' : `heading:${Math.min(i, 6)}`, pageBreak: false });
  });

  $effect(() => {
    if (format !== 'docx') return;
    const name = template || null;
    api.templateStyles(name).then((s) => (styles = s)).catch(() => (styles = []));
  });

  async function runAction<T>(action: () => Promise<T>) {
    try {
      return await action();
    } catch (e) {
      store.notify(e);
    }
  }

  async function refresh() {
    const id = ++run;
    previewing = true;
    previewError = '';
    try {
      if (format === 'html') {
        const article = await buildContent(tab, $state.snapshot(options) as ExportOptions);
        if (id !== run || !htmlHost) return;
        const shadow = htmlHost.shadowRoot ?? htmlHost.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = documentCss();
        shadow.replaceChildren(style, article);
      } else if (format === 'docx') {
        const bytes = await api.previewDocx(await buildPlan(tab, $state.snapshot(options) as ExportOptions));
        if (id === run) await docx?.show(bytes);
      } else {
        const rendered = await api.previewPdf(await buildPlan(tab, $state.snapshot(options) as ExportOptions));
        if (id === run) pages = rendered;
      }
    } catch (e) {
      if (id === run) previewError = String(e);
    } finally {
      if (id === run) previewing = false;
    }
  }

  $effect(() => {
    JSON.stringify(options);
    format;
    clearTimeout(timer);
    timer = setTimeout(refresh, PREVIEW_DELAY);
  });

  function setScope(next: Scope) {
    scope = next;
    if (next === 'folder' && !folder) folder = folders[0] ?? '';
    cover = next !== 'note';
  }

  async function importTemplate() {
    const name = await runAction(api.importTemplate);
    await loadTemplates();
    if (name) template = name;
  }

  async function renameTemplate() {
    const name = (await store.prompt(tr('export.templateName'), template, tr('common.rename')))?.trim();
    if (!name || name === template) return;
    await runAction(() => api.renameTemplate(template, name));
    await loadTemplates();
    if (templates.includes(name)) template = name;
  }

  async function deleteTemplate() {
    if (!(await store.confirm(tr('export.templateDelete', { name: template }), tr('common.delete'), true))) return;
    await runAction(() => api.deleteTemplate(template));
    await loadTemplates();
  }

  async function submit() {
    busy = true;
    const done = await runAction(async () => {
      const current = $state.snapshot(options) as ExportOptions;
      if (format === 'html') return exportHtml(tab, current);
      const plan = await buildPlan(tab, current);
      return format === 'docx' ? api.exportDocx(plan) : api.exportPdf(plan);
    });
    busy = false;
    if (done) {
      saveMemory({ format, scope, folder, levels: $state.snapshot(levels), noteTitles, noteBreak, cover, template });
      store.exporting = false;
      store.notify(tr('export.done'));
    }
  }
</script>

<button class="scrim" aria-label={tr('common.close')} onclick={() => (store.exporting = false)}></button>
<div class="modal" role="dialog" aria-label={tr('export.title')}>
  <div class="config">
    <header>
      <h2>{tr('export.title')}</h2>
      <button class="icon" title={tr('common.close')} onclick={() => (store.exporting = false)}><Icon name="close" /></button>
    </header>

    <h3>{tr('export.format')}</h3>
    <div class="seg" role="group" aria-label={tr('export.format')}>
      {#each FORMATS as f}
        <button class:on={format === f.id} aria-pressed={format === f.id} onclick={() => (format = f.id)}>{f.label}</button>
      {/each}
    </div>

    <h3>{tr('export.what')}</h3>
    <div class="seg" role="group" aria-label={tr('export.scope')}>
      <button class:on={scope === 'note'} onclick={() => setScope('note')}>{tr('export.thisNote')}</button>
      <button class:on={scope === 'folder'} disabled={!canWiden || !folders.length} onclick={() => setScope('folder')}>{tr('export.folder')}</button>
      <button class:on={scope === 'vault'} disabled={!canWiden} onclick={() => setScope('vault')}>Vault</button>
    </div>
    {#if scope === 'folder'}
      <label class="row">{tr('export.folder')}
        <select bind:value={folder}>
          {#each folders as f}<option value={f}>{f}</option>{/each}
        </select>
      </label>
    {/if}

    {#if scope !== 'note'}
      <h3>{tr('export.foldersInDoc')}</h3>
      {#each levels as level, i}
        <div class="level">
          <label class="row">
            <span class="name" title={examples[i]}>{i === 0 ? tr('export.root') : tr('export.level', { n: i })}{examples[i] ? ` · ${examples[i]}` : ''}</span>
            <select bind:value={level.value} aria-label={tr('export.level', { n: i })}>
              <option value="">{tr('export.noTitle')}</option>
              {#each HEADINGS as n}<option value="heading:{n}">{tr('export.heading', { n })}</option>{/each}
              {#if format === 'docx' && customStyles.length}
                <optgroup label={tr('export.templateStyles')}>
                  {#each customStyles as s}<option value="style:{s.id}">{s.name}</option>{/each}
                </optgroup>
              {/if}
            </select>
          </label>
          {#if level.value}
            <label class="check"><input type="checkbox" bind:checked={level.pageBreak} /> {tr('export.pageBreak')}</label>
          {/if}
        </div>
      {/each}
      <h3>{tr('export.notes')}</h3>
      <label class="check"><input type="checkbox" bind:checked={noteTitles} /> {tr('export.noteTitles')}</label>
      <label class="check"><input type="checkbox" bind:checked={noteBreak} /> {tr('export.noteBreak')}</label>
    {/if}

    {#if format === 'pdf'}
      <h3>{tr('export.document')}</h3>
      <label class="check"><input type="checkbox" bind:checked={cover} /> {tr('export.cover')}</label>
    {:else if format === 'docx'}
      <h3>{tr('export.template')}</h3>
      <select class="wide" aria-label={tr('export.template')} bind:value={template}>
        {#if vaultTemplate}<option value={VAULT_TEMPLATE}>{tr('export.vaultTemplate')}</option>{/if}
        <option value="">{tr('export.noTemplate')}</option>
        {#each templates as name}<option value={name}>{name === EXAMPLE ? tr('export.exampleTemplate') : name}</option>{/each}
      </select>
      <div class="buttons">
        <button class="plain" onclick={importTemplate}>{tr('export.import')}</button>
        {#if template && template !== VAULT_TEMPLATE}<button class="plain" onclick={() => runAction(() => api.saveTemplateCopy(template))}>{tr('export.saveCopy')}</button>{/if}
        {#if !tab.loose}<button class="plain" onclick={() => { store.exporting = false; store.wordScreen = tab.vaultId; }}>{tr('word.openSettings')}</button>{/if}
        {#if template && template !== EXAMPLE && template !== VAULT_TEMPLATE}
          <button class="plain" onclick={renameTemplate}>{tr('common.rename')}</button>
          <button class="plain" onclick={deleteTemplate}>{tr('common.delete')}</button>
        {/if}
      </div>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- our own translation, with markup -->
      <p>{@html tr('export.templateHelp')}</p>
    {/if}

    <footer>
      <button class="main" disabled={busy} onclick={submit}>{tr(busy ? 'export.exporting' : 'export.title')}</button>
    </footer>
  </div>

  <div class="preview" aria-label={tr('export.preview')} aria-busy={previewing}>
    {#if previewError}
      <p class="error" role="alert">{previewError}</p>
    {:else if format === 'pdf'}
      {#each pages as page, i}
        <img class="page" src={page} alt={tr('export.page', { n: i + 1 })} />
      {/each}
    {:else if format === 'docx'}
      <p class="note">{tr('export.wordNote')}</p>
      <DocxSheet bind:this={docx} />
    {:else}
      <div class="html" bind:this={htmlHost}></div>
    {/if}
  </div>
</div>

<style>
  .modal { position: fixed; top: 50%; left: 50%; z-index: 31; display: grid; grid-template-columns: 340px 1fr; width: min(1040px, calc(100vw - 32px)); height: min(760px, calc(100vh - 32px)); overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); box-shadow: var(--shadow); transform: translate(-50%, -50%); }
  .config { display: flex; flex-direction: column; min-height: 0; padding: 8px 18px 14px; overflow-y: auto; }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 8px 0; font-size: 15px; font-weight: 650; }
  h3 { margin: 14px 0 6px; font-size: 12px; font-weight: 650; }
  .seg { display: inline-flex; align-self: flex-start; padding: 2px; border-radius: 8px; background: var(--hover); }
  .seg button { padding: 4px 12px; border: 0; border-radius: 6px; background: none; color: var(--text-2); font-size: 12.5px; }
  .seg button:disabled { opacity: .45; }
  .seg .on { background: var(--raised); color: var(--text); box-shadow: 0 1px 2px rgb(0 0 0 / 15%); }
  label { color: var(--text-2); font-size: 12.5px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
  .name { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .level { margin-bottom: 4px; }
  .check { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
  select { flex: none; max-width: 170px; padding: 3px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--text); font: inherit; }
  select.wide { width: 100%; max-width: none; }
  .buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .plain { padding: 3px 9px; border: 1px solid var(--line); border-radius: 6px; background: none; color: var(--text-2); font-size: 12px; }
  .plain:hover { background: var(--hover); color: var(--text); }
  p { margin: 8px 0 0; color: var(--text-2); font-size: 12px; line-height: 1.5; }
  p :global(code) { font: 11px var(--mono); }
  footer { display: flex; justify-content: flex-end; margin-top: auto; padding-top: 14px; }
  .main { padding: 6px 16px; border: 1px solid var(--accent); border-radius: 7px; background: var(--accent); color: var(--on-accent); font-size: 13px; }
  .main:disabled { opacity: .6; }
  .preview { min-width: 0; min-height: 0; padding: 16px 24px; overflow-y: auto; border-left: 1px solid var(--line); background: var(--panel); }
  .preview[aria-busy='true'] { opacity: .6; }
  .page { display: block; width: 100%; margin-bottom: 12px; box-shadow: 0 1px 4px rgb(0 0 0 / 30%); }
  .html { background: #fff; }
  .note { margin: 0 0 12px; text-align: center; }
  .error { color: var(--danger); }
</style>
