<script lang="ts">
  import Icon from './Icon.svelte';
  import { api, type HomeInfo } from '../api';
  import { language, tr, type Key } from '../i18n.svelte';
  import { baseName, dirName } from '../paths';
  import { store } from '../store.svelte';
  import { vaultColor } from '../vaultColor';

  const REFRESH_DELAY = 300;
  const TIPS: Key[] = ['tip.headings', 'tip.palette', 'tip.links', 'tip.ctrlClick', 'tip.outline', 'tip.diagrams', 'tip.word', 'tip.mcp', 'tip.accents'];

  let info = $state<HomeInfo | null>(null);
  let run = 0;

  // Read again when a vault opens or closes, or a note changes on disk.
  $effect(() => {
    void store.openVaults.map((v) => v.id).join();
    void Object.values(store.trees);
    const id = ++run;
    const timer = setTimeout(async () => {
      const found = await api.homeInfo().catch(() => null);
      if (id === run) info = found;
    }, REFRESH_DELAY);
    return () => clearTimeout(timer);
  });

  const day = Math.floor(Date.now() / 86_400_000);
  let tip = $state(day % TIPS.length);

  const vaults = $derived(store.openVaults.map((v) => ({ vault: v, summary: info?.vaults.find((s) => s.vaultId === v.id) })));
  const recent = $derived((info?.recent ?? []).filter((r) => store.vault(r.vaultId)));

  const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12]];

  /** "hace 5 minutos", "ayer"… in the interface language; a plain date past a year. */
  function ago(ms: number) {
    let value = (ms - Date.now()) / 60_000;
    if (value > -1) return tr('home.justNow');
    const format = new Intl.RelativeTimeFormat(language(), { numeric: 'auto' });
    for (const [unit, size] of STEPS) {
      if (Math.abs(value) < size) return format.format(Math.round(value), unit);
      value /= size;
    }
    return new Date(ms).toLocaleDateString(language());
  }

  const noteName = (path: string) => baseName(path).replace(/\.(md|markdown)$/i, '');

  const ACTIONS: { icon: string; label: Key; keys: string[]; run: () => void }[] = [
    { icon: 'plus', label: 'cmd.newNote', keys: ['Ctrl', 'N'], run: () => void store.newNote() },
    { icon: 'file', label: 'cmd.openNote', keys: ['Ctrl', 'P'], run: () => (store.palette = '') },
    { icon: 'search', label: 'home.search', keys: ['Ctrl', 'Shift', 'F'], run: () => { store.searching = true; store.toggleBar('left', true); } },
    { icon: 'list', label: 'home.actions', keys: ['Ctrl', 'Shift', 'P'], run: () => (store.palette = '>') },
  ];
  const keyLabel = (k: string) => (k === 'Shift' ? tr('keys.shift') : k);
</script>

