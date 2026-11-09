<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { onMount } from 'svelte';
  import { api, fileUrl } from '../api';
  import { parseStyle } from '../diagramStyle';
  import { renderDiagram, toPng, toSvgBytes } from '../diagrams';
  import { findTerms } from '../fold';
  import { tr } from '../i18n.svelte';
  import { renderMarkdown } from '../markdown';
  import { store, type Tab } from '../store.svelte';
  import { themeKey, themeVariables } from '../themes';
  import previewCss from '../preview.css?inline';

  let { tab }: { tab: Tab } = $props();

  const DELAY = 150;
  const MAX_ERROR = 400;
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
        await api.exportFile(name, format === 'svg' ? toSvgBytes(svg) : await toPng(svg));
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

  async function hydrate(id: number) {
    const blocks = [...body.querySelectorAll<HTMLElement>('.diagram')];
    await Promise.all(blocks.map(async (el, index) => {
      const src = decodeURIComponent(el.dataset.src ?? '');
      try {
        const { theme, sketch } = store.diagramLook(tab, parseStyle(el.dataset.style ?? ''));
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
        const pre = document.createElement('pre');
        pre.className = 'diagram-error';
        pre.textContent = (e instanceof Error ? e.message : String(e)).slice(0, MAX_ERROR);
        el.replaceChildren(pre);
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
    rendered = true;
    reveal();
    void hydrate(id);
  }

  /** Marks the words of a search and scrolls to the match nearest the line found. */
  function reveal() {
    const want = store.reveal;
    if (!rendered || !scroller || !want || want.key !== tab.key || tab.view !== 'preview') return;
    store.reveal = null;
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
    if (href.startsWith('#') && !a.dataset.wikilink) {
      e.preventDefault();
      if (href.length > 1) root.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
      return;
    }
    e.preventDefault();
    if (a.dataset.note) return store.openFile(tab.vaultId, a.dataset.note);
    if (a.dataset.external && /^(https?|mailto):/i.test(a.dataset.external)) return openUrl(a.dataset.external);
    if (a.dataset.wikilink) {
      await store.followLink(tab, a.dataset.wikilink);
    }
  }

  onMount(() => {
    if (tab.kind !== 'md') return;
    root = host!.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${previewCss}
::highlight(${FOUND}) { background: color-mix(in srgb, var(--accent) 30%, transparent); }`;
    body = document.createElement('article');
    body.className = 'prose';
    root.append(style, body);
    body.addEventListener('click', onClick);
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
  <div class="scroll" style={scoped} data-note-theme={content.id} bind:this={scroller}><div bind:this={host}></div></div>
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
  .note { margin: 0; padding: 4px 12px; background: var(--panel); color: var(--text-3); font-size: 11.5px; }
  .image { display: flex; align-items: center; justify-content: center; height: 100%; padding: 24px; overflow: auto; background: var(--bg); }
  .image img { max-width: 100%; max-height: 100%; }
</style>
