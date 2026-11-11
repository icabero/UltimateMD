<script lang="ts">
  // A vault's guide for the diagrams an AI draws over MCP. It saves itself as
  // it is written, like a note.
  import { dim, pop } from '../motion';
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { api } from '../api';
  import { guideDraft } from '../diagramGuide';
  import { renderDiagram } from '../diagrams';
  import { tr } from '../i18n.svelte';
  import { store } from '../store.svelte';

  let { vaultId }: { vaultId: string } = $props();

  const DELAY = 600;
  const SAMPLE = 'flowchart LR\n  a[Idea] --> b{OK?}\n  b -->|✓| c[Plan]\n  b -->|✗| a';

  let text = $state('');
  let loaded = $state(false);
  let saved = $state(true);
  let error = $state('');
  let sample = $state('');
  let timer: ReturnType<typeof setTimeout>;

  const vault = $derived(store.vault(vaultId));
  const look = $derived(store.vaultDiagramLook(vaultId));

  onMount(() => {
    api.diagramGuide(vaultId).then(
      (guide) => {
        text = guide ?? '';
        loaded = true;
      },
      (e) => (error = String(e)),
    );
  });

  $effect(() => {
    const { theme, sketch } = look;
    renderDiagram('mermaid', SAMPLE, theme, sketch).then((svg) => (sample = svg), () => (sample = ''));
  });

  async function save() {
    clearTimeout(timer);
    try {
      await api.saveDiagramGuide(vaultId, text);
      saved = true;
      error = '';
    } catch (e) {
      error = String(e);
    }
  }

  function edited() {
    saved = false;
    clearTimeout(timer);
    timer = setTimeout(save, DELAY);
  }

  async function fromStyle() {
    if (text.trim() && !(await store.confirm(tr('guide.replaceDraft'), tr('guide.fromStyle')))) return;
    text = guideDraft(vault?.name ?? '', look);
    await save();
  }

  async function close() {
    if (!saved) await save();
    store.guideScreen = null;
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && !store.dialog) void close(); }} />

<button in:dim class="scrim top" aria-label={tr('common.close')} onclick={close}></button>
<div in:pop class="modal" role="dialog" aria-label={tr('guide.title', { name: vault?.name ?? '' })}>
  <div class="edit">
    <header>
      <h2>{tr('guide.title', { name: vault?.name ?? '' })}</h2>
      <button class="icon" title={tr('common.close')} onclick={close}><Icon name="close" /></button>
    </header>
    <p>{tr('guide.intro')}</p>
    {#if vault?.mcp === 'off'}<p class="warn" role="status">{tr('guide.mcpOff')}</p>{/if}
    <textarea aria-label={tr('guide.title', { name: vault?.name ?? '' })} placeholder={tr('guide.placeholder')} disabled={!loaded}
      bind:value={text} oninput={edited} spellcheck="true"></textarea>
    <div class="bar">
      <button class="plain" onclick={fromStyle} disabled={!loaded}><Icon name="diagram" size={14} /> {tr('guide.fromStyle')}</button>
      {#if text.trim()}<button class="plain" onclick={() => { text = ''; void save(); }}>{tr('common.remove')}</button>{/if}
      <span class="status" role="status">{error || (saved && text.trim() ? tr('app.statusSaved') : '')}</span>
    </div>
    <p class="hint">{tr('guide.where')}</p>
  </div>
  <div class="aside" role="region" aria-label={tr('guide.sample')}>
    <h3>{tr('guide.sample')}</h3>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- renderDiagram sanitizes the SVG -->
    <div class="sample">{@html sample}</div>
    <p class="hint">{tr('guide.perNote')}</p>
  </div>
</div>

<style>
  .top { z-index: var(--z-nested-scrim); }
  .modal { position: fixed; top: 50%; left: 50%; z-index: var(--z-nested); display: grid; grid-template-columns: 1fr 300px; width: min(960px, calc(100vw - 32px)); height: min(640px, calc(100vh - 32px)); overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translate(-50%, -50%); }
  .edit { display: flex; flex-direction: column; gap: var(--space-2); min-height: 0; padding: var(--space-2) var(--space-5) var(--space-4); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: var(--space-2) 0 0; font-size: var(--font-lg); font-weight: 650; }
  h3 { margin: var(--space-2) 0; font-size: var(--font-sm); font-weight: 650; }
  p { margin: 0; color: var(--text-2); font-size: var(--font-sm); line-height: 1.5; }
  .warn { color: var(--warn); }
  textarea { flex: 1; min-height: 0; padding: var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); color: var(--text); font: var(--font-md)/1.55 var(--mono); resize: none; }
  .bar { display: flex; align-items: center; gap: var(--space-1-5); }
  .plain { display: flex; align-items: center; gap: var(--space-1-5); padding: var(--space-1) var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: none; color: var(--text); font-size: var(--font-sm); }
  .plain:hover { background: var(--hover); }
  .status { margin-left: auto; color: var(--text-2); font-size: var(--font-sm); }
  .hint { color: var(--text-2); font-size: var(--font-xs); }
  .aside { display: flex; flex-direction: column; gap: var(--space-2); min-height: 0; padding: var(--space-3) var(--space-4); overflow: auto; border-left: 1px solid var(--line); background: var(--panel); }
  .sample { display: flex; justify-content: center; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); }
  .sample :global(svg) { max-width: 100%; height: auto; }
</style>
