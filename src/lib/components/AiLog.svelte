<script lang="ts">
  import { dim, pop } from '../motion';
  import { onMount } from 'svelte';
  import DiffView from './DiffView.svelte';
  import Icon from './Icon.svelte';
  import { api, type AiEntry } from '../api';
  import { language, tr, type Key } from '../i18n.svelte';
  import { baseName } from '../paths';
  import { store } from '../store.svelte';

  /** What the AI did in a vault through the MCP server, newest first, each with a way to see it and take it back. */
  let { vaultId }: { vaultId: string } = $props();

  const vaultName = $derived(store.vault(vaultId)?.name ?? '');
  let entries = $state<AiEntry[] | null>(null);
  let busy = $state(false);
  /** The entry whose changes show, with the note before and now. */
  let shown = $state<{ id: string; before: string; after: string } | null>(null);

  const ACTIONS: Record<string, Key> = {
    create_note: 'aiLog.created',
    update_note: 'aiLog.updated',
    append_note: 'aiLog.appended',
    insert_at_heading: 'aiLog.inserted',
    add_diagram_image: 'aiLog.diagram',
    move_note: 'aiLog.moved',
    delete_note: 'aiLog.deleted',
  };

  const name = (path: string) => baseName(path).replace(/\.(md|markdown)$/i, '');
  const when = (time: number) => new Date(time).toLocaleString(language(), { dateStyle: 'medium', timeStyle: 'short' });
  const describe = (e: AiEntry) => tr(ACTIONS[e.tool] ?? 'aiLog.updated', { name: name(e.path), from: e.from ? name(e.from) : '' });

  async function load() {
    entries = await api.aiLog(vaultId).catch((e) => {
      store.fail(e);
      return [];
    });
  }

  async function show(entry: AiEntry) {
    if (shown?.id === entry.id) return (shown = null);
    if (!entry.before) return;
    try {
      const before = await api.historyRead(vaultId, entry.before);
      const after = entry.tool === 'delete_note' ? '' : (await api.read(vaultId, entry.path)).content;
      shown = { id: entry.id, before, after };
    } catch (e) {
      store.fail(e);
    }
  }

  async function undo(entry: AiEntry) {
    busy = true;
    try {
      await api.aiUndo(vaultId, entry.id);
      store.notify(tr('aiLog.undone'));
    } catch (e) {
      store.notify(String(e).includes('changed since') ? tr('aiLog.editedSince', { name: name(entry.path) }) : e);
    }
    shown = null;
    await store.reread(vaultId);
    await load();
    busy = false;
  }

  function open(entry: AiEntry) {
    if (entry.tool === 'delete_note' && !entry.undone) return;
    store.aiLog = null;
    void store.openFile(vaultId, entry.undone && entry.from ? entry.from : entry.path);
  }

  const close = () => (store.aiLog = null);
  onMount(load);
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && !store.dialog) close(); }} />

<button in:dim class="scrim" aria-label={tr('common.close')} onclick={close}></button>
<div in:pop class="modal" role="dialog" aria-label={tr('aiLog.title', { name: vaultName })}>
  <header>
    <h2>{tr('aiLog.title', { name: vaultName })}</h2>
    <button class="icon" title={tr('common.close')} onclick={close}><Icon name="close" /></button>
  </header>

  {#if entries === null}
    <p class="hint">{tr('aiLog.loading')}</p>
  {:else if !entries.length}
    <p class="empty">{tr('aiLog.none')}</p>
  {:else}
    <p class="hint">{tr('aiLog.hint')}</p>
    <ol class="list" aria-busy={busy}>
      {#each entries as entry (entry.id)}
        <li class:undone={entry.undone}>
          <div class="row">
            <button class="what" title={entry.path} onclick={() => open(entry)}>
              <span class="text">{describe(entry)}</span>
              <span class="when">{when(entry.time)}</span>
            </button>
            <div class="actions">
              {#if entry.undone}
                <span class="done">{tr('aiLog.wasUndone')}</span>
              {:else}
                {#if entry.before}
                  <button class="plain" aria-expanded={shown?.id === entry.id} onclick={() => show(entry)}>{tr('outside.show')}</button>
                {/if}
                <button class="plain" disabled={busy} onclick={() => undo(entry)}>{tr('common.undo')}</button>
              {/if}
            </div>
          </div>
          {#if shown?.id === entry.id}
            <div class="changes"><DiffView before={shown.before} after={shown.after} /></div>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .modal { position: fixed; top: 50%; left: 50%; z-index: var(--z-dialog); display: flex; flex-direction: column; width: min(720px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 32px)); padding: var(--space-2) var(--space-5) var(--space-4); overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translate(-50%, -50%); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: var(--space-1-5) 0; font-size: var(--font-lg); font-weight: 650; }
  .hint, .empty { margin: 0 0 var(--space-2); color: var(--text-2); font-size: var(--font-sm); line-height: 1.5; }
  .empty { padding: var(--space-5) 0; text-align: center; }
  .list { min-height: 0; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
  li { border-top: 1px solid var(--line); }
  .row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-1-5) 0; }
  .what { display: flex; flex: 1; flex-direction: column; min-width: 0; padding: var(--space-1) var(--space-1-5); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text); text-align: left; }
  .what:hover { background: var(--hover); }
  .text { overflow: hidden; font-size: var(--font-md); white-space: nowrap; text-overflow: ellipsis; }
  .when { color: var(--text-3); font-size: var(--font-xs); }
  .undone .text { color: var(--text-3); text-decoration: line-through; }
  .actions { display: flex; flex: none; align-items: center; gap: var(--space-1-5); }
  .done { color: var(--text-3); font-size: var(--font-sm); }
  .plain { padding: var(--space-1) var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: none; color: var(--text); font-size: var(--font-sm); }
  .plain:hover:not(:disabled) { background: var(--hover); }
  .changes { display: flex; flex-direction: column; max-height: 260px; margin-bottom: var(--space-2); }
</style>
