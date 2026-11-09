// Turns the engines' messages, technical and in English, into what went wrong
// and where, in the language of the app. The original stays as a detail.
import { tr } from './i18n.svelte';

export interface DiagramProblem {
  /** Line of the diagram's code, from 1, when the engine says. */
  line: number | null;
  /** What is wrong, in the language of the app. */
  message: string;
  /** How many more problems the engine found. */
  more: number;
  /** The engine's own message. */
  detail: string;
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const MAX_DETAIL = 600;

interface D2Error {
  errmsg?: string;
}

/** D2's messages, as `index:LINE:COLUMN: text`, and what each one means. */
const D2_RULES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^(?:maps|arrays|block string|(?:double|single) quoted strings) must be terminated with (\S+)/, (m) => tr('diagramError.unclosed', { mark: m[1] })],
  [/^unexpected map termination character (\S+)/, (m) => tr('diagramError.extraMark', { mark: m[1] })],
  [/^connection missing destination/, () => tr('diagramError.noTarget')],
  [/^connection missing source/, () => tr('diagramError.noSource')],
  [/^unknown shape "([^"]*)"/, (m) => tr('diagramError.unknownShape', { name: m[1] })],
  [/^invalid style keyword: "([^"]*)"/, (m) => tr('diagramError.unknownStyle', { name: m[1] })],
  [/^missing value after colon/, () => tr('diagramError.missingValue')],
  [/^expected "([^"]*)" to be/, (m) => tr('diagramError.badValue', { name: m[1] })],
  [/^(\w+)(?: key "[^"]*")? must be/, (m) => tr('diagramError.badValue', { name: m[1] })],
  [/^bad (\w+)/, (m) => tr('diagramError.badValue', { name: m[1] })],
];

function d2Problem(message: string): DiagramProblem {
  let errors: D2Error[] = [];
  try {
    const parsed = JSON.parse(message);
    if (Array.isArray(parsed)) errors = parsed;
  } catch {
    errors = [{ errmsg: message }];
  }
  const first = errors[0]?.errmsg ?? message;
  const found = first.match(/^[^:\n]*:(\d+):\d+:\s*([\s\S]*)$/);
  const text = found ? found[2] : first;
  const rule = D2_RULES.map(([pattern, say]) => [text.match(pattern), say] as const).find(([m]) => m);
  return {
    line: found ? Number(found[1]) : null,
    message: rule ? rule[1](rule[0]!) : tr('diagramError.generic'),
    more: Math.max(0, errors.length - 1),
    detail: errors.length ? errors.map((e) => e.errmsg ?? '').join('\n') : message,
  };
}

interface JisonHash {
  token?: string | number;
  text?: string;
  loc?: { first_line?: number };
}

function mermaidProblem(src: string, message: string, hash: JisonHash | undefined): DiagramProblem {
  const problem = (line: number | null, text: string): DiagramProblem => ({ line, message: text, more: 0, detail: message });
  if (!src.replace(FRONTMATTER, '').trim()) return problem(null, tr('diagramError.empty'));
  if (/No diagram type detected/i.test(message)) return problem(1 + headerLines(src), tr('diagramError.unknownType'));
  // Mermaid counts lines after the header it takes off.
  const offset = headerLines(src);
  if (/^Parse error on line/i.test(message)) {
    const line = hash?.loc?.first_line ?? Number(message.match(/line (\d+)/)?.[1]);
    const ends = hash?.token === 'EOF' || /got 'EOF'/.test(message);
    const text = hash?.text?.trim();
    const say = ends ? tr('diagramError.endsEarly') : text ? tr('diagramError.unexpectedNear', { text }) : tr('diagramError.unexpected');
    return problem(clamp(src, line ? line + offset : null), say);
  }
  const lexical = message.match(/Lexical error on line (\d+)/i);
  if (lexical) return problem(clamp(src, Number(lexical[1]) + offset), tr('diagramError.unknownText'));
  // The newer grammars (pie, gitGraph, packet…) say line and column.
  const langium = message.match(/line (\d+), column \d+/);
  if (/^Parsing failed/i.test(message) && langium) {
    const character = message.match(/unexpected character: ->(.+?)<-/)?.[1];
    const say = character ? tr('diagramError.unexpectedNear', { text: character }) : /found `\s*`|EOF/.test(message) ? tr('diagramError.endsEarly') : tr('diagramError.unexpected');
    return problem(clamp(src, Number(langium[1]) + offset), say);
  }
  return problem(null, tr('diagramError.generic'));
}

function headerLines(src: string) {
  const header = src.match(FRONTMATTER)?.[0] ?? '';
  return header ? header.split('\n').length - (header.endsWith('\n') ? 1 : 0) : 0;
}

/** An error at the end of the text points to its last line, not past it. */
function clamp(src: string, line: number | null) {
  if (line === null || !Number.isFinite(line)) return null;
  const lines = src.replace(/\n+$/, '').split('\n').length;
  return Math.min(Math.max(1, line), lines);
}

/** What went wrong with a diagram, from what the engine threw. */
export function explainDiagramError(lang: string, src: string, error: unknown): DiagramProblem {
  const message = error instanceof Error ? error.message : String(error);
  const problem = lang === 'd2' ? d2Problem(message) : mermaidProblem(src, message, (error as { hash?: JisonHash })?.hash);
  return { ...problem, detail: problem.detail.slice(0, MAX_DETAIL) };
}

/** One line for the problem: where it is and what it is. */
export function describeProblem(problem: DiagramProblem) {
  const where = problem.line ? tr('diagramError.line', { n: problem.line, message: problem.message }) : problem.message;
  return problem.more ? `${where} ${tr('diagramError.more', { n: problem.more })}` : where;
}

/**
 * The box shown in place of a diagram that cannot be drawn. The engine's
 * message is folded away, for those who want it.
 */
export function diagramErrorBox(problem: DiagramProblem, onOpen?: () => void) {
  const box = document.createElement('div');
  box.className = 'diagram-error';
  box.setAttribute('role', 'alert');
  const title = document.createElement('strong');
  title.textContent = tr('diagramError.title');
  const what = document.createElement('p');
  what.textContent = describeProblem(problem);
  box.append(title, what);
  if (onOpen) {
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = tr('diagramError.open');
    open.onmousedown = (e) => e.stopPropagation();
    open.onclick = (e) => {
      e.stopPropagation();
      onOpen();
    };
    box.append(open);
  }
  if (problem.detail) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = tr('diagramError.detail');
    const pre = document.createElement('pre');
    pre.textContent = problem.detail;
    details.append(summary, pre);
    details.onmousedown = (e) => e.stopPropagation();
    box.append(details);
  }
  return box;
}
