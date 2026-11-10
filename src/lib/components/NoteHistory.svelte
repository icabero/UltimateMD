<script lang="ts">
  import { dim, pop } from '../motion';
  import DiffView from './DiffView.svelte';
  import Icon from './Icon.svelte';
  import { api, type Snapshot } from '../api';
  import { language, tr, type Key } from '../i18n.svelte';
  import { store, type Tab } from '../store.svelte';

  /** The versions the app kept of a note: see what each had and bring one back. */
  let { tab }: { tab: Tab } = $props();

  const SOURCES: Record<Snapshot['source'], Key> = {
    edit: 'history.edit',
    'before-ai': 'history.beforeAi',
    'before-restore': 'history.beforeRestore',
  };

  let versions = $state<Snapshot[] | null>(null);
  let shown = $state<{ version: Snapshot; text: string } | null>(null);
  let run = 0;

  // Read again when the note is saved, as that may have kept a version.
  $effect(() => {
    const { vaultId, path } = tab;
    void tab.version;
    const id = ++run;
    void api.historyList(vaultId, path).then(
      (found) => id === run && (versions = found),
      () => id === run && (versions = []),
    );
  });

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  function when(time: number) {
    const date = new Date(time);
    const clock = date.toLocaleTimeString(language(), { hour: '2-digit', minute: '2-digit' });
    if (sameDay(date, new Date())) return tr('history.today', { time: clock });
    return `${date.toLocaleDateString(language(), { day: 'numeric', month: 'short', year: 'numeric' })}, ${clock}`;
  }

  async function show(version: Snapshot) {
    try {
      shown = { version, text: await api.historyRead(tab.vaultId, version.blob) };
    } catch (e) {
      store.notify(e);
    }
  }

  async function restore() {
    if (!shown) return;
    await store.restoreVersion(tab, shown.text);
    shown = null;
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') shown = null; }} />

{#if versions === null}
  <p class="empty">{tr('history.loading')}</p>
{:else if !versions.length}
  <p class="empty">{tr('history.none')}</p>
{:else}
  <p class="empty">{tr('history.hint')}</p>
  <ol aria-label={tr('panel.history')}>
    {#each versions as v (`${v.time}:${v.blob}`)}
      <li>
        <button class="version" onclick={() => show(v)}>
          <span class="when">{when(v.time)}</span>
          <span class="source">{tr(SOURCES[v.source])}</span>
        </button>
      </li>
    {/each}
  </ol>
{/if}

{#if shown}
  <button in:dim class="scrim" aria-label={tr('common.close')} onclick={() => (shown = null)}></button>
  <div in:pop class="modal" role="dialog" aria-label={tr('history.versionOf', { when: when(shown.version.time) })}>
    <header>
      <h2>{tr('history.versionOf', { when: when(shown.version.time) })}</h2>
      <button class="icon" title={tr('common.close')} onclick={() => (shown = null)}><Icon name="close" /></button>
    </header>
    {#if shown.text === tab.content}
      <p class="same">{tr('history.same')}</p>
    {:else}
      <p class="same">{tr('history.diffHint')}</p>
      <DiffView before={tab.content} after={shown.text} />
    {/if}
    <footer>
      <button class="plain" onclick={() => (shown = null)}>{tr('common.close')}</button>
      <button class="main" disabled={shown.text === tab.content} onclick={restore}>{tr('history.restore')}</button>
    </footer>
  </div>
{/if}

<style>
  ol { margin: 0; padding: 0; list-style: none; }
  .version { display: block; width: 100%; padding: var(--space-1) var(--space-2); border: 0; border-radius: var(--radius-sm); background: none; text-align: left; }
  .version:hover { background: var(--hover); }
  .when { display: block; color: var(--text); font-size: var(--font-sm); }
  .source { display: block; color: var(--text-3); font-size: var(--font-xs); }
  .empty { margin: 0; padding: var(--space-1) var(--space-2) var(--space-2); color: var(--text-3); font-size: var(--font-sm); line-height: 1.45; }
  .modal { position: fixed; top: 50%; left: 50%; z-index: var(--z-dialog); display: flex; flex-direction: column; width: min(820px, calc(100vw - 32px)); max-height: min(680px, calc(100vh - 32px)); padding: var(--space-2) var(--space-5) var(--space-4); overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translate(-50%, -50%); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: var(--space-1-5) 0; font-size: var(--font-lg); font-weight: 650; }
  .same { margin: 0 0 var(--space-2); color: var(--text-2); font-size: var(--font-sm); }
  footer { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-3); }
  .plain { padding: var(--space-1-5) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: none; color: var(--text); font-size: var(--font-md); }
  .plain:hover { background: var(--hover); }
  .main { padding: var(--space-1-5) var(--space-4); border: 1px solid var(--accent); border-radius: var(--radius-md); background: var(--accent); color: var(--on-accent); font-size: var(--font-md); }
  .main:disabled { opacity: .5; }
</style>
