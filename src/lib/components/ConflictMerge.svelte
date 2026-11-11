<script lang="ts">
  import { dim, pop } from '../motion';
  import { SvelteMap } from 'svelte/reactivity';
  import Icon from './Icon.svelte';
  import { blocks, merge } from '../diff';
  import { tr } from '../i18n.svelte';
  import { store, type Tab } from '../store.svelte';

  /**
   * A note edited here and changed on disk at once: every place where the two
   * differ, with a choice of which to keep there, or both.
   */
  let { tab }: { tab: Tab } = $props();

  type Pick = 'before' | 'after' | 'both';
  /** Unchanged lines shown around each difference. */
  const CONTEXT = 2;

  // `before` is the text in this tab, `after` the one on disk.
  const parts = $derived(tab.conflict ? blocks(tab.content, tab.conflict.content) : []);
  const picks = new SvelteMap<number, Pick>();
  const pick = (i: number): Pick => picks.get(i) ?? 'before';
  const changes = $derived(parts.filter((p) => p.kind === 'change').length);

  function all(choice: Pick) {
    parts.forEach((p, i) => p.kind === 'change' && picks.set(i, choice));
  }

  async function save() {
    const newline = tab.content.includes('\r\n') ? '\r\n' : '\n';
    let text = merge(parts, pick, newline);
    // Neither side ended with a line break: nor does the result.
    if (!tab.content.endsWith('\n') && !tab.conflict?.content.endsWith('\n')) text = text.slice(0, -newline.length);
    await store.resolveConflict(tab, text);
    store.merging = false;
  }

  const close = () => (store.merging = false);
  const context = (lines: string[], first: boolean, last: boolean) => {
    const head = first ? 0 : CONTEXT;
    const tail = last ? 0 : CONTEXT;
    return lines.length <= head + tail + 1 ? { head: lines, hidden: 0, tail: [] } : { head: lines.slice(0, head), hidden: lines.length - head - tail, tail: lines.slice(lines.length - tail) };
  };
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<button in:dim class="scrim" aria-label={tr('common.close')} onclick={close}></button>
<div in:pop class="modal" role="dialog" aria-label={tr('merge.title')}>
  <header>
    <h2>{tr('merge.title')}</h2>
    <button class="icon" title={tr('common.close')} onclick={close}><Icon name="close" /></button>
  </header>
  <p class="hint">{tr(changes === 1 ? 'merge.hintOne' : 'merge.hint', { n: changes })}</p>
  <div class="quick">
    <button class="plain" onclick={() => all('before')}>{tr('merge.allMine')}</button>
    <button class="plain" onclick={() => all('after')}>{tr('merge.allDisk')}</button>
  </div>

  <div class="parts">
    {#each parts as part, i (i)}
      {#if part.kind === 'same'}
        {@const c = context(part.before, i === 0, i === parts.length - 1)}
        <div class="same">
          {#each c.head as line}<div class="line">{line || ' '}</div>{/each}
          {#if c.hidden}<div class="fold">{tr('diff.folded', { n: c.hidden })}</div>{/if}
          {#each c.tail as line}<div class="line">{line || ' '}</div>{/each}
        </div>
      {:else}
        <fieldset class="change">
          <legend>{tr('merge.difference')}</legend>
          <label class:on={pick(i) !== 'after'}>
            <input type="radio" name="part-{i}" checked={pick(i) === 'before'} onchange={() => picks.set(i, 'before')} />
            <span class="side">{tr('merge.mine')}</span>
            <span class="text">{#each part.before as line}<span class="line">{line || ' '}</span>{:else}<em>{tr('merge.nothing')}</em>{/each}</span>
          </label>
          <label class:on={pick(i) !== 'before'}>
            <input type="radio" name="part-{i}" checked={pick(i) === 'after'} onchange={() => picks.set(i, 'after')} />
            <span class="side">{tr('merge.disk')}</span>
            <span class="text">{#each part.after as line}<span class="line">{line || ' '}</span>{:else}<em>{tr('merge.nothing')}</em>{/each}</span>
          </label>
          {#if part.before.length && part.after.length}
            <label class="both">
              <input type="radio" name="part-{i}" checked={pick(i) === 'both'} onchange={() => picks.set(i, 'both')} />
              <span class="side">{tr('merge.both')}</span>
            </label>
          {/if}
        </fieldset>
      {/if}
    {/each}
  </div>

  <footer>
    <button class="plain" onclick={close}>{tr('common.cancel')}</button>
    <button class="main" onclick={save}>{tr('merge.save')}</button>
  </footer>
</div>

<style>
  .modal { position: fixed; top: 50%; left: 50%; z-index: var(--z-dialog); display: flex; flex-direction: column; width: min(860px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 32px)); padding: var(--space-2) var(--space-5) var(--space-4); overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translate(-50%, -50%); }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: var(--space-1-5) 0; font-size: var(--font-lg); font-weight: 650; }
  .hint { margin: 0 0 var(--space-2); color: var(--text-2); font-size: var(--font-sm); line-height: 1.5; }
  .quick { display: flex; gap: var(--space-2); margin-bottom: var(--space-2); }
  .parts { min-height: 0; overflow-y: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); font: var(--font-sm)/1.55 var(--mono); }
  .line { display: block; padding: 0 var(--space-3); white-space: pre-wrap; overflow-wrap: anywhere; }
  .same { color: var(--text-3); }
  .fold { padding: var(--space-0-5) var(--space-3); border-block: 1px dashed var(--line); font: var(--font-xs) var(--sans); }
  .change { margin: var(--space-1) 0; padding: 0; border: 0; border-block: 1px solid var(--line); }
  legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  label { display: grid; grid-template-columns: auto 6.5em 1fr; gap: var(--space-2); align-items: start; padding: var(--space-1) var(--space-2); opacity: .55; }
  label.on, label.both { opacity: 1; }
  label.on { background: var(--accent-soft); }
  .side { color: var(--text-2); font: 600 var(--font-xs)/1.9 var(--sans); }
  .text .line { padding: 0; }
  em { color: var(--text-3); font: italic var(--font-xs)/1.9 var(--sans); }
  footer { display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-3); }
  .plain { padding: var(--space-1) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: none; color: var(--text); font-size: var(--font-sm); }
  .plain:hover { background: var(--hover); }
  .main { padding: var(--space-1-5) var(--space-4); border: 1px solid var(--accent); border-radius: var(--radius-md); background: var(--accent); color: var(--on-accent); font-size: var(--font-md); }
</style>
