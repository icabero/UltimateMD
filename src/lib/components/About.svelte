<script lang="ts">
  import { dim, pop } from '../motion';
  import { getVersion } from '@tauri-apps/api/app';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { listen } from '@tauri-apps/api/event';
  import { onMount, untrack } from 'svelte';
  import { api } from '../api';
  import Icon from './Icon.svelte';
  import { tr } from '../i18n.svelte';
  import { store } from '../store.svelte';
  import { RELEASES_URL, REPOSITORY_URL, checksAtStart, isNewer, latestVersion, setChecksAtStart } from '../updates';

  type Check = { state: 'idle' | 'checking' | 'current' | 'none' | 'failed' } | { state: 'available'; version: string };

  const known = untrack(() => store.update);
  let version = $state('');
  let check = $state<Check>(known ? { state: 'available', version: known } : { state: 'idle' });
  let auto = $state(checksAtStart());

  /** Whether this copy can install the update itself. */
  let selfUpdate = $state(false);
  let installing = $state<{ percent: number | null } | null>(null);
  let installFailed = $state(false);

  onMount(() => {
    void getVersion().then((v) => (version = v), () => {});
    void api.updateSupported().then((ok) => (selfUpdate = ok), () => {});
    const stop = listen<{ done: number; total: number | null }>('update-progress', ({ payload }) => {
      if (installing) installing = { percent: payload.total ? Math.min(100, Math.round((payload.done / payload.total) * 100)) : null };
    });
    return () => void stop.then((off) => off());
  });

  /** Saves everything, then lets the app replace itself and start again. */
  async function install() {
    installFailed = false;
    installing = { percent: null };
    try {
      await store.saveAll();
      await api.updateInstall();
    } catch (e) {
      void api.logError('update', String(e)).catch(() => {});
      installFailed = true;
    }
    installing = null;
  }

  async function search() {
    check = { state: 'checking' };
    try {
      const latest = await latestVersion();
      if (latest === null) check = { state: 'none' };
      else if (isNewer(latest, version)) {
        check = { state: 'available', version: latest };
        store.update = latest;
      } else check = { state: 'current' };
    } catch {
      check = { state: 'failed' };
    }
  }

  const open = (url: string) => openUrl(url).catch((e) => store.fail(e));
</script>

<button in:dim class="scrim" aria-label={tr('common.close')} onclick={() => (store.about = false)}></button>
<div in:pop class="modal" role="dialog" aria-label={tr('about.title')}>
  <header>
    <h2>Ultimate<b>MD</b></h2>
    <button class="icon" title={tr('common.close')} onclick={() => (store.about = false)}><Icon name="close" /></button>
  </header>
  {#if version}<p class="version">{tr('about.version', { version })}</p>{/if}
  <p>{tr('about.description')}</p>

  <div class="links">
    <button onclick={() => { store.about = false; void store.showNews(); }}>{tr('news.open')}</button>
    <button onclick={() => open(REPOSITORY_URL)}>{tr('about.repository')}</button>
    <button onclick={() => open(`${REPOSITORY_URL}/blob/main/LICENSE`)}>{tr('about.license')}</button>
  </div>

  <h3>{tr('about.updates')}</h3>
  <div class="check">
    <button class="plain" disabled={check.state === 'checking'} onclick={search}>{tr(check.state === 'checking' ? 'about.checking' : 'about.check')}</button>
    {#if check.state === 'current'}
      <span role="status">{tr('about.upToDate')}</span>
    {:else if check.state === 'none'}
      <span role="status">{tr('about.noReleases')}</span>
    {:else if check.state === 'failed'}
      <span role="status" class="bad">{tr('about.failed')}</span>
    {:else if check.state === 'available'}
      <span role="status">{tr('about.available', { version: check.version })}</span>
      {#if installing}
        <span role="status">{installing.percent === null ? tr('about.installing') : tr('about.downloading', { n: installing.percent })}</span>
      {:else}
        {#if selfUpdate}<button class="plain primary" onclick={install}>{tr('about.install')}</button>{/if}
        <button class="plain" onclick={() => open(RELEASES_URL)}>{tr('about.download')}</button>
      {/if}
      {#if installFailed}<p class="bad" role="alert">{tr('about.installFailed')}</p>{/if}
      {#if !selfUpdate}<p class="note">{tr('about.systemPackage')}</p>{/if}
    {/if}
  </div>
  <label><input type="checkbox" bind:checked={auto} onchange={() => setChecksAtStart(auto)} /> {tr('about.auto')}</label>
</div>

<style>
  .modal { position: fixed; top: 50%; left: 50%; z-index: var(--z-dialog); width: min(440px, calc(100vw - 32px)); padding: var(--space-2-5) var(--space-5) var(--space-5); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translate(-50%, -50%); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: var(--space-1-5) 0; color: var(--text-2); font-size: var(--font-xl); font-weight: 400; letter-spacing: -.02em; }
  b { color: var(--text); font-weight: 700; }
  h3 { margin: var(--space-5) 0 var(--space-2); font-size: var(--font-sm); font-weight: 650; }
  p { margin: 0 0 var(--space-2); color: var(--text-2); font-size: var(--font-md); line-height: 1.5; }
  .version { color: var(--text-3); font-size: var(--font-sm); }
  .links { display: flex; gap: var(--space-3-5); }
  .links button { padding: 0; border: 0; background: none; color: var(--accent-text); font-size: var(--font-sm); }
  .links button:hover { text-decoration: underline; }
  .check { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); color: var(--text-2); font-size: var(--font-sm); }
  .bad { color: var(--danger); }
  .plain { padding: var(--space-1) var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: none; color: var(--text); font-size: var(--font-sm); }
  .plain:hover { background: var(--hover); }
  .plain.primary { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
  .check p { flex-basis: 100%; margin: 0; font-size: var(--font-sm); }
  .note { color: var(--text-3); }
  label { display: flex; align-items: center; gap: var(--space-1-5); margin-top: var(--space-3); color: var(--text-2); font-size: var(--font-sm); }
</style>
