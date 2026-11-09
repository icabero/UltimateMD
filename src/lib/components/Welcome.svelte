<script lang="ts">
  import { tr } from '../i18n.svelte';
  import { store } from '../store.svelte';
  const keys = $derived([['Ctrl P', tr('welcome.openNote')], [tr('keys.searchAll'), tr('welcome.searchAll')], ['Ctrl N', tr('welcome.newNote')], ['Ctrl \\', tr('welcome.changeView')]]);
</script>

<div class="wrap">
  <h1>Ultimate<b>MD</b></h1>
  {#if store.openVaults.length === 0}
    <p>{tr('welcome.intro')}</p>
  {:else}
    <dl>
      {#each keys as [key, label]}
        <div><dt>{key}</dt><dd>{label}</dd></div>
      {/each}
    </dl>
  {/if}
</div>

<style>
  .wrap { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: var(--space-6); background: var(--bg); text-align: center; }
  h1 { margin: 0 0 var(--space-3-5); color: var(--text-2); font-size: var(--font-2xl); font-weight: 400; letter-spacing: -.02em; }
  b { color: var(--text); font-weight: 700; }
  p { max-width: 380px; color: var(--text-2); font-size: var(--font-base); line-height: 1.5; }
  dl { display: grid; gap: var(--space-2); margin: var(--space-2) 0 0; }
  div { display: flex; gap: var(--space-3); align-items: center; font-size: var(--font-md); }
  dt { min-width: 104px; padding: var(--space-0-5) var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); color: var(--text-2); font: var(--font-xs) var(--mono); }
  dd { margin: 0; color: var(--text-2); }
</style>
