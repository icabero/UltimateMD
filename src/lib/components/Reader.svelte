<script lang="ts">
  // A vault or a folder read top to bottom, as one document. Notes load as
  // they come near, so a large vault opens at once; links between the notes
  // being read jump within the reading.
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { onDestroy, onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { api } from '../api';
  import { parseAnchor } from '../anchors';
  import { parseStyle } from '../diagramStyle';
  import { renderDiagram } from '../diagrams';
  import { fillEmbeds } from '../embeds';
  import { fold } from '../fold';
  import { tr } from '../i18n.svelte';
  import { renderMarkdown } from '../markdown';
  import { baseName } from '../paths';
  import { readingOrder, readingText, savePlace, savedPlace } from '../reading';
  import { store, type Tab } from '../store.svelte';
  import { themeVariables } from '../themes';
  import previewCss from '../preview.css?inline';

  let { vaultId, folder }: { vaultId: string; folder: string } = $props();

  /** How far ahead of the screen notes are loaded. */
  const AHEAD = '1200px';

  const notes = $derived(readingOrder(store.trees[vaultId] ?? [], folder));
  const title = $derived(folder ? baseName(folder) : (store.vault(vaultId)?.name ?? ''));
  const theme = $derived(store.lookUpTheme(vaultId, store.vaultThemes[vaultId]?.defaultTheme) ?? store.theme);
  const scoped = $derived(theme === store.theme ? '' : Object.entries(themeVariables(theme)).map(([k, v]) => `${k}:${v}`).join(';'));

  let host = $state<HTMLDivElement>();
  let scroller = $state<HTMLDivElement>();
  let current = $state<string | null>(null);
  let root: ShadowRoot;
  let article: HTMLElement;
  let loader: IntersectionObserver | null = null;
  let watcher: IntersectionObserver | null = null;
  // Plain caches: nothing on screen depends on them.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const loaded = new Set<string>();
  /** Each note's text, for its diagrams' look. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const texts = new Map<string, string>();

  const sectionOf = (path: string) => article?.querySelector<HTMLElement>(`section[data-path="${CSS.escape(path)}"]`) ?? null;
  // The look of a diagram goes by its note, as in the preview.
  const asTab = (path: string) => ({ vaultId, path, content: texts.get(path) ?? '' }) as Tab;

  async function load(section: HTMLElement) {
    const path = section.dataset.path!;
    if (loaded.has(path)) return;
    loaded.add(path);
    try {
      const { content } = await api.read(vaultId, path);
      texts.set(path, content);
      const body = section.querySelector<HTMLElement>('.body')!;
      const context = { vaultId, path, files: store.files(vaultId), aliases: store.aliasMap(vaultId) };
      body.replaceChildren(renderMarkdown(readingText(content), context));
      // A first heading that only repeats the note's name, shown above already.
      const first = body.firstElementChild;
      const name = section.querySelector('.note-title')?.textContent ?? '';
      if (first?.tagName === 'H1' && fold(first.textContent ?? '').trim() === fold(name).trim()) first.remove();
      await fillEmbeds(body, context, store.noteReader(vaultId));
      section.classList.add('ready');
      for (const el of body.querySelectorAll<HTMLElement>('.diagram')) void draw(path, el);
    } catch (e) {
      loaded.delete(path);
      store.fail(e);
    }
  }

  async function draw(path: string, el: HTMLElement) {
    try {
      const { theme, sketch } = store.diagramLook(asTab(path), parseStyle(el.dataset.style ?? ''));
      el.innerHTML = await renderDiagram(el.dataset.lang!, decodeURIComponent(el.dataset.src ?? ''), theme, sketch);
    } catch {
      el.textContent = tr('reader.diagramFailed');
    }
  }

  function build() {
    loader?.disconnect();
    watcher?.disconnect();
    loaded.clear();
    article.replaceChildren();
    for (const note of notes) {
      const section = document.createElement('section');
      section.dataset.path = note.path;
      section.setAttribute('aria-label', note.title);
      const head = document.createElement('header');
      if (note.folder) {
        const where = document.createElement('p');
        where.className = 'where';
        where.textContent = note.folder.replaceAll('/', ' › ');
        head.append(where);
      }
      const name = document.createElement('h1');
      name.className = 'note-title';
      name.textContent = note.title;
      const edit = document.createElement('button');
      edit.className = 'edit';
      edit.textContent = tr('reader.edit');
      edit.title = note.path;
      edit.onclick = () => openForEditing(note.path);
      head.append(name, edit);
      const body = document.createElement('div');
      body.className = 'body';
      body.textContent = tr('reader.loading');
      section.append(head, body);
      article.append(section);
    }
    loader = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) void load(entry.target as HTMLElement);
    }, { root: scroller, rootMargin: `${AHEAD} 0px` });
    // The note whose start last passed the top of the screen is the current one.
    watcher = new IntersectionObserver(() => markCurrent(), { root: scroller, threshold: [0, 1] });
    for (const section of article.querySelectorAll('section')) {
      loader.observe(section);
      watcher.observe(section);
    }
  }

  function markCurrent() {
    if (!scroller) return;
    const top = scroller.getBoundingClientRect().top + 8;
    let found: string | null = notes[0]?.path ?? null;
    for (const section of article.querySelectorAll<HTMLElement>('section')) {
      if (section.getBoundingClientRect().top <= top) found = section.dataset.path!;
      else break;
    }
    if (found && found !== current) {
      current = found;
      savePlace(vaultId, folder, found);
    }
  }

  async function goTo(path: string, anchor?: string | null) {
    const section = sectionOf(path);
    if (!section) return;
    await load(section);
    await tick();
    const wanted = parseAnchor(anchor);
    const heading = wanted?.kind === 'heading'
      ? [...section.querySelectorAll<HTMLElement>('.body h1, .body h2, .body h3, .body h4, .body h5, .body h6')].find((h) => fold(h.textContent ?? '').trim() === fold(wanted.text).trim())
      : null;
    (heading ?? section).scrollIntoView({ block: 'start' });
    current = path;
    savePlace(vaultId, folder, path);
  }

  // Closing the reading clears the props, so the vault is taken first.
  function openForEditing(path: string) {
    const id = vaultId;
    store.reader = null;
    void store.openFile(id, path);
  }

  async function onClick(e: MouseEvent) {
    const a = e.composedPath().find((n) => n instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') ?? '';
    const from = (a.closest('section') as HTMLElement | null)?.dataset.path ?? '';
    if (/^#fn/.test(href)) {
      sectionOf(from)?.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView();
      return;
    }
    if (a.dataset.tag) return store.searchTag(a.dataset.tag);
    if (a.dataset.external && /^(https?|mailto):/i.test(a.dataset.external)) return openUrl(a.dataset.external);
    const target = a.dataset.note ?? (a.dataset.wikilink === '' ? from : undefined);
    if (target && sectionOf(target)) return goTo(target, a.dataset.anchor);
    // Outside what is being read: open it, as the preview does.
    const id = vaultId;
    store.reader = null;
    if (target) return store.openNoteAt(id, target, a.dataset.anchor);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !store.dialog && !store.menu) {
      e.preventDefault();
      store.reader = null;
    }
  }

  onMount(() => {
    root = host!.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${previewCss}
section { padding-bottom: 2.5em; margin-bottom: 2.5em; border-bottom: 1px solid var(--line); }
section:last-child { border-bottom: 0; }
section > header { display: flex; flex-wrap: wrap; align-items: baseline; gap: .25em 1em; margin-bottom: 1em; }
section > header .where { flex-basis: 100%; margin: 0; color: var(--text-2); font: 600 .78em/1.4 var(--sans); letter-spacing: .02em; text-transform: uppercase; }
section > header .note-title { flex: 1; margin: 0; }
section > header .edit { padding: .2em .7em; border: 1px solid var(--line); border-radius: 6px; background: none; color: var(--text-2); font: .8em var(--sans); cursor: pointer; }
section > header .edit:hover { color: var(--text); background: var(--hover); }
section:not(.ready) .body { min-height: 40vh; color: var(--text-2); font-family: var(--sans); }`;
    article = document.createElement('article');
    article.className = 'prose';
    root.append(style, article);
    article.addEventListener('click', onClick);
  });

  // The list of notes follows the vault as it changes.
  $effect(() => {
    if (!host) return;
    void notes;
    if (!article) return;
    build();
    const place = savedPlace(vaultId, folder);
    if (place && sectionOf(place)) void goTo(place);
    else current = notes[0]?.path ?? null;
  });

  onDestroy(() => {
    loader?.disconnect();
    watcher?.disconnect();
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="reader" style={scoped}>
  <header class="bar">
    <Icon name="eye" size={15} />
    <h2>{tr('reader.title', { name: title })}</h2>
    <span class="count">{tr('reader.count', { n: notes.length })}</span>
    <button class="plain" onclick={() => (store.reader = null)}>{tr('reader.close')}</button>
  </header>
  <div class="columns">
    <nav aria-label={tr('reader.index')}>
      {#each notes as note (note.path)}
        {#if note.folder && note.folder !== notes[notes.indexOf(note) - 1]?.folder}
          <p class="folder" style:padding-left="{(note.depth - 1) * 12 + 8}px">{baseName(note.folder)}</p>
        {/if}
        <button class:on={current === note.path} aria-current={current === note.path ? 'location' : undefined}
          style:padding-left="{note.depth * 12 + 8}px" title={note.path} onclick={() => goTo(note.path)}>{note.title}</button>
      {/each}
    </nav>
    <div class="scroll" bind:this={scroller} onscroll={markCurrent}>
      {#if notes.length}
        <div bind:this={host}></div>
      {:else}
        <p class="empty">{tr('reader.empty')}</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .reader { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg); color: var(--text); }
  .bar { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1-5) var(--space-3); border-bottom: 1px solid var(--line); color: var(--text-2); }
  h2 { margin: 0; overflow: hidden; color: var(--text); font-size: var(--font-md); font-weight: 650; white-space: nowrap; text-overflow: ellipsis; }
  .count { color: var(--text-2); font-size: var(--font-sm); }
  .plain { margin-left: auto; padding: var(--space-1) var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: none; color: var(--text); font-size: var(--font-sm); }
  .plain:hover { background: var(--hover); }
  .columns { display: grid; flex: 1; grid-template-columns: 220px 1fr; min-height: 0; }
  nav { min-height: 0; padding: var(--space-2) var(--space-1-5); overflow-y: auto; border-right: 1px solid var(--line); background: var(--panel); }
  nav button { display: block; width: 100%; padding-top: var(--space-1); padding-right: var(--space-2); padding-bottom: var(--space-1); overflow: hidden; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-2); font-size: var(--font-sm); text-align: left; white-space: nowrap; text-overflow: ellipsis; }
  nav button:hover { background: var(--hover); color: var(--text); }
  nav button.on { background: var(--accent-soft); color: var(--text); }
  .folder { margin: var(--space-2) 0 var(--space-0-5); color: var(--text-2); font-size: var(--font-xs); font-weight: 650; text-transform: uppercase; letter-spacing: .03em; }
  .scroll { min-height: 0; overflow-y: auto; }
  .empty { margin: var(--space-6); color: var(--text-2); }
</style>
