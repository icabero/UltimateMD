<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { api } from '../api';
  import { fold } from '../fold';
  import { tr } from '../i18n.svelte';
  import { dim, pop } from '../motion';
  import { store } from '../store.svelte';

  let { vaultId, dir }: { vaultId: string; dir: string } = $props();

  let names = $state<string[] | null>(null);
  let query = $state('');
  let index = $state(0);
  let input = $state<HTMLInputElement>();

  async function load() {
    names = await api.noteTemplates(vaultId).catch(() => []);
  }

  onMount(() => {
    void load();
    // At once, so typing right after the shortcut lands here, and again once drawn.
    input?.focus();
    requestAnimationFrame(() => input?.focus());
  });

  /** A blank note first, then the templates that match. */
  const options = $derived([null, ...(names ?? []).filter((n) => fold(n).includes(fold(query.trim())))] as (string | null)[]);
  const close = () => (store.templatePicker = null);

  function pick(name: string | null) {
    // Read before closing: the props go when the picker does.
    const [vault, folder] = [vaultId, dir];
    close();
    void store.createFromTemplate(vault, folder, name);
  }

  async function remove(name: string) {
    if (!(await store.confirm(tr('templates.deleteConfirm', { name }), tr('common.delete'), true))) return;
    await api.deleteNoteTemplate(vaultId, name).catch((e) => store.fail(e));
    await load();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') index = Math.min(index + 1, options.length - 1);
    else if (e.key === 'ArrowUp') index = Math.max(index - 1, 0);
    else if (e.key === 'Enter') pick(options[index] ?? null);
    else if (e.key === 'Escape') close();
    else return;
    e.preventDefault();
  }
</script>

<button class="scrim" in:dim aria-label={tr('common.close')} onclick={close}></button>
<div class="box" in:pop role="dialog" aria-label={tr('templates.title')}>
  <input bind:this={input} bind:value={query} oninput={() => (index = 0)} onkeydown={onKey} placeholder={tr('templates.search')} />
  <div class="list" role="listbox">
    {#each options as name, i (name ?? '')}
      <div class="row" class:on={i === index} role="option" aria-selected={i === index} tabindex="-1" onmousemove={() => (index = i)}>
        <button class="pick" onclick={() => pick(name)}>
          <Icon name="file" size={14} />
          <span>{name ?? tr('templates.blank')}</span>
        </button>
        {#if name}
          <button class="icon small" title={tr('templates.delete', { name })} onclick={() => remove(name)}><Icon name="close" size={14} /></button>
        {/if}
      </div>
    {/each}
  </div>
  {#if names && !names.length}
    <p class="hint">{tr('templates.none')}</p>
  {:else}
    <p class="hint">{tr('templates.hint')}</p>
  {/if}
</div>

<style>
  .box { position: fixed; top: 12vh; left: 50%; z-index: var(--z-dialog); width: min(480px, calc(100vw - 32px)); padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translateX(-50%); }
  input { width: 100%; }
  .list { max-height: 50vh; margin-top: var(--space-1-5); overflow-y: auto; }
  .row { display: flex; align-items: center; border-radius: var(--radius-sm); }
  .row.on { background: var(--accent-soft); }
  .pick { display: flex; flex: 1; align-items: center; gap: var(--space-2); min-width: 0; padding: var(--space-1-5) var(--space-2-5); border: 0; background: none; color: var(--text); font-size: var(--font-md); text-align: left; }
  .pick span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .hint { margin: var(--space-1-5) 0 0; padding: var(--space-1-5) var(--space-2) 0; border-top: 1px solid var(--line); color: var(--text-3); font-size: var(--font-xs); line-height: 1.4; }
</style>
