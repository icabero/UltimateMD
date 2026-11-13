<script lang="ts">
  // How a vault's diagrams look, as a part of its settings screen: the theme
  // the app draws them with, and the guide an AI reads over MCP before drawing
  // one. The guide saves itself as it is written, like a note.
  import { onDestroy, onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { api } from '../api';
  import { guideDraft } from '../diagramGuide';
  import { renderDiagram } from '../diagrams';
  import { themeName, tr } from '../i18n.svelte';
  import { THEMES } from '../themes';
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
  const data = $derived(store.vaultThemes[vaultId]);

  async function setTheme(id: string) {
    await api.setVaultDiagramTheme(vaultId, id || null).catch((e) => store.fail(e));
    await store.loadVaultThemes(vaultId);
  }

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

  onDestroy(() => {
    if (!saved) void save();
  });
</script>

<div class="diagrams">
  <div class="edit">
    <p>{tr('diagrams.intro')}</p>
    <label class="theme">{tr('themes.vaultDiagrams')}
      <select value={data?.defaultDiagramTheme ?? ''} onchange={(e) => setTheme(e.currentTarget.value)}>
        <option value="">{tr('noteStyle.inheritNote')}</option>
        <option value="boceto">{tr('noteStyle.sketch')}</option>
        {#if data?.themes.length}
          <optgroup label={tr('themes.fromVault')}>
            {#each data.themes as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
          </optgroup>
        {/if}
        <optgroup label={tr('themes.included')}>
          {#each THEMES as t (t.id)}<option value={t.id}>{themeName(t)}</option>{/each}
        </optgroup>
      </select>
    </label>
    <p class="hint">{tr('diagrams.themeHint')}</p>

    <h3>{tr('guide.open')}</h3>
    <p>{tr('guide.intro')}</p>
    {#if vault?.mcp === 'off'}
      <p class="warn" role="status">{tr('guide.mcpOff')} <button class="link" onclick={() => store.openVaultSettings(vaultId, 'ai')}>{tr('guide.giveAccess')}</button></p>
    {/if}
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
  .diagrams { display: grid; grid-template-columns: 1fr 280px; height: 100%; min-height: 0; }
  .edit { display: flex; flex-direction: column; gap: var(--space-2); min-height: 0; padding: 0 var(--space-5) var(--space-4) 0; overflow-y: auto; }
  h3 { margin: var(--space-3) 0 0; font-size: var(--font-sm); font-weight: 650; }
  .aside h3 { margin: var(--space-2) 0; }
  .theme { display: flex; align-items: center; gap: var(--space-2); color: var(--text-2); font-size: var(--font-sm); }
  select { padding: var(--space-1) var(--space-1-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); color: var(--text); font: inherit; }
  .link { padding: 0; border: 0; background: none; color: var(--accent-text); font-size: var(--font-sm); }
  .link:hover { text-decoration: underline; }
  p { margin: 0; color: var(--text-2); font-size: var(--font-sm); line-height: 1.5; }
  .warn { color: var(--warn); }
  textarea { flex: 1; min-height: 180px; padding: var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); color: var(--text); font: var(--font-md)/1.55 var(--mono); resize: none; }
  .bar { display: flex; align-items: center; gap: var(--space-1-5); }
  .plain { display: flex; align-items: center; gap: var(--space-1-5); padding: var(--space-1) var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: none; color: var(--text); font-size: var(--font-sm); }
  .plain:hover { background: var(--hover); }
  .status { margin-left: auto; color: var(--text-2); font-size: var(--font-sm); }
  .hint { color: var(--text-2); font-size: var(--font-xs); }
  .aside { display: flex; flex-direction: column; gap: var(--space-2); min-height: 0; padding: var(--space-3) var(--space-4); overflow: auto; border-left: 1px solid var(--line); background: var(--panel); }
  .sample { display: flex; justify-content: center; padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); }
  .sample :global(svg) { max-width: 100%; height: auto; }
</style>
