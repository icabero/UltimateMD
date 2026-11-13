<script lang="ts">
  // Everything a vault can set, in one place: its name and folder, how its
  // notes and diagrams look, Word, and what an AI may do with it.
  import { dim, pop } from '../motion';
  import DiagramGuide from './DiagramGuide.svelte';
  import Icon from './Icon.svelte';
  import ThemeEditor from './ThemeEditor.svelte';
  import WordScreen from './WordScreen.svelte';
  import { api, type McpAccess, type SortMode } from '../api';
  import { ORDERS } from '../treeOrder';
  import { tr, type Key } from '../i18n.svelte';
  import { store, type VaultSection } from '../store.svelte';

  let { vaultId, section }: { vaultId: string; section: VaultSection } = $props();

  const SECTIONS: { id: VaultSection; label: Key }[] = [
    { id: 'general', label: 'vaultSettings.general' },
    { id: 'look', label: 'vaultSettings.look' },
    { id: 'diagrams', label: 'vaultSettings.diagrams' },
    { id: 'word', label: 'vaultSettings.word' },
    { id: 'ai', label: 'vaultSettings.ai' },
  ];
  const ACCESS: { value: McpAccess; label: Key; hint: Key }[] = [
    { value: 'off', label: 'settings.accessOff', hint: 'vaultSettings.accessOffHint' },
    { value: 'read', label: 'settings.accessRead', hint: 'vaultSettings.accessReadHint' },
    { value: 'write', label: 'settings.accessWrite', hint: 'vaultSettings.accessWriteHint' },
  ];
  /** These read the vault's files, so they need it open. */
  const NEEDS_OPEN: VaultSection[] = ['look', 'diagrams', 'word'];

  const vault = $derived(store.vault(vaultId));
  const name = $derived(vault?.name ?? '');
  const access = $derived(ACCESS.find((a) => a.value === vault?.mcp) ?? ACCESS[0]);

  function close() {
    store.vaultSettings = null;
  }
  function go(to: VaultSection) {
    store.vaultSettings = { vaultId, section: to };
  }

  $effect(() => {
    if (!vault) close();
  });

  async function rename(value: string) {
    const next = value.trim();
    if (!next || next === vault?.name) return;
    await api.renameVault(vaultId, next).catch((e) => store.fail(e));
    await store.loadVaults();
  }

  async function setAccess(value: McpAccess) {
    await api.setVaultAccess(vaultId, value).catch((e) => store.fail(e));
    await store.loadVaults();
  }

  async function setScripts(allow: boolean) {
    await api.setVaultScripts(vaultId, allow).catch((e) => store.fail(e));
    await store.loadVaults();
  }

  async function remove() {
    if (!(await store.confirm(tr('settings.removeVault', { name }), tr('common.remove'), true))) return;
    close();
    await store.removeVault(vaultId);
  }

  function aiLog() {
    close();
    store.aiLog = vaultId;
  }

  function connect() {
    close();
    store.settings = true;
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && !store.dialog) close(); }} />