<div class="home">
  <div class="column">
    <h1>Ultimate<b>MD</b></h1>

    {#if store.openVaults.length === 0}
      <p class="intro">{tr('welcome.intro')}</p>
      <div class="start">
        <button class="primary" onclick={() => store.createVaultDialog()}><Icon name="plus" /> {tr('sidebar.createVault')}</button>
        <button onclick={() => store.openVaultDialog()}><Icon name="folder" /> {tr('sidebar.openFolder')}</button>
      </div>
    {:else}
      <div class="actions">
        {#each ACTIONS as a (a.label)}
          <button onclick={a.run}>
            <Icon name={a.icon} />
            <span class="label">{tr(a.label)}</span>
            <span class="keys">{#each a.keys as k}<kbd>{keyLabel(k)}</kbd>{/each}</span>
          </button>
        {/each}
      </div>

      {#if recent.length}
        <section aria-labelledby="home-recent">
          <h2 id="home-recent">{tr('home.recent')}</h2>
          <ul class="recent">
            {#each recent as r (`${r.vaultId}:${r.path}`)}
              <li>
                <button onclick={() => store.openFile(r.vaultId, r.path)} title={r.path}>
                  <span class="dot" style:background={vaultColor(r.vaultId)}></span>
                  <span class="name">{noteName(r.path)}</span>
                  <span class="where">{store.vault(r.vaultId)?.name}{dirName(r.path) ? ` · ${dirName(r.path)}` : ''}</span>
                  <span class="when">{ago(r.modified)}</span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <section aria-labelledby="home-vaults">
        <h2 id="home-vaults">{tr('home.vaults')}</h2>
        <div class="vaults">
          {#each vaults as { vault, summary } (vault.id)}
            {@const last = summary?.lastNote}
            <button class="card" disabled={!last} title={last ? tr('home.continue', { name: noteName(last) }) : ''} onclick={() => last && store.openFile(vault.id, last)}>
              <span class="card-name"><span class="dot" style:background={vaultColor(vault.id)}></span>{vault.name}</span>
              {#if summary?.notes === null}
                <span class="meta">{tr('home.unreachable')}</span>
              {:else if summary}
                <span class="meta">{tr(summary.notes === 1 ? 'home.oneNote' : 'home.notes', { n: summary.notes ?? 0 })}</span>
                {#if summary.lastEdit}<span class="meta">{tr('home.edited', { when: ago(summary.lastEdit) })}</span>{/if}
              {/if}
            </button>
          {/each}
        </div>
      </section>
    {/if}

    <div class="tip" role="note" aria-label={tr('home.tip')}>
      <span><b>{tr('home.tip')}</b> {tr(TIPS[tip])}</span>
      <button class="plain" onclick={() => (tip = (tip + 1) % TIPS.length)}>{tr('home.nextTip')}</button>
    </div>
  </div>
</div>

<style>
  .home { flex: 1; height: 100%; overflow-y: auto; background: var(--bg); }
  .column { display: flex; flex-direction: column; gap: var(--space-5); width: min(640px, 100%); margin: 0 auto; padding: 7vh var(--space-6) var(--space-8); }
  h1 { margin: 0; color: var(--text-2); font-size: var(--font-2xl); font-weight: 400; letter-spacing: -.02em; }
  h1 b { color: var(--text); font-weight: 700; }
  h2 { margin: 0 0 var(--space-2); color: var(--text-3); font-size: var(--font-xs); font-weight: 600; letter-spacing: .02em; text-transform: uppercase; }
  .intro { margin: 0; color: var(--text-2); font-size: var(--font-base); line-height: 1.5; }
  .start { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .start button { display: inline-flex; align-items: center; gap: var(--space-2); height: 36px; padding: 0 var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--raised); color: var(--text); font-size: var(--font-md); }
  .start .primary { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
  .actions { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--space-2); }
  .actions button { display: flex; align-items: center; gap: var(--space-2-5); padding: var(--space-2-5) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--raised); color: var(--text-2); font-size: var(--font-md); text-align: left; transition: border-color var(--ease), color var(--ease); }
  .actions button:hover { border-color: var(--accent); color: var(--text); }
  .label { flex: 1; }
  .keys { display: flex; gap: var(--space-1); }
  kbd { padding: 0 var(--space-1-5); border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--bg); color: var(--text-3); font: var(--font-xs)/1.7 var(--sans); }
  ul { margin: 0; padding: 0; list-style: none; }
  .recent button { display: flex; align-items: baseline; gap: var(--space-2); width: 100%; padding: var(--space-1-5) var(--space-2); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text); font-size: var(--font-md); text-align: left; }
  .recent button:hover { background: var(--hover); }
  .dot { flex: none; width: 8px; height: 8px; border-radius: var(--radius-2xs); align-self: center; }
  .name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .where { flex: 1; min-width: 0; overflow: hidden; color: var(--text-3); font-size: var(--font-sm); white-space: nowrap; text-overflow: ellipsis; }
  .when { flex: none; color: var(--text-3); font-size: var(--font-sm); font-variant-numeric: tabular-nums; }
  .vaults { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--space-2); }
  .card { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-0-5); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--panel); color: var(--text); text-align: left; transition: border-color var(--ease); }
  .card:not(:disabled):hover { border-color: var(--accent); }
  .card-name { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-1); font-size: var(--font-base); font-weight: 600; }
  .meta { color: var(--text-3); font-size: var(--font-sm); }
  .tip { display: flex; align-items: baseline; gap: var(--space-3); padding: var(--space-3); border-radius: var(--radius-md); background: var(--accent-soft); color: var(--text-2); font-size: var(--font-md); line-height: 1.5; }
  .tip span { flex: 1; }
  .tip b { color: var(--accent-text); }
  .plain { flex: none; padding: 0; border: 0; background: none; color: var(--accent-text); font-size: var(--font-sm); }
  .plain:hover { text-decoration: underline; }
</style>
