<script lang="ts">
  import { onMount } from 'svelte';
  import DocxSheet from './DocxSheet.svelte';
  import Icon from './Icon.svelte';
  import { api, type WordConfig, type WordSettings } from '../api';
  import { tr } from '../i18n.svelte';
  import { store } from '../store.svelte';

  let { vaultId }: { vaultId: string } = $props();

  const DELAY = 300;
  const LEVELS = [1, 2, 3, 4, 5, 6];
  const PICTURE = { width: 720, height: 240 };

  let config = $state<WordConfig | null>(null);
  let settings = $state<WordSettings | null>(null);
  let sheet = $state<DocxSheet>();
  let error = $state('');
  let busy = $state(false);
  let picture: number[] = [];
  let timer: ReturnType<typeof setTimeout>;
  let run = 0;

  const vaultName = $derived(store.vault(vaultId)?.name ?? '');
  const styleName = (id: string | null | undefined) => config?.info.styles.find((s) => s.id === id)?.name ?? id ?? '';
  const auto = (id: string | null | undefined) => (id ? tr('word.autoStyle', { name: styleName(id) }) : tr('word.standard'));
  const fill = $derived(settings?.headerFill ?? config?.info.headerFill ?? 'DCE4EE');
  const missing = $derived(LEVELS.filter((n) => !settings?.headings[n - 1] && !config?.info.headings[n - 1]));

  async function makePicture() {
    const canvas = document.createElement('canvas');
    canvas.width = PICTURE.width;
    canvas.height = PICTURE.height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#d7dee8';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#6b7a90';
    context.font = '28px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText(tr('word.samplePicture'), canvas.width / 2, canvas.height / 2);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
    return blob ? Array.from(new Uint8Array(await blob.arrayBuffer())) : [];
  }

  async function draw() {
    if (!settings || !sheet) return;
    const id = ++run;
    busy = true;
    try {
      const current = $state.snapshot(settings) as WordSettings;
      await api.saveWordSettings(vaultId, current);
      const bytes = await api.wordSample(vaultId, current, tr('word.sample'), picture);
      if (id !== run) return;
      await sheet.show(bytes);
      error = '';
    } catch (e) {
      if (id === run) error = String(e);
    } finally {
      if (id === run) busy = false;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(draw, DELAY);
  }

  async function load() {
    const loaded = await api.wordConfig(vaultId);
    config = loaded;
    settings = loaded.settings;
    schedule();
  }

  async function chooseTemplate() {
    try {
      if (await api.chooseVaultTemplate(vaultId)) await load();
    } catch (e) {
      store.notify(e);
    }
  }

  async function removeTemplate() {
    if (!(await store.confirm(tr('word.removeConfirm', { name: vaultName }), tr('common.remove'), true))) return;
    await api.removeVaultTemplate(vaultId).catch((e) => store.notify(e));
    await load();
  }

  const close = () => (store.wordScreen = null);
  const number = (value: string) => (value === '' ? null : Number(value));

  onMount(() => {
    void makePicture().then((bytes) => {
      picture = bytes;
      return load();
    }).catch((e) => store.notify(e));
    return () => clearTimeout(timer);
  });
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && !store.dialog) close(); }} />

