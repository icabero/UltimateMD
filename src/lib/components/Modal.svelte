<script lang="ts">
  import { untrack } from 'svelte';
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

<button class="scrim top" aria-label="Cancelar" onclick={() => dialog.resolve(null)}></button>
<form class="dialog" aria-label={dialog.title} {onsubmit}>
  <p>{dialog.title}</p>
  {#if dialog.value !== null}
    <input bind:value use:select />
  {/if}
  <div class="buttons">
    <button type="button" onclick={() => dialog.resolve(null)}>Cancelar</button>
    <button type="submit" class="main" class:danger={dialog.danger}>{dialog.action}</button>
  </div>
</form>

<style>
  .top { z-index: 50; }
  .dialog { position: fixed; top: 22vh; left: 50%; z-index: 51; width: min(420px, calc(100vw - 32px)); padding: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); box-shadow: var(--shadow); transform: translateX(-50%); }
  p { margin: 0 0 12px; font-size: 13.5px; }
  input { width: 100%; }
  .buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  button { padding: 6px 12px; border: 1px solid var(--line); border-radius: 7px; background: none; color: var(--text); font-size: 13px; }
  .main { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
  .main.danger { border-color: var(--danger); background: none; color: var(--danger); }
</style>
