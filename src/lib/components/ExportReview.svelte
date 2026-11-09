<script lang="ts">
  import Icon from './Icon.svelte';
  import type { ExportProblem } from '../export';
  import { tr } from '../i18n.svelte';
  import { stem } from '../paths';

  /** `null` while the notes are being checked. */
  let { problems, ongo }: { problems: ExportProblem[] | null; ongo: (problem: ExportProblem) => void } = $props();
</script>

<section class="review" aria-label={tr('review.title')} aria-busy={problems === null}>
  {#if problems === null}
    <p class="hint">{tr('review.looking')}</p>
  {:else if !problems.length}
    <p class="ok"><Icon name="check" size={14} /> {tr('review.ok')}</p>
  {:else}
    <p class="hint">{problems.length === 1 ? tr('review.countOne') : tr('review.count', { n: problems.length })}</p>
    <ul>
      {#each problems as problem, i (i)}
        <li>
          <button class="problem {problem.kind}" onclick={() => ongo(problem)}>
            <span class="text">{problem.text}</span>
            <span class="where">{tr('review.where', { note: stem(problem.note), line: problem.line })}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .review { display: flex; flex-direction: column; min-height: 0; }
  p { margin: 0; color: var(--text-2); font-size: var(--font-sm); line-height: 1.5; }
  .ok { display: flex; gap: var(--space-1-5); align-items: flex-start; }
  .ok :global(svg) { flex: none; margin-top: var(--space-0-5); color: var(--accent-text); }
  ul { min-height: 0; margin: var(--space-1-5) 0 0; padding: 0; overflow-y: auto; list-style: none; }
  .problem { display: flex; flex-direction: column; gap: var(--space-0-5); width: 100%; padding: var(--space-1-5) var(--space-2); border: 1px solid transparent; border-radius: var(--radius-sm); background: var(--warn); color: var(--text); font-size: var(--font-sm); text-align: left; }
  .problem:hover { border-color: var(--line); }
  li + li { margin-top: var(--space-1); }
  .where { color: var(--text-3); font-size: var(--font-xs); }
</style>
