<script lang="ts">
  import { fold } from '../fold';
  import { tr } from '../i18n.svelte';
  import { store } from '../store.svelte';

  const MAX = 40;
  let query = $state('');
  let index = $state(0);

  const all = $derived(store.openVaults.flatMap((v) => store.files(v.id).map((path) => ({ vault: v, path }))));

  /** Subsequence match, ignoring case and accents. Tighter matches and matches in the file name rank higher. */
  function score(text: string, q: string) {
    const lower = fold(text);
    let at = -1, gaps = 0;
    for (const c of q) {
      const next = lower.indexOf(c, at + 1);
      if (next < 0) return null;
      if (at >= 0) gaps += next - at - 1;
      at = next;
    }
    return gaps - (at > lower.lastIndexOf('/') ? 50 : 0);
  }

  const results = $derived.by(() => {
    const q = fold(query).replace(/\s+/g, '');
    if (!q) return all.slice(0, MAX);
    return all
      .map((f) => ({ f, s: score(f.path, q) }))
      .filter((r): r is { f: (typeof all)[number]; s: number } => r.s !== null)
      .sort((a, b) => a.s - b.s)
      .slice(0, MAX)
      .map((r) => r.f);
  });

  function pick(i: number) {
    const f = results[i];
    if (!f) return;
    store.palette = false;
    void store.openFile(f.vault.id, f.path);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') index = Math.min(index + 1, results.length - 1);
    else if (e.key === 'ArrowUp') index = Math.max(index - 1, 0);
    else if (e.key === 'Enter') pick(index);
    else if (e.key === 'Escape') store.palette = false;
    else return;
    e.preventDefault();
  }
</script>

<button class="scrim" aria-label={tr('common.close')} onclick={() => (store.palette = false)}></button>
<div class="box" role="dialog" aria-label={tr('palette.title')}>
  <!-- svelte-ignore a11y_autofocus -->
  <input autofocus bind:value={query} oninput={() => (index = 0)} onkeydown={onKey} placeholder={tr('palette.placeholder')} />
  <div class="list">
    {#each results as f, i}
      <button class:on={i === index} onclick={() => pick(i)} onmousemove={() => (index = i)}>
        <span class="path">{f.path}</span><span class="vault">{f.vault.name}</span>
      </button>
    {:else}
      <p>{tr('palette.empty')}</p>
    {/each}
  </div>
</div>

<style>
  .box { position: fixed; top: 12vh; left: 50%; z-index: var(--z-dialog); width: min(600px, calc(100vw - 32px)); padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translateX(-50%); }
  input { width: 100%; }
  .list { max-height: 50vh; margin-top: var(--space-1-5); overflow-y: auto; }
  .list button { display: flex; justify-content: space-between; gap: var(--space-3); width: 100%; padding: var(--space-2) var(--space-2-5); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text); font-size: var(--font-md); text-align: left; }
  .list button.on { background: var(--accent-soft); }
  .path { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .vault { flex: none; color: var(--text-3); font-size: var(--font-sm); }
  p { padding: var(--space-2); color: var(--text-3); font-size: var(--font-md); }
</style>
