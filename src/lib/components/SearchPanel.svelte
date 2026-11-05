<script lang="ts">
  import { api, type VaultHit } from '../api';
  import { store } from '../store.svelte';

  let query = $state('');
  let hits = $state<VaultHit[]>([]);
  let searched = $state(false);
  let timer: ReturnType<typeof setTimeout>;
  let run = 0;

  function onInput() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const id = ++run;
      const found = query.trim() ? await api.search(query).catch(() => []) : [];
      if (id !== run) return;
      hits = found;
      searched = !!query.trim();
    }, 200);
  }
</script>

<div class="panel">
  <!-- svelte-ignore a11y_autofocus -->
  <input autofocus bind:value={query} oninput={onInput} placeholder="Buscar en los vaults abiertos" />
  <div class="results">
    {#each hits as { vaultId, hit }}
      <button onclick={() => store.openFile(vaultId, hit.path)}>
        <span class="path">{store.vault(vaultId)?.name} · {hit.path}{hit.line ? `:${hit.line}` : ''}</span>
        {#if hit.text}<span class="text">{hit.text}</span>{/if}
      </button>
    {:else}
      {#if searched}<p>Sin resultados</p>{/if}
    {/each}
  </div>
</div>

<style>
  .panel { display: flex; flex: 1; flex-direction: column; min-height: 0; padding: 0 8px 8px; }
  input { width: 100%; }
  .results { flex: 1; min-height: 0; margin-top: 8px; overflow-y: auto; }
  button { display: block; width: 100%; padding: 6px 8px; border: 0; border-radius: 6px; background: none; color: var(--text); text-align: left; }
  button:hover { background: var(--hover); }
  span { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .path { color: var(--text-2); font-size: 11.5px; }
  .text { font-size: 12.5px; }
  p { padding: 8px; color: var(--text-3); font-size: 13px; }
</style>
