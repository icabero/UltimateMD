<script lang="ts">
  import type { EditorView } from '@codemirror/view';
  import Icon from './Icon.svelte';
  import { insertBlock, insertLink, prefixLines, tableMarkdown, wrap } from '../formatting';
  import { tr, type Key } from '../i18n.svelte';
  import { startNoteLink } from '../wikilinks';

  let { view, ondiagram, onstyle }: { view: () => EditorView | null; ondiagram: () => void; onstyle: () => void } = $props();

  interface Tool {
    title: Key;
    params?: Record<string, number>;
    text?: string;
    icon?: string;
    run: (view: EditorView) => void;
  }

  const placeholder = () => tr('toolbar.text');
  const heading = (n: number): Tool => ({ title: 'toolbar.heading', params: { n }, text: `H${n}`, run: (v) => prefixLines(v, `${'#'.repeat(n)} `) });

  const GROUPS: Tool[][] = [
    [
      { title: 'toolbar.bold', text: 'B', run: (v) => wrap(v, '**', placeholder()) },
      { title: 'toolbar.italic', text: 'I', run: (v) => wrap(v, '*', placeholder()) },
      { title: 'toolbar.strike', text: 'S', run: (v) => wrap(v, '~~', placeholder()) },
      { title: 'toolbar.inlineCode', icon: 'code', run: (v) => wrap(v, '`', placeholder()) },
    ],
    [heading(1), heading(2), heading(3)],
    [
      { title: 'toolbar.bullets', icon: 'list', run: (v) => prefixLines(v, '- ') },
      { title: 'toolbar.numbers', icon: 'numbers', run: (v) => prefixLines(v, (i) => `${i + 1}. `) },
      { title: 'toolbar.tasks', icon: 'tasks', run: (v) => prefixLines(v, '- [ ] ') },
      { title: 'toolbar.quote', icon: 'quote', run: (v) => prefixLines(v, '> ') },
    ],
    [
      { title: 'toolbar.link', icon: 'link', run: (v) => insertLink(v, tr('toolbar.linkText')) },
      { title: 'toolbar.table', icon: 'table', run: (v) => insertBlock(v, tableMarkdown(tr('toolbar.column'))) },
      { title: 'toolbar.rule', icon: 'rule', run: (v) => insertBlock(v, '---') },
    ],
  ];

  function use(tool: Tool) {
    const current = view();
    if (current) tool.run(current);
  }
</script>

<div class="bar" role="toolbar" aria-label={tr('toolbar.label')}>
  {#each GROUPS as group}
    <div class="group">
      {#each group as tool}
        <!-- Pressing a button must not take the selection away from the editor. -->
        <button title={tr(tool.title, tool.params)} aria-label={tr(tool.title, tool.params)} onmousedown={(e) => e.preventDefault()} onclick={() => use(tool)}>
          {#if tool.icon}<Icon name={tool.icon} size={15} />{:else}<span class="t-{tool.text}">{tool.text}</span>{/if}
        </button>
      {/each}
    </div>
  {/each}
  <div class="actions">
    <button class="labelled" onmousedown={(e) => e.preventDefault()} onclick={() => { const v = view(); if (v) startNoteLink(v); }}><Icon name="file" size={15} /> {tr('toolbar.noteLink')}</button>
    <button class="labelled" onmousedown={(e) => e.preventDefault()} onclick={ondiagram}><Icon name="diagram" size={15} /> {tr('toolbar.diagram')}</button>
    <button class="labelled" title={tr('toolbar.styleTitle')} onmousedown={(e) => e.preventDefault()} onclick={onstyle}><Icon name="palette" size={15} /> {tr('toolbar.style')}</button>
  </div>
</div>

<style>
  .bar { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 2px 10px; padding: 4px 10px; border-bottom: 1px solid var(--line); background: var(--panel); }
  .group { display: flex; gap: 1px; }
  button { display: flex; align-items: center; justify-content: center; min-width: 26px; height: 26px; padding: 0 5px; border: 0; border-radius: 6px; background: none; color: var(--text-2); font-size: 12.5px; }
  button:hover { background: var(--hover); color: var(--text); }
  .t-B { font-weight: 700; }
  .t-I { font-family: var(--serif); font-style: italic; }
  .t-S { text-decoration: line-through; }
  .actions { display: flex; gap: 4px; margin-left: auto; }
  .labelled { gap: 5px; padding: 0 9px; border: 1px solid var(--line); white-space: nowrap; }
</style>
