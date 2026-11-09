<script lang="ts">
  import { dim, pop } from '../motion';
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { api, type BrokenLink } from '../api';
  import { tr } from '../i18n.svelte';
  import { baseName, dirName, stem } from '../paths';
  import { store } from '../store.svelte';

  let { vaultId }: { vaultId: string } = $props();

  let links = $state<BrokenLink[] | null>(null);
  let busy = $state(false);

  const vaultName = $derived(store.vault(vaultId)?.name ?? '');
  /** The notes with broken links, in the order the vault lists them; their links come together. */
  const groups = $derived.by(() => {
    const out: [string, BrokenLink[]][] = [];
    for (const link of links ?? []) {
      const last = out.at(-1);
      if (last?.[0] === link.note) last[1].push(link);
      else out.push([link.note, [link]]);
    }
    return out;
  });
  const noteCount = $derived(groups.length);

  async function load() {
    try {
      await store.saveAll();
      links = await api.brokenLinks(vaultId);
    } catch (e) {
      store.notify(e);
      links = [];
    }
  }

  /** Runs a fix, then reads the vault again: one fix can mend other links too. */
  async function fix(action: () => Promise<unknown>) {
    busy = true;
    try {
      await store.saveAll();
      await action();
      await store.refreshTree(vaultId);
      links = await api.brokenLinks(vaultId);
    } catch (e) {
      store.notify(e);
    } finally {
      busy = false;
    }
  }

  const repoint = (link: BrokenLink) => fix(() => api.repointLink(vaultId, link.note, link.target, link.suggestion!));
  const create = (link: BrokenLink) => fix(() => store.createNote(vaultId, dirName(link.note), link.target, '', false));

  function show(link: BrokenLink) {
    // Closing empties the prop, so the vault is read first.
    const id = vaultId;
    close();
    void store.openAt(id, link.note, link.line, [link.target]);
  }

  const close = () => (store.brokenLinks = null);
  const name = (path: string) => (/\.(md|markdown)$/i.test(path) ? stem(path) : baseName(path));

  onMount(load);
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && !store.dialog) close(); }} />

<button in:dim class="scrim" aria-label={tr('common.close')} onclick={close}></button>
<div in:pop class="modal" role="dialog" aria-label={tr('broken.title', { name: vaultName })}>
  <header>
    <h2>{tr('broken.title', { name: vaultName })}</h2>
    <button class="icon" title={tr('common.close')} onclick={close}><Icon name="close" /></button>
  </header>

  {#if links === null}
    <p class="hint">{tr('broken.looking')}</p>
  {:else if !links.length}
    <p class="empty">{tr('broken.none')}</p>
  {:else}
    <p class="hint">{links.length === 1 ? tr('broken.summaryOne') : tr(noteCount === 1 ? 'broken.summaryOneNote' : 'broken.summary', { links: links.length, notes: noteCount })}</p>
    <div class="list" aria-busy={busy}>
      {#each groups as [note, items] (note)}
        <section>
          <h3 title={note}>{name(note)}</h3>
          {#each items as link (`${link.target}:${link.line}`)}
            <div class="link">
              <button class="where" title={tr('broken.show')} onclick={() => show(link)}>
                <code>{link.target}</code>
                <span class="line">{tr('broken.line', { n: link.line })}</span>
              </button>
              <div class="actions">
                {#if link.suggestion}
                  <button class="plain" disabled={busy} title={link.suggestion} onclick={() => repoint(link)}>{tr('broken.use', { name: name(link.suggestion) })}</button>
                {/if}
                {#if link.toNote}
                  <button class="plain" disabled={busy} onclick={() => create(link)}>{tr('broken.create')}</button>
                {/if}
              </div>
            </div>
          {/each}
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .modal { position: fixed; top: 50%; left: 50%; z-index: var(--z-dialog); display: flex; flex-direction: column; width: min(640px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 32px)); padding: var(--space-2) var(--space-5) var(--space-4); overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translate(-50%, -50%); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: var(--space-2) 0; font-size: var(--font-lg); font-weight: 650; }
  h3 { margin: var(--space-3-5) 0 var(--space-1); overflow: hidden; font-size: var(--font-sm); font-weight: 650; white-space: nowrap; text-overflow: ellipsis; }
  p { margin: 0; color: var(--text-2); font-size: var(--font-sm); line-height: 1.5; }
  .empty { padding: var(--space-6) 0; text-align: center; }
  .list { min-height: 0; margin-top: var(--space-1); overflow-y: auto; }
  .list[aria-busy='true'] { opacity: .6; }
  .link { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-1) 0; border-top: 1px solid var(--line); }
  .where { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0; padding: var(--space-1) var(--space-1-5); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text); text-align: left; }
  .where:hover { background: var(--hover); }
  code { overflow: hidden; font: var(--font-sm) var(--mono); white-space: nowrap; text-overflow: ellipsis; }
  .line { flex: none; color: var(--text-3); font-size: var(--font-xs); }
  .actions { display: flex; flex: none; gap: var(--space-1-5); }
  .plain { max-width: 220px; overflow: hidden; padding: var(--space-1) var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: none; color: var(--text); font-size: var(--font-sm); white-space: nowrap; text-overflow: ellipsis; }
  .plain:hover:not(:disabled) { background: var(--hover); }
</style>
