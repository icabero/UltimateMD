<script lang="ts">
  import { dim, pop } from '../motion';
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
    await api.setVaultDiagramTheme(tab.vaultId, id || null).catch((e) => store.fail(e));
    await store.loadVaultThemes(tab.vaultId);
  }

  function makeTheme() {
    onclose();
    store.openVaultSettings(tab.vaultId, 'look');
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

<button in:dim class="scrim top" aria-label={tr('common.close')} onclick={onclose}></button>
<div in:pop class="modal" role="dialog" aria-label={tr('noteStyle.title')}>
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
  .top { z-index: var(--z-nested-scrim); }
  .modal { position: fixed; top: 50%; left: 50%; z-index: var(--z-nested); width: min(460px, calc(100vw - 32px)); padding: var(--space-2) var(--space-5) var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translate(-50%, -50%); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: var(--space-2) 0; font-size: var(--font-lg); font-weight: 650; }
  label { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2-5); margin-top: var(--space-2); color: var(--text-2); font-size: var(--font-md); }
  select { flex: none; width: 210px; padding: var(--space-1) var(--space-1-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); color: var(--text); font: inherit; }
  p { margin: var(--space-3-5) 0 var(--space-2-5); color: var(--text-2); font-size: var(--font-sm); line-height: 1.5; }
  .plain { padding: var(--space-1) var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: none; color: var(--text); font-size: var(--font-sm); }
  .plain:hover { background: var(--hover); }
</style>
