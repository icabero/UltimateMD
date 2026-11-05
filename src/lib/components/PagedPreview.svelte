<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { DocxPreview } from '../api';

  let { preview }: { preview: DocxPreview } = $props();

  const PT_TO_PX = 96 / 72;
  const PAGE_GAP = 12;
  const CSS = `
    :host { display: block; }
    .page { position: relative; box-sizing: border-box; margin: 0 auto ${PAGE_GAP}px; overflow: hidden; background: #fff; color: #000; box-shadow: 0 1px 4px rgb(0 0 0 / 30%); }
    .body { position: absolute; overflow: hidden; }
    .furniture { position: absolute; left: 0; right: 0; }
    p { margin: 0; overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 2pt 4pt; border: .5pt solid #999; vertical-align: top; }
    img { max-width: 100%; }
    .measure { visibility: hidden; position: absolute; left: -99999px; top: 0; }
  `;

  let host: HTMLDivElement;
  let root: ShadowRoot;
  let pane = $state(0);

  const px = (pt: number) => pt * PT_TO_PX;

  function newPage(number: number) {
    const { width, height, top, right, bottom, left, header, footer, titlePage } = preview;
    const page = document.createElement('div');
    page.className = 'page';
    page.style.cssText = `width:${px(width)}px;height:${px(height)}px`;
    if (!(titlePage && number === 1)) {
      const head = document.createElement('div');
      head.className = 'furniture';
      head.style.cssText = `top:${px(top) / 2.4}px;padding:0 ${px(right)}px 0 ${px(left)}px`;
      head.innerHTML = header;
      const foot = document.createElement('div');
      foot.className = 'furniture';
      foot.style.cssText = `bottom:${px(bottom) / 2.4}px;padding:0 ${px(right)}px 0 ${px(left)}px`;
      foot.innerHTML = footer;
      for (const mark of foot.querySelectorAll('.page-number')) mark.textContent = String(number);
      page.append(head, foot);
    }
    const body = document.createElement('div');
    body.className = 'body';
    body.style.cssText = `top:${px(top)}px;left:${px(left)}px;right:${px(right)}px;bottom:${px(bottom)}px`;
    page.append(body);
    return { page, body };
  }

  /** Fills pages block by block, as the blocks are measured to be tall. */
  function layout() {
    root.replaceChildren();
    const style = document.createElement('style');
    style.textContent = CSS;
    const scale = document.createElement('div');
    scale.style.zoom = String(pane / px(preview.width));
    root.append(style, scale);

    let number = 1;
    let { page, body } = newPage(number);
    scale.append(page);
    for (const block of preview.blocks) {
      if (block.breakBefore && body.childElementCount) {
        ({ page, body } = newPage(++number));
        scale.append(page);
      }
      if (!block.html) continue;
      const holder = document.createElement('div');
      holder.innerHTML = block.html;
      body.append(holder);
      if (body.scrollHeight > body.clientHeight && body.childElementCount > 1) {
        holder.remove();
        ({ page, body } = newPage(++number));
        scale.append(page);
        body.append(holder);
      }
    }
  }

  onMount(() => {
    root = host.attachShadow({ mode: 'open' });
    const observer = new ResizeObserver(([entry]) => {
      // Deferred, so that laying out never happens inside the observer's own pass.
      requestAnimationFrame(() => (pane = entry.contentRect.width));
    });
    observer.observe(host);
    return () => observer.disconnect();
  });

  $effect(() => {
    preview;
    if (pane) void tick().then(layout);
  });
</script>

<div class="paged" bind:this={host}></div>

<style>
  .paged { width: 100%; }
</style>
