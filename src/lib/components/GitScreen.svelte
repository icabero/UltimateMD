<script lang="ts">
  // What changed in a vault that is a Git repository, and a commit of it.
  // Pushing and pulling stay with the user's own Git program.
  import { dim, pop } from '../motion';
  import DiffView from './DiffView.svelte';
  import Icon from './Icon.svelte';
  import { api, type GitChange } from '../api';
  import { tr, type Key } from '../i18n.svelte';
  import { stem } from '../paths';
  import { store } from '../store.svelte';

  let { vaultId }: { vaultId: string } = $props();

  const STATES: Record<GitChange['state'], Key> = {
    modified: 'git.modified',
    added: 'git.added',
    deleted: 'git.deleted',
    renamed: 'git.renamed',
    untracked: 'git.untracked',
    conflict: 'git.conflict',
  };

  let message = $state('');
  let busy = $state(false);
  let error = $state('');
  let shown = $state<{ path: string; before: string; after: string } | null>(null);

  const vault = $derived(store.vault(vaultId));
  const status = $derived(store.git[vaultId] ?? null);
  const changes = $derived(status?.changes ?? []);

  async function show(change: GitChange) {
    error = '';
    try {
      const before = (await api.gitCommitted(vaultId, change.path)) ?? '';
      const after = change.state === 'deleted' ? '' : ((await store.noteReader(vaultId)(change.path)) ?? '');
      shown = { path: change.path, before, after };
    } catch (e) {
      error = String(e);
    }
  }

  async function commit() {
    busy = true;
    error = '';
    try {
      await store.saveAll();
      const id = await api.gitCommit(vaultId, message);
      message = '';
      shown = null;
      store.notify(tr('git.done', { id }));
      await store.loadGit(vaultId);
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }

  const close = () => (store.gitScreen = null);
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && !store.dialog) close(); }} />

<button in:dim class="scrim top" aria-label={tr('common.close')} onclick={close}></button>
<div in:pop class="modal" role="dialog" aria-label={tr('git.title', { name: vault?.name ?? '' })}>
  <div class="side">
    <header>
      <h2>{tr('git.title', { name: vault?.name ?? '' })}</h2>
      <button class="icon" title={tr('common.close')} onclick={close}><Icon name="close" /></button>
    </header>
    <p class="branch"><Icon name="branch" size={14} /> {status?.branch ?? tr('git.detached')}</p>
    {#if changes.length}
      <ul aria-label={tr('git.changes', { n: changes.length })}>
        {#each changes as change (change.path)}
          <li>
            <button class:on={shown?.path === change.path} title={change.path} onclick={() => show(change)}>
              <span class="state {change.state}">{tr(STATES[change.state])}</span>
              <span class="name">{stem(change.path)}</span>
            </button>
          </li>
        {/each}
      </ul>
      <label class="message">{tr('git.message')}
        <textarea bind:value={message} rows="3"></textarea>
      </label>
      <button class="primary" disabled={busy || !message.trim()} onclick={commit}>{tr('git.commit', { n: changes.length })}</button>
    {:else}
      <p class="none">{tr('git.none')}</p>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <p class="hint">{tr('git.noPush')}</p>
  </div>
  <div class="diff" role="region" aria-label={shown ? shown.path : tr('git.pick')}>
    {#if shown}
      <h3>{shown.path}</h3>
      <DiffView before={shown.before} after={shown.after} />
    {:else}
      <p class="none">{tr('git.pick')}</p>
    {/if}
  </div>
</div>

<style>
  .top { z-index: var(--z-nested-scrim); }
  .modal { position: fixed; top: 50%; left: 50%; z-index: var(--z-nested); display: grid; grid-template-columns: 320px 1fr; width: min(1040px, calc(100vw - 32px)); height: min(680px, calc(100vh - 32px)); overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translate(-50%, -50%); }
  .side { display: flex; flex-direction: column; gap: var(--space-2); min-height: 0; padding: var(--space-2) var(--space-4) var(--space-4); overflow-y: auto; }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: var(--space-2) 0 0; font-size: var(--font-lg); font-weight: 650; }
  h3 { margin: 0 0 var(--space-2); font-size: var(--font-sm); font-weight: 650; }
  p { margin: 0; color: var(--text-2); font-size: var(--font-sm); line-height: 1.5; }
  .branch { display: flex; align-items: center; gap: var(--space-1-5); color: var(--text); }
  ul { margin: 0; padding: 0; list-style: none; }
  li button { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding: var(--space-1) var(--space-1-5); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text); font-size: var(--font-sm); text-align: left; }
  li button:hover { background: var(--hover); }
  li button.on { background: var(--accent-soft); }
  .state { flex: none; width: 96px; color: var(--text-2); font-size: var(--font-xs); }
  .state.conflict { color: var(--danger); }
  .name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .message { display: flex; flex-direction: column; gap: var(--space-1); color: var(--text-2); font-size: var(--font-sm); }
  textarea { padding: var(--space-1-5) var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); color: var(--text); font: inherit; resize: vertical; }
  .primary { align-self: flex-start; padding: var(--space-1-5) var(--space-3); border: 0; border-radius: var(--radius-sm); background: var(--accent); color: var(--on-accent); font-size: var(--font-sm); }
  .primary:disabled { opacity: .5; }
  .error { color: var(--danger); white-space: pre-wrap; }
  .hint { margin-top: auto; font-size: var(--font-xs); }
  .diff { min-width: 0; min-height: 0; padding: var(--space-3) var(--space-4); overflow: auto; border-left: 1px solid var(--line); background: var(--panel); }
  .none { color: var(--text-2); }
</style>
