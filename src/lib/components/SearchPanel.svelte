<script lang="ts">
  import { api, type VaultHit } from '../api';
  import { pieces, terms } from '../fold';
  import { tr } from '../i18n.svelte';
  import { store } from '../store.svelte';

  let query = $state('');
  let hits = $state<VaultHit[]>([]);
  let words = $state<string[]>([]);
  let searched = $state(false);
  let timer: ReturnType<typeof setTimeout>;
  let run = 0;

  /** Hits come best note first, each note's lines together. */
  const groups = $derived.by(() => {
    const out: { vaultId: string; path: string; lines: VaultHit['hit'][] }[] = [];
    for (const { vaultId, hit } of hits) {
      const last = out.at(-1);
      const group = last && last.vaultId === vaultId && last.path === hit.path ? last : null;
      if (group) group.lines.push(hit);
      else out.push({ vaultId, path: hit.path, lines: [hit] });
    }
    return out;
  });

  function onInput() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const id = ++run;
      const asked = query;
      const found = asked.trim() ? await api.search(asked).catch(() => []) : [];
      if (id !== run) return;
      hits = found;
      words = terms(asked);
      searched = !!asked.trim();
    }, 200);
  }

  const name = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');
  const folder = (path: string) => path.split('/').slice(0, -1).join('/');
</script>

<div class="panel">
  <!-- svelte-ignore a11y_autofocus -->
  <input autofocus bind:value={query} oninput={onInput} placeholder={tr('search.placeholder')} />
  <div class="results">
    {#each groups as g (`${g.vaultId}:${g.path}`)}
      <div class="note">
        <button class="name" title={g.path} onclick={() => store.openAt(g.vaultId, g.path, g.lines[0].line, words)}>
          <span class="title">{#each pieces(name(g.path), words) as p}{#if p.match}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}</span>
          <span class="where">{store.vault(g.vaultId)?.name}{folder(g.path) ? ` · ${folder(g.path)}` : ''}</span>
        </button>
        {#each g.lines.filter((l) => l.line > 0) as hit (hit.line)}
          <button class="line" onclick={() => store.openAt(g.vaultId, g.path, hit.line, words)}>
            <span class="n">{hit.line}</span>
            <span class="text">{#each pieces(hit.text, words) as p}{#if p.match}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}</span>
          </button>
        {/each}
      </div>
    {:else}
      {#if searched}<p>{tr('search.empty')}</p>{/if}
    {/each}
  </div>
</div>

<style>
  .panel { display: flex; flex: 1; flex-direction: column; min-height: 0; padding: 0 8px 8px; }
  input { width: 100%; }
  .results { flex: 1; min-height: 0; margin-top: 8px; overflow-y: auto; }
  .note + .note { margin-top: 6px; }
  button { display: flex; width: 100%; border: 0; border-radius: 6px; background: none; color: var(--text); text-align: left; }
  button:hover { background: var(--hover); }
  .name { flex-direction: column; padding: 5px 8px 3px; }
  .title { overflow: hidden; font-size: 13px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
  .where { overflow: hidden; color: var(--text-3); font-size: 11px; white-space: nowrap; text-overflow: ellipsis; }
  .line { gap: 8px; padding: 3px 8px; }
  .n { flex: none; min-width: 2.2em; color: var(--text-3); font-size: 11px; font-variant-numeric: tabular-nums; line-height: 1.6; text-align: right; }
  .text { display: -webkit-box; overflow: hidden; color: var(--text-2); font-size: 12.5px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow-wrap: anywhere; }
  mark { border-radius: 2px; background: color-mix(in srgb, var(--accent) 30%, transparent); color: var(--text); }
  p { padding: 8px; color: var(--text-3); font-size: 13px; }
</style>
