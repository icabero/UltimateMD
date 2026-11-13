<script lang="ts">
  import Icon from './Icon.svelte';
  import NoteLook from './NoteLook.svelte';
  import { properties, setProperty, validKey } from '../frontmatter';
  import { tr, type Key } from '../i18n.svelte';
  import { store, type Tab } from '../store.svelte';

  let { tab }: { tab: Tab } = $props();

  /** The fields UltimateMD itself reads. The first key is the one written; the others are accepted too. */
  const KNOWN: { keys: string[]; label: Key; hint: Key; kind: 'text' | 'date' }[] = [
    { keys: ['titulo', 'title'], label: 'props.title', hint: 'props.titleHint', kind: 'text' },
    { keys: ['autor', 'author'], label: 'props.author', hint: 'props.authorHint', kind: 'text' },
    { keys: ['fecha', 'date'], label: 'props.date', hint: 'props.dateHint', kind: 'date' },
  ];

  const fields = $derived(properties(tab.content));
  const known = $derived(
    KNOWN.map((field) => {
      const found = fields.find((p) => field.keys.includes(p.key));
      return { ...field, key: found?.key ?? field.keys[0], value: found?.value ?? '', complex: found?.complex ?? false };
    }),
  );
  const others = $derived(fields.filter((p) => !KNOWN.some((k) => k.keys.includes(p.key))));

  function commit(key: string, value: string) {
    const next = setProperty(tab.content, key, value);
    if (next !== tab.content) store.edit(tab, next);
  }

  let newKey = $state('');
  let newValue = $state('');
  const taken = $derived(new Set(fields.map((p) => p.key)));
  const keyProblem = $derived(!newKey.trim() ? '' : !validKey(newKey) ? tr('props.badKey') : taken.has(newKey.trim()) ? tr('props.takenKey') : '');

  function add(e: SubmitEvent) {
    e.preventDefault();
    if (!newKey.trim() || keyProblem || !newValue.trim()) return;
    commit(newKey.trim(), newValue);
    newKey = newValue = '';
  }

  const today = () => new Date().toISOString().slice(0, 10);
</script>

<div class="props">
  {#each known as f (f.label)}
    {@const id = `prop-${f.keys[0]}`}
    <div class="field">
      <label class="name" for={id}>{tr(f.label)}</label>
      {#if f.complex}
        <span class="complex">{tr('props.complex')}</span>
      {:else}
        <span class="row">
          <input {id} aria-describedby="{id}-hint" value={f.value} placeholder={f.kind === 'date' ? tr('props.datePlaceholder') : ''} onchange={(e) => commit(f.key, e.currentTarget.value)} onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          {#if f.kind === 'date'}<button type="button" class="text" onclick={() => commit(f.key, today())}>{tr('props.today')}</button>{/if}
        </span>
      {/if}
      <span class="hint" id="{id}-hint">{tr(f.hint)}</span>
    </div>
  {/each}

  <NoteLook {tab} />

  <h3>{tr('props.others')}</h3>
  <p class="hint">{tr('props.othersHint')}</p>
  {#each others as p (p.key)}
    <div class="other">
      <span class="key" title={p.key}>{p.key}</span>
      {#if p.complex}
        <span class="complex">{tr('props.complex')}</span>
      {:else}
        <input aria-label={p.key} value={p.value} onchange={(e) => commit(p.key, e.currentTarget.value)} onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        <button type="button" class="icon small" title={tr('props.remove', { key: p.key })} onclick={() => commit(p.key, '')}><Icon name="close" size={14} /></button>
      {/if}
    </div>
  {/each}

  <form class="add" onsubmit={add}>
    <input bind:value={newKey} placeholder={tr('props.newKey')} aria-label={tr('props.newKey')} aria-invalid={!!keyProblem} />
    <input bind:value={newValue} placeholder={tr('props.newValue')} aria-label={tr('props.newValue')} />
    <button type="submit" class="text" disabled={!newKey.trim() || !!keyProblem || !newValue.trim()}>{tr('props.add')}</button>
  </form>
  {#if keyProblem}<p class="problem" role="alert">{keyProblem}</p>{/if}
</div>

<style>
  .props { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-1) var(--space-1) var(--space-4); }
  .field { display: flex; flex-direction: column; gap: var(--space-1); }
  .name { color: var(--text-2); font-size: var(--font-sm); font-weight: 600; }
  .row { display: flex; gap: var(--space-1-5); }
  .row input { flex: 1; min-width: 0; }
  input { width: 100%; height: 30px; font-size: var(--font-md); }

  .hint { margin: 0; color: var(--text-3); font-size: var(--font-xs); line-height: 1.4; }
  .complex { color: var(--text-3); font-size: var(--font-sm); font-style: italic; }
  h3 { margin: var(--space-2) 0 0; color: var(--text-3); font-size: var(--font-xs); font-weight: 600; letter-spacing: .02em; text-transform: uppercase; }
  .other { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) auto; align-items: center; gap: var(--space-1-5); }
  .key { overflow: hidden; color: var(--text-2); font: var(--font-sm) var(--mono); text-overflow: ellipsis; white-space: nowrap; }
  .add { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) auto; gap: var(--space-1-5); }
  .text { flex: none; height: 30px; padding: 0 var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--raised); color: var(--text); font-size: var(--font-sm); }
  .text:disabled { opacity: .5; }
  [aria-invalid='true'] { border-color: var(--danger); }
  .problem { margin: 0; color: var(--danger); font-size: var(--font-xs); }
</style>
