// Callouts, the coloured boxes of Obsidian (`> [!warning] Title`). Each type
// falls into one of five kinds, which set the colour. The Rust exporters keep
// the same table, in crates/core/src/callouts.rs.
import { tr, type Key } from './i18n.svelte';

export type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

const TYPES: [names: string[], kind: CalloutKind, title: Key][] = [
  [['note'], 'note', 'callout.note'],
  [['info'], 'note', 'callout.info'],
  [['todo'], 'note', 'callout.todo'],
  [['abstract', 'summary', 'tldr'], 'note', 'callout.summary'],
  [['example'], 'note', 'callout.example'],
  [['quote', 'cite'], 'note', 'callout.quote'],
  [['tip', 'hint'], 'tip', 'callout.tip'],
  [['success', 'check', 'done'], 'tip', 'callout.done'],
  [['important'], 'important', 'callout.important'],
  [['question', 'help', 'faq'], 'important', 'callout.question'],
  [['warning', 'caution', 'attention'], 'warning', 'callout.warning'],
  [['failure', 'fail', 'missing'], 'caution', 'callout.failure'],
  [['danger', 'error'], 'caution', 'callout.danger'],
  [['bug'], 'caution', 'callout.bug'],
];

/** The kind and default title of a type. Unknown types are notes titled with their own name. */
export function describeCallout(type: string): { kind: CalloutKind; title: string } {
  const lower = type.toLowerCase();
  const found = TYPES.find(([names]) => names.includes(lower));
  if (found) return { kind: found[1], title: tr(found[2]) };
  return { kind: 'note', title: lower.charAt(0).toUpperCase() + lower.slice(1) };
}

/** `[!type]` with an optional `+` or `-` for folding, then the title, on the first line. */
export const CALLOUT_START = /^\[!([\p{L}\p{N}_-]+)\]([+-]?)[ \t]*([^\n]*)/u;

/**
 * Turns each quote that starts with `[!type]` into a callout box. A `-` or
 * `+` after the type makes it fold, closed or open.
 */
export function shapeCallouts(root: ParentNode) {
  for (const quote of [...root.querySelectorAll('blockquote')]) {
    const first = quote.firstElementChild;
    const text = first?.tagName === 'P' ? first.firstChild : null;
    if (!(text instanceof Text)) continue;
    const match = CALLOUT_START.exec(text.data);
    if (!match) continue;
    const [whole, type, fold, written] = match;
    const { kind, title } = describeCallout(type);
    // The title is the rest of the first line; the paragraph goes on after it.
    const rest = text.data.slice(whole.length);
    const titleNodes: Node[] = [];
    if (written || rest.startsWith('\n')) {
      text.data = rest.replace(/^\n/, '');
    } else {
      // A title with formatting goes on in the next elements, up to the line break.
      text.remove();
      while (first!.firstChild && first!.firstChild.nodeName !== 'BR') {
        const node = first!.firstChild;
        const cut = node instanceof Text ? node.data.indexOf('\n') : -1;
        if (node instanceof Text && cut >= 0) {
          titleNodes.push(document.createTextNode(node.data.slice(0, cut)));
          node.data = node.data.slice(cut + 1);
          break;
        }
        titleNodes.push(node);
        node.remove();
      }
      if (first!.firstChild?.nodeName === 'BR') first!.firstChild.remove();
    }
    const box = document.createElement(fold ? 'details' : 'div');
    box.className = 'callout';
    box.dataset.callout = kind;
    box.dataset.type = type.toLowerCase();
    if (fold === '+' || fold === '') (box as HTMLDetailsElement).open = true;
    const head = document.createElement(fold ? 'summary' : 'div');
    head.className = 'callout-title';
    if (written) head.textContent = written.trim();
    else if (titleNodes.some((n) => n.textContent?.trim())) head.append(...titleNodes);
    else head.textContent = title;
    const body = document.createElement('div');
    body.className = 'callout-body';
    if (!first!.textContent?.trim() && !first!.querySelector('img')) first!.remove();
    body.append(...quote.childNodes);
    box.append(head);
    if (body.childNodes.length) box.append(body);
    quote.replaceWith(box);
  }
}
