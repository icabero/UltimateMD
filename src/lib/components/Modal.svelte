<script lang="ts">
  import { dim, pop } from '../motion';
  import { untrack } from 'svelte';
  import { tr } from '../i18n.svelte';
  import { store, type Dialog } from '../store.svelte';

  let { dialog }: { dialog: Dialog } = $props();
  let value = $state(untrack(() => dialog.value ?? ''));

  function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    dialog.resolve(dialog.value === null ? '' : value);
  }

  function select(el: HTMLInputElement) {
    el.focus();
    const dot = value.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : value.length);
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') store.dialog?.resolve(null); }} />

<button in:dim class="scrim top" aria-label={tr('common.cancel')} onclick={() => dialog.resolve(null)}></button>
<form in:pop class="dialog" aria-label={dialog.title} {onsubmit}>
  <p>{dialog.title}</p>
  {#if dialog.value !== null}
    <input bind:value use:select />
  {/if}
  <div class="buttons">
    <button type="button" onclick={() => dialog.resolve(null)}>{tr('common.cancel')}</button>
    <button type="submit" class="main" class:danger={dialog.danger}>{dialog.action}</button>
  </div>
</form>

<style>
  .top { z-index: var(--z-confirm-scrim); }
  .dialog { position: fixed; top: 22vh; left: 50%; z-index: var(--z-confirm); width: min(420px, calc(100vw - 32px)); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translateX(-50%); }
  p { margin: 0 0 var(--space-3); font-size: var(--font-md); }
  input { width: 100%; }
  .buttons { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-3-5); }
  button { padding: var(--space-1-5) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: none; color: var(--text); font-size: var(--font-md); }
  .main { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
  .main.danger { border-color: var(--danger); background: none; color: var(--danger); }
</style>
