<script lang="ts">
  import { dim, pop } from '../motion';
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { api, type DefaultAppInfo, type McpAccess, type Vault } from '../api';
  import { LANGUAGES, language, setLanguage, themeName, tr, type Key, type Language } from '../i18n.svelte';
  import { store } from '../store.svelte';
  import { THEMES, type Theme } from '../themes';

  type Client = 'claude-code' | 'claude-desktop' | 'cursor' | 'other';
  type Section = 'general' | 'appearance' | 'vaults' | 'ai';

  const SECTIONS: { id: Section; label: Key }[] = [
    { id: 'general', label: 'settings.sectionGeneral' },
    { id: 'appearance', label: 'settings.appearance' },
    { id: 'vaults', label: 'settings.sectionVaults' },
    { id: 'ai', label: 'settings.sectionAi' },
  ];
  let section = $state<Section>('general');

  const ACCESS: { value: McpAccess; label: Key }[] = [
    { value: 'off', label: 'settings.accessOff' },
    { value: 'read', label: 'settings.accessRead' },
    { value: 'write', label: 'settings.accessWrite' },
  ];
  const CLIENTS = $derived<{ id: Client; label: string }[]>([
    { id: 'claude-code', label: 'Claude Code' },
    { id: 'claude-desktop', label: 'Claude Desktop' },
    { id: 'cursor', label: 'Cursor' },
    { id: 'other', label: tr('settings.clientOther') },
  ]);

  let mcp = $state<{ binary: string; available: boolean } | null>(null);
  let client = $state<Client>('claude-code');
  let copied = $state(false);

  let defaultApp = $state<DefaultAppInfo | null>(null);

  onMount(async () => {
    mcp = await api.mcpInfo().catch(() => null);
    defaultApp = await api.defaultAppInfo().catch(() => null);
  });

  async function makeDefault() {
    try {
      await api.setDefaultApp();
      defaultApp = await api.defaultAppInfo();
    } catch (e) {
      store.notify(e);
    }
  }

  const ua = navigator.userAgent;
  const desktopConfig = ua.includes('Windows')
    ? '%APPDATA%\\Claude\\claude_desktop_config.json'
    : ua.includes('Mac')
      ? '~/Library/Application Support/Claude/claude_desktop_config.json'
      : 'claude_desktop_config.json';

  const json = $derived(JSON.stringify({ mcpServers: { ultimatemd: { command: mcp?.binary ?? '', args: [] } } }, null, 2));
  const snippet = $derived(client === 'claude-code' ? `claude mcp add --scope user ultimatemd -- "${mcp?.binary ?? ''}"` : json);
  const hint = $derived(
    { 'claude-code': tr('settings.hintCode'), 'claude-desktop': tr('settings.hintDesktop', { path: desktopConfig }), cursor: tr('settings.hintCursor'), other: tr('settings.hintOther') }[client],
  );

  const lightThemes = THEMES.filter((t) => t.mode === 'light');
  const darkThemes = THEMES.filter((t) => t.mode === 'dark');
  const following = $derived(store.themeChoice.fixed === null);

  async function setAccess(vault: Vault, value: McpAccess) {
    await api.setVaultAccess(vault.id, value).catch((e) => store.notify(e));
    await store.loadVaults();
  }

  async function setScripts(vault: Vault, allow: boolean) {
    await api.setVaultScripts(vault.id, allow).catch((e) => store.notify(e));
    await store.loadVaults();
  }

  async function rename(vault: Vault) {
    const name = await store.prompt(tr('sidebar.vaultName'), vault.name, tr('common.rename'));
    if (name?.trim() && name.trim() !== vault.name) {
      await api.renameVault(vault.id, name.trim()).catch((e) => store.notify(e));
      await store.loadVaults();
    }
  }

  async function remove(vault: Vault) {
    if (await store.confirm(tr('settings.removeVault', { name: vault.name }), tr('common.remove'))) await store.removeVault(vault.id);
  }

  async function copy() {
    await navigator.clipboard.writeText(snippet);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

{#snippet swatch(t: Theme, selected: boolean, pick: () => void)}
  <button class="swatch" class:selected aria-pressed={selected} onclick={pick} style:background={t.colors.bg} style:color={t.colors.text} style:border-color={selected ? t.colors.accent : t.colors.line}>
    <span class="sample" style:font-family={t.prose === 'serif' ? 'var(--serif)' : 'var(--sans)'}>Aa</span>
    <span class="bar" style:background={t.colors.accent}></span>
    <span class="tname">{themeName(t)}</span>
  </button>
{/snippet}

<button in:dim class="scrim" aria-label={tr('common.close')} onclick={() => (store.settings = false)}></button>
<div in:pop class="modal" role="dialog" aria-label={tr('settings.title')}>
  <header>
    <h2>{tr('settings.title')}</h2>
    <button class="icon" title={tr('common.close')} onclick={() => (store.settings = false)}><Icon name="close" /></button>
  </header>

  <div class="layout">
  <nav aria-label={tr('settings.title')}>
    {#each SECTIONS as s (s.id)}
      <button class:on={section === s.id} aria-current={section === s.id ? 'page' : undefined} onclick={() => (section = s.id)}>{tr(s.label)}</button>
    {/each}
  </nav>
  <div class="content">
  {#if section === 'general'}
  <section>
    <h3>{tr('settings.language')}</h3>
    <select aria-label={tr('settings.language')} value={language()} onchange={(e) => setLanguage(e.currentTarget.value as Language)}>
      {#each LANGUAGES as l (l.code)}<option value={l.code}>{l.name}</option>{/each}
    </select>
  </section>
  <section>
    <h3>{tr('tutorial.label')}</h3>
    <button class="plain" onclick={() => { store.settings = false; store.tutorial = true; }}>{tr('settings.tutorial')}</button>
  </section>
  {#if defaultApp}
    <section>
      <h3>{tr('settings.defaultApp')}</h3>
      {#if defaultApp.platform === 'windows'}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- our own translation, with markup -->
        <p class="muted">{@html tr('settings.defaultWindows')}</p>
        <button class="plain" onclick={makeDefault}>{tr('settings.defaultWindowsButton')}</button>
      {:else if defaultApp.platform === 'macos'}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- our own translation, with markup -->
        <p class="muted">{@html tr('settings.defaultMac')}</p>
      {:else if defaultApp.appimage}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- our own translation, with markup -->
        <p class="muted">{@html tr('settings.defaultAppImage')}</p>
      {:else if defaultApp.isDefault}
        <p class="muted">{tr('settings.defaultDone')}</p>
      {:else}
        <button class="plain" onclick={makeDefault}>{tr('settings.defaultLinuxButton')}</button>
      {/if}
    </section>
  {/if}
  {:else if section === 'appearance'}
  <section>
    <h3>{tr('settings.appearance')}</h3>
    <div class="themes">
      {#each THEMES as t (t.id)}
        {@render swatch(t, store.theme.id === t.id, () => store.setThemeChoice({ fixed: t.id }))}
      {/each}
    </div>
    <label class="follow">
      <input type="checkbox" checked={following} onchange={(e) => store.setThemeChoice({ fixed: e.currentTarget.checked ? null : store.theme.id })} />
      {tr('settings.followSystem')}
    </label>
    {#if following}
      <div class="modes">
        <label>{tr('settings.lightMode')}
          <select value={store.themeChoice.light} onchange={(e) => store.setThemeChoice({ light: e.currentTarget.value })}>
            {#each lightThemes as t}<option value={t.id}>{themeName(t)}</option>{/each}
          </select>
        </label>
        <label>{tr('settings.darkMode')}
          <select value={store.themeChoice.dark} onchange={(e) => store.setThemeChoice({ dark: e.currentTarget.value })}>
            {#each darkThemes as t}<option value={t.id}>{themeName(t)}</option>{/each}
          </select>
        </label>
      </div>
    {/if}
  </section>

  {:else if section === 'vaults'}
  <section>
    <h3>{tr('settings.sectionVaults')}</h3>
    {#each store.vaults as vault (vault.id)}
      <div class="vault">
        <div class="info">
          <button class="name" title={tr('common.rename')} onclick={() => rename(vault)}>{vault.name}</button>
          <span class="path">{vault.path}</span>
        </div>
        <div class="seg" role="group" aria-label={tr('settings.mcpAccessOf', { name: vault.name })}>
          {#each ACCESS as a}
            <button class:on={vault.mcp === a.value} onclick={() => setAccess(vault, a.value)}>{tr(a.label)}</button>
          {/each}
        </div>
        <div class="actions">
          <label title={tr('settings.scriptsHint')}>
            <input type="checkbox" checked={vault.allowScripts} onchange={(e) => setScripts(vault, e.currentTarget.checked)} />
            {tr('settings.scripts')}
          </label>
          <span class="spacer"></span>
          {#if vault.open}<button onclick={() => (store.themeEditor = vault.id)}>{tr('settings.themes')}</button>{/if}
          {#if vault.open}<button onclick={() => { store.settings = false; store.wordScreen = vault.id; }}>{tr('word.open')}</button>{/if}
          <button onclick={() => store.setVaultOpen(vault.id, !vault.open)}>{tr(vault.open ? 'common.close' : 'common.open')}</button>
          <button onclick={() => remove(vault)}>{tr('common.remove')}</button>
        </div>
      </div>
    {:else}
      <p class="muted">{tr('settings.noVaults')}</p>
    {/each}
  </section>

  {:else}
  <section>
    <h3>{tr('settings.mcpTitle')}</h3>
    <p class="muted">{tr('settings.mcpIntro')}</p>
    <div class="clients">
      {#each CLIENTS as c}
        <button class:on={client === c.id} onclick={() => (client = c.id)}>{c.label}</button>
      {/each}
    </div>
    {#if mcp?.available === false}
      <p class="warn">{tr('settings.mcpMissing')}</p>
    {/if}
    <div class="code">
      <pre>{snippet}</pre>
      <button onclick={copy}>{tr(copied ? 'common.copied' : 'common.copy')}</button>
    </div>
    <p class="muted">{hint}</p>
  </section>
  {/if}
  </div>
  </div>
</div>

<style>
  .modal { position: fixed; top: 50%; left: 50%; z-index: var(--z-dialog); display: flex; flex-direction: column; width: min(820px, calc(100vw - 32px)); height: min(600px, calc(100vh - 48px)); padding: var(--space-2) var(--space-5) 0; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translate(-50%, -50%); }
  header { display: flex; flex: none; align-items: center; justify-content: space-between; padding-bottom: var(--space-2); border-bottom: 1px solid var(--line); }
  .layout { display: grid; flex: 1; grid-template-columns: 180px 1fr; min-height: 0; margin: 0 calc(var(--space-5) * -1); }
  nav { display: flex; flex-direction: column; gap: var(--space-0-5); padding: var(--space-3) var(--space-2-5); border-right: 1px solid var(--line); background: var(--panel); }
  nav button { padding: var(--space-2) var(--space-2-5); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-2); font-size: var(--font-md); text-align: left; }
  nav button:hover { background: var(--hover); color: var(--text); }
  nav .on { background: var(--accent-soft); color: var(--accent-text); font-weight: 600; }
  .content { min-width: 0; padding: 0 var(--space-5) var(--space-5); overflow-y: auto; }
  section + section { margin-top: var(--space-6); padding-top: var(--space-0-5); border-top: 1px solid var(--line); }
  h2 { margin: var(--space-2) 0; font-size: var(--font-lg); font-weight: 650; }
  h3 { margin: var(--space-4) 0 var(--space-2); font-size: var(--font-md); font-weight: 650; }
  .themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(116px, 1fr)); gap: var(--space-2); }
  .swatch { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: var(--space-0-5) var(--space-2); padding: var(--space-2) var(--space-2-5); border: 1.5px solid; border-radius: var(--radius-md); text-align: left; }
  .swatch.selected { box-shadow: 0 0 0 1px currentColor; }
  .sample { font-size: var(--font-xl); line-height: 1.2; }
  .bar { width: 18px; height: 6px; border-radius: var(--radius-2xs); }
  .tname { grid-column: 1 / -1; font-size: var(--font-sm); }
  .follow { display: flex; align-items: center; gap: var(--space-1-5); margin-top: var(--space-3); color: var(--text-2); font-size: var(--font-sm); }
  .modes { display: flex; flex-wrap: wrap; gap: var(--space-4); margin-top: var(--space-2); color: var(--text-2); font-size: var(--font-sm); }
  .modes label { display: flex; align-items: center; gap: var(--space-1-5); }
  select { min-width: 170px; padding: var(--space-1) var(--space-1-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); color: var(--text); font: inherit; }
  .vault { padding: var(--space-2-5) 0; border-top: 1px solid var(--line); }
  .info { display: flex; align-items: baseline; gap: var(--space-2-5); min-width: 0; margin-bottom: var(--space-2); }
  .name { flex: none; padding: 0; border: 0; background: none; color: var(--text); font-size: var(--font-md); font-weight: 600; }
  .path { overflow: hidden; color: var(--text-3); font-size: var(--font-sm); white-space: nowrap; text-overflow: ellipsis; }
  .seg, .clients { display: inline-flex; padding: var(--space-0-5); border-radius: var(--radius-md); background: var(--hover); flex-wrap: wrap; }
  .seg button, .clients button { padding: var(--space-1) var(--space-2-5); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-2); font-size: var(--font-sm); }
  .seg .on, .clients .on { background: var(--raised); color: var(--text); box-shadow: var(--shadow-sm); }
  .actions { display: flex; align-items: center; gap: var(--space-1-5); margin-top: var(--space-2); color: var(--text-2); font-size: var(--font-sm); }
  .actions label { display: flex; align-items: center; gap: var(--space-1-5); }
  .actions button, .code button { padding: var(--space-1) var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: none; color: var(--text-2); font-size: var(--font-sm); }
  .actions button:hover, .code button:hover { background: var(--hover); color: var(--text); }
  .spacer { flex: 1; }
  .code { position: relative; margin: var(--space-2-5) 0 var(--space-1-5); }
  pre { margin: 0; padding: var(--space-3) 76px var(--space-3) var(--space-3); overflow-x: auto; border-radius: var(--radius-md); background: var(--panel); font: var(--font-sm)/1.5 var(--mono); }
  .code button { position: absolute; top: 8px; right: 8px; background: var(--raised); }
  .plain { margin-top: var(--space-1); padding: var(--space-1) var(--space-2-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: none; color: var(--text); font-size: var(--font-sm); }
  .plain:hover { background: var(--hover); }
  .muted :global(code) { font: var(--font-sm) var(--mono); }
  .muted { margin: var(--space-1) 0; color: var(--text-2); font-size: var(--font-sm); }
  .warn { color: var(--danger); font-size: var(--font-sm); }
</style>
