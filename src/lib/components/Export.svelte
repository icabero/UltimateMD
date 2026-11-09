<script lang="ts">
  import { dim, pop } from '../motion';
  import { onMount, untrack } from 'svelte';
  import DocxSheet from './DocxSheet.svelte';
  import ExportReview from './ExportReview.svelte';
  import Icon from './Icon.svelte';
  import { api, type TemplateStyle } from '../api';
  import { buildContent, buildPlan, documentCss, exportHtml, foldersOf, levelCount, levelExamples, reviewExport, type ExportOptions, type ExportProblem, type LevelChoice, type Scope } from '../export';
  import { tr, type Key } from '../i18n.svelte';
  import { baseName } from '../paths';
  import { store, type Tab } from '../store.svelte';

  type Format = 'pdf' | 'docx' | 'html';

  const FORMATS: { id: Format; label: string; hint: Key }[] = [
    { id: 'pdf', label: 'PDF', hint: 'export.pdfHint' },
    { id: 'docx', label: 'Word', hint: 'export.docxHint' },
    { id: 'html', label: 'HTML', hint: 'export.htmlHint' },
  ];
  const STEPS: Key[] = ['export.stepFormat', 'export.stepContent', 'export.stepLook'];
  const CONTENT_STEP = 1;
  /** The width of a thumbnail, in pixels. */
  const THUMB_WIDTH = 168;
  /** An A4 page at screen resolution, in pixels. */
  const PAGE_WIDTH = 794;
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
    archive: boolean;
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
  let archive = $state(memory.archive ?? false);
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
  let problems = $state<ExportProblem[] | null>(null);
  let step = $state(0);
  /** Where the document was written, once it is. */
  let saved = $state<string | null>(null);
  /** The first page, taken from the preview before it goes away. */
  let picture = $state<HTMLElement | null>(null);
  let reviewRun = 0;

  const folders = $derived(foldersOf(store.trees[tab.vaultId] ?? []));
  const canWiden = $derived(!tab.loose);
  const options = $derived<ExportOptions>({ scope, folder, levels: levels.map((l) => ({ ...l })), noteTitles, noteBreak, cover, archive, template: format === 'docx' && template ? template : null });
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
    const count = levelCount(tab, { scope, folder, levels: [], noteTitles: false, noteBreak: false, cover: false, archive: false, template: null });
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

  /** Checks the notes again; only what goes in the document matters, not its format. */
  async function review() {
    const id = ++reviewRun;
    problems = null;
    const found = await reviewExport(tab, $state.snapshot(options) as ExportOptions).catch(() => []);
    if (id === reviewRun) problems = found;
  }

  function goTo(problem: ExportProblem) {
    const id = tab.vaultId;
    store.exporting = false;
    void store.openAt(id, problem.note, problem.line, []);
  }

  $effect(() => {
    JSON.stringify(options);
    format;
    clearTimeout(timer);
    timer = setTimeout(refresh, PREVIEW_DELAY);
  });

  let reviewTimer: ReturnType<typeof setTimeout>;
  $effect(() => {
    JSON.stringify([scope, folder, levels, noteTitles]);
    clearTimeout(reviewTimer);
    reviewTimer = setTimeout(review, PREVIEW_DELAY);
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

  /** Notes prepared out of how many, while preparing; null while the document is written. */
  let progress = $state<{ done: number; total: number } | null>(null);
  const onProgress = (done: number, total: number) => (progress = { done, total });

  /** A copy of the first page of the preview, for the thumbnail. */
  function thumbnail(): HTMLElement | null {
    if (format === 'pdf') {
      if (!pages[0]) return null;
      const img = document.createElement('img');
      img.src = pages[0];
      img.alt = '';
      return img;
    }
    const parts = format === 'docx' ? (docx?.firstPage() ?? []) : [...(htmlHost?.shadowRoot?.childNodes ?? [])].map((n) => n.cloneNode(true));
    if (!parts.length) return null;
    const frame = document.createElement('div');
    frame.attachShadow({ mode: 'open' }).append(...parts);
    // Laid out at the width of a page, then shrunk to fit.
    frame.style.width = `${PAGE_WIDTH}px`;
    frame.style.zoom = String(THUMB_WIDTH / PAGE_WIDTH);
    return frame;
  }

  /** Shows the copy of the first page. */
  function fit(node: HTMLElement, page: HTMLElement | null) {
    if (page) node.replaceChildren(page);
  }

  async function submit() {
    busy = true;
    progress = { done: 0, total: 0 };
    const written = await runAction(async () => {
      const current = $state.snapshot(options) as ExportOptions;
      if (format === 'html') return exportHtml(tab, current, onProgress);
      const plan = await buildPlan(tab, current, onProgress);
      progress = null;
      return format === 'docx' ? api.exportDocx(plan) : api.exportPdf(plan);
    });
    busy = false;
    progress = null;
    if (written) {
      saveMemory({ format, scope, folder, levels: $state.snapshot(levels), noteTitles, noteBreak, cover, archive, template });
      try {
        picture = thumbnail();
      } catch {
        // The card still says where the file is.
        picture = null;
      }
      saved = written;
    }
  }

  const close = () => (store.exporting = false);
  const openSaved = (path: string) => runAction(() => api.openExported(path));
  const revealSaved = (path: string) => runAction(() => api.revealExported(path));
</script>

<button in:dim class="scrim" aria-label={tr('common.close')} onclick={close}></button>
{#if saved}
  <div in:pop class="modal done" role="dialog" aria-label={tr('export.doneTitle')}>
    <header>
      <h2>{tr('export.doneTitle')}</h2>
      <button class="icon" title={tr('common.close')} onclick={close}><Icon name="close" /></button>
    </header>
    <div class="card">
      <div class="thumb" class:empty={!picture} use:fit={picture} aria-hidden="true"></div>
      <div class="file">
        <strong title={saved}>{baseName(saved)}</strong>
        <span class="path">{saved}</span>
      </div>
    </div>
    <div class="actions">
      <button class="plain" onclick={() => (saved = null)}>{tr('export.again')}</button>
      <span class="spacer"></span>
      <button class="plain" onclick={() => revealSaved(saved!)}>{tr('export.showInFolder')}</button>
      <button class="main" onclick={() => openSaved(saved!)}>{tr('export.openFile')}</button>
    </div>
  </div>
{:else}
  <div in:pop class="modal" role="dialog" aria-label={tr('export.title')}>
    <div class="config">
      <header>
        <h2>{tr('export.title')}</h2>
        <button class="icon" title={tr('common.close')} onclick={close}><Icon name="close" /></button>
      </header>

      <nav class="steps" aria-label={tr('export.steps')}>
        {#each STEPS as label, i}
          <button class:on={step === i} aria-current={step === i ? 'step' : undefined} onclick={() => (step = i)}><span class="n">{i + 1}</span>{tr(label)}</button>
        {/each}
      </nav>

      <div class="body">
        {#if step === 0}
          <div class="formats" role="group" aria-label={tr('export.format')}>
            {#each FORMATS as f}
              <button class="format" class:on={format === f.id} aria-pressed={format === f.id} onclick={() => (format = f.id)}>
                <strong>{f.label}</strong>
                <span>{tr(f.hint)}</span>
              </button>
            {/each}
          </div>
          {#if format === 'pdf'}
            <label class="check"><input type="checkbox" bind:checked={archive} /> {tr('export.archive')}</label>
            <p class="hint">{tr('export.archiveHint')}</p>
          {/if}
        {:else if step === CONTENT_STEP}
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

          <h3>{tr('review.title')}</h3>
          <ExportReview {problems} ongo={goTo} />
        {:else if format === 'pdf'}
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
        {:else}
          <p class="hint">{tr('export.htmlLook')}</p>
        {/if}
      </div>

      <footer>
        {#if busy}
          <div class="progress">
            <div class="track" role="progressbar" aria-label={tr('export.exporting')} aria-valuemin={0} aria-valuemax={progress?.total || undefined} aria-valuenow={progress?.total ? progress.done : undefined}>
              <span class="bar" class:indeterminate={!progress?.total} style:width={progress?.total ? `${(100 * progress.done) / progress.total}%` : undefined}></span>
            </div>
            <span class="phase">{progress?.total ? tr('export.preparing', { done: progress.done, total: progress.total }) : tr('export.writing')}</span>
          </div>
        {:else}
          {#if step > 0}<button class="plain" onclick={() => step--}>{tr('export.back')}</button>{/if}
          {#if step !== CONTENT_STEP && problems?.length}
            <button class="warnings" onclick={() => (step = CONTENT_STEP)}>{problems.length === 1 ? tr('export.warningsOne') : tr('export.warnings', { n: problems.length })}</button>
          {/if}
          <span class="spacer"></span>
          {#if step < STEPS.length - 1}<button class="plain" onclick={() => step++}>{tr('export.next')}</button>{/if}
        {/if}
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
{/if}

<style>
  .modal { position: fixed; top: 50%; left: 50%; z-index: var(--z-dialog); display: grid; grid-template-columns: 340px 1fr; width: min(1040px, calc(100vw - 32px)); height: min(760px, calc(100vh - 32px)); overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translate(-50%, -50%); }
  .config { display: flex; flex-direction: column; min-height: 0; padding: var(--space-2) var(--space-5) var(--space-3-5); }
  .body { display: flex; flex: 1; flex-direction: column; min-height: 0; padding-bottom: var(--space-3); overflow-y: auto; }
  .steps { display: flex; gap: var(--space-1); margin: var(--space-1) 0 var(--space-2); }
  .steps button { display: flex; flex: 1; align-items: center; gap: var(--space-1-5); padding: var(--space-1-5) var(--space-1); border: 0; border-bottom: 2px solid var(--line); border-radius: 0; background: none; color: var(--text-3); font-size: var(--font-sm); }
  .steps button:hover { color: var(--text); }
  .steps .on { border-color: var(--accent); color: var(--text); font-weight: 600; }
  .steps .n { display: grid; width: 18px; height: 18px; flex: none; place-items: center; border-radius: 50%; background: var(--hover); font-size: var(--font-xs); }
  .steps .on .n { background: var(--accent); color: var(--on-accent); }
  .formats { display: flex; flex-direction: column; gap: var(--space-2); margin: var(--space-2) 0 var(--space-3); }
  .format { display: flex; flex-direction: column; gap: var(--space-0-5); padding: var(--space-2-5) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: none; color: var(--text); text-align: left; }
  .format span { color: var(--text-2); font-size: var(--font-sm); line-height: 1.4; }
  .format:hover { background: var(--hover); }
  .format.on { border-color: var(--accent); background: var(--accent-soft); }
  .hint { margin-top: var(--space-1); }
  .spacer { flex: 1; }
  .warnings { padding: var(--space-1) var(--space-2-5); border: 0; border-radius: var(--radius-sm); background: var(--warn); color: var(--text); font-size: var(--font-sm); }
  .done { display: flex; flex-direction: column; width: min(480px, calc(100vw - 32px)); height: auto; padding: var(--space-2) var(--space-5) var(--space-4); }
  .card { display: flex; gap: var(--space-4); align-items: center; margin: var(--space-2) 0 var(--space-4); }
  .thumb { flex: none; width: 168px; height: 238px; overflow: hidden; border: 1px solid var(--line); background: #fff; box-shadow: var(--shadow-md); }
  .thumb :global(img) { display: block; width: 100%; }
  .file { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
  .file strong { overflow: hidden; font-size: var(--font-base); white-space: nowrap; text-overflow: ellipsis; }
  .path { color: var(--text-3); font-size: var(--font-xs); overflow-wrap: anywhere; }
  .actions { display: flex; gap: var(--space-1-5); align-items: center; }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: var(--space-2) 0; font-size: var(--font-lg); font-weight: 650; }
  h3 { margin: var(--space-3-5) 0 var(--space-1-5); font-size: var(--font-sm); font-weight: 650; }
  .seg { display: inline-flex; align-self: flex-start; padding: var(--space-0-5); border-radius: var(--radius-md); background: var(--hover); }
  .seg button { padding: var(--space-1) var(--space-3); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-2); font-size: var(--font-sm); }
  .seg button:disabled { opacity: .45; }
  .seg .on { background: var(--raised); color: var(--text); box-shadow: var(--shadow-sm); }
  label { color: var(--text-2); font-size: var(--font-sm); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-top: var(--space-1-5); }
  .name { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .level { margin-bottom: var(--space-1); }
  .check { display: flex; align-items: center; gap: var(--space-1-5); margin-top: var(--space-1); }
  select { flex: none; max-width: 170px; padding: var(--space-1) var(--space-1-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); color: var(--text); font: inherit; }
  select.wide { width: 100%; max-width: none; }
  .buttons { display: flex; flex-wrap: wrap; gap: var(--space-1-5); margin-top: var(--space-2); }
  .plain { padding: var(--space-1) var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: none; color: var(--text-2); font-size: var(--font-sm); }
  .plain:hover { background: var(--hover); color: var(--text); }
  p { margin: var(--space-2) 0 0; color: var(--text-2); font-size: var(--font-sm); line-height: 1.5; }
  p :global(code) { font: var(--font-xs) var(--mono); }
  footer { display: flex; flex: none; align-items: center; gap: var(--space-1-5); padding-top: var(--space-3); border-top: 1px solid var(--line); }
  .main { padding: var(--space-1-5) var(--space-4); border: 1px solid var(--accent); border-radius: var(--radius-md); background: var(--accent); color: var(--on-accent); font-size: var(--font-md); }
  .main:disabled { opacity: .6; }
  .preview { min-width: 0; min-height: 0; padding: var(--space-4) var(--space-6); overflow-y: auto; border-left: 1px solid var(--line); background: var(--panel); }
  .preview[aria-busy='true'] { opacity: .6; }
  .progress { display: flex; flex: 1; flex-direction: column; gap: var(--space-1); min-width: 0; margin-right: var(--space-3); }
  .track { position: relative; height: 4px; overflow: hidden; border-radius: var(--radius-2xs); background: var(--line); }
  .bar { position: absolute; inset: 0 auto 0 0; background: var(--accent); transition: width var(--ease); }
  .bar.indeterminate { width: 30%; animation: slide 1.1s ease-in-out infinite; }
  @keyframes slide { from { left: -30%; } to { left: 100%; } }
  @media (prefers-reduced-motion: reduce) { .bar.indeterminate { width: 100%; animation: none; opacity: .5; } }
  .phase { overflow: hidden; color: var(--text-3); font-size: var(--font-xs); white-space: nowrap; text-overflow: ellipsis; }
  .page { display: block; width: 100%; margin-bottom: var(--space-3); box-shadow: var(--shadow-md); }
  .html { background: #fff; }
  .note { margin: 0 0 var(--space-3); text-align: center; }
  .error { color: var(--danger); }
</style>
