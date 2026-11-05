// The model behind the diagram builder, and its text in both directions, so a
// diagram made here can be reopened and changed. Anything the parsers do not
// recognise is hand-written, and the builder leaves it alone.

export type Shape = 'rect' | 'round' | 'diamond' | 'circle';
export type Engine = 'mermaid' | 'd2';
export type Direction = 'LR' | 'TD';

export interface FlowNode {
  id: string;
  label: string;
  shape: Shape;
  /** A colour of its own, over the diagram's. */
  fill?: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  label: string;
}

export interface Flow {
  kind: 'flow';
  direction: Direction;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface States {
  kind: 'state';
  direction: Direction;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Ids of the states joined to the start and end marks. Empty for none. */
  initial: string;
  final: string;
}

export interface Actor {
  id: string;
  name: string;
}

export interface Message {
  from: string;
  to: string;
  text: string;
  reply: boolean;
}

export interface Sequence {
  kind: 'sequence';
  actors: Actor[];
  messages: Message[];
}

export interface Pie {
  kind: 'pie';
  title: string;
  slices: { label: string; value: number }[];
}

export interface Gantt {
  kind: 'gantt';
  tasks: { name: string; start: string; days: number }[];
}

export interface Mindmap {
  kind: 'mindmap';
  /** In reading order; level 0 is the root. */
  items: { text: string; level: number }[];
}

export type Diagram = Flow | States | Sequence | Pie | Gantt | Mindmap;
export type Kind = Diagram['kind'];

export const hasD2 = (kind: Kind) => kind === 'flow' || kind === 'sequence';

const SHAPES: Record<Shape, [string, string]> = {
  rect: ['[', ']'],
  round: ['(', ')'],
  diamond: ['{', '}'],
  circle: ['((', '))'],
};

const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
const encode = (text: string) => flat(text).replace(/#/g, '#35;').replace(/"/g, '#quot;').replace(/;/g, '#59;').replace(/\|/g, '#124;');
const decode = (text: string) => text.replace(/#124;/g, '|').replace(/#59;/g, ';').replace(/#quot;/g, '"').replace(/#35;/g, '#');
/** Gantt lines have no way to escape these. */
const plainTask = (text: string) => flat(text.replace(/[:;#]/g, ' '));

const d2Quote = (text: string) => `"${flat(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const d2Unquote = (text: string) => text.replace(/\\(["\\])/g, '$1');

const NODE = /^(\w+)(\(\(|\[|\(|\{)"(.*)"(\)\)|\]|\)|\})$/;
const EDGE = /^(\w+) -->\s*(?:\|"?(.*?)"?\|\s*)?(\w+)$/;
const FILL = /^style (\w+) fill:(#[0-9a-f]{6})$/i;
const PARTICIPANT = /^participant (\w+) as (.+)$/;
const MESSAGE = /^(\w+) (->>|-->>) (\w+): ?(.*)$/;
const STATE = /^state "(.*)" as (\w+)$/;
const TRANSITION = /^(\w+|\[\*\]) --> (\w+|\[\*\])(?:: (.*))?$/;
const SLICE = /^"(.*)" : ([\d.]+)$/;
const TASK = /^(.+?) :t\d+, (\d{4}-\d{2}-\d{2}), (\d+)d$/;
const BRANCH = /^( +)\w+\["(.*)"\]$/;
const D2_NODE = /^(\w+): "((?:[^"\\]|\\.)*)" \{(.*)\}$/;
const D2_EDGE = /^(\w+) -> (\w+)(?:: "((?:[^"\\]|\\.)*)")?( \{style\.stroke-dash: 3\})?$/;
const D2_ACTOR = /^(\w+): "((?:[^"\\]|\\.)*)"$/;
const D2_SHAPE: Record<Shape, string> = { rect: 'rectangle', round: 'rectangle', diamond: 'diamond', circle: 'circle' };

function flowMermaid({ direction, nodes, edges }: Flow) {
  const lines = [`flowchart ${direction}`];
  for (const { id, label, shape } of nodes) {
    const [open, close] = SHAPES[shape];
    lines.push(`  ${id}${open}"${encode(label)}"${close}`);
  }
  for (const { from, to, label } of edges) lines.push(`  ${from} -->${flat(label) ? `|${encode(label)}| ` : ' '}${to}`);
  for (const { id, fill } of nodes) if (fill) lines.push(`  style ${id} fill:${fill}`);
  return lines;
}

function flowD2({ direction, nodes, edges }: Flow) {
  const lines = [`direction: ${direction === 'LR' ? 'right' : 'down'}`];
  for (const { id, label, shape, fill } of nodes) {
    const parts = [`shape: ${D2_SHAPE[shape]}`];
    if (shape === 'round') parts.push('style.border-radius: 12');
    if (fill) parts.push(`style.fill: "${fill}"`);
    lines.push(`${id}: ${d2Quote(label)} {${parts.join('; ')}}`);
  }
  for (const { from, to, label } of edges) lines.push(`${from} -> ${to}${flat(label) ? `: ${d2Quote(label)}` : ''}`);
  return lines;
}

function sequenceMermaid({ actors, messages }: Sequence) {
  const lines = ['sequenceDiagram'];
  for (const { id, name } of actors) lines.push(`  participant ${id} as ${encode(name)}`);
  for (const { from, to, text, reply } of messages) lines.push(`  ${from} ${reply ? '-->>' : '->>'} ${to}: ${encode(text)}`);
  return lines;
}

function sequenceD2({ actors, messages }: Sequence) {
  const lines = ['shape: sequence_diagram'];
  for (const { id, name } of actors) lines.push(`${id}: ${d2Quote(name)}`);
  for (const { from, to, text, reply } of messages) lines.push(`${from} -> ${to}: ${d2Quote(text)}${reply ? ' {style.stroke-dash: 3}' : ''}`);
  return lines;
}

function stateMermaid({ direction, nodes, edges, initial, final }: States) {
  const lines = ['stateDiagram-v2', `  direction ${direction === 'LR' ? 'LR' : 'TB'}`];
  for (const { id, label } of nodes) lines.push(`  state "${encode(label)}" as ${id}`);
  if (initial) lines.push(`  [*] --> ${initial}`);
  for (const { from, to, label } of edges) lines.push(`  ${from} --> ${to}${flat(label) ? `: ${encode(label)}` : ''}`);
  if (final) lines.push(`  ${final} --> [*]`);
  return lines;
}

function pieMermaid({ title, slices }: Pie) {
  const lines = ['pie showData'];
  if (flat(title)) lines.push(`  title ${flat(title)}`);
  for (const { label, value } of slices) lines.push(`  "${encode(label)}" : ${value}`);
  return lines;
}

function ganttMermaid({ tasks }: Gantt) {
  const lines = ['gantt', '  dateFormat YYYY-MM-DD'];
  tasks.forEach(({ name, start, days }, i) => lines.push(`  ${plainTask(name)} :t${i + 1}, ${start}, ${days}d`));
  return lines;
}

function mindmapMermaid({ items }: Mindmap) {
  const lines = ['mindmap'];
  items.forEach(({ text, level }, i) => lines.push(`${'  '.repeat(level + 1)}m${i}["${encode(text)}"]`));
  return lines;
}

export function toSource(diagram: Diagram, engine: Engine) {
  const d2 = engine === 'd2' && hasD2(diagram.kind);
  switch (diagram.kind) {
    case 'flow':
      return (d2 ? flowD2(diagram) : flowMermaid(diagram)).join('\n');
    case 'sequence':
      return (d2 ? sequenceD2(diagram) : sequenceMermaid(diagram)).join('\n');
    case 'state':
      return stateMermaid(diagram).join('\n');
    case 'pie':
      return pieMermaid(diagram).join('\n');
    case 'gantt':
      return ganttMermaid(diagram).join('\n');
    case 'mindmap':
      return mindmapMermaid(diagram).join('\n');
  }
}

/** Links to nodes that were never declared mean someone else wrote this. */
function closed<T extends { nodes: FlowNode[]; edges: FlowEdge[] }>(graph: T): T | null {
  const known = new Set(graph.nodes.map((n) => n.id));
  return graph.nodes.length && graph.edges.every((e) => known.has(e.from) && known.has(e.to)) ? graph : null;
}

function parseFlow(lines: string[], direction: string): Flow | null {
  const flow: Flow = { kind: 'flow', direction: direction === 'LR' ? 'LR' : 'TD', nodes: [], edges: [] };
  for (const line of lines) {
    const edge = EDGE.exec(line);
    const node = NODE.exec(line);
    const fill = FILL.exec(line);
    if (edge) {
      flow.edges.push({ from: edge[1], to: edge[3], label: decode(edge[2] ?? '') });
    } else if (fill) {
      const target = flow.nodes.find((n) => n.id === fill[1]);
      if (!target) return null;
      target.fill = fill[2].toLowerCase();
    } else if (node) {
      const shape = (Object.keys(SHAPES) as Shape[]).find((s) => SHAPES[s][0] === node[2]);
      if (!shape) return null;
      flow.nodes.push({ id: node[1], label: decode(node[3]), shape });
    } else {
      return null;
    }
  }
  return closed(flow);
}

function actorsKnown(sequence: Sequence) {
  const known = new Set(sequence.actors.map((a) => a.id));
  return sequence.actors.length && sequence.messages.every((m) => known.has(m.from) && known.has(m.to)) ? sequence : null;
}

function parseSequence(lines: string[]): Sequence | null {
  const sequence: Sequence = { kind: 'sequence', actors: [], messages: [] };
  for (const line of lines) {
    const actor = PARTICIPANT.exec(line);
    const message = MESSAGE.exec(line);
    if (actor) sequence.actors.push({ id: actor[1], name: decode(actor[2]) });
    else if (message) sequence.messages.push({ from: message[1], reply: message[2] === '-->>', to: message[3], text: decode(message[4]) });
    else return null;
  }
  return actorsKnown(sequence);
}

function parseStates(lines: string[]): States | null {
  const states: States = { kind: 'state', direction: 'TD', nodes: [], edges: [], initial: '', final: '' };
  for (const line of lines) {
    const state = STATE.exec(line);
    const step = TRANSITION.exec(line);
    if (line.startsWith('direction ')) states.direction = line.endsWith('LR') ? 'LR' : 'TD';
    else if (state) states.nodes.push({ id: state[2], label: decode(state[1]), shape: 'rect' });
    else if (step?.[1] === '[*]') states.initial = step[2];
    else if (step?.[2] === '[*]') states.final = step[1];
    else if (step) states.edges.push({ from: step[1], to: step[2], label: decode(step[3] ?? '') });
    else return null;
  }
  const ids = states.nodes.map((n) => n.id);
  if ((states.initial && !ids.includes(states.initial)) || (states.final && !ids.includes(states.final))) return null;
  return closed(states);
}

function parsePie(lines: string[]): Pie | null {
  const pie: Pie = { kind: 'pie', title: '', slices: [] };
  for (const line of lines) {
    const slice = SLICE.exec(line);
    if (line.startsWith('title ')) pie.title = line.slice('title '.length);
    else if (slice) pie.slices.push({ label: decode(slice[1]), value: Number(slice[2]) });
    else return null;
  }
  return pie;
}

function parseGantt(lines: string[]): Gantt | null {
  const gantt: Gantt = { kind: 'gantt', tasks: [] };
  for (const line of lines) {
    const task = TASK.exec(line);
    if (task) gantt.tasks.push({ name: task[1], start: task[2], days: Number(task[3]) });
    else if (line !== 'dateFormat YYYY-MM-DD') return null;
  }
  return gantt;
}

function parseMindmap(raw: string[]): Mindmap | null {
  const mindmap: Mindmap = { kind: 'mindmap', items: [] };
  for (const line of raw) {
    const branch = BRANCH.exec(line);
    if (!branch) return null;
    mindmap.items.push({ text: decode(branch[2]), level: branch[1].length / 2 - 1 });
  }
  return mindmap;
}

function parseMermaid(source: string): Diagram | null {
  const raw = source.split(/\r?\n/).filter((l) => l.trim());
  const [first, ...rest] = raw.map((l) => l.trim());
  const flow = /^(?:flowchart|graph) (LR|TD|TB)$/.exec(first ?? '');
  if (flow) return parseFlow(rest, flow[1]);
  if (first === 'sequenceDiagram') return parseSequence(rest);
  if (first === 'stateDiagram-v2') return parseStates(rest);
  if (first === 'pie showData') return parsePie(rest);
  if (first === 'gantt') return parseGantt(rest);
  if (first === 'mindmap') return parseMindmap(raw.slice(1));
  return null;
}

function parseD2Node(line: string): FlowNode | null {
  const node = D2_NODE.exec(line);
  if (!node) return null;
  const parts = Object.fromEntries(node[3].split('; ').map((p) => p.split(': ')));
  const round = parts['style.border-radius'] !== undefined;
  const shape = round ? 'round' : (Object.keys(D2_SHAPE) as Shape[]).find((s) => D2_SHAPE[s] === parts.shape);
  if (!shape) return null;
  const fill = parts['style.fill']?.replace(/"/g, '');
  return { id: node[1], label: d2Unquote(node[2]), shape, ...(fill ? { fill } : {}) };
}

function parseD2(source: string): Diagram | null {
  const [first, ...rest] = source.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (first === 'shape: sequence_diagram') {
    const sequence: Sequence = { kind: 'sequence', actors: [], messages: [] };
    for (const line of rest) {
      const actor = D2_ACTOR.exec(line);
      const message = D2_EDGE.exec(line);
      if (actor) sequence.actors.push({ id: actor[1], name: d2Unquote(actor[2]) });
      else if (message) sequence.messages.push({ from: message[1], to: message[2], text: d2Unquote(message[3] ?? ''), reply: !!message[4] });
      else return null;
    }
    return actorsKnown(sequence);
  }
  const direction = /^direction: (right|down)$/.exec(first ?? '');
  if (!direction) return null;
  const flow: Flow = { kind: 'flow', direction: direction[1] === 'right' ? 'LR' : 'TD', nodes: [], edges: [] };
  for (const line of rest) {
    const edge = D2_EDGE.exec(line);
    const node = parseD2Node(line);
    if (edge) flow.edges.push({ from: edge[1], to: edge[2], label: d2Unquote(edge[3] ?? '') });
    else if (node) flow.nodes.push(node);
    else return null;
  }
  return closed(flow);
}

/** Reads a diagram back. Null when it uses anything the builder cannot show. */
export function parseSource(lang: string, source: string): Diagram | null {
  if (lang === 'mermaid') return parseMermaid(source);
  if (lang === 'd2') return parseD2(source);
  return null;
}

/** The first id with this prefix that is free. */
export function freshId(prefix: string, taken: string[]) {
  let n = taken.length + 1;
  while (taken.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
