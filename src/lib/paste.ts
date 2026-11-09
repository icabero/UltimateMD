// Pasting formatted text: what comes from a web page, Word or Google Docs
// turns into clean Markdown. Ctrl+Shift+V pastes it as plain text instead.
import { gfm } from '@joplin/turndown-plugin-gfm';
import TurndownService from 'turndown';

/** Elements that carry formatting worth keeping. Without any, plain text is better. */
const FORMATTING = 'b, strong, i, em, a[href], h1, h2, h3, h4, h5, h6, ul, ol, table, img, blockquote, pre, s, del, strike, hr';

const style = (node: Node) => (node instanceof HTMLElement ? node.getAttribute('style') ?? '' : '');
const isBold = (node: Node) => node.nodeName === 'SPAN' && /font-weight:\s*(bold|[6-9]00)/i.test(style(node));
const isItalic = (node: Node) => node.nodeName === 'SPAN' && /font-style:\s*italic/i.test(style(node));

let service: TurndownService | null = null;

function converter() {
  if (service) return service;
  service = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*', hr: '---' });
  service.use(gfm);
  service.remove(['script', 'style', 'meta', 'link', 'title', 'noscript']);
  // "- item" with one space, as people write it, and nested lines under the text.
  service.addRule('tightListItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      const parent = node.parentNode as HTMLElement;
      let prefix = `${options.bulletListMarker} `;
      if (parent.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start') ?? 1);
        prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `;
      }
      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n')
        .replace(/\n/gm, `\n${' '.repeat(prefix.length)}`);
      return prefix + body + (node.nextSibling && !body.endsWith('\n') ? '\n' : '');
    },
  });
  // Google Docs wraps everything in a <b> that is not bold.
  service.addRule('docsWrapper', {
    filter: (node) => node.nodeName === 'B' && (node as HTMLElement).id?.startsWith('docs-internal-guid'),
    replacement: (content) => content,
  });
  // Google Docs and others mark bold and italics with styles, not tags.
  service.addRule('styledBold', {
    filter: (node) => isBold(node) && !isItalic(node),
    replacement: (content) => (content.trim() ? `**${content}**` : content),
  });
  service.addRule('styledItalic', {
    filter: (node) => isItalic(node) && !isBold(node),
    replacement: (content) => (content.trim() ? `*${content}*` : content),
  });
  service.addRule('styledBoth', {
    filter: (node) => isBold(node) && isItalic(node),
    replacement: (content) => (content.trim() ? `***${content}***` : content),
  });
  return service;
}

/** Markdown for pasted HTML, or null when plain text says the same (code editors, plain pages). */
export function htmlToMarkdown(html: string): string | null {
  // A parsed document is inert: no script runs and no image loads.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const styled = [...doc.body.querySelectorAll('span[style]')].some((s) => isBold(s) || isItalic(s));
  if (!doc.body.querySelector(FORMATTING) && !styled) return null;
  const markdown = converter().turndown(doc.body).trim();
  return markdown || null;
}
