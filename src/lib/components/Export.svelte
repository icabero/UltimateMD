<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { api } from '../api';
  import { exportDocx, exportHtml, exportPdf } from '../export';
  import { store, type Tab } from '../store.svelte';

  type Format = 'pdf' | 'html' | 'docx';

  const FORMATS: { id: Format; label: string }[] = [
    { id: 'pdf', label: 'PDF' },
    { id: 'html', label: 'HTML' },
    { id: 'docx', label: 'Word' },
  ];

  let { tab }: { tab: Tab } = $props();
  let format = $state<Format>('pdf');
  let templates = $state<string[]>([]);
  let template = $state('');
  let busy = $state(false);

  async function load() {
    templates = await api.listTemplates().catch(() => []);
    if (!templates.includes(template)) template = '';
  }

  onMount(load);

  async function run<T>(action: () => Promise<T>) {
    try {
      return await action();
    } catch (e) {
      store.notify(e);
    }
  }

  async function importTemplate() {
    const name = await run(api.importTemplate);
    await load();
    if (name) template = name;
  }

  async function renameTemplate() {
    const name = (await store.prompt('Nombre de la plantilla', template, 'Renombrar'))?.trim();
    if (!name || name === template) return;
    await run(() => api.renameTemplate(template, name));
    await load();
    if (templates.includes(name)) template = name;
  }

  async function deleteTemplate() {
    if (!(await store.confirm(`¿Eliminar la plantilla «${template}»?`, 'Eliminar', true))) return;
    await run(() => api.deleteTemplate(template));
    await load();
  }

  async function submit() {
    busy = true;
    const done = await run(async () => {
      if (format === 'html') return exportHtml(tab);
      if (format === 'docx') return exportDocx(tab, template || null);
      store.exporting = false;
      await exportPdf(tab);
      return false;
    });
    busy = false;
    if (done) {
      store.exporting = false;
      store.notify('Exportado');
    }
  }
</script>

<button class="scrim" aria-label="Cerrar" onclick={() => (store.exporting = false)}></button>
<div class="modal" role="dialog" aria-label="Exportar">
  <header>
    <h2>Exportar nota</h2>
    <button class="icon" title="Cerrar" onclick={() => (store.exporting = false)}><Icon name="close" /></button>
  </header>

  <div class="seg" role="group" aria-label="Formato">
    {#each FORMATS as f}
      <button class:on={format === f.id} aria-pressed={format === f.id} onclick={() => (format = f.id)}>{f.label}</button>
    {/each}
  </div>

  {#if format === 'pdf'}
    <p>Se abrirá el diálogo de impresión del sistema. Elige guardar como PDF o imprimir a un archivo.</p>
  {:else if format === 'html'}
    <p>Un único archivo con las imágenes y los diagramas incluidos.</p>
  {:else}
    <label>Plantilla
      <select bind:value={template}>
        <option value="">Sin plantilla</option>
        {#each templates as t}<option value={t}>{t}</option>{/each}
      </select>
    </label>
    <div class="row">
      <button class="plain" onclick={importTemplate}>Importar .docx</button>
      {#if template}
        <button class="plain" onclick={renameTemplate}>Renombrar</button>
        <button class="plain" onclick={deleteTemplate}>Eliminar</button>
      {/if}
    </div>
    <p>En la plantilla, escribe <code>{'{{contenido}}'}</code> donde deba ir la nota, y <code>{'{{titulo}}'}</code>, <code>{'{{autor}}'}</code>, <code>{'{{fecha}}'}</code> o cualquier dato del frontmatter. Word te pedirá actualizar el índice al abrir.</p>
  {/if}

  <footer>
    <button class="main" disabled={busy} onclick={submit}>{busy ? 'Exportando…' : 'Exportar'}</button>
  </footer>
</div>

<style>
  .modal { position: fixed; top: 16vh; left: 50%; z-index: 31; width: min(460px, calc(100vw - 32px)); padding: 8px 18px 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); box-shadow: var(--shadow); transform: translateX(-50%); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 8px 0; font-size: 15px; font-weight: 650; }
  .seg { display: inline-flex; margin: 6px 0 12px; padding: 2px; border-radius: 8px; background: var(--hover); }
  .seg button { padding: 4px 14px; border: 0; border-radius: 6px; background: none; color: var(--text-2); font-size: 12.5px; }
  .seg .on { background: var(--raised); color: var(--text); box-shadow: 0 1px 2px rgb(0 0 0 / 15%); }
  p { margin: 8px 0 0; color: var(--text-2); font-size: 12.5px; line-height: 1.5; }
  code { font: 11.5px var(--mono); }
  label { display: flex; align-items: center; gap: 8px; color: var(--text-2); font-size: 12.5px; }
  select { flex: 1; padding: 4px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--text); font: inherit; }
  .row { display: flex; gap: 6px; margin-top: 8px; }
  .plain { padding: 3px 9px; border: 1px solid var(--line); border-radius: 6px; background: none; color: var(--text-2); font-size: 12px; }
  .plain:hover { background: var(--hover); color: var(--text); }
  footer { display: flex; justify-content: flex-end; margin-top: 16px; }
  .main { padding: 6px 14px; border: 1px solid var(--accent); border-radius: 7px; background: var(--accent); color: var(--on-accent); font-size: 13px; }
  .main:disabled { opacity: .6; }
</style>
