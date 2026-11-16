<script lang="ts">
  // How this note looks: its colours and its diagrams. Each setting shows whether
  // it comes from the vault or from the note, and the way to the other.
  import { renderDiagram } from '../diagrams';
  import { properties, setProperty } from '../frontmatter';
  import { themeName, tr, type Key } from '../i18n.svelte';
  import { store, type Tab } from '../store.svelte';
  import { THEMES } from '../themes';

  type Setting = { value: string; complex: boolean; set: boolean };

  let { tab }: { tab: Tab } = $props();

  const SAMPLE = 'flowchart LR\n  a[Idea] --> b{OK?}\n  b -->|✓| c[Plan]\n  b -->|✗| a';

  const data = $derived(store.vaultThemes[tab.vaultId]);
  const own = $derived(data?.themes ?? []);
  const fields = $derived(properties(tab.content));

  const setting = (key: string): Setting => {
    const found = fields.find((p) => p.key === key);
    return { value: found?.value ?? '', complex: found?.complex ?? false, set: !!found?.value };
  };
  const theme = $derived(setting('tema'));
  const diagram = $derived(setting('tema-diagramas'));

  function themeLabel(id: string) {
    if (id === 'boceto') return tr('noteStyle.sketch');
    const file = own.find((t) => t.id === id);
    if (file) return file.name;
    const built = THEMES.find((t) => t.id === id);
    return built ? themeName(built) : id;
  }

  const vaultTheme = $derived(data?.defaultTheme ? themeLabel(data.defaultTheme) : tr('noteLook.appTheme'));
  const vaultDiagram = $derived(data?.defaultDiagramTheme ? themeLabel(data.defaultDiagramTheme) : tr('noteLook.sameColors'));
  // What "change only in this note" starts from: the value the note has now, written down.
  const themeNow = $derived(store.noteTheme(tab).id);
  const diagramNow = $derived(data?.defaultDiagramTheme || themeNow);

  function commit(key: string, value: string) {
    const next = setProperty(tab.content, key, value);
    if (next !== tab.content) store.edit(tab, next);
  }

  // The preview is the sample diagram as this note would draw it.
  let sample = $state('');
  let drawn = 0;
  $effect(() => {
    const { theme: colors, sketch } = store.diagramLook(tab);
    const id = ++drawn;
    renderDiagram('mermaid', SAMPLE, colors, sketch).then(
      (svg) => id === drawn && (sample = svg),
      () => id === drawn && (sample = ''),
    );
  });
</script>

{#snippet options(diagrams: boolean)}
  {#if diagrams}<option value="boceto">{tr('noteStyle.sketch')}</option>{/if}
  {#if own.length}
    <optgroup label={tr('themes.fromVault')}>
      {#each own as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
    </optgroup>
  {/if}
  <optgroup label={tr('themes.included')}>
    {#each THEMES as t (t.id)}<option value={t.id}>{themeName(t)}</option>{/each}
  </optgroup>
{/snippet}

{#snippet field(key: string, label: Key, hint: Key, now: Setting, inherited: string, start: string, diagrams: boolean, section: 'look' | 'diagrams')}
  {@const id = `look-${key}`}
  <div class="field" data-setting={key === 'tema' ? 'note.theme' : 'note.diagramTheme'}>
    <label class="name" for={id}>{tr(label)}</label>
    {#if now.complex}
      <span class="complex">{tr('props.complex')}</span>
    {:else if tab.loose || now.set}
      <select {id} aria-describedby="{id}-hint" value={now.value || start} onchange={(e) => commit(key, e.currentTarget.value)}>
        {@render options(diagrams)}
        {#if now.value && now.value !== 'boceto' && !THEMES.some((t) => t.id === now.value) && !own.some((t) => t.id === now.value)}
          <option value={now.value}>{tr('props.unknownTheme', { id: now.value })}</option>
        {/if}
      </select>
    {/if}
    <span class="hint" id="{id}-hint">{tr(hint)}</span>
    {#if !tab.loose && !now.complex}
      <span class="origin">
        {#if now.set}
          {tr('noteLook.own')} ·
          <button type="button" class="link" onclick={() => commit(key, '')}>{tr('noteLook.back')}</button>
        {:else}
          {tr('noteLook.fromVault', { value: inherited })} ·
          <button type="button" class="link" onclick={() => commit(key, start)}>{tr('noteLook.changeHere')}</button>
        {/if}
        · <button type="button" class="link" onclick={() => store.openVaultSettings(tab.vaultId, section)}>{tr('vaultSettings.open')}</button>
      </span>
    {/if}
  </div>
{/snippet}

<section class="look" aria-label={tr('noteLook.title')}>
  <h3>{tr('noteLook.title')}</h3>
  {@render field('tema', 'props.theme', 'props.themeHint', theme, vaultTheme, themeNow, false, 'look')}
  {@render field('tema-diagramas', 'props.diagramTheme', 'props.diagramThemeHint', diagram, vaultDiagram, diagramNow, true, 'diagrams')}
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- renderDiagram sanitizes the SVG -->
  <div class="preview" role="img" aria-label={tr('noteLook.preview')}>{@html sample}</div>
  <p class="hint">{tr('noteStyle.help')}</p>
  {#if !tab.loose}<button type="button" class="text" onclick={() => store.openVaultSettings(tab.vaultId, 'look')}>{tr('noteStyle.ownColors')}</button>{/if}
</section>

<style>
  .look { display: flex; flex-direction: column; gap: var(--space-3); }
  .field { display: flex; flex-direction: column; gap: var(--space-1); }
  .name { color: var(--text-2); font-size: var(--font-sm); font-weight: 600; }
  select { width: 100%; height: 30px; padding: 0 var(--space-1-5); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--bg); color: var(--text); font-size: var(--font-md); }
  .hint { margin: 0; color: var(--text-3); font-size: var(--font-xs); line-height: 1.4; }
  .origin { color: var(--text-2); font-size: var(--font-xs); line-height: 1.5; }
  .complex { color: var(--text-3); font-size: var(--font-sm); font-style: italic; }
  .link { padding: 0; border: 0; background: none; color: var(--accent-text); font-size: inherit; }
  .link:hover { text-decoration: underline; }
  h3 { margin: var(--space-2) 0 0; color: var(--text-3); font-size: var(--font-xs); font-weight: 600; letter-spacing: .02em; text-transform: uppercase; }
  .preview { padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--bg); overflow: hidden; }
  .preview :global(svg) { display: block; max-width: 100%; height: auto; margin: 0 auto; }
  .text { align-self: flex-start; height: 30px; padding: 0 var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--raised); color: var(--text); font-size: var(--font-sm); }
  .text:hover { background: var(--hover); }
</style>
