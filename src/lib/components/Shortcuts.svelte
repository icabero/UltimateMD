<script lang="ts">
  import { dim, pop } from '../motion';
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { fold } from '../fold';
  import { tr } from '../i18n.svelte';
  import { SHORTCUTS, keyLabel } from '../shortcuts';
  import { store } from '../store.svelte';

  let query = $state('');
  let input = $state<HTMLInputElement>();

  /**
   * Each word matches the action's name or one of its keys, so «ctrl k» finds Ctrl+K.
   * A single letter only matches a key: it would be in almost every name.
   */
  const groups = $derived.by(() => {
    const words = fold(query).split(/[\s+]+/).filter(Boolean);
    return SHORTCUTS.map((g) => ({
      title: g.title,
      items: g.items.filter((s) => {
        const name = fold(tr(s.label));
        const keys = new Set(s.keys.flat().flatMap((k) => [fold(k), fold(keyLabel(k))]));
        return words.every((w) => keys.has(w) || (w.length > 1 && name.includes(w)));
      }),
    })).filter((g) => g.items.length);
  });

  const close = () => (store.shortcuts = false);

  onMount(() => {
    input?.focus();
    // The shortcut that opened this list may come from the editor, which would keep the focus.
    requestAnimationFrame(() => input?.focus());
  });
</script>

<button in:dim class="scrim" aria-label={tr('common.close')} onclick={close}></button>
<div in:pop class="modal" role="dialog" aria-label={tr('shortcuts.title')}>
  <header>
    <h2>{tr('shortcuts.title')}</h2>
    <button class="icon" title={tr('common.close')} onclick={close}><Icon name="close" /></button>
  </header>
  <input bind:this={input} bind:value={query} placeholder={tr('shortcuts.filter')} aria-label={tr('shortcuts.filter')} />
  <div class="groups">
    {#each groups as group (group.title)}
      <section aria-label={tr(group.title)}>
        <h3>{tr(group.title)}</h3>
        <dl>
          {#each group.items as item (item.label)}
            <div class="row">
              <dt>{tr(item.label)}</dt>
              <dd>
                {#each item.keys as combo, i}
                  {#if i > 0}<span class="or">{tr('shortcuts.or')}</span>{/if}
                  <span class="combo">{#each combo as k}<kbd>{keyLabel(k)}</kbd>{/each}</span>
                {/each}
              </dd>
            </div>
          {/each}
        </dl>
      </section>
    {:else}
      <p class="none">{tr('shortcuts.none')}</p>
    {/each}
  </div>
</div>

<style>
  .modal { position: fixed; top: 50%; left: 50%; z-index: var(--z-dialog); display: flex; flex-direction: column; width: min(760px, calc(100vw - 32px)); max-height: min(680px, calc(100vh - 32px)); padding: var(--space-2) var(--space-5) var(--space-4); overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translate(-50%, -50%); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: var(--space-1-5) 0; font-size: var(--font-lg); font-weight: 650; }
  input { width: 100%; margin: var(--space-1) 0 var(--space-3); }
  .groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--space-2) var(--space-6); min-height: 0; overflow-y: auto; }
  h3 { margin: var(--space-2) 0 var(--space-1); color: var(--text-3); font-size: var(--font-xs); font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
  dl { margin: 0; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-1) 0; border-bottom: 1px solid var(--line); }
  dt { color: var(--text); font-size: var(--font-md); }
  dd { display: flex; flex: none; align-items: center; gap: var(--space-1); margin: 0; }
  .combo { display: flex; gap: var(--space-1); }
  .or { color: var(--text-3); font-size: var(--font-xs); }
  kbd { padding: 0 var(--space-1-5); border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--bg); color: var(--text-2); font: var(--font-xs)/1.7 var(--sans); }
  .none { margin: var(--space-3) 0; color: var(--text-3); font-size: var(--font-md); }
</style>
