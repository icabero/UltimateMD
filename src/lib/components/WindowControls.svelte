<script lang="ts">
  import Icon from './Icon.svelte';
  import { frame } from '../frame.svelte';
  import { tr } from '../i18n.svelte';
  import { store } from '../store.svelte';

  async function close() {
    // Saved first, as when the window loses the focus.
    await store.saveAll();
    frame.close();
  }
</script>

<div class="controls" role="group" aria-label={tr('frame.controls')}>
  <button title={tr('frame.minimize')} onclick={() => frame.minimize()}><Icon name="minimize" /></button>
  <button title={tr(frame.maximized ? 'frame.restore' : 'frame.maximize')} onclick={() => frame.toggleMaximize()}><Icon name={frame.maximized ? 'restore' : 'maximize'} size={14} /></button>
  <button class="close" title={tr('frame.close')} onclick={close}><Icon name="close" /></button>
</div>

<style>
  .controls { position: absolute; top: 0; right: 0; z-index: var(--z-raised); display: flex; height: 38px; }
  button { display: flex; align-items: center; justify-content: center; width: 46px; height: 100%; padding: 0; border: 0; background: none; color: var(--text-2); transition: background var(--ease), color var(--ease); }
  button:hover { background: var(--hover); color: var(--text); }
  .close:hover { background: #c42b1c; color: #fff; }
</style>
