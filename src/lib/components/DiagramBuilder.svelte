<script lang="ts">
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { freshId, hasD2, toSource, type Diagram, type Engine, type Flow, type Gantt, type Kind, type Mindmap, type Pie, type Sequence, type Shape, type States } from '../diagramBuilder';
  import type { DiagramColor, DiagramStyle } from '../diagramStyle';
  import { TEMPLATES } from '../diagramTemplates';
  import { renderDiagram } from '../diagrams';
  import { themeName, tr, type Key } from '../i18n.svelte';
  import { store, type Tab } from '../store.svelte';
  import { THEMES, diagramColors } from '../themes';

  export interface BuilderStart {
    /** Null for a hand-written diagram: only its look can be changed here. */
    diagram: Diagram | null;
    source: string;
    lang: string;
    style: DiagramStyle;
  }
  export interface BuilderResult {
    source: string;
    lang: string;
    style: DiagramStyle;
  }

  let { tab, initial, onsave, onclose }: { tab: Tab; initial: BuilderStart | null; onsave: (result: BuilderResult) => void; onclose: () => void } = $props();

  const DELAY = 200;
  const DEFAULT_DAYS = 5;
  const KINDS: { id: Kind; label: Key }[] = [
    { id: 'flow', label: 'builder.flow' },
    { id: 'sequence', label: 'builder.sequence' },
    { id: 'state', label: 'builder.state' },
    { id: 'mindmap', label: 'builder.mindmap' },
    { id: 'pie', label: 'builder.pie' },
    { id: 'gantt', label: 'builder.gantt' },
  ];
  const SHAPES: { id: Shape; label: Key }[] = [
    { id: 'rect', label: 'builder.shapeRect' },
    { id: 'round', label: 'builder.shapeRound' },
    { id: 'diamond', label: 'builder.shapeDiamond' },
    { id: 'circle', label: 'builder.shapeCircle' },
  ];
  const COLORS: { key: DiagramColor; label: Key }[] = [
    { key: 'surface', label: 'builder.fill' },
    { key: 'border', label: 'builder.border' },
    { key: 'line', label: 'builder.line' },
    { key: 'text', label: 'builder.textColor' },
  ];

  const today = () => new Date().toISOString().slice(0, 10);

  function blank(kind: Kind): Diagram {
    switch (kind) {
      case 'flow':
        return {
          kind, direction: 'LR',
          nodes: [
            { id: 'n1', label: tr('builder.sampleStart'), shape: 'round' },
            { id: 'n2', label: tr('builder.sampleEnd'), shape: 'rect' },
          ],
          edges: [{ from: 'n1', to: 'n2', label: '' }],
        };
      case 'state':
        return {
          kind, direction: 'LR', initial: 's1', final: 's2',
          nodes: [
            { id: 's1', label: tr('builder.sampleStart'), shape: 'rect' },
            { id: 's2', label: tr('builder.sampleEnd'), shape: 'rect' },
          ],
          edges: [{ from: 's1', to: 's2', label: '' }],
        };
      case 'sequence':
        return {
          kind,
          actors: [
            { id: 'p1', name: tr('builder.sampleActor', { n: 1 }) },
            { id: 'p2', name: tr('builder.sampleActor', { n: 2 }) },
          ],
          messages: [{ from: 'p1', to: 'p2', text: tr('builder.sampleMessage'), reply: false }],
        };
      case 'pie':
        return { kind, title: '', slices: [{ label: tr('builder.sampleSlice', { n: 1 }), value: 60 }, { label: tr('builder.sampleSlice', { n: 2 }), value: 40 }] };
      case 'gantt':
        return { kind, tasks: [{ name: tr('builder.sampleTask', { n: 1 }), start: today(), days: DEFAULT_DAYS }] };
      case 'mindmap':
        return { kind, items: [{ text: tr('builder.sampleTopic'), level: 0 }, { text: tr('builder.sampleIdea', { n: 1 }), level: 1 }, { text: tr('builder.sampleIdea', { n: 2 }), level: 1 }] };
    }
  }

  const start = untrack(() => initial);
  const handWritten = start !== null && start.diagram === null;
  const editing = start !== null;
  const mermaidTemplates = TEMPLATES.filter((t) => t.lang === 'mermaid');
  const d2Templates = TEMPLATES.filter((t) => t.lang === 'd2');
  let diagram = $state<Diagram>(start?.diagram ?? blank('flow'));
  let engine = $state<Engine>(start?.lang === 'd2' ? 'd2' : 'mermaid');
  let style = $state<DiagramStyle>({ ...start?.style });
  /** Set when working on the code itself, for the types with no form. */
  let code = $state<{ template: string; lang: string; source: string } | null>(handWritten ? { template: '', lang: start.lang, source: start.source.replace(/\n$/, '') } : null);
  /** Work on each type, so that trying another one loses nothing. */
  const drafts = new Map<Kind, Diagram>();
  const codeDrafts = new Map<string, string>();

  let svg = $state('');
  let error = $state('');
  let timer: ReturnType<typeof setTimeout>;
  let run = 0;

  const lang = $derived(code ? code.lang : hasD2(diagram.kind) ? engine : 'mermaid');
  const source = $derived(code ? code.source : toSource(diagram, engine));
  const look = $derived(store.diagramLook(tab, $state.snapshot(style) as DiagramStyle));
  const current = $derived(diagramColors(look.theme));
  const customColors = $derived(COLORS.some((c) => style[c.key]));
  const own = $derived(store.vaultThemes[tab.vaultId]?.themes ?? []);

  $effect(() => {
    const [text, language, { theme, sketch }] = [source, lang, look];
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const id = ++run;
      try {
        const drawn = await renderDiagram(language, text, theme, sketch);
        if (id !== run) return;
        svg = drawn;
        error = '';
      } catch (e) {
        if (id === run) error = e instanceof Error ? e.message : String(e);
      }
    }, DELAY);
  });

  function useTemplate(id: string) {
    if (code?.template) codeDrafts.set(code.template, code.source);
    const template = TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
    code = { template: template.id, lang: template.lang, source: codeDrafts.get(template.id) ?? template.source };
  }

  function setKind(kind: Kind) {
    if (code?.template) codeDrafts.set(code.template, code.source);
    code = null;
    if (kind === diagram.kind) return;
    drafts.set(diagram.kind, $state.snapshot(diagram) as Diagram);
    diagram = drafts.get(kind) ?? blank(kind);
  }

  function addNode(graph: Flow | States) {
    const id = freshId(graph.kind === 'flow' ? 'n' : 's', graph.nodes.map((n) => n.id));
    const previous = graph.nodes.at(-1);
    graph.nodes.push({ id, label: tr('builder.step', { n: graph.nodes.length + 1 }), shape: 'rect' });
    if (previous) graph.edges.push({ from: previous.id, to: id, label: '' });
  }

  function removeNode(graph: Flow | States, id: string) {
    graph.nodes = graph.nodes.filter((n) => n.id !== id);
    graph.edges = graph.edges.filter((e) => e.from !== id && e.to !== id);
    if (graph.kind === 'state') {
      if (graph.initial === id) graph.initial = '';
      if (graph.final === id) graph.final = '';
    }
  }

  function addActor(sequence: Sequence) {
    const id = freshId('p', sequence.actors.map((a) => a.id));
    sequence.actors.push({ id, name: tr('builder.sampleActor', { n: sequence.actors.length + 1 }) });
  }

  function removeActor(sequence: Sequence, id: string) {
    sequence.actors = sequence.actors.filter((a) => a.id !== id);
    sequence.messages = sequence.messages.filter((m) => m.from !== id && m.to !== id);
  }

  function addMessage(sequence: Sequence) {
    const [from, to] = sequence.actors;
    if (from) sequence.messages.push({ from: from.id, to: (to ?? from).id, text: tr('builder.sampleMessage'), reply: false });
  }

  function addSlice(pie: Pie) {
    pie.slices.push({ label: tr('builder.sampleSlice', { n: pie.slices.length + 1 }), value: 10 });
  }

  function addTask(gantt: Gantt) {
    gantt.tasks.push({ name: tr('builder.sampleTask', { n: gantt.tasks.length + 1 }), start: gantt.tasks.at(-1)?.start ?? today(), days: DEFAULT_DAYS });
  }

  function addIdea(mindmap: Mindmap) {
    mindmap.items.push({ text: tr('builder.sampleIdea', { n: mindmap.items.length }), level: Math.max(1, mindmap.items.at(-1)?.level ?? 1) });
  }

  function nudge(mindmap: Mindmap, i: number, step: number) {
    const parent = mindmap.items[i - 1].level;
    mindmap.items[i].level = Math.min(parent + 1, Math.max(1, mindmap.items[i].level + step));
  }

  function clearColors() {
    for (const { key } of COLORS) delete style[key];
  }

  const save = () => onsave({ source, lang, style: $state.snapshot(style) as DiagramStyle });
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose(); }} />

