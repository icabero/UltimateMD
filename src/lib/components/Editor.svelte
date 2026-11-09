<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Annotation, Compartment, EditorState, type Extension } from '@codemirror/state';
  import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { HighlightStyle, indentOnInput, syntaxHighlighting, bracketMatching } from '@codemirror/language';
  import { autocompletion } from '@codemirror/autocomplete';
  import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
  import { html } from '@codemirror/lang-html';
  import { languages } from '@codemirror/language-data';
  import { tags as t } from '@lezer/highlight';
  import DiagramBuilder, { type BuilderResult, type BuilderStart } from './DiagramBuilder.svelte';
  import NoteDiagramStyle from './NoteDiagramStyle.svelte';
  import Toolbar from './Toolbar.svelte';
  import { parseSource } from '../diagramBuilder';
  import { fenceLine, parseStyle, splitFence } from '../diagramStyle';
  import { fenceAt, insertBlock, insertLink, wrap } from '../formatting';
  import { tr } from '../i18n.svelte';
  import { store, type Tab } from '../store.svelte';
  import { frontmatterChange, frontmatterValue } from '../themes';
  import { EDIT_DIAGRAM, visualMode } from '../visual';
  import { linkAt, noteCompletions, wikilinks } from '../wikilinks';

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
  // Editor states of the tabs not shown. Never drawn, so not reactive.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const states = new Map<string, EditorState>();
  const language = new Compartment();
  const mode = new Compartment();
  const PLAIN: Extension = [];
  let builder = $state<{ initial: BuilderStart | null; replace: { from: number; to: number } | null } | null>(null);
  let styling = $state(false);
  let shownKey = '';
  let shownRevision = 0;

  const languageFor = (kind: string) =>
    kind === 'html' ? html() : markdown({ base: markdownLanguage, codeLanguages: languages });

  const command = (run: (view: EditorView) => void) => (view: EditorView) => {
    run(view);
    return true;
  };
  const shortcuts = [
    { key: 'Mod-b', run: command((v) => wrap(v, '**', tr('toolbar.text'))) },
    { key: 'Mod-i', run: command((v) => wrap(v, '*', tr('toolbar.text'))) },
    { key: 'Mod-k', run: command((v) => insertLink(v, tr('toolbar.linkText'))) },
  ];

  const followWithCtrl = EditorView.domEventHandlers({
    mousedown(event, target) {
      if (!event.ctrlKey && !event.metaKey) return false;
      const pos = target.posAtCoords(event);
      const link = pos === null ? null : linkAt(target.state, pos);
      if (!link) return false;
      event.preventDefault();
      void store.followLink(tab, link.target);
      return true;
    },
  });

  function makeState(current: Tab) {
    return EditorState.create({
      doc: current.content,
      extensions: [
        lineNumbers(), history(), drawSelection(), highlightActiveLine(), indentOnInput(), bracketMatching(),
        highlightSelectionMatches(), search({ top: true }),
        keymap.of([...shortcuts, indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        syntaxHighlighting(highlight), baseTheme, EditorView.lineWrapping,
        language.of(languageFor(current.kind)),
        mode.of(PLAIN),
        ...(current.kind === 'md' ? [wikilinks, followWithCtrl, autocompletion({ override: [noteCompletions], icons: false })] : []),
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
    const wanted = current.kind === 'md' && current.view === 'visual' ? visualMode : PLAIN;
    if (mode.get(view.state) !== wanted) view.dispatch({ effects: mode.reconfigure(wanted) });
  }

  /** Opens the diagram under the cursor when the builder can read it. */
  function openBuilder() {
    if (!view) return;
    const fence = fenceAt(view.state);
    if (!fence) {
      builder = { initial: null, replace: null };
      return;
    }
    const { lang, words } = splitFence(fence.info);
    if (lang === 'mermaid' || lang === 'd2') {
      const initial = { diagram: parseSource(lang, fence.source), source: fence.source, lang, style: parseStyle(words) };
      builder = { initial, replace: { from: fence.from, to: fence.to } };
      return;
    }
    // Any other code block stays as it is; the new diagram goes after it.
    view.dispatch({ selection: { anchor: fence.to } });
    builder = { initial: null, replace: null };
  }

  /** Leaves the cursor past the diagram, so that it shows drawn in visual mode. */
  function closeBuilder() {
    if (view && builder?.replace) {
      const line = view.state.doc.lineAt(Math.min(builder.replace.to, view.state.doc.length));
      view.dispatch({ selection: { anchor: Math.min(line.to + 1, view.state.doc.length) } });
    }
    builder = null;
    view?.focus();
  }

  function saveDiagram({ source, lang, style }: BuilderResult) {
    const block = `${fenceLine(lang, style)}\n${source}\n\`\`\``;
    if (view && builder?.replace) {
      const { from, to } = builder.replace;
      view.dispatch({ changes: { from, to, insert: block } });
      builder.replace = { from, to: from + block.length };
      closeBuilder();
    } else if (view) {
      insertBlock(view, block);
      builder = null;
    }
  }

  function setNoteStyle(value: string | null) {
    if (!view) return;
    const change = frontmatterChange(view.state.doc.toString(), 'tema-diagramas', value);
    if (change) view.dispatch({ changes: change });
  }

  onMount(() => {
    view = new EditorView({ parent: host });
    view.dom.addEventListener(EDIT_DIAGRAM, openBuilder);
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
    tab.view;
    show(tab);
  });
</script>

<div class="editor">
  {#if tab.kind === 'md'}<Toolbar view={() => view} ondiagram={openBuilder} onstyle={() => (styling = true)} />{/if}
  <div class="host" bind:this={host}></div>
</div>
{#if builder}
  <DiagramBuilder {tab} initial={builder.initial} onsave={saveDiagram} onclose={closeBuilder} />
{/if}
{#if styling}
  <NoteDiagramStyle {tab} value={frontmatterValue(tab.content, 'tema-diagramas')} onchange={setNoteStyle} onclose={() => (styling = false)} />
{/if}

<style>
  .editor { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .host { flex: 1; min-height: 0; overflow: hidden; }
</style>
