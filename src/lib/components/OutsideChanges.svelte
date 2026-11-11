<script lang="ts">
  import { dim, pop } from '../motion';
  import DiffView from './DiffView.svelte';
  import Icon from './Icon.svelte';
  import { tr } from '../i18n.svelte';
  import { baseName } from '../paths';
  import { store, type Tab } from '../store.svelte';

  /** What changed in a note outside the app, with a way to undo it. */
  let { tab }: { tab: Tab } = $props();

  const close = () => (store.outsideDiff = false);
  const title = $derived(tr(tab.outside?.ai ? 'outside.aiTitle' : 'outside.title', { name: baseName(tab.path).replace(/\.(md|markdown)$/i, '') }));

  async function undo() {
    await store.undoOutside(tab);
    close();
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<button in:dim class="scrim" aria-label={tr('common.close')} onclick={close}></button>
<div in:pop class="modal" role="dialog" aria-label={title}>
  <header>
    <h2>{title}</h2>
    <button class="icon" title={tr('common.close')} onclick={close}><Icon name="close" /></button>
  </header>
  {#if tab.outside}
    <DiffView before={tab.outside.before} after={tab.content} />
    <footer>
      <button class="plain" onclick={undo}>{tr('outside.undo')}</button>
      <button class="main" onclick={() => { tab.outside = null; close(); }}>{tr('outside.keep')}</button>
    </footer>
  {/if}
</div>

<style>
  .modal { position: fixed; top: 50%; left: 50%; z-index: var(--z-dialog); display: flex; flex-direction: column; width: min(820px, calc(100vw - 32px)); max-height: min(680px, calc(100vh - 32px)); padding: var(--space-2) var(--space-5) var(--space-4); overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translate(-50%, -50%); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: var(--space-1-5) 0; font-size: var(--font-lg); font-weight: 650; }
  footer { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-3); }
  .plain { padding: var(--space-1-5) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: none; color: var(--text); font-size: var(--font-md); }
  .plain:hover { background: var(--hover); }
  .main { padding: var(--space-1-5) var(--space-4); border: 1px solid var(--accent); border-radius: var(--radius-md); background: var(--accent); color: var(--on-accent); font-size: var(--font-md); }
</style>