<button in:dim class="scrim top" aria-label={tr('common.close')} onclick={close}></button>
<div in:pop class="modal" role="dialog" aria-label={tr('vaultSettings.title', { name })}>
  <header>
    <h2>{tr('vaultSettings.title', { name })}</h2>
    <button class="icon" title={tr('common.close')} onclick={close}><Icon name="close" /></button>
  </header>

  <div class="layout">
    <nav aria-label={tr('vaultSettings.title', { name })}>
      {#each SECTIONS as s (s.id)}
        <button class:on={section === s.id} aria-current={section === s.id ? 'page' : undefined} onclick={() => go(s.id)}>{tr(s.label)}</button>
      {/each}
    </nav>

    <div class="content" data-setting-area class:fill={section === 'word' || section === 'diagrams'}>
      {#if !vault}
        <!-- Closing on the next tick. -->
      {:else if NEEDS_OPEN.includes(section) && !vault.open}
        <div class="closed">
          <p>{tr('vaultSettings.closed')}</p>
          <button class="plain" onclick={() => store.setVaultOpen(vaultId, true)}>{tr('vaultSettings.openVault')}</button>
        </div>
      {:else if section === 'general'}
        <section data-setting="vault.name">
          <label class="field">
            <span>{tr('vaultSettings.name')}</span>
            <input type="text" value={vault.name} onchange={(e) => rename(e.currentTarget.value)} onkeydown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          </label>
          <p class="hint">{tr('vaultSettings.nameHint')}</p>
        </section>
        <section data-setting="vault.folder">
          <h3>{tr('vaultSettings.folder')}</h3>
          <p class="path">{vault.path}</p>
          <button class="plain" onclick={() => store.revealInFolder(vaultId, '')}><Icon name="folder" size={14} /> {tr('menu.reveal')}</button>
        </section>
        {#if vault.open}
          <section data-setting="vault.order">
            <label class="field">
              <span>{tr('vaultSettings.order')}</span>
              <select value={store.order(vaultId)} onchange={(e) => store.setOrder(vaultId, e.currentTarget.value as SortMode)}>
                {#each ORDERS as o (o.value)}<option value={o.value}>{tr(o.label)}</option>{/each}
              </select>
            </label>
            <p class="hint">{tr('vaultSettings.orderHint')}</p>
          </section>
        {/if}
        <section data-setting="vault.scripts">
          <h3>{tr('vaultSettings.safety')}</h3>
          <label class="check">
            <input type="checkbox" checked={vault.allowScripts} onchange={(e) => setScripts(e.currentTarget.checked)} />
            {tr('settings.scripts')}
          </label>
          <p class="hint">{tr('settings.scriptsHint')}</p>
        </section>
        <section data-setting="vault.list">
          <h3>{tr('vaultSettings.inList')}</h3>
          <p class="hint">{tr(vault.open ? 'vaultSettings.openHint' : 'vaultSettings.closedHint')}</p>
          <div class="buttons">
            <button class="plain" onclick={() => store.setVaultOpen(vaultId, !vault.open)}>{tr(vault.open ? 'sidebar.closeVault' : 'vaultSettings.openVault')}</button>
            <button class="plain danger" onclick={remove}>{tr('vaultSettings.remove')}</button>
          </div>
        </section>
      {:else if section === 'look'}
        <ThemeEditor {vaultId} />
      {:else if section === 'diagrams'}
        <DiagramGuide {vaultId} />
      {:else if section === 'word'}
        <WordScreen {vaultId} />
      {:else}
        <section data-setting="vault.ai">
          <p class="hint lead">{tr('vaultSettings.aiIntro')}</p>
          <div class="seg" role="group" aria-label={tr('settings.mcpAccessOf', { name })}>
            {#each ACCESS as a (a.value)}
              <button class:on={vault.mcp === a.value} aria-pressed={vault.mcp === a.value} onclick={() => setAccess(a.value)}>{tr(a.label)}</button>
            {/each}
          </div>
          <p class="hint" role="status">{tr(access.hint)}</p>
        </section>
        <section data-setting="vault.aiLog">
          <h3>{tr('aiLog.open')}</h3>
          <p class="hint">{tr('vaultSettings.aiLogHint')}</p>
          <button class="plain" onclick={aiLog}>{tr('vaultSettings.aiLogOpen')}</button>
        </section>
        <section data-setting="vault.connect">
          <h3>{tr('vaultSettings.connect')}</h3>
          <p class="hint">{tr('vaultSettings.connectHint')}</p>
          <button class="plain" onclick={connect}>{tr('vaultSettings.connectOpen')}</button>
        </section>
      {/if}
    </div>
  </div>
</div>

<style>
  .top { z-index: var(--z-nested-scrim); }
  .modal { position: fixed; top: 50%; left: 50%; z-index: var(--z-nested); display: flex; flex-direction: column; width: min(1120px, calc(100vw - 32px)); height: min(760px, calc(100vh - 32px)); padding: var(--space-2) var(--space-5) 0; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translate(-50%, -50%); }
  header { display: flex; flex: none; align-items: center; justify-content: space-between; padding-bottom: var(--space-2); border-bottom: 1px solid var(--line); }
  h2 { margin: var(--space-2) 0; font-size: var(--font-lg); font-weight: 650; }
  h3 { margin: 0 0 var(--space-1-5); font-size: var(--font-md); font-weight: 650; }
  .layout { display: grid; flex: 1; grid-template-columns: 180px 1fr; min-height: 0; margin: 0 calc(var(--space-5) * -1); }
  nav { display: flex; flex-direction: column; gap: var(--space-0-5); padding: var(--space-3) var(--space-2-5); border-right: 1px solid var(--line); background: var(--panel); }
  nav button { padding: var(--space-2) var(--space-2-5); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-2); font-size: var(--font-md); text-align: left; }
  nav button:hover { background: var(--hover); color: var(--text); }
  nav .on { background: var(--accent-soft); color: var(--accent-text); font-weight: 600; }
  .content { min-width: 0; min-height: 0; padding: var(--space-4) var(--space-5) var(--space-5); overflow-y: auto; }
  .content.fill { padding: var(--space-4) 0 0 var(--space-5); overflow: hidden; }
  section { max-width: 620px; }
  section + section { margin-top: var(--space-5); padding-top: var(--space-4); border-top: 1px solid var(--line); }
  .field { display: flex; flex-direction: column; gap: var(--space-1); color: var(--text); font-size: var(--font-md); font-weight: 650; }
  .field input, .field select { max-width: 360px; height: 30px; padding: 0 var(--space-2); font-weight: 400; }
  .hint { margin: var(--space-1-5) 0 0; color: var(--text-2); font-size: var(--font-sm); line-height: 1.5; }
  .hint.lead { margin: 0 0 var(--space-2-5); }
  .path { margin: 0 0 var(--space-2); overflow-wrap: anywhere; color: var(--text-2); font: var(--font-sm)/1.5 var(--mono); }
  .check { display: flex; align-items: center; gap: var(--space-1-5); color: var(--text); font-size: var(--font-sm); }
  .buttons { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
  .plain { display: inline-flex; align-items: center; gap: var(--space-1-5); padding: var(--space-1) var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: none; color: var(--text); font-size: var(--font-sm); }
  .plain:hover { background: var(--hover); }
  .danger { color: var(--danger); }
  .seg { display: inline-flex; flex-wrap: wrap; padding: var(--space-0-5); border-radius: var(--radius-md); background: var(--hover); }
  .seg button { padding: var(--space-1) var(--space-2-5); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-2); font-size: var(--font-sm); }
  .seg .on { background: var(--raised); color: var(--text); box-shadow: var(--shadow-sm); }
  .closed { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); color: var(--text-2); font-size: var(--font-sm); }
  .closed p { margin: 0; }
</style>
