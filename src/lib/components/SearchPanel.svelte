<script lang="ts">
  import { api, type VaultHit } from '../api';
  import { pieces, queryMarks } from '../fold';
  import { tr } from '../i18n.svelte';
  import { store } from '../store.svelte';
  import ReplacePanel from './ReplacePanel.svelte';
  import TagsPanel from './TagsPanel.svelte';

  let query = $state('');
  let hits = $state<VaultHit[]>([]);
  let words = $state<string[]>([]);
  let searched = $state(false);
  let problem = $state<string | null>(null);
  let help = $state(false);
  let mode = $state<'find' | 'replace' | 'tags'>('find');

  // Another part of the app asks for a search, such as a tag clicked in a note.
  $effect(() => {
    const asked = store.searchQuery;
    if (asked === null) return;
    store.searchQuery = null;
    mode = 'find';
    query = asked;
    onInput();
  });
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
      let failed: string | null = null;
      const found = asked.trim()
        ? await api.search(asked).catch((e) => {
            failed = String(e);
            return [];
          })
        : [];
      if (id !== run) return;
      hits = found;
      problem = failed;
      words = queryMarks(asked);
      searched = !!asked.trim();
    }, 200);
  }

  const name = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');

  /** A search for plain words that finds nothing can become a note with that name. */
  const creatable = $derived.by(() => {
    const text = query.trim();
    const vaultId = (store.active && !store.active.loose ? store.active.vaultId : null) ?? store.openVaults[0]?.id;
    return vaultId && text && text.length <= 80 && /^[^"/:*?<>|\\-][^"/:*?<>|\\]*$/.test(text) ? { vaultId, name: text } : null;
  });
  const folder = (path: string) => path.split('/').slice(0, -1).join('/');
</script>

<div class="panel">
  <div class="modes" role="tablist" aria-label={tr('search.modes')}>
    <button role="tab" aria-selected={mode === 'find'} class:on={mode === 'find'} onclick={() => (mode = 'find')}>{tr('search.find')}</button>
    <button role="tab" aria-selected={mode === 'replace'} class:on={mode === 'replace'} onclick={() => (mode = 'replace')}>{tr('search.replace')}</button>
    <button role="tab" aria-selected={mode === 'tags'} class:on={mode === 'tags'} onclick={() => (mode = 'tags')}>{tr('tags.title')}</button>
  </div>
  {#if mode === 'replace'}
    <ReplacePanel />
  {:else if mode === 'tags'}
    <TagsPanel />
  {:else}
  <!-- svelte-ignore a11y_autofocus -->
  <div class="field">
    <input autofocus bind:value={query} oninput={onInput} placeholder={tr('search.placeholder')} />
    <button class="help" class:on={help} aria-expanded={help} title={tr('search.helpTitle')} onclick={() => (help = !help)}>?</button>
  </div>
  {#if help}
    <dl class="syntax" aria-label={tr('search.helpTitle')}>
      <dt>"…"</dt><dd>{tr('search.helpPhrase')}</dd>
      <dt>{tr('search.kwExclude')}</dt><dd>{tr('search.helpExclude')}</dd>
      <dt>{tr('search.kwPath')}</dt><dd>{tr('search.helpPath')}</dd>
      <dt>{tr('search.kwTag')}</dt><dd>{tr('search.helpTag')}</dd>
      <dt>{tr('search.kwKind')}</dt><dd>{tr('search.helpKind')}</dd>
      <dt>/…/</dt><dd>{tr('search.helpRegex')}</dd>
    </dl>
  {/if}
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
      {#if problem?.includes('regular expression')}
        <p class="bad" role="alert">{tr('search.badRegex')}</p>
      {:else if searched}
        <p>{tr('search.empty')}</p>
        <p class="tips">{tr('search.emptyTips')}</p>
        {#if creatable}
          <button class="create" onclick={() => store.createNote(creatable.vaultId, '', creatable.name)}>{tr('search.createNote', { name: creatable.name })}</button>
        {/if}
      {/if}
    {/each}
  </div>
  {/if}
</div>

<style>
  .panel { display: flex; flex: 1; flex-direction: column; min-height: 0; padding: 0 var(--space-2) var(--space-2); }
  .modes { display: flex; gap: var(--space-0-5); margin-bottom: var(--space-2); padding: var(--space-0-5); border-radius: var(--radius-sm); background: var(--hover); }
  .modes button { flex: 1; justify-content: center; padding: var(--space-1) 0; color: var(--text-2); font-size: var(--font-sm); }
  .modes button.on { background: var(--raised); color: var(--text); font-weight: 600; box-shadow: var(--shadow-sm); }
  .field { display: flex; gap: var(--space-1); }
  input { flex: 1; min-width: 0; }
  .help { flex: none; justify-content: center; width: 28px; padding: 0; border: 1px solid var(--line); color: var(--text-3); font-size: var(--font-sm); }
  .help.on { border-color: var(--accent); color: var(--accent-text); }
  .syntax { display: grid; grid-template-columns: auto 1fr; gap: var(--space-1) var(--space-2); margin: var(--space-2) 0 0; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); font-size: var(--font-xs); }
  .syntax dt { color: var(--text); font-family: var(--mono); }
  .syntax dd { margin: 0; color: var(--text-2); }
  .bad { color: var(--danger); }
  .tips { padding-top: 0; font-size: var(--font-sm); line-height: 1.5; }
  .create { margin: 0 var(--space-2); padding: var(--space-1) var(--space-2-5); border: 1px solid var(--line); color: var(--accent-text); font-size: var(--font-sm); }
  .results { flex: 1; min-height: 0; margin-top: var(--space-2); overflow-y: auto; }
  .note + .note { margin-top: var(--space-1-5); }
  button { display: flex; width: 100%; border: 0; border-radius: var(--radius-sm); background: none; color: var(--text); text-align: left; }
  button:hover { background: var(--hover); }
  .name { flex-direction: column; padding: var(--space-1-5) var(--space-2) var(--space-1); }
  .title { overflow: hidden; font-size: var(--font-md); font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
  .where { overflow: hidden; color: var(--text-3); font-size: var(--font-xs); white-space: nowrap; text-overflow: ellipsis; }
  .line { gap: var(--space-2); padding: var(--space-1) var(--space-2); }
  .n { flex: none; min-width: 2.2em; color: var(--text-3); font-size: var(--font-xs); font-variant-numeric: tabular-nums; line-height: 1.6; text-align: right; }
  .text { display: -webkit-box; overflow: hidden; color: var(--text-2); font-size: var(--font-sm); line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow-wrap: anywhere; }
  mark { border-radius: var(--radius-2xs); background: var(--found); color: var(--text); }
  p { padding: var(--space-2); color: var(--text-3); font-size: var(--font-md); }
</style>
