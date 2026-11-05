<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { api, type McpAccess, type Vault } from '../api';
  import { store } from '../store.svelte';

  type Client = 'claude-code' | 'claude-desktop' | 'cursor' | 'other';

  const ACCESS: { value: McpAccess; label: string }[] = [
    { value: 'off', label: 'Desactivado' },
    { value: 'read', label: 'Lectura' },
    { value: 'write', label: 'Lectura y escritura' },
  ];
  const CLIENTS: { id: Client; label: string }[] = [
    { id: 'claude-code', label: 'Claude Code' },
    { id: 'claude-desktop', label: 'Claude Desktop' },
    { id: 'cursor', label: 'Cursor' },
    { id: 'other', label: 'Otros' },
  ];

  let mcp = $state<{ binary: string; available: boolean } | null>(null);
  let client = $state<Client>('claude-code');
  let copied = $state(false);

  onMount(async () => {
    mcp = await api.mcpInfo().catch(() => null);
  });

  const ua = navigator.userAgent;
  const desktopConfig = ua.includes('Windows')
    ? '%APPDATA%\\Claude\\claude_desktop_config.json'
    : ua.includes('Mac')
      ? '~/Library/Application Support/Claude/claude_desktop_config.json'
      : 'claude_desktop_config.json';

  const json = $derived(JSON.stringify({ mcpServers: { ultimatemd: { command: mcp?.binary ?? '', args: [] } } }, null, 2));
  const snippet = $derived(client === 'claude-code' ? `claude mcp add --scope user ultimatemd -- "${mcp?.binary ?? ''}"` : json);
  const hint = $derived(
    { 'claude-code': 'Ejecútalo en una terminal.', 'claude-desktop': `Añádelo a ${desktopConfig} y reinicia Claude Desktop.`, cursor: 'Añádelo a ~/.cursor/mcp.json.', other: 'Cualquier cliente MCP por stdio: usa esta ruta como comando, sin argumentos.' }[client],
  );

  async function setAccess(vault: Vault, value: McpAccess) {
    await api.setVaultAccess(vault.id, value).catch((e) => store.notify(e));
    await store.loadVaults();
  }

  async function setScripts(vault: Vault, allow: boolean) {
    await api.setVaultScripts(vault.id, allow).catch((e) => store.notify(e));
    await store.loadVaults();
  }

  async function rename(vault: Vault) {
    const name = await store.prompt('Nombre del vault', vault.name, 'Renombrar');
    if (name?.trim() && name.trim() !== vault.name) {
      await api.renameVault(vault.id, name.trim()).catch((e) => store.notify(e));
      await store.loadVaults();
    }
  }

  async function remove(vault: Vault) {
    if (await store.confirm(`¿Quitar «${vault.name}» de la lista? Sus archivos no se borran.`, 'Quitar')) await store.removeVault(vault.id);
  }

  async function copy() {
    await navigator.clipboard.writeText(snippet);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<button class="scrim" aria-label="Cerrar" onclick={() => (store.settings = false)}></button>
<div class="modal" role="dialog" aria-label="Ajustes">
  <header>
    <h2>Ajustes</h2>
    <button class="icon" title="Cerrar" onclick={() => (store.settings = false)}><Icon name="close" /></button>
  </header>

  <section>
    <h3>Vaults</h3>
    {#each store.vaults as vault (vault.id)}
      <div class="vault">
        <div class="info">
          <button class="name" title="Renombrar" onclick={() => rename(vault)}>{vault.name}</button>
          <span class="path">{vault.path}</span>
        </div>
        <div class="seg" role="group" aria-label="Acceso MCP de {vault.name}">
          {#each ACCESS as a}
            <button class:on={vault.mcp === a.value} onclick={() => setAccess(vault, a.value)}>{a.label}</button>
          {/each}
        </div>
        <div class="actions">
          <label title="Permite que los archivos .html de este vault ejecuten scripts, siempre aislados de la app y sin red">
            <input type="checkbox" checked={vault.allowScripts} onchange={(e) => setScripts(vault, e.currentTarget.checked)} />
            Scripts en HTML
          </label>
          <span class="spacer"></span>
          <button onclick={() => store.setVaultOpen(vault.id, !vault.open)}>{vault.open ? 'Cerrar' : 'Abrir'}</button>
          <button onclick={() => remove(vault)}>Quitar</button>
        </div>
      </div>
    {:else}
      <p class="muted">Aún no hay vaults.</p>
    {/each}
  </section>

  <section>
    <h3>Conectar una IA por MCP</h3>
    <p class="muted">Funciona aunque la app esté cerrada. Cada vault responde según su nivel de acceso de arriba.</p>
    <div class="clients">
      {#each CLIENTS as c}
        <button class:on={client === c.id} onclick={() => (client = c.id)}>{c.label}</button>
      {/each}
    </div>
    {#if mcp?.available === false}
      <p class="warn">No se encuentra el servidor MCP en esta instalación.</p>
    {/if}
    <div class="code">
      <pre>{snippet}</pre>
      <button onclick={copy}>{copied ? 'Copiado' : 'Copiar'}</button>
    </div>
    <p class="muted">{hint}</p>
  </section>
</div>

<style>
  .modal { position: fixed; top: 50%; left: 50%; z-index: 31; width: min(720px, calc(100vw - 32px)); max-height: calc(100vh - 48px); padding: 8px 20px 20px; overflow-y: auto; border: 1px solid var(--line); border-radius: 14px; background: var(--raised); box-shadow: var(--shadow); transform: translate(-50%, -50%); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 8px 0; font-size: 17px; }
  h3 { margin: 18px 0 8px; font-size: 13px; }
  .vault { padding: 10px 0; border-top: 1px solid var(--line); }
  .info { display: flex; align-items: baseline; gap: 10px; min-width: 0; margin-bottom: 8px; }
  .name { flex: none; padding: 0; border: 0; background: none; color: var(--text); font-size: 13.5px; font-weight: 600; }
  .path { overflow: hidden; color: var(--text-3); font-size: 12px; white-space: nowrap; text-overflow: ellipsis; }
  .seg, .clients { display: inline-flex; padding: 2px; border-radius: 8px; background: var(--hover); flex-wrap: wrap; }
  .seg button, .clients button { padding: 4px 10px; border: 0; border-radius: 6px; background: none; color: var(--text-2); font-size: 12.5px; }
  .seg .on, .clients .on { background: var(--raised); color: var(--text); box-shadow: 0 1px 2px #0002; }
  .actions { display: flex; align-items: center; gap: 6px; margin-top: 8px; color: var(--text-2); font-size: 12.5px; }
  .actions label { display: flex; align-items: center; gap: 5px; }
  .actions button, .code button { padding: 3px 9px; border: 1px solid var(--line); border-radius: 6px; background: none; color: var(--text-2); font-size: 12px; }
  .actions button:hover, .code button:hover { background: var(--hover); color: var(--text); }
  .spacer { flex: 1; }
  .code { position: relative; margin: 10px 0 6px; }
  pre { margin: 0; padding: 12px; overflow-x: auto; border-radius: 8px; background: var(--panel); font: 12.5px/1.5 var(--mono); }
  .code button { position: absolute; top: 8px; right: 8px; background: var(--raised); }
  .muted { margin: 4px 0; color: var(--text-2); font-size: 12.5px; }
  .warn { color: var(--danger); font-size: 12.5px; }
</style>
