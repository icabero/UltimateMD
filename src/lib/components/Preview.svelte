<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { onMount } from 'svelte';
  import { api, fileUrl } from '../api';
  import { renderDiagram, toPng, toSvgBytes } from '../diagrams';
  import { renderMarkdown } from '../markdown';
  import { dirName } from '../paths';
  import { store, type Tab } from '../store.svelte';
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

  export function scrollTo(ratio: number) {
    if (scroller) scroller.scrollTop = ratio * (scroller.scrollHeight - scroller.clientHeight);
  }

  function saveDiagram(svg: SVGSVGElement, format: 'svg' | 'png', index: number) {
    return async () => {
      const name = `diagrama-${index + 1}.${format}`;
      try {
        await api.exportFile(name, format === 'svg' ? toSvgBytes(svg) : await toPng(svg));
      } catch (e) {
        store.notify(format === 'png' ? 'No se pudo generar el PNG. Prueba a exportar en SVG.' : e);
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
    const theme = store.theme;
    const blocks = [...body.querySelectorAll<HTMLElement>('.diagram')];
    await Promise.all(blocks.map(async (el, index) => {
      const src = decodeURIComponent(el.dataset.src ?? '');
      try {
        const svg = await renderDiagram(el.dataset.lang!, src, theme);
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
    const kept = body.dataset.theme === store.theme.id ? [...body.querySelectorAll<HTMLElement>('.diagram')] : [];
    const old = new Map(kept.map((e) => [`${e.dataset.lang}:${e.dataset.src}`, e]));
    body.dataset.theme = store.theme.id;
    for (const el of fragment.querySelectorAll<HTMLElement>('.diagram')) {
      const previous = old.get(`${el.dataset.lang}:${el.dataset.src}`);
      if (previous) el.innerHTML = previous.innerHTML;
    }
    body.replaceChildren(fragment);
    void hydrate(id);
  }

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
      const name = a.dataset.wikilink;
      if (await store.confirm(`La nota «${name}» no existe. ¿Crearla?`, 'Crear')) await store.createNote(tab.vaultId, dirName(tab.path), name);
    }
  }

  onMount(() => {
    if (tab.kind !== 'md') return;
    root = host!.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = previewCss;
    body = document.createElement('article');
    body.className = 'prose';
    root.append(style, body);
    body.addEventListener('click', onClick);
  });

  $effect(() => {
    if (tab.kind !== 'md' || !body) return;
    tab.content;
    store.theme;
    store.trees[tab.vaultId];
    clearTimeout(timer);
    timer = setTimeout(render, DELAY);
  });

  const htmlSrc = $derived(`${fileUrl(tab.vaultId, tab.path)}?v=${tab.version ?? tab.revision}`);
  const scripts = $derived(store.vault(tab.vaultId)?.allowScripts ?? false);
</script>

{#if tab.kind === 'md'}
  <div class="scroll" bind:this={scroller}><div bind:this={host}></div></div>
{:else if tab.kind === 'html'}
  <div class="frame">
    {#key `${htmlSrc}:${scripts}`}
      <iframe title={tab.path} src={htmlSrc} sandbox={scripts ? 'allow-scripts' : ''}></iframe>
    {/key}
    {#if !scripts}
      <p class="note">Scripts desactivados. Se activan por vault en Ajustes.</p>
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
