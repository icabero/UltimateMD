<script lang="ts">
  import Icon from './Icon.svelte';
  import { api, type ThemeFile } from '../api';
  import { store } from '../store.svelte';
  import { THEMES, contrast, resolveTheme, type Theme } from '../themes';

  let { vaultId }: { vaultId: string } = $props();

  type ColorKey = keyof Theme['colors'];

  const FIELDS: { key: ColorKey; label: string }[] = [
    { key: 'bg', label: 'Fondo' },
    { key: 'panel', label: 'Bloques' },
    { key: 'line', label: 'Líneas' },
    { key: 'text', label: 'Texto' },
    { key: 'text2', label: 'Secundario' },
    { key: 'accent', label: 'Acento' },
    { key: 'accentText', label: 'Enlaces' },
  ];
  const DIAGRAM_FIELDS: { key: keyof Theme['diagram']; label: string }[] = [
    { key: 'surface', label: 'Nodos' },
    { key: 'border', label: 'Bordes' },
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
    const pairs: [string, string][] = [['el texto', text], ['el texto secundario', text2], ['los enlaces', accentText]];
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
    const name = (await store.prompt('Nombre del tema', '', 'Crear'))?.trim();
    if (!name) return;
    const id = slug(name);
    if (!id || themes.some((t) => t.id === id)) return store.notify('Ya existe un tema con ese nombre');
    draft = { id, name, base: store.theme.mode === 'dark' ? 'oscuro' : 'claro', colors: {}, diagram: {} };
    selected = id;
    json = null;
  }

  function parseJson() {
    if (json === null) return draft;
    try {
      return JSON.parse(json) as ThemeFile;
    } catch {
      store.notify('El JSON no es válido');
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
      store.notify('Tema guardado');
    } catch (e) {
      store.notify(e);
    }
  }

  async function remove() {
    if (!draft || !(await store.confirm(`¿Eliminar el tema «${draft.name}»?`, 'Eliminar', true))) return;
    await api.deleteVaultTheme(vaultId, draft.id).catch((e) => store.notify(e));
    await store.loadVaultThemes(vaultId);
    draft = selected = null;
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

<button class="scrim top" aria-label="Cerrar" onclick={() => (store.themeEditor = null)}></button>
<div class="modal" role="dialog" aria-label="Temas de {vaultName}">
  <header>
    <h2>Temas de {vaultName}</h2>
    <button class="icon" title="Cerrar" onclick={() => (store.themeEditor = null)}><Icon name="close" /></button>
  </header>

  <label class="default">Tema por defecto del vault
    <select value={data?.defaultTheme ?? ''} onchange={(e) => setDefault(e.currentTarget.value)}>
      <option value="">El de la aplicación</option>
      <optgroup label="Del vault">
        {#each themes as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
      </optgroup>
      <optgroup label="Incluidos">
        {#each THEMES as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
      </optgroup>
    </select>
  </label>

  <div class="columns">
    <nav>
      {#each themes as t (t.id)}
        <button class:on={selected === t.id} onclick={() => pick(t)}>{t.name}</button>
      {/each}
      <button class="new" onclick={create}><Icon name="plus" size={13} /> Nuevo tema</button>
    </nav>

    {#if draft && look}
      <div class="form">
        {#if json === null}
          <label class="row">Base
            <select bind:value={draft.base}>
              {#each THEMES as t}<option value={t.id}>{t.name}</option>{/each}
            </select>
          </label>
          <label class="row">Lectura
            <select bind:value={draft.prose}>
              <option value={undefined}>Como la base</option>
              <option value="serif">Serif</option>
              <option value="sans">Sans</option>
            </select>
          </label>
          <h3>Colores</h3>
          <div class="grid">
            {#each FIELDS as f}
              <label class="color">{f.label}<input type="color" value={look.colors[f.key]} oninput={(e) => setColor(f.key, e.currentTarget.value)} /></label>
            {/each}
          </div>
          <h3>Diagramas</h3>
          <div class="grid">
            {#each DIAGRAM_FIELDS as f}
              <label class="color">{f.label}<input type="color" value={look.diagram[f.key]} oninput={(e) => setDiagramColor(f.key, e.currentTarget.value)} /></label>
            {/each}
          </div>
          <div class="sample" style:background={look.colors.bg} style:color={look.colors.text}>
            <strong>Vista previa</strong> del tema con <span style:color={look.colors.text2}>texto secundario</span> y <span style:color={look.colors.accentText}>un enlace</span>.
            <div class="node" style:background={look.diagram.surface} style:border-color={look.diagram.border}>Nodo de diagrama</div>
          </div>
          {#if warnings.length}
            <p class="warn" role="alert">Poco contraste con el fondo en {warnings.join(', ')}.</p>
          {/if}
        {:else}
          <textarea aria-label="JSON del tema" spellcheck="false" bind:value={json}></textarea>
        {/if}
        <div class="actions">
          <button onclick={() => (json = json === null ? JSON.stringify(draft, null, 2) : null)}>{json === null ? 'Editar JSON' : 'Editar con controles'}</button>
          <span class="spacer"></span>
          {#if themes.some((t) => t.id === draft?.id)}<button onclick={remove}>Eliminar</button>{/if}
          <button class="main" onclick={save}>Guardar</button>
        </div>
      </div>
    {:else}
      <p class="empty">Crea un tema o elige uno. Se guarda dentro del vault y viaja con él. Úsalo en una nota con <code>tema: id</code> en el frontmatter, o solo en sus diagramas con <code>tema-diagramas: id</code>.</p>
    {/if}
  </div>
</div>

<style>
  .top { z-index: 32; }
  .modal { position: fixed; top: 50%; left: 50%; z-index: 33; width: min(680px, calc(100vw - 32px)); max-height: calc(100vh - 48px); padding: 8px 18px 16px; overflow-y: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); box-shadow: var(--shadow); transform: translate(-50%, -50%); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 8px 0; font-size: 15px; font-weight: 650; }
  h3 { margin: 14px 0 6px; font-size: 12px; font-weight: 650; }
  label { color: var(--text-2); font-size: 12.5px; }
  select { padding: 3px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--text); font: inherit; }
  .default { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .columns { display: grid; grid-template-columns: 150px 1fr; gap: 16px; }
  nav { display: flex; flex-direction: column; gap: 2px; }
  nav button { display: flex; align-items: center; gap: 5px; padding: 5px 8px; border: 0; border-radius: 6px; background: none; color: var(--text-2); font-size: 12.5px; text-align: left; }
  nav button:hover { background: var(--hover); color: var(--text); }
  nav .on { background: var(--accent-soft); color: var(--accent-text); }
  .row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px 12px; }
  .color { display: flex; align-items: center; justify-content: space-between; }
  input[type='color'] { width: 30px; height: 22px; padding: 0; border: 1px solid var(--line); border-radius: 4px; background: none; }
  .sample { margin-top: 12px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; font-size: 13px; }
  .node { display: inline-block; margin-top: 8px; padding: 3px 10px; border: 1px solid; border-radius: 5px; font-size: 12px; }
  .warn { margin: 8px 0 0; color: var(--danger); font-size: 12.5px; }
  textarea { width: 100%; height: 260px; padding: 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); color: var(--text); font: 12px/1.5 var(--mono); resize: vertical; user-select: text; }
  .actions { display: flex; gap: 6px; margin-top: 12px; }
  .actions button { padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: none; color: var(--text-2); font-size: 12px; }
  .actions .main { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
  .spacer { flex: 1; }
  .empty { margin: 0; color: var(--text-2); font-size: 12.5px; line-height: 1.5; }
  code { font: 11.5px var(--mono); }
</style>
