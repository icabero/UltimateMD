<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import { api, type ReplaceOptions, type ReplacePlan } from '../api';
  import { tr } from '../i18n.svelte';
  import { store } from '../store.svelte';

  let find = $state('');
  let replacement = $state('');
  let matchCase = $state(false);
  let wholeWord = $state(false);
  let regex = $state(false);
  let plans = $state<ReplacePlan[]>([]);
  /** Lines left out by hand, as `vault:path:line`. */
  const skipped = new SvelteSet<string>();
  let problem = $state<string | null>(null);
  let busy = $state(false);
  let timer: ReturnType<typeof setTimeout>;
  let run = 0;

  const options = (): ReplaceOptions => ({ find, with: replacement, matchCase, wholeWord, regex });
  const lineKey = (p: ReplacePlan, line: number) => `${p.vaultId}:${p.path}:${line}`;
  const chosen = (p: ReplacePlan) => p.changes.filter((c) => !skipped.has(lineKey(p, c.line)));
  const total = $derived(plans.reduce((n, p) => n + chosen(p).length, 0));
  const notes = $derived(plans.filter((p) => chosen(p).length).length);

  function preview() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const id = ++run;
      let failed: string | null = null;
      const found = find ? await api.replacePreview(options()).catch((e) => ((failed = String(e)), [])) : [];
      if (id !== run) return;
      plans = found;
      problem = failed;
      skipped.clear();
    }, 250);
  }

  function toggle(p: ReplacePlan, line: number) {
    const key = lineKey(p, line);
    if (!skipped.delete(key)) skipped.add(key);
  }

  function toggleNote(p: ReplacePlan, on: boolean) {
    for (const c of p.changes) {
      if (on) skipped.delete(lineKey(p, c.line));
      else skipped.add(lineKey(p, c.line));
    }
  }

  async function apply() {
    busy = true;
    const targets = plans.map((p) => ({ vaultId: p.vaultId, path: p.path, version: p.version, lines: chosen(p).map((c) => c.line) })).filter((t) => t.lines.length);
    await store.replaceInVaults(options(), targets);
    busy = false;
    preview();
  }

  const name = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '');
</script>

<div class="replace">
  <input bind:value={find} oninput={preview} placeholder={tr('replace.find')} aria-label={tr('replace.find')} />
  <input bind:value={replacement} oninput={preview} placeholder={tr('replace.with')} aria-label={tr('replace.with')} />
  <div class="options">
    <button class:on={matchCase} aria-pressed={matchCase} title={tr('replace.matchCase')} aria-label={tr('replace.matchCase')} onclick={() => { matchCase = !matchCase; preview(); }}>Aa</button>
    <button class:on={wholeWord} aria-pressed={wholeWord} title={tr('replace.wholeWord')} aria-label={tr('replace.wholeWord')} onclick={() => { wholeWord = !wholeWord; preview(); }}><u>ab</u></button>
    <button class:on={regex} aria-pressed={regex} title={tr('replace.regex')} aria-label={tr('replace.regex')} onclick={() => { regex = !regex; preview(); }}>.*</button>
    <span class="spacer"></span>
    <button class="go" disabled={!total || busy} onclick={apply}>{tr('replace.apply', { n: total })}</button>
  </div>
  {#if problem}
    <p class="bad" role="alert">{tr(problem.includes('regular expression') ? 'search.badRegex' : 'replace.failed')}</p>
  {:else if find && plans.length}
    <p class="summary" role="status">{tr('replace.summary', { lines: total, notes })}</p>
  {:else if find}
    <p class="summary" role="status">{tr('search.empty')}</p>
  {/if}
  <div class="results">
    {#each plans as p (`${p.vaultId}:${p.path}`)}
      {@const count = chosen(p).length}
      <section class="note" aria-label={name(p.path)}>
        <label class="name" title={p.path}>
          <input type="checkbox" checked={count > 0} indeterminate={count > 0 && count < p.changes.length} onchange={(e) => toggleNote(p, e.currentTarget.checked)} />
          <span class="title">{name(p.path)}</span>
          <span class="where">{store.vault(p.vaultId)?.name}</span>
        </label>
        {#each p.changes as c (c.line)}
          <label class="line">
            <input type="checkbox" checked={!skipped.has(lineKey(p, c.line))} onchange={() => toggle(p, c.line)} />
            <span class="n">{c.line}</span>
            <span class="text"><del>{c.before.trim()}</del><ins>{c.after.trim()}</ins></span>
          </label>
        {/each}
      </section>
    {/each}
  </div>
</div>

<style>
  .replace { display: flex; flex: 1; flex-direction: column; gap: var(--space-1-5); min-height: 0; }
  input:not([type]) { width: 100%; }
  .options { display: flex; align-items: center; gap: var(--space-1); }
  .options button { min-width: 28px; height: 26px; padding: 0 var(--space-1-5); border: 1px solid var(--line); border-radius: var(--radius-sm); background: none; color: var(--text-3); font: var(--font-xs) var(--mono); }
  .options button.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-text); }
  .options .go { padding: 0 var(--space-2-5); border-color: var(--accent); background: var(--accent); color: var(--on-accent); font: 600 var(--font-sm) var(--sans); }
  .options .go:disabled { opacity: .5; }
  .spacer { flex: 1; }
  .summary, .bad { margin: 0; color: var(--text-3); font-size: var(--font-xs); }
  .bad { color: var(--danger); }
  .results { flex: 1; min-height: 0; overflow-y: auto; }
  .note + .note { margin-top: var(--space-1-5); }
  label { display: flex; align-items: flex-start; gap: var(--space-1-5); border-radius: var(--radius-sm); }
  label:hover { background: var(--hover); }
  .name { align-items: center; padding: var(--space-1) var(--space-1-5); }
  .title { overflow: hidden; font-size: var(--font-md); font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
  .where { margin-left: auto; color: var(--text-3); font-size: var(--font-xs); white-space: nowrap; }
  .line { padding: var(--space-1) var(--space-1-5) var(--space-1) var(--space-4); }
  .n { flex: none; min-width: 2em; color: var(--text-3); font-size: var(--font-xs); font-variant-numeric: tabular-nums; line-height: 1.6; text-align: right; }
  .text { display: flex; flex-direction: column; min-width: 0; font-size: var(--font-sm); line-height: 1.45; overflow-wrap: anywhere; }
  del { color: var(--text-3); }
  ins { color: var(--text); text-decoration: none; }
</style>
