<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { onMount } from 'svelte';
  import { api, fileUrl } from '../api';
  import { parseStyle } from '../diagramStyle';
  import { diagramErrorBox, explainDiagramError } from '../diagramErrors';
  import { aiImages, redrawPrompt } from '../diagramGuide';
  import { renderDiagram, toPng, toSvgBytes } from '../diagrams';
  import { findTerms } from '../fold';
  import { tr } from '../i18n.svelte';
  import { outline, renderMarkdown, type Heading } from '../markdown';
  import { store, type Tab } from '../store.svelte';
  import { themeKey, themeVariables } from '../themes';
  import previewCss from '../preview.css?inline';

  let { tab }: { tab: Tab } = $props();

  /** An image an AI drew can be asked for again, following the vault's guide. */
  function imageMenu(e: MouseEvent) {
    const image = e.composedPath().find((n): n is HTMLImageElement => n instanceof HTMLImageElement);
    const path = image?.dataset.path;
    const shows = path ? aiImages(tab.path, tab.content).get(path) : undefined;
    if (!path || shows === undefined) return;
    store.openMenu(e, [
      { label: tr('guide.copyRedraw'), icon: 'copy', run: () => void store.copyText(redrawPrompt(tab.path, path, shows), tr('guide.copied')) },
    ]);
  }

  const DELAY = 150;
  let host = $state<HTMLDivElement>();
  let scroller = $state<HTMLDivElement>();
  let root: ShadowRoot;
  let body: HTMLElement;
  let timer: ReturnType<typeof setTimeout>;
  let run = 0;
  let drawnWith = '';
  let rendered = $state(false);
  const FOUND = 'umd-found';

  export function scrollTo(ratio: number) {
    if (scroller) scroller.scrollTop = ratio * (scroller.scrollHeight - scroller.clientHeight);
  }

  function saveDiagram(svg: SVGSVGElement, format: 'svg' | 'png', index: number) {
    return async () => {
      const name = `${tr('preview.diagramFile', { n: index + 1 })}.${format}`;
      try {
        store.notifyExported(await api.exportFile(name, format === 'svg' ? toSvgBytes(svg) : await toPng(svg)));
      } catch (e) {
        store.notify(format === 'png' ? tr('preview.pngFailed') : e);
      }
    };
  }

  function exportButton(label: string, onclick: () => void) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = onclick;
    return b;
  }

  /** Each code block names its language and can be copied with one click. Only on screen, never in an export. */
  function codeTools() {
    for (const pre of body.querySelectorAll<HTMLElement>('pre:not(.frontmatter)')) {
      const code = pre.querySelector('code');
      if (!code || pre.closest('.diagram, .diagram-error')) continue;
      const lang = pre.dataset.lang ?? /language-(\S+)/.exec(code.className)?.[1] ?? '';
      const tools = document.createElement('div');
      tools.className = 'code-tools';
      if (lang) {
        const name = document.createElement('span');
        name.textContent = lang;
        tools.append(name);
      }
      const copy = exportButton(tr('common.copy'), () => {
        void navigator.clipboard.writeText(code.textContent ?? '').then(() => {
          copy.textContent = tr('common.copied');
          setTimeout(() => (copy.textContent = tr('common.copy')), 1500);
        });
      });
      tools.append(copy);
      pre.classList.add('with-tools');
      pre.prepend(tools);
    }
  }

  async function hydrate(id: number) {
    const blocks = [...body.querySelectorAll<HTMLElement>('.diagram')];
    await Promise.all(blocks.map(async (el, index) => {
      const src = decodeURIComponent(el.dataset.src ?? '');
      try {
        const style = parseStyle(el.dataset.style ?? '');
        el.classList.toggle('animated', !!style.animated);
        const { theme, sketch } = store.diagramLook(tab, style);
        const svg = await renderDiagram(el.dataset.lang!, src, theme, sketch);
        if (id !== run) return;
        el.innerHTML = svg;
        const node = el.querySelector('svg');
        if (node) {
          const tools = document.createElement('div');
          tools.className = 'tools';
          tools.append(exportButton('SVG', saveDiagram(node, 'svg', index)), exportButton('PNG', saveDiagram(node, 'png', index)));
          el.append(tools);
        }
      } catch (e) {
        if (id !== run) return;
        const problem = explainDiagramError(el.dataset.lang!, src, e);
        el.replaceChildren(diagramErrorBox(problem, tab.kind === 'md' ? () => store.openDiagram(tab, index) : undefined));
      }
    }));
  }

  function render() {
    const id = ++run;
    const fragment = renderMarkdown(tab.content, {
      vaultId: tab.vaultId,
      path: tab.path,
      files: store.files(tab.vaultId),
    });
    // Diagrams already drawn stay on screen until their source really changes.
    const look = store.diagramLook(tab);
    const lookKey = `${look.sketch}:${themeKey(look.theme)}`;
    const kept = drawnWith === lookKey ? [...body.querySelectorAll<HTMLElement>('.diagram')] : [];
    const old = new Map(kept.map((e) => [`${e.dataset.lang}:${e.dataset.style}:${e.dataset.src}`, e]));
    drawnWith = lookKey;
    for (const el of fragment.querySelectorAll<HTMLElement>('.diagram')) {
      const previous = old.get(`${el.dataset.lang}:${el.dataset.style}:${el.dataset.src}`);
      if (previous) el.innerHTML = previous.innerHTML;
    }
    if ('highlights' in CSS) CSS.highlights.delete(FOUND);
    body.replaceChildren(fragment);
    markOutside();
    codeTools();
    rendered = true;
    reveal();
    publishPosition();
    void hydrate(id);
  }

  let markedSeen = 0;

  /** Briefly marks the blocks changed outside the app, once per change. */
  function markOutside() {
    const change = tab.outside;
    if (!change || change.seen === markedSeen) return;
    markedSeen = change.seen;
    const lines = new Set(change.lines);
    for (const el of body.querySelectorAll<HTMLElement>(':scope > [data-lines]')) {
      const [from, to] = el.dataset.lines!.split('-').map(Number);
      for (let line = from; line <= to; line++) {
        if (lines.has(line)) {
          el.classList.add('outside-change');
          break;
        }
      }
    }
  }

  const headings = () => [...body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')];

  let parsed = { content: '', headings: [] as Heading[] };
  let frame = 0;

  /** In reading view, tells the note panel which section is at the top. */
  function publishPosition() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (tab.view !== 'preview' || !scroller || !rendered) return;
      if (parsed.content !== tab.content) parsed = { content: tab.content, headings: outline(tab.content) };
      const box = scroller.getBoundingClientRect();
      // At the end of the note the last headings cannot reach the top: the lowest one in sight counts.
      const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      const limit = atEnd ? box.bottom : box.top + 24;
      const index = headings().filter((h) => h.getBoundingClientRect().top <= limit).length - 1;
      const line = index < 0 ? 1 : (parsed.headings[index]?.line ?? 1);
      if (store.position?.key !== tab.key || store.position.line !== line) store.position = { key: tab.key, line };
    });
  }

  /** Marks the words of a search and scrolls to the match nearest the line found. */
  function reveal() {
    const want = store.reveal;
    if (!rendered || !scroller || !want || want.key !== tab.key || tab.view !== 'preview') return;
    store.reveal = null;
    if (want.heading !== undefined) {
      if ('highlights' in CSS) CSS.highlights.delete(FOUND);
      const target = headings()[want.heading];
      if (target) scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
      return;
    }
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const [a, b] of findTerms(node.textContent ?? '', want.terms)) {
        const range = new Range();
        range.setStart(node, a);
        range.setEnd(node, b);
        ranges.push(range);
      }
    }
    if ('highlights' in CSS) CSS.highlights.set(FOUND, new Highlight(...ranges));
    if (!want.line) return void (scroller.scrollTop = 0);
    // Where the line would fall if text were spread evenly; the nearest match wins.
    const lines = Math.max(tab.content.split(/\r?\n/).length - 1, 1);
    const guess = ((want.line - 1) / lines) * scroller.scrollHeight;
    const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
    let target = guess;
    let best = Infinity;
    for (const r of ranges) {
      const y = r.getBoundingClientRect().top - origin;
      if (Math.abs(y - guess) < best) [best, target] = [Math.abs(y - guess), y];
    }
    scroller.scrollTop = target - scroller.clientHeight / 3;
  }

  $effect(() => {
    store.reveal;
    tab.view;
    reveal();
  });

  async function onClick(e: MouseEvent) {
    const a = e.composedPath().find((n) => n instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined;
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    e.preventDefault();
    // Footnotes keep their own ids within the preview.
    if (/^#fn/.test(href)) {
      root.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
      return;
    }
    if (a.dataset.tag) return store.searchTag(a.dataset.tag);
    if (a.dataset.note) return store.openNoteAt(tab.vaultId, a.dataset.note, a.dataset.anchor);
    if (a.dataset.external && /^(https?|mailto):/i.test(a.dataset.external)) return openUrl(a.dataset.external);
    if (a.dataset.wikilink !== undefined) await store.followLink(tab, a.dataset.wikilink, a.dataset.anchor);
  }

  onMount(() => {
    if (tab.kind !== 'md') return;
    root = host!.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${previewCss}
::highlight(${FOUND}) { background: var(--found); }`;
    body = document.createElement('article');
    body.className = 'prose';
    root.append(style, body);
    body.addEventListener('click', onClick);
    body.addEventListener('contextmenu', imageMenu);
  });

  $effect(() => {
    if (tab.kind !== 'md' || !body) return;
    tab.content;
    store.diagramLook(tab);
    store.trees[tab.vaultId];
    clearTimeout(timer);
    timer = setTimeout(render, DELAY);
  });

  // A note's own theme is scoped here, so it never reaches the app around it.
  const content = $derived(store.noteTheme(tab));
  const scoped = $derived(content === store.theme ? '' : Object.entries(themeVariables(content)).map(([k, v]) => `${k}:${v}`).join(';'));

  const htmlSrc = $derived(`${fileUrl(tab.vaultId, tab.path)}?v=${tab.version ?? tab.revision}`);
  const scripts = $derived(store.vault(tab.vaultId)?.allowScripts ?? false);
</script>

{#if tab.kind === 'md'}
  <div class="scroll" style={scoped} data-note-theme={content.id} bind:this={scroller} onscroll={publishPosition}><div bind:this={host}></div></div>
{:else if tab.kind === 'html'}
  <div class="frame">
    {#key `${htmlSrc}:${scripts}`}
      <iframe title={tab.path} src={htmlSrc} sandbox={scripts ? 'allow-scripts' : ''}></iframe>
    {/key}
    {#if !scripts}
      <p class="note">{tr('preview.scriptsOff')}</p>
    {/if}
  </div>
{:else}
  <div class="image"><img alt={tab.path} src="{fileUrl(tab.vaultId, tab.path)}?r={tab.revision}" /></div>
{/if}

<style>
  .scroll { height: 100%; overflow-y: auto; background: var(--bg); }
  .frame { display: flex; flex-direction: column; height: 100%; }
  iframe { flex: 1; min-height: 0; width: 100%; border: 0; background: #fff; }
  .note { margin: 0; padding: var(--space-1) var(--space-3); background: var(--panel); color: var(--text-3); font-size: var(--font-xs); }
  .image { display: flex; align-items: center; justify-content: center; height: 100%; padding: var(--space-6); overflow: auto; background: var(--bg); }
  .image img { max-width: 100%; max-height: 100%; }
</style>
