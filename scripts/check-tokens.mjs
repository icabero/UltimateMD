// Fails when interface CSS uses a raw size where the design system has a
// token: spacing, radius, font size, shadow or layer. See
// docs/sistema-de-diseno.md. Note content (preview.css) is exempt: it is the
// document's own typography, in em.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (name.endsWith('.svelte')) yield path;
  }
}

const RULES = [
  // Hairlines of 1px are allowed; anything bigger is a step of the scale.
  { prop: /^(padding|margin)(-[a-z-]+)?$|^(row-|column-)?gap$/, bad: /(?<![\w.-])(?:[2-9]|[1-3]\d)(?:\.\d+)?px/, token: '--space-*' },
  { prop: /radius$/, bad: /\d(?:\.\d+)?px/, token: '--radius-*' },
  { prop: /^font-size$/, bad: /\d(?:\.\d+)?px/, token: '--font-*' },
  // Rings and inset lines are borders drawn with a shadow, not elevation.
  { prop: /^box-shadow$/, bad: /^(?!.*(?:var\(|inset|0 0 0 \dpx)).*\d/, token: '--shadow-*' },
  { prop: /^z-index$/, bad: /^\s*-?\d+\s*$/, token: '--z-*' },
];

const problems = [];
const sources = [join(root, 'src/app.css'), ...files(join(root, 'src'))];
for (const file of sources) {
  const text = readFileSync(file, 'utf8');
  const blocks = file.endsWith('.css') ? [{ css: text, at: 0 }] : [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => ({ css: m[1], at: m.index + m[0].indexOf(m[1]) }));
  for (const { css, at } of blocks) {
    for (const m of css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g)) {
      const [, prop, value] = m;
      if (prop.startsWith('--')) continue;
      const rule = RULES.find((r) => r.prop.test(prop));
      if (rule && rule.bad.test(value)) {
        const line = text.slice(0, at + m.index).split('\n').length;
        problems.push(`${relative(root, file)}:${line}  ${prop}: ${value.trim()}  → usa ${rule.token}`);
      }
    }
  }
}

if (problems.length) {
  console.error(`Valores sueltos donde hay una variable del sistema de diseño:\n${problems.join('\n')}`);
  process.exit(1);
}
