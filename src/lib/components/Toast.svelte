<script lang="ts">
  import Icon from './Icon.svelte';
  import { tr } from '../i18n.svelte';
  import { rise } from '../motion';
  import { store, type Toast } from '../store.svelte';

  let { toast }: { toast: Toast } = $props();
  let open = $state(false);

  const hover = (inside: boolean) => store.holdToast(inside || open);

  function run(action: () => void) {
    store.toast = null;
    action();
  }

  function toggle() {
    open = !open;
    store.holdToast(open);
  }
</script>

<div class="toast" class:wide={open} in:rise role="group" aria-label={tr('toast.label')} onmouseenter={() => hover(true)} onmouseleave={() => hover(false)}>
  <div class="line">
    <p role="status">{toast.message}</p>
    {#if toast.details}
      <button class="link" aria-expanded={open} onclick={toggle}>{tr(open ? 'toast.hideDetails' : 'toast.showDetails')}</button>
    {/if}
    {#each toast.actions as a (a.label)}
      <button class="action" onclick={() => run(a.run)}>{a.label}</button>
    {/each}
    {#if toast.actions.length || toast.details}
      <button class="x" title={tr('toast.close')} onclick={() => (store.toast = null)}><Icon name="close" size={14} /></button>
    {/if}
  </div>
  {#if open && toast.details}<pre>{toast.details}</pre>{/if}
</div>

<style>
  .toast { position: fixed; bottom: 36px; left: 50%; z-index: var(--z-toast); max-width: min(560px, calc(100vw - 32px)); padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3-5); border-radius: var(--radius-md); background: var(--text); color: var(--bg); box-shadow: var(--shadow-lg); font-size: var(--font-md); transform: translateX(-50%); }
  .toast.wide { width: min(560px, calc(100vw - 32px)); }
  .line { display: flex; align-items: center; gap: var(--space-2); min-height: 26px; }
  p { flex: 1; margin: 0; padding-right: var(--space-1); }
  button { flex: none; border: 0; background: none; color: inherit; font-size: var(--font-sm); }
  .action { padding: var(--space-1) var(--space-2-5); border-radius: var(--radius-sm); background: color-mix(in srgb, var(--bg) 16%, transparent); font-weight: 600; }
  .action:hover { background: color-mix(in srgb, var(--bg) 26%, transparent); }
  .link { padding: var(--space-1); text-decoration: underline; text-underline-offset: 2px; opacity: .85; }
  .x { display: flex; padding: var(--space-1); border-radius: var(--radius-sm); opacity: .7; }
  .x:hover { opacity: 1; }
  pre { max-height: 40vh; margin: var(--space-2) 0 var(--space-1); padding: var(--space-2); overflow: auto; border-radius: var(--radius-sm); background: color-mix(in srgb, var(--bg) 12%, transparent); font: var(--font-xs)/1.5 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
</style>
