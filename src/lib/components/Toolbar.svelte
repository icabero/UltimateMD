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
  const LEVELS = [1, 2, 3, 4, 5, 6];

  const GROUPS: Tool[][] = [
    [
      { title: 'toolbar.bold', text: 'B', run: (v) => wrap(v, '**', placeholder()) },
      { title: 'toolbar.italic', text: 'I', run: (v) => wrap(v, '*', placeholder()) },
      { title: 'toolbar.strike', text: 'S', run: (v) => wrap(v, '~~', placeholder()) },
      { title: 'toolbar.inlineCode', icon: 'code', run: (v) => wrap(v, '`', placeholder()) },
    ],
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

  /** The menu is an action, not a state: it goes back to its label each time. */
  function setHeading(menu: HTMLSelectElement) {
    const level = Number(menu.value);
    menu.value = '';
    const current = view();
    if (current) prefixLines(current, level ? `${'#'.repeat(level)} ` : '');
  }

  function use(tool: Tool) {
    const current = view();
    if (current) tool.run(current);
  }
</script>

<div class="bar" role="toolbar" aria-label={tr('toolbar.label')}>
  <select class="headings" aria-label={tr('toolbar.headingMenu')} title={tr('toolbar.headingMenu')} value="" onchange={(e) => setHeading(e.currentTarget)}>
    <option value="" hidden>{tr('toolbar.headingMenu')}</option>
    <option value="0">{tr('toolbar.paragraph')}</option>
    {#each LEVELS as n}<option value={String(n)}>{tr('toolbar.heading', { n })}</option>{/each}
  </select>
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
  .bar { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: var(--space-0-5) var(--space-2-5); padding: var(--space-1) var(--space-2-5); border-bottom: 1px solid var(--line); background: var(--panel); }
  .group { display: flex; gap: 1px; }
  .headings { flex: none; width: 104px; height: 26px; padding: 0 var(--space-1); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); color: var(--text-2); font: inherit; font-size: var(--font-sm); }
  button { display: flex; align-items: center; justify-content: center; min-width: 26px; height: 26px; padding: 0 var(--space-1-5); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text-2); font-size: var(--font-sm); }
  button:hover { background: var(--hover); color: var(--text); }
  .t-B { font-weight: 700; }
  .t-I { font-family: var(--serif); font-style: italic; }
  .t-S { text-decoration: line-through; }
  .actions { display: flex; gap: var(--space-1); margin-left: auto; }
  .labelled { gap: var(--space-1-5); padding: 0 var(--space-2-5); border: 1px solid var(--line); white-space: nowrap; }
</style>
