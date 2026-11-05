<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Annotation, Compartment, EditorState } from '@codemirror/state';
  import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { HighlightStyle, indentOnInput, syntaxHighlighting, bracketMatching } from '@codemirror/language';
  import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
  import { html } from '@codemirror/lang-html';
  import { languages } from '@codemirror/language-data';
  import { tags as t } from '@lezer/highlight';
  import { store, type Tab } from '../store.svelte';

  let { tab, onscroll }: { tab: Tab; onscroll?: (ratio: number) => void } = $props();

  const external = Annotation.define<boolean>();
  const highlight = HighlightStyle.define([
    { tag: t.heading, color: 'var(--text)', fontWeight: '700' },
    { tag: t.heading1, fontSize: '1.3em' },
    { tag: t.heading2, fontSize: '1.15em' },
    { tag: t.strong, fontWeight: '700' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: [t.link, t.url], color: 'var(--accent-text)' },
    { tag: [t.monospace, t.string], color: 'var(--syn-string)' },
    { tag: [t.keyword, t.tagName], color: 'var(--syn-keyword)' },
    { tag: [t.comment, t.meta, t.processingInstruction], color: 'var(--text-3)' },
    { tag: [t.number, t.bool, t.atom], color: 'var(--syn-number)' },
    { tag: [t.attributeName, t.propertyName], color: 'var(--syn-attr)' },
    { tag: t.quote, color: 'var(--text-2)', fontStyle: 'italic' },
  ]);

  const baseTheme = EditorView.theme({
    '&': { height: '100%', background: 'var(--bg)', color: 'var(--text)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--mono)', fontSize: '13.5px', lineHeight: '1.65', overflow: 'auto' },
    '.cm-content': { padding: '20px 0 40vh', caretColor: 'var(--accent)' },
    '.cm-line': { padding: '0 22px' },
    '.cm-gutters': { background: 'var(--bg)', color: 'var(--text-3)', border: 'none', fontSize: '11.5px' },
    '.cm-activeLine, .cm-activeLineGutter': { background: 'var(--hover)' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { background: 'var(--selection) !important' },
    '.cm-panels': { background: 'var(--panel)', color: 'var(--text)', borderColor: 'var(--line)' },
    '.cm-searchMatch': { background: 'var(--accent-soft)' },
  });

  let host: HTMLDivElement;
  let view: EditorView | null = null;
  const states = new Map<string, EditorState>();
  const language = new Compartment();
  let shownKey = '';
  let shownRevision = 0;

  const languageFor = (kind: string) =>
    kind === 'html' ? html() : markdown({ base: markdownLanguage, codeLanguages: languages });

  function makeState(current: Tab) {
    return EditorState.create({
      doc: current.content,
      extensions: [
        lineNumbers(), history(), drawSelection(), highlightActiveLine(), indentOnInput(), bracketMatching(),
        highlightSelectionMatches(), search({ top: true }),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        syntaxHighlighting(highlight), baseTheme, EditorView.lineWrapping,
        language.of(languageFor(current.kind)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((tr) => tr.annotation(external))) store.edit(tab, u.state.doc.toString());
        }),
      ],
    });
  }

  function show(current: Tab) {
    if (!view) return;
    if (shownKey !== current.key) {
      if (shownKey) states.set(shownKey, view.state);
      view.setState(states.get(current.key) ?? makeState(current));
      shownKey = current.key;
      shownRevision = current.revision;
    }
    // An edit made outside this editor stays undoable.
    if (shownRevision !== current.revision || view.state.doc.toString() !== current.content) {
      shownRevision = current.revision;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: current.content },
        annotations: external.of(true),
      });
    }
  }

  onMount(() => {
    view = new EditorView({ parent: host });
    const scroller = view.scrollDOM;
    scroller.addEventListener('scroll', () => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      onscroll?.(max > 0 ? scroller.scrollTop / max : 0);
    }, { passive: true });
    show(tab);
    view.focus();
  });

  onDestroy(() => view?.destroy());

  $effect(() => {
    tab.content;
    tab.revision;
    show(tab);
  });
</script>

<div class="host" bind:this={host}></div>

<style>
  .host { height: 100%; min-height: 0; overflow: hidden; }
</style>
