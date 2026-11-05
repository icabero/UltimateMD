<script lang="ts">
  import { store } from '../store.svelte';

  const MAX = 40;
  let query = $state('');
  let index = $state(0);

  const all = $derived(store.openVaults.flatMap((v) => store.files(v.id).map((path) => ({ vault: v, path }))));

  /** Subsequence match. Tighter matches and matches in the file name rank higher. */
  function score(text: string, q: string) {
    const lower = text.toLowerCase();
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
    const q = query.toLowerCase().replace(/\s+/g, '');
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

<button class="scrim" aria-label="Cerrar" onclick={() => (store.palette = false)}></button>
<div class="box" role="dialog" aria-label="Abrir nota">
  <!-- svelte-ignore a11y_autofocus -->
  <input autofocus bind:value={query} oninput={() => (index = 0)} onkeydown={onKey} placeholder="Abrir nota…" />
  <div class="list">
    {#each results as f, i}
      <button class:on={i === index} onclick={() => pick(i)} onmousemove={() => (index = i)}>
        <span class="path">{f.path}</span><span class="vault">{f.vault.name}</span>
      </button>
    {:else}
      <p>Nada coincide</p>
    {/each}
  </div>
</div>

<style>
  .box { position: fixed; top: 12vh; left: 50%; z-index: 31; width: min(600px, calc(100vw - 32px)); padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); box-shadow: var(--shadow); transform: translateX(-50%); }
  input { width: 100%; }
  .list { max-height: 50vh; margin-top: 6px; overflow-y: auto; }
  .list button { display: flex; justify-content: space-between; gap: 12px; width: 100%; padding: 7px 9px; border: 0; border-radius: 6px; background: none; color: var(--text); font-size: 13px; text-align: left; }
  .list button.on { background: var(--accent-soft); }
  .path { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .vault { flex: none; color: var(--text-3); font-size: 12px; }
  p { padding: 8px; color: var(--text-3); font-size: 13px; }
</style>