<button class="scrim top" aria-label={tr('common.close')} onclick={close}></button>
<div class="modal" role="dialog" aria-label={tr('word.title', { name: vaultName })}>
  <div class="config">
    <header>
      <h2>{tr('word.title', { name: vaultName })}</h2>
      <button class="icon" title={tr('common.close')} onclick={close}><Icon name="close" /></button>
    </header>

    {#if settings && config}
      <h3>{tr('export.template')}</h3>
      <p class="hint">{tr(config.hasTemplate ? 'word.templateHere' : 'word.noTemplate')}</p>
      <div class="buttons">
        <button class="plain" onclick={chooseTemplate}>{tr(config.hasTemplate ? 'word.changeTemplate' : 'word.chooseTemplate')}</button>
        {#if config.hasTemplate}<button class="plain" onclick={removeTemplate}>{tr('common.remove')}</button>{/if}
      </div>

      <h3>{tr('word.headings')}</h3>
      {#each LEVELS as n}
        <label class="row">{tr('export.heading', { n })}
          <select value={settings.headings[n - 1] ?? ''} onchange={(e) => { settings!.headings[n - 1] = e.currentTarget.value || null; schedule(); }}>
            <option value="">{auto(config.info.headings[n - 1])}</option>
            {#each config.info.styles as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
          </select>
        </label>
      {/each}
      {#if config.hasTemplate && missing.length}
        <p class="note" role="status">{tr('word.levelsWithout', { list: missing.join(', ') })}</p>
      {/if}

      <h3>{tr('word.text')}</h3>
      <label class="row">{tr('word.body')}
        <select value={settings.body ?? ''} onchange={(e) => { settings!.body = e.currentTarget.value || null; schedule(); }}>
          <option value="">{auto(config.info.body)}</option>
          {#each config.info.styles as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
        </select>
      </label>

      <h3>{tr('word.tables')}</h3>
      <div class="row">
        <label for="word-fill">{tr('word.headerColor')}</label>
        <span class="pair">
          {#if settings.headerFill}<button class="link" onclick={() => { settings!.headerFill = null; schedule(); }}>{tr('word.useTemplate')}</button>{/if}
          <input id="word-fill" class="swatch" type="color" value="#{fill}" oninput={(e) => { settings!.headerFill = e.currentTarget.value.slice(1).toUpperCase(); schedule(); }} />
        </span>
      </div>
      <label class="row">{tr('word.tableTextSize')}
        <input class="number" type="number" min="6" max="24" step="0.5" placeholder={tr('word.likeText')} value={settings.tableTextSize ?? ''} oninput={(e) => { settings!.tableTextSize = number(e.currentTarget.value); schedule(); }} />
      </label>

      <h3>{tr('word.images')}</h3>
      <label class="row">{tr('word.maxWidth')}
        <input class="number" type="number" min="50" max="1000" step="10" placeholder={tr('word.fullWidth')} value={settings.imageMaxWidth ?? ''} oninput={(e) => { settings!.imageMaxWidth = number(e.currentTarget.value); schedule(); }} />
      </label>

      <h3>{tr('word.code')}</h3>
      <label class="row">{tr('word.codeTextSize')}
        <input class="number" type="number" min="6" max="24" step="0.5" placeholder={tr('word.likeText')} value={settings.codeTextSize ?? ''} oninput={(e) => { settings!.codeTextSize = number(e.currentTarget.value); schedule(); }} />
      </label>
      <label class="check"><input type="checkbox" checked={settings.plainCode} onchange={(e) => { settings!.plainCode = e.currentTarget.checked; schedule(); }} /> {tr('word.plainCode')}</label>
    {/if}
  </div>

  <div class="preview" aria-label={tr('word.sampleTitle')} aria-busy={busy}>
    <p class="note">{tr('word.sampleNote')}</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <DocxSheet bind:this={sheet} />
  </div>
</div>

<style>
  .top { z-index: 32; }
  .modal { position: fixed; top: 50%; left: 50%; z-index: 33; display: grid; grid-template-columns: 360px 1fr; width: min(1120px, calc(100vw - 32px)); height: min(760px, calc(100vh - 32px)); overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); box-shadow: var(--shadow); transform: translate(-50%, -50%); }
  .config { min-height: 0; padding: 8px 18px 16px; overflow-y: auto; }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 8px 0; font-size: 15px; font-weight: 650; }
  h3 { margin: 16px 0 6px; font-size: 12px; font-weight: 650; }
  p { margin: 0; color: var(--text-2); font-size: 12px; line-height: 1.5; }
  .hint { margin-bottom: 6px; }
  .buttons { display: flex; gap: 6px; }
  .plain { padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: none; color: var(--text); font-size: 12.5px; }
  .plain:hover { background: var(--hover); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 5px; color: var(--text-2); font-size: 12.5px; }
  .pair { display: flex; align-items: center; gap: 8px; }
  .check { display: flex; align-items: center; gap: 6px; color: var(--text-2); font-size: 12.5px; }
  select { flex: none; width: 200px; padding: 3px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--text); font: inherit; font-size: 12.5px; }
  input.number { flex: none; width: 120px; height: 26px; padding: 0 6px; font-size: 12.5px; }
  .swatch { width: 30px; height: 24px; padding: 0; border: 1px solid var(--line); border-radius: 4px; background: none; }
  .link { padding: 0; border: 0; background: none; color: var(--accent-text); font-size: 12px; }
  .note { margin: 6px 0; color: var(--text-3); font-size: 11.5px; }
  .preview { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 10px 20px 16px; overflow: auto; border-left: 1px solid var(--line); background: var(--panel); }
  .preview[aria-busy='true'] :global(.sheet) { opacity: .6; }
  .error { color: var(--danger); }
</style>
