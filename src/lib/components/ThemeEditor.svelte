<script lang="ts">
  import { dim, pop } from '../motion';
  import Icon from './Icon.svelte';
  import { api, type ThemeFile } from '../api';
  import { themeName, tr, type Key } from '../i18n.svelte';
  import { store } from '../store.svelte';
  import { THEMES, contrast, diagramColors, resolveTheme, type Theme } from '../themes';

  let { vaultId }: { vaultId: string } = $props();

  type ColorKey = keyof Theme['colors'];

  const FIELDS: { key: ColorKey; label: Key }[] = [
    { key: 'bg', label: 'themes.fieldBg' },
    { key: 'panel', label: 'themes.fieldPanel' },
    { key: 'line', label: 'themes.fieldLine' },
    { key: 'text', label: 'themes.fieldText' },
    { key: 'text2', label: 'themes.fieldText2' },
    { key: 'accent', label: 'themes.fieldAccent' },
    { key: 'accentText', label: 'themes.fieldLinks' },
  ];
  const DIAGRAM_FIELDS: { key: keyof Theme['diagram']; label: Key }[] = [
    { key: 'surface', label: 'themes.fieldNodes' },
    { key: 'border', label: 'themes.fieldBorders' },
    { key: 'line', label: 'themes.fieldDiagramLine' },
    { key: 'text', label: 'themes.fieldDiagramText' },
  ];
  const AA = 4.5;

  let selected = $state<string | null>(null);
  let draft = $state<ThemeFile | null>(null);
  let json = $state<string | null>(null);

  const vaultName = $derived(store.vault(vaultId)?.name ?? '');
  const data = $derived(store.vaultThemes[vaultId]);
  const themes = $derived(data?.themes ?? []);
  const look = $derived(draft ? resolveTheme(draft) : null);
  const warnings = $derived.by(() => {
    if (!look) return [];
    const { bg, text, text2, accentText } = look.colors;
    const pairs: [string, string][] = [[tr('themes.warnText'), text], [tr('themes.warnText2'), text2], [tr('themes.warnLinks'), accentText]];
    return pairs.filter(([, color]) => contrast(color, bg) < AA).map(([name]) => name);
  });

  function pick(theme: ThemeFile) {
    selected = theme.id;
    draft = $state.snapshot(theme);
    json = null;
  }

  const slug = (name: string) =>
    name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  async function create() {
    const name = (await store.prompt(tr('themes.name'), '', tr('common.create')))?.trim();
    if (!name) return;
    const id = slug(name);
    if (!id || themes.some((t) => t.id === id)) return store.notify(tr('themes.exists'));
    draft = { id, name, base: store.theme.mode === 'dark' ? 'oscuro' : 'claro', colors: {}, diagram: {} };
    selected = id;
    json = null;
  }

  function parseJson() {
    if (json === null) return draft;
    try {
      return JSON.parse(json) as ThemeFile;
    } catch {
      store.notify(tr('themes.badJson'));
      return null;
    }
  }

  async function save() {
    const theme = parseJson();
    if (!theme) return;
    try {
      await api.saveVaultTheme(vaultId, theme);
      await store.loadVaultThemes(vaultId);
      draft = theme;
      selected = theme.id;
      store.notify(tr('themes.saved'));
    } catch (e) {
      store.notify(e);
    }
  }

  async function remove() {
    if (!draft || !(await store.confirm(tr('themes.deleteConfirm', { name: draft.name }), tr('common.delete'), true))) return;
    await api.deleteVaultTheme(vaultId, draft.id).catch((e) => store.notify(e));
    await store.loadVaultThemes(vaultId);
    draft = selected = null;
  }

  async function setDiagramDefault(id: string) {
    await api.setVaultDiagramTheme(vaultId, id || null).catch((e) => store.notify(e));
    await store.loadVaultThemes(vaultId);
  }

  async function setDefault(id: string) {
    await api.setVaultDefaultTheme(vaultId, id || null).catch((e) => store.notify(e));
    await store.loadVaultThemes(vaultId);
  }

  function setColor(key: ColorKey, value: string) {
    if (draft) draft.colors[key] = value;
  }

  function setDiagramColor(key: keyof Theme['diagram'], value: string) {
    if (draft) draft.diagram[key] = value;
  }
</script>

