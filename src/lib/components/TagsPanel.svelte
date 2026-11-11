<script lang="ts">
  import { onMount } from 'svelte';
  import { fold } from '../fold';
  import { tr } from '../i18n.svelte';
  import { store } from '../store.svelte';

  let filter = $state('');
  let loading = $state(true);

  onMount(async () => {
    await Promise.all(store.openVaults.map((v) => store.loadTags(v.id)));
    loading = false;
  });

  /** The tags of every open vault together, the most used first. */
  const tags = $derived.by(() => {
    // Built anew on each change, never mutated afterwards.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const merged = new Map<string, { tag: string; notes: number }>();
    for (const vault of store.openVaults) {
      for (const t of store.tags[vault.id] ?? []) {
        const key = fold(t.tag);
        const known = merged.get(key);
        if (known) known.notes += t.notes;
        else merged.set(key, { ...t });
      }
    }
    const wanted = fold(filter.trim().replace(/^#/, ''));
    return [...merged.values()].filter((t) => fold(t.tag).includes(wanted)).sort((a, b) => b.notes - a.notes || fold(a.tag).localeCompare(fold(b.tag)));
  });

  // Reading the tags again when a vault changes and its list is dropped.
  $effect(() => {
    for (const vault of store.openVaults) if (!store.tags[vault.id]) void store.loadTags(vault.id);
  });
</script>

<div class="tags">
  <input bind:value={filter} placeholder={tr('tags.filter')} aria-label={tr('tags.filter')} />
  <ul class="list" aria-label={tr('tags.title')}>
    {#each tags as t (fold(t.tag))}
      <li>
        <button onclick={() => store.searchTag(t.tag)}>
          <span class="name">#{t.tag}</span>
          <span class="count">{t.notes}</span>
        </button>
      </li>
    {:else}
      {#if !loading}<li class="empty">{tr(filter ? 'tags.noneMatch' : 'tags.none')}</li>{/if}
    {/each}
  </ul>
</div>

<style>
  .tags { display: flex; flex: 1; flex-direction: column; gap: var(--space-2); min-height: 0; }
  input { width: 100%; }
  .list { flex: 1; min-height: 0; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
  button { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); width: 100%; padding: var(--space-1) var(--space-2); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text); font-size: var(--font-md); text-align: left; }
  button:hover { background: var(--hover); }
  .name { overflow: hidden; color: var(--accent-text); white-space: nowrap; text-overflow: ellipsis; }
  .count { flex: none; color: var(--text-3); font-size: var(--font-xs); font-variant-numeric: tabular-nums; }
  .empty { padding: var(--space-2); color: var(--text-3); font-size: var(--font-sm); line-height: 1.5; }
</style>
