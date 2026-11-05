<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { api } from '../api';
  import { themeName, tr } from '../i18n.svelte';
  import { store, type Tab } from '../store.svelte';
  import { THEMES } from '../themes';

  let { tab, value, onchange, onclose }: { tab: Tab; value: string | null; onchange: (value: string | null) => void; onclose: () => void } = $props();

  let note = $state(untrack(() => value ?? ''));
  const data = $derived(store.vaultThemes[tab.vaultId]);
  const own = $derived(data?.themes ?? []);
  const vaultName = $derived(store.vault(tab.vaultId)?.name ?? '');

  async function setVault(id: string) {
    await api.setVaultDiagramTheme(tab.vaultId, id || null).catch((e) => store.notify(e));
    await store.loadVaultThemes(tab.vaultId);
  }

  function makeTheme() {
    onclose();
    store.themeEditor = tab.vaultId;
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose(); }} />

{#snippet options()}
  <option value="boceto">{tr('noteStyle.sketch')}</option>
  {#if own.length}
    <optgroup label={tr('themes.fromVault')}>
      {#each own as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
    </optgroup>
  {/if}
  <optgroup label={tr('themes.included')}>
    {#each THEMES as t (t.id)}<option value={t.id}>{themeName(t)}</option>{/each}
  </optgroup>
{/snippet}

<button class="scrim top" aria-label={tr('common.close')} onclick={onclose}></button>
<div class="modal" role="dialog" aria-label={tr('noteStyle.title')}>
  <header>
    <h2>{tr('noteStyle.title')}</h2>
    <button class="icon" title={tr('common.close')} onclick={onclose}><Icon name="close" /></button>
  </header>

  <label>{tr('noteStyle.inNote')}
    <select bind:value={note} onchange={() => onchange(note || null)}>
      <option value="">{tr('noteStyle.inheritVault')}</option>
      {@render options()}
    </select>
  </label>
  {#if !tab.loose}
    <label>{tr('noteStyle.inVault', { name: vaultName })}
      <select value={data?.defaultDiagramTheme ?? ''} onchange={(e) => setVault(e.currentTarget.value)}>
        <option value="">{tr('noteStyle.inheritNote')}</option>
        {@render options()}
      </select>
    </label>
  {/if}

  <p>{tr('noteStyle.help')}</p>
  {#if !tab.loose}<button class="plain" onclick={makeTheme}>{tr('noteStyle.ownColors')}</button>{/if}
</div>

<style>
  .top { z-index: 32; }
  .modal { position: fixed; top: 50%; left: 50%; z-index: 33; width: min(460px, calc(100vw - 32px)); padding: 8px 18px 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); box-shadow: var(--shadow); transform: translate(-50%, -50%); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 8px 0; font-size: 15px; font-weight: 650; }
  label { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; color: var(--text-2); font-size: 13px; }
  select { flex: none; width: 210px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--text); font: inherit; }
  p { margin: 14px 0 10px; color: var(--text-2); font-size: 12.5px; line-height: 1.5; }
  .plain { padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: none; color: var(--text); font-size: 12.5px; }
  .plain:hover { background: var(--hover); }
</style>
