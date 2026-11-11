<script lang="ts" module>
  /** Unchanged lines shown around each change; longer stretches fold. */
  const CONTEXT = 3;
</script>

<script lang="ts">
  import { blocks } from '../diff';
  import { tr } from '../i18n.svelte';

  /** What changed from `before` to `after`, line by line, with the stretches that stay folded. */
  let { before, after }: { before: string; after: string } = $props();

  type Row = { kind: 'same' | 'del' | 'add'; text: string } | { kind: 'fold'; count: number };

  const rows = $derived.by(() => {
    const parts = blocks(before, after);
    const out: Row[] = [];
    parts.forEach((part, i) => {
      if (part.kind === 'change') {
        out.push(...part.before.map((text) => ({ kind: 'del' as const, text })), ...part.after.map((text) => ({ kind: 'add' as const, text })));
        return;
      }
      const lines = part.before;
      const head = i === 0 ? 0 : CONTEXT;
      const tail = i === parts.length - 1 ? 0 : CONTEXT;
      if (lines.length <= head + tail + 1) {
        out.push(...lines.map((text) => ({ kind: 'same' as const, text })));
        return;
      }
      out.push(...lines.slice(0, head).map((text) => ({ kind: 'same' as const, text })));
      out.push({ kind: 'fold', count: lines.length - head - tail });
      out.push(...lines.slice(lines.length - tail).map((text) => ({ kind: 'same' as const, text })));
    });
    return out;
  });

  const counts = $derived({ del: rows.filter((r) => r.kind === 'del').length, add: rows.filter((r) => r.kind === 'add').length });
</script>

<p class="counts">{tr('diff.counts', { add: counts.add, del: counts.del })}</p>
<div class="diff" role="table" aria-label={tr('diff.title')}>
  {#each rows as row, i (i)}
    {#if row.kind === 'fold'}
      <div class="fold" role="row"><span role="cell">{tr('diff.folded', { n: row.count })}</span></div>
    {:else}
      <div class="line {row.kind}" role="row">
        <span class="sign" role="cell" aria-label={row.kind === 'add' ? tr('diff.added') : row.kind === 'del' ? tr('diff.removed') : undefined}>{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}</span>
        <span class="text" role="cell">{row.text || ' '}</span>
      </div>
    {/if}
  {/each}
</div>

<style>
  .counts { margin: 0 0 var(--space-2); color: var(--text-3); font-size: var(--font-xs); }
  .diff { min-height: 0; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); font: var(--font-sm)/1.55 var(--mono); }
  .line { display: flex; }
  .sign { flex: none; width: 2em; color: var(--text-3); text-align: center; user-select: none; }
  .text { flex: 1; padding-right: var(--space-2); white-space: pre-wrap; overflow-wrap: anywhere; }
  .del { background: color-mix(in srgb, var(--danger) 14%, transparent); }
  .del .text { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--danger) 60%, transparent); }
  .add { background: color-mix(in srgb, var(--syn-string) 16%, transparent); }
  .add .sign { color: var(--syn-string); }
  .del .sign { color: var(--danger); }
  .fold { padding: var(--space-0-5) var(--space-3); border-block: 1px dashed var(--line); color: var(--text-3); font: var(--font-xs) var(--sans); }
</style>
