<script lang="ts">
  // The drawing of the diagram being typed, in a small window next to its code.
  // It never takes the focus and never covers the line with the cursor.
  import Icon from './Icon.svelte';
  import { describeProblem, explainDiagramError, type DiagramProblem } from '../diagramErrors';
  import { renderDiagram } from '../diagrams';
  import { tr } from '../i18n.svelte';
  import { store, type Tab } from '../store.svelte';
  import type { DiagramStyle } from '../diagramStyle';

  export interface Box {
    top: number;
    bottom: number;
    left: number;
    right: number;
  }

  let {
    tab, lang, source, style, anchor, caret, area, pinned = $bindable(), onclose,
  }: {
    tab: Tab;
    lang: string;
    source: string;
    style: DiagramStyle;
    /** The block of code, and the line with the cursor, in the editor's own coordinates. */
    anchor: Box;
    caret: Box;
    /** The size of the editor. */
    area: { width: number; height: number };
    pinned: boolean;
    onclose: () => void;
  } = $props();

  const DELAY = 300;
  const MARGIN = 8;
  const GAP = 10;

  let svg = $state('');
  let error = $state<DiagramProblem | null>(null);
  let drawing = $state(false);
  let collapsed = $state(false);
  let width = $state(0);
  let height = $state(0);
  let timer: ReturnType<typeof setTimeout>;
  let run = 0;

  const blank = $derived(!source.trim());
  const look = $derived(store.diagramLook(tab, style));

  // Typing never waits for the drawing: it is asked for after a pause, and an
  // answer that comes late is dropped. While the code is broken the last good
  // drawing stays, with the reason below it.
  $effect(() => {
    const [text, language, { theme, sketch }] = [source, lang, look];
    clearTimeout(timer);
    if (!text.trim()) {
      run++;
      error = null;
      drawing = false;
      return;
    }
    timer = setTimeout(async () => {
      const id = ++run;
      drawing = true;
      try {
        const drawn = await renderDiagram(language, text, theme, sketch);
        if (id !== run) return;
        svg = drawn;
        error = null;
      } catch (e) {
        if (id === run) error = explainDiagramError(language, text, e);
      }
      if (id === run) drawing = false;
    }, svg ? DELAY : 0);
    return () => clearTimeout(timer);
  });

  const fits = (top: number, left: number) => top >= MARGIN && left >= MARGIN && top + height <= area.height - MARGIN && left + width <= area.width - MARGIN;
  const overlapsCaret = (top: number, left: number) =>
    top < caret.bottom + 2 && top + height > caret.top - 2 && left < caret.right + GAP && left + width > caret.left - GAP;
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, Math.max(min, max)));

  /** Right of the code when there is room, else below, else above; the corners when nothing fits. */
  const place = $derived.by(() => {
    const w = width;
    const h = height;
    const corner = (bottom: boolean) => ({ top: bottom ? area.height - h - MARGIN : MARGIN, left: area.width - w - MARGIN });
    const tries: { top: number; left: number }[] = [];
    if (!pinned) {
      const top = clamp(anchor.top, MARGIN, area.height - h - MARGIN);
      tries.push({ top, left: anchor.right + GAP });
      tries.push({ top: anchor.bottom + GAP, left: clamp(anchor.left, MARGIN, area.width - w - MARGIN) });
      tries.push({ top: anchor.top - GAP - h, left: clamp(anchor.left, MARGIN, area.width - w - MARGIN) });
    }
    tries.push(corner(true), corner(false));
    const roomy = tries.find((t) => fits(t.top, t.left) && !overlapsCaret(t.top, t.left));
    const free = roomy ?? tries.find((t) => !overlapsCaret(t.top, t.left)) ?? tries[tries.length - 1];
    return { top: clamp(free.top, MARGIN, area.height - h - MARGIN), left: clamp(free.left, MARGIN, area.width - w - MARGIN) };
  });

  // Buttons must not take the focus from the text.
  const keepFocus = (e: MouseEvent) => e.preventDefault();
</script>

<section class="peek" class:collapsed style:top="{place.top}px" style:left="{place.left}px" aria-label={tr('peek.title')} bind:clientWidth={width} bind:clientHeight={height}>
  <header>
    <span class="title">{tr('peek.title')}</span>
    <button class="icon small" class:on={pinned} title={tr(pinned ? 'peek.unpin' : 'peek.pin')} aria-label={tr(pinned ? 'peek.unpin' : 'peek.pin')} aria-pressed={pinned} onmousedown={keepFocus} onclick={() => (pinned = !pinned)}><Icon name="pin" size={14} /></button>
    <button class="icon small" title={tr(collapsed ? 'peek.expand' : 'peek.collapse')} aria-label={tr(collapsed ? 'peek.expand' : 'peek.collapse')} aria-expanded={!collapsed} onmousedown={keepFocus} onclick={() => (collapsed = !collapsed)}><span class="fold" class:open={!collapsed}><Icon name="chevron" size={14} /></span></button>
    <button class="icon small" title={tr('peek.close')} aria-label={tr('peek.close')} onmousedown={keepFocus} onclick={onclose}><Icon name="close" size={14} /></button>
  </header>
  <div class="body" hidden={collapsed}>
    {#if blank}
      <p class="muted">{tr('peek.empty')}</p>
    {:else if svg}
      <div class="drawing" class:stale={!!error}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- renderDiagram sanitizes the SVG -->
        {@html svg}
      </div>
    {:else if drawing || !error}
      <p class="muted" role="status">{tr('peek.drawing')}</p>
    {/if}
    {#if error && !blank}
      <p class="problem" role="alert">
        <strong>{describeProblem(error)}</strong>
        {#if svg}<span>{tr('peek.lastGood')}</span>{/if}
      </p>
    {/if}
  </div>
</section>

<style>
  .peek { position: absolute; z-index: var(--z-raised); display: flex; flex-direction: column; max-width: calc(100% - 16px); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--raised); box-shadow: var(--shadow-lg); user-select: none; }
  header { display: flex; align-items: center; gap: var(--space-0-5); padding: var(--space-0-5) var(--space-1) var(--space-0-5) var(--space-2-5); border-bottom: 1px solid var(--line); }
  .collapsed header { border-bottom: 0; }
  .title { flex: 1; min-width: 0; overflow: hidden; color: var(--text-2); font-size: var(--font-xs); text-overflow: ellipsis; white-space: nowrap; }
  .small { width: 24px; height: 24px; }
  .on { background: var(--accent-soft); color: var(--accent-text); }
  .fold { display: inline-flex; transform: rotate(0deg); transition: transform var(--ease); }
  .fold.open { transform: rotate(90deg); }
  .body { box-sizing: border-box; width: 340px; min-width: 220px; max-width: 100%; height: 200px; min-height: 90px; max-height: 80vh; padding: var(--space-2); overflow: auto; resize: both; }
  .body[hidden] { display: none; }
  .drawing { display: flex; justify-content: center; }
  .drawing.stale { opacity: 0.55; }
  .drawing :global(svg) { max-width: 100%; height: auto; }
  .muted { margin: 0; color: var(--text-3); font-size: var(--font-sm); }
  .problem { display: flex; flex-direction: column; gap: var(--space-0-5); margin: var(--space-2) 0 0; padding: var(--space-1-5) var(--space-2); border-left: 2px solid var(--danger); background: var(--hover); color: var(--text); font-size: var(--font-sm); user-select: text; }
  .problem span { color: var(--text-2); font-size: var(--font-xs); }
</style>