{#snippet graphForm(graph: Flow | States)}
  <h3>{tr('builder.direction')}</h3>
  <div class="seg" role="group" aria-label={tr('builder.direction')}>
    <button class:on={graph.direction === 'LR'} onclick={() => (graph.direction = 'LR')}>{tr('builder.horizontal')}</button>
    <button class:on={graph.direction === 'TD'} onclick={() => (graph.direction = 'TD')}>{tr('builder.vertical')}</button>
  </div>

  <h3>{tr(graph.kind === 'flow' ? 'builder.steps' : 'builder.states')}</h3>
  {#each graph.nodes as node (node.id)}
    <div class="row">
      <input aria-label={tr('builder.stepName')} bind:value={node.label} />
      {#if graph.kind === 'flow'}
        <select aria-label={tr('builder.shape')} bind:value={node.shape}>
          {#each SHAPES as s}<option value={s.id}>{tr(s.label)}</option>{/each}
        </select>
        <input class="swatch" type="color" title={tr('builder.nodeColor')} aria-label={tr('builder.nodeColor')} value={node.fill ?? current.surface} oninput={(e) => (node.fill = e.currentTarget.value)} />
      {/if}
      <button class="icon" title={tr('common.remove')} onclick={() => removeNode(graph, node.id)}><Icon name="close" size={13} /></button>
    </div>
  {/each}
  <button class="add" onclick={() => addNode(graph)}><Icon name="plus" size={13} /> {tr(graph.kind === 'flow' ? 'builder.addStep' : 'builder.addState')}</button>

  {#if graph.kind === 'state'}
    <div class="ends">
      <label>{tr('builder.initial')}
        <select bind:value={graph.initial}>
          <option value="">{tr('builder.none')}</option>
          {#each graph.nodes as n (n.id)}<option value={n.id}>{n.label}</option>{/each}
        </select>
      </label>
      <label>{tr('builder.final')}
        <select bind:value={graph.final}>
          <option value="">{tr('builder.none')}</option>
          {#each graph.nodes as n (n.id)}<option value={n.id}>{n.label}</option>{/each}
        </select>
      </label>
    </div>
  {/if}

  <h3>{tr('builder.connections')}</h3>
  {#each graph.edges as edge, i}
    <div class="row">
      <select aria-label={tr('builder.from')} bind:value={edge.from}>
        {#each graph.nodes as n (n.id)}<option value={n.id}>{n.label}</option>{/each}
      </select>
      <span class="arrow">→</span>
      <select aria-label={tr('builder.to')} bind:value={edge.to}>
        {#each graph.nodes as n (n.id)}<option value={n.id}>{n.label}</option>{/each}
      </select>
      <input class="short" aria-label={tr('builder.edgeLabel')} placeholder={tr('builder.edgeLabel')} bind:value={edge.label} />
      <button class="icon" title={tr('common.remove')} onclick={() => graph.edges.splice(i, 1)}><Icon name="close" size={13} /></button>
    </div>
  {/each}
  {#if graph.nodes.length}
    <button class="add" onclick={() => graph.edges.push({ from: graph.nodes[0].id, to: graph.nodes.at(-1)!.id, label: '' })}><Icon name="plus" size={13} /> {tr('builder.addConnection')}</button>
  {/if}
{/snippet}

{#snippet sequenceForm(sequence: Sequence)}
  <h3>{tr('builder.actors')}</h3>
  {#each sequence.actors as actor (actor.id)}
    <div class="row">
      <input aria-label={tr('builder.actorName')} bind:value={actor.name} />
      <button class="icon" title={tr('common.remove')} onclick={() => removeActor(sequence, actor.id)}><Icon name="close" size={13} /></button>
    </div>
  {/each}
  <button class="add" onclick={() => addActor(sequence)}><Icon name="plus" size={13} /> {tr('builder.addActor')}</button>

  <h3>{tr('builder.messages')}</h3>
  {#each sequence.messages as message, i}
    <div class="message">
      <div class="row">
        <select aria-label={tr('builder.from')} bind:value={message.from}>
          {#each sequence.actors as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        </select>
        <span class="arrow">→</span>
        <select aria-label={tr('builder.to')} bind:value={message.to}>
          {#each sequence.actors as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
        </select>
        <button class="icon" title={tr('common.remove')} onclick={() => sequence.messages.splice(i, 1)}><Icon name="close" size={13} /></button>
      </div>
      <div class="row">
        <input aria-label={tr('builder.message')} bind:value={message.text} />
        <label class="check"><input type="checkbox" bind:checked={message.reply} /> {tr('builder.reply')}</label>
      </div>
    </div>
  {/each}
  {#if sequence.actors.length}
    <button class="add" onclick={() => addMessage(sequence)}><Icon name="plus" size={13} /> {tr('builder.addMessage')}</button>
  {/if}
{/snippet}

{#snippet pieForm(pie: Pie)}
  <h3>{tr('builder.chartTitle')}</h3>
  <div class="row"><input aria-label={tr('builder.chartTitle')} bind:value={pie.title} /></div>
  <h3>{tr('builder.slices')}</h3>
  {#each pie.slices as slice, i}
    <div class="row">
      <input aria-label={tr('builder.sliceName')} bind:value={slice.label} />
      <input class="number" type="number" min="0" aria-label={tr('builder.value')} bind:value={slice.value} />
      <button class="icon" title={tr('common.remove')} onclick={() => pie.slices.splice(i, 1)}><Icon name="close" size={13} /></button>
    </div>
  {/each}
  <button class="add" onclick={() => addSlice(pie)}><Icon name="plus" size={13} /> {tr('builder.addSlice')}</button>
{/snippet}

{#snippet ganttForm(gantt: Gantt)}
  <h3>{tr('builder.tasks')}</h3>
  {#each gantt.tasks as task, i}
    <div class="message">
      <div class="row">
        <input aria-label={tr('builder.taskName')} bind:value={task.name} />
        <button class="icon" title={tr('common.remove')} onclick={() => gantt.tasks.splice(i, 1)}><Icon name="close" size={13} /></button>
      </div>
      <div class="row">
        <label class="check">{tr('builder.startDate')} <input class="date" type="date" bind:value={task.start} /></label>
        <label class="check">{tr('builder.days')} <input class="number" type="number" min="1" bind:value={task.days} /></label>
      </div>
    </div>
  {/each}
  <button class="add" onclick={() => addTask(gantt)}><Icon name="plus" size={13} /> {tr('builder.addTask')}</button>
{/snippet}

{#snippet mindmapForm(mindmap: Mindmap)}
  <h3>{tr('builder.ideas')}</h3>
  {#each mindmap.items as item, i}
    <div class="row" style:padding-left="{item.level * 14}px">
      <input aria-label={tr('builder.ideaName')} bind:value={item.text} />
      {#if i > 0}
        <button class="icon" title={tr('builder.outdent')} onclick={() => nudge(mindmap, i, -1)}>←</button>
        <button class="icon" title={tr('builder.indent')} onclick={() => nudge(mindmap, i, 1)}>→</button>
        <button class="icon" title={tr('common.remove')} onclick={() => mindmap.items.splice(i, 1)}><Icon name="close" size={13} /></button>
      {/if}
    </div>
  {/each}
  <button class="add" onclick={() => addIdea(mindmap)}><Icon name="plus" size={13} /> {tr('builder.addIdea')}</button>
{/snippet}

<button class="scrim top" aria-label={tr('common.close')} onclick={onclose}></button>
<div class="modal" role="dialog" aria-label={tr(editing ? 'builder.editTitle' : 'builder.title')}>
  <div class="config">
    <header>
      <h2>{tr(editing ? 'builder.editTitle' : 'builder.title')}</h2>
      <button class="icon" title={tr('common.close')} onclick={onclose}><Icon name="close" /></button>
    </header>

    {#if handWritten}
      <p class="hint">{tr('builder.rawHint')}</p>
    {:else}
      <div class="kinds" role="group" aria-label={tr('builder.kind')}>
        {#each KINDS as k (k.id)}
          <button class:on={!code && diagram.kind === k.id} aria-pressed={!code && diagram.kind === k.id} onclick={() => setKind(k.id)}>{tr(k.label)}</button>
        {/each}
        <button class="more" class:on={code !== null} aria-pressed={code !== null} onclick={() => useTemplate(code?.template || TEMPLATES[0].id)}>{tr('builder.more')}</button>
      </div>

      {#if code}
        <label class="line">{tr('builder.template')}
          <select value={code.template} onchange={(e) => useTemplate(e.currentTarget.value)}>
            <optgroup label="Mermaid">
              {#each mermaidTemplates as t (t.id)}<option value={t.id}>{tr(t.label)}</option>{/each}
            </optgroup>
            <optgroup label="D2">
              {#each d2Templates as t (t.id)}<option value={t.id}>{tr(t.label)}</option>{/each}
            </optgroup>
          </select>
        </label>
      {:else if hasD2(diagram.kind)}
        <h3>{tr('builder.engine')}</h3>
        <div class="seg" role="group" aria-label={tr('builder.engine')}>
          <button class:on={engine === 'mermaid'} aria-pressed={engine === 'mermaid'} onclick={() => (engine = 'mermaid')}>Mermaid</button>
          <button class:on={engine === 'd2'} aria-pressed={engine === 'd2'} onclick={() => (engine = 'd2')}>D2</button>
        </div>
      {/if}

      {#if code}
        <!-- The code editor below stands in for the form. -->
      {:else if diagram.kind === 'flow' || diagram.kind === 'state'}
        {@render graphForm(diagram)}
      {:else if diagram.kind === 'sequence'}
        {@render sequenceForm(diagram)}
      {:else if diagram.kind === 'pie'}
        {@render pieForm(diagram)}
      {:else if diagram.kind === 'gantt'}
        {@render ganttForm(diagram)}
      {:else}
        {@render mindmapForm(diagram)}
      {/if}
    {/if}

    {#if code}
      <textarea aria-label={tr('builder.source')} spellcheck="false" bind:value={code.source}></textarea>
    {/if}

    <details class="look">
      <summary>{tr('builder.style')}</summary>
      <label class="line">{tr('builder.theme')}
        <select value={style.theme ?? ''} onchange={(e) => { if (e.currentTarget.value) style.theme = e.currentTarget.value; else delete style.theme; }}>
          <option value="">{tr('builder.inherit')}</option>
          {#if own.length}
            <optgroup label={tr('themes.fromVault')}>
              {#each own as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
            </optgroup>
          {/if}
          <optgroup label={tr('themes.included')}>
            {#each THEMES as t (t.id)}<option value={t.id}>{themeName(t)}</option>{/each}
          </optgroup>
        </select>
      </label>
      <label class="check"><input type="checkbox" checked={!!style.sketch} onchange={(e) => { if (e.currentTarget.checked) style.sketch = true; else delete style.sketch; }} /> {tr('builder.sketch')}</label>
      <div class="colors">
        {#each COLORS as c (c.key)}
          <label class="check">{tr(c.label)} <input class="swatch" type="color" value={current[c.key]} oninput={(e) => (style[c.key] = e.currentTarget.value)} /></label>
        {/each}
      </div>
      {#if customColors}<button class="add" onclick={clearColors}>{tr('builder.resetColors')}</button>{/if}
    </details>

    <footer>
      <button class="main" onclick={save}>{tr(editing ? 'builder.update' : 'builder.insert')}</button>
    </footer>
  </div>

  <div class="preview" aria-label={tr('export.preview')}>
    <div class="drawing">{@html svg}</div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if !code}
      <details>
        <summary>{tr('builder.code')}</summary>
        <pre>{source}</pre>
      </details>
    {/if}
  </div>
</div>

<style>
  .top { z-index: 32; }
  .modal { position: fixed; top: 50%; left: 50%; z-index: 33; display: grid; grid-template-columns: 410px 1fr; width: min(1060px, calc(100vw - 32px)); height: min(700px, calc(100vh - 32px)); overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); box-shadow: var(--shadow); transform: translate(-50%, -50%); }
  .config { display: flex; flex-direction: column; min-height: 0; padding: 8px 18px 14px; overflow-y: auto; }
  header { display: flex; flex: none; align-items: center; justify-content: space-between; }
  h2 { margin: 8px 0; font-size: 15px; font-weight: 650; }
  h3 { flex: none; margin: 14px 0 6px; font-size: 12px; font-weight: 650; }
  .hint { margin: 0 0 10px; color: var(--text-2); font-size: 12.5px; line-height: 1.5; }
  .kinds { display: grid; flex: none; grid-template-columns: repeat(3, 1fr); gap: 4px; }
  .kinds .more { grid-column: span 3; }
  .kinds button { padding: 6px 4px; border: 1px solid var(--line); border-radius: 7px; background: none; color: var(--text-2); font-size: 12.5px; }
  .kinds button:hover { background: var(--hover); color: var(--text); }
  .kinds .on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-text); }
  .seg { display: inline-flex; flex: none; align-self: flex-start; padding: 2px; border-radius: 8px; background: var(--hover); }
  .seg button { padding: 4px 12px; border: 0; border-radius: 6px; background: none; color: var(--text-2); font-size: 12.5px; }
  .seg .on { background: var(--raised); color: var(--text); box-shadow: 0 1px 2px rgb(0 0 0 / 15%); }
  .row { display: flex; flex: none; align-items: center; gap: 6px; min-width: 0; margin-bottom: 5px; }
  .row input:not([type='checkbox']):not([type='color']) { flex: 1; min-width: 0; height: 28px; font-size: 12.5px; }
  .row input.short { flex: 0 1 90px; }
  .row input.number { flex: 0 0 70px; }
  .row input.date { flex: 0 0 130px; }
  .row select { flex: 1 1 0; min-width: 0; }
  .message { flex: none; margin-bottom: 6px; padding-bottom: 2px; border-bottom: 1px solid var(--line); }
  .ends { display: grid; flex: none; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
  .ends label { display: grid; gap: 3px; color: var(--text-2); font-size: 12px; }
  select { padding: 3px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--text); font: inherit; font-size: 12.5px; }
  .arrow { flex: none; color: var(--text-3); }
  .check { display: flex; flex: none; align-items: center; gap: 5px; color: var(--text-2); font-size: 12px; }
  .swatch { flex: none; width: 28px; height: 24px; padding: 0; border: 1px solid var(--line); border-radius: 4px; background: none; }
  .add { display: flex; flex: none; align-items: center; align-self: flex-start; gap: 4px; padding: 3px 9px; border: 1px solid var(--line); border-radius: 6px; background: none; color: var(--text-2); font-size: 12px; }
  .add:hover { background: var(--hover); color: var(--text); }
  textarea { flex: 1 0 220px; width: 100%; margin-top: 10px; padding: 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); color: var(--text); font: 12.5px/1.5 var(--mono); resize: none; user-select: text; }
  .look { flex: none; margin-top: 16px; padding-top: 10px; border-top: 1px solid var(--line); }
  .look summary { font-size: 12px; font-weight: 650; cursor: default; }
  .line { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 10px 0 8px; color: var(--text-2); font-size: 12.5px; }
  .line select { width: 220px; }
  .colors { display: flex; flex-wrap: wrap; gap: 8px 14px; margin: 10px 0 8px; }
  footer { display: flex; flex: none; justify-content: flex-end; margin-top: auto; padding-top: 14px; }
  .main { padding: 6px 16px; border: 1px solid var(--accent); border-radius: 7px; background: var(--accent); color: var(--on-accent); font-size: 13px; }
  .preview { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 16px; overflow: auto; border-left: 1px solid var(--line); background: var(--bg); }
  .drawing { display: flex; flex: 1; align-items: center; justify-content: center; min-height: 0; }
  .drawing :global(svg) { max-width: 100%; height: auto; }
  .error { flex: none; max-height: 40%; margin: 10px 0 0; overflow: auto; color: var(--danger); font-size: 12.5px; white-space: pre-wrap; }
  details:not(.look) { flex: none; margin-top: 10px; color: var(--text-2); font-size: 12px; }
  pre { margin: 6px 0 0; padding: 10px; overflow-x: auto; border-radius: 8px; background: var(--panel); font: 12px/1.5 var(--mono); }
</style>
