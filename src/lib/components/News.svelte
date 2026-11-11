<script lang="ts">
  import { dim, pop } from '../motion';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import Icon from './Icon.svelte';
  import { tr } from '../i18n.svelte';
  import { NEWS } from '../news';
  import { store } from '../store.svelte';
  import { RELEASES_URL } from '../updates';

  /** What a version brought, shown once after updating and whenever asked for. */
  let { version }: { version: string } = $props();

  const close = () => (store.news = null);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<button in:dim class="scrim" aria-label={tr('common.close')} onclick={close}></button>
<div in:pop class="modal" role="dialog" aria-label={tr('news.title', { version })}>
  <header>
    <h2>{tr('news.title', { version })}</h2>
    <button class="icon" title={tr('common.close')} onclick={close}><Icon name="close" /></button>
  </header>
  <ul>
    {#each NEWS[version] ?? [] as item (item.title)}
      <li>
        <strong>{tr(item.title)}</strong>
        <span>{tr(item.text)}</span>
      </li>
    {/each}
  </ul>
  <footer>
    <button class="link" onclick={() => openUrl(`${RELEASES_URL}/tag/v${version}.0`).catch((e) => store.fail(e))}>{tr('news.all')}</button>
    <button class="main" onclick={close}>{tr('news.close')}</button>
  </footer>
</div>

<style>
  .modal { position: fixed; top: 50%; left: 50%; z-index: var(--z-dialog); display: flex; flex-direction: column; width: min(560px, calc(100vw - 32px)); max-height: min(680px, calc(100vh - 32px)); padding: var(--space-2) var(--space-5) var(--space-4); overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translate(-50%, -50%); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: var(--space-1-5) 0; font-size: var(--font-lg); font-weight: 650; }
  ul { min-height: 0; margin: var(--space-1) 0 0; padding: 0; overflow-y: auto; list-style: none; }
  li { padding: var(--space-2) 0; border-top: 1px solid var(--line); }
  strong { display: block; color: var(--text); font-size: var(--font-md); font-weight: 600; }
  span { display: block; margin-top: var(--space-0-5); color: var(--text-2); font-size: var(--font-sm); line-height: 1.5; }
  footer { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-top: var(--space-3); }
  .link { padding: 0; border: 0; background: none; color: var(--accent-text); font-size: var(--font-sm); }
  .link:hover { text-decoration: underline; }
  .main { padding: var(--space-1-5) var(--space-4); border: 1px solid var(--accent); border-radius: var(--radius-md); background: var(--accent); color: var(--on-accent); font-size: var(--font-md); }
</style>