<button in:dim class="scrim top" aria-label={tr('common.close')} onclick={() => (store.themeEditor = null)}></button>
<div in:pop class="modal" role="dialog" aria-label={tr('themes.of', { name: vaultName })}>
  <header>
    <h2>{tr('themes.of', { name: vaultName })}</h2>
    <button class="icon" title={tr('common.close')} onclick={() => (store.themeEditor = null)}><Icon name="close" /></button>
  </header>

  <label class="default">{tr('themes.vaultDefault')}
    <select value={data?.defaultTheme ?? ''} onchange={(e) => setDefault(e.currentTarget.value)}>
      <option value="">{tr('themes.appDefault')}</option>
      <optgroup label={tr('themes.fromVault')}>
        {#each themes as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
      </optgroup>
      <optgroup label={tr('themes.included')}>
        {#each THEMES as t (t.id)}<option value={t.id}>{themeName(t)}</option>{/each}
      </optgroup>
    </select>
  </label>

  <label class="default">{tr('themes.vaultDiagrams')}
    <select value={data?.defaultDiagramTheme ?? ''} onchange={(e) => setDiagramDefault(e.currentTarget.value)}>
      <option value="">{tr('noteStyle.inheritNote')}</option>
      <option value="boceto">{tr('noteStyle.sketch')}</option>
      <optgroup label={tr('themes.fromVault')}>
        {#each themes as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
      </optgroup>
      <optgroup label={tr('themes.included')}>
        {#each THEMES as t (t.id)}<option value={t.id}>{themeName(t)}</option>{/each}
      </optgroup>
    </select>
  </label>

  <div class="columns">
    <nav>
      {#each themes as t (t.id)}
        <button class:on={selected === t.id} onclick={() => pick(t)}>{t.name}</button>
      {/each}
      <button class="new" onclick={create}><Icon name="plus" size={13} /> {tr('themes.new')}</button>
    </nav>

    {#if draft && look}
      <div class="form">
        {#if json === null}
          <label class="row">{tr('themes.base')}
            <select bind:value={draft.base}>
              {#each THEMES as t}<option value={t.id}>{themeName(t)}</option>{/each}
            </select>
          </label>
          <label class="row">{tr('themes.reading')}
            <select bind:value={draft.prose}>
              <option value={undefined}>{tr('themes.likeBase')}</option>
              <option value="serif">Serif</option>
              <option value="sans">Sans</option>
            </select>
          </label>
          <h3>{tr('themes.colors')}</h3>
          <div class="grid">
            {#each FIELDS as f}
              <label class="color">{tr(f.label)}<input type="color" value={look.colors[f.key]} oninput={(e) => setColor(f.key, e.currentTarget.value)} /></label>
            {/each}
          </div>
          <h3>{tr('themes.diagrams')}</h3>
          <div class="grid">
            {#each DIAGRAM_FIELDS as f}
              <label class="color">{tr(f.label)}<input type="color" value={diagramColors(look)[f.key]} oninput={(e) => setDiagramColor(f.key, e.currentTarget.value)} /></label>
            {/each}
          </div>
          <div class="sample" style:background={look.colors.bg} style:color={look.colors.text}>
            <strong>{tr('themes.sampleTitle')}</strong>{tr('themes.sampleOf')}<span style:color={look.colors.text2}>{tr('themes.sampleSecondary')}</span>{tr('themes.sampleAnd')}<span style:color={look.colors.accentText}>{tr('themes.sampleLink')}</span>{tr('themes.sampleEnd')}
            <div class="node" style:background={look.diagram.surface} style:border-color={look.diagram.border}>{tr('themes.sampleNode')}</div>
          </div>
          {#if warnings.length}
            <p class="warn" role="alert">{tr('themes.lowContrast', { list: warnings.join(', ') })}</p>
          {/if}
        {:else}
          <textarea aria-label={tr('themes.jsonLabel')} spellcheck="false" bind:value={json}></textarea>
        {/if}
        <div class="actions">
          <button onclick={() => (json = json === null ? JSON.stringify(draft, null, 2) : null)}>{tr(json === null ? 'themes.editJson' : 'themes.editControls')}</button>
          <span class="spacer"></span>
          {#if themes.some((t) => t.id === draft?.id)}<button onclick={remove}>{tr('common.delete')}</button>{/if}
          <button class="main" onclick={save}>{tr('common.save')}</button>
        </div>
      </div>
    {:else}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- our own translation, with markup -->
      <p class="empty">{@html tr('themes.empty')}</p>
    {/if}
  </div>
</div>

<style>
  .top { z-index: var(--z-nested-scrim); }
  .modal { position: fixed; top: 50%; left: 50%; z-index: var(--z-nested); width: min(680px, calc(100vw - 32px)); max-height: calc(100vh - 48px); padding: var(--space-2) var(--space-5) var(--space-4); overflow-y: auto; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translate(-50%, -50%); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: var(--space-2) 0; font-size: var(--font-lg); font-weight: 650; }
  h3 { margin: var(--space-3-5) 0 var(--space-1-5); font-size: var(--font-sm); font-weight: 650; }
  label { color: var(--text-2); font-size: var(--font-sm); }
  select { padding: var(--space-1) var(--space-1-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); color: var(--text); font: inherit; }
  .default { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }
  .columns { display: grid; grid-template-columns: 150px 1fr; gap: var(--space-4); }
  nav { display: flex; flex-direction: column; gap: var(--space-0-5); }
  nav button { display: flex; align-items: center; gap: var(--space-1-5); padding: var(--space-1-5) var(--space-2); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-2); font-size: var(--font-sm); text-align: left; }
  nav button:hover { background: var(--hover); color: var(--text); }
  nav .on { background: var(--accent-soft); color: var(--accent-text); }
  .row { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-1-5); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--space-1-5) var(--space-3); }
  .color { display: flex; align-items: center; justify-content: space-between; }
  input[type='color'] { width: 30px; height: 22px; padding: 0; border: 1px solid var(--line); border-radius: var(--radius-xs); background: none; }
  .sample { margin-top: var(--space-3); padding: var(--space-2-5) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); font-size: var(--font-md); }
  .node { display: inline-block; margin-top: var(--space-2); padding: var(--space-1) var(--space-2-5); border: 1px solid; border-radius: var(--radius-sm); font-size: var(--font-sm); }
  .warn { margin: var(--space-2) 0 0; color: var(--danger); font-size: var(--font-sm); }
  textarea { width: 100%; height: 260px; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--bg); color: var(--text); font: var(--font-sm)/1.5 var(--mono); resize: vertical; user-select: text; }
  .actions { display: flex; gap: var(--space-1-5); margin-top: var(--space-3); }
  .actions button { padding: var(--space-1) var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: none; color: var(--text-2); font-size: var(--font-sm); }
  .actions .main { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
  .spacer { flex: 1; }
  .empty { margin: 0; color: var(--text-2); font-size: var(--font-sm); line-height: 1.5; }
  .empty :global(code) { font: var(--font-xs) var(--mono); }
</style>
